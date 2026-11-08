import re
from collections import OrderedDict
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from starlette.concurrency import run_in_threadpool

import models
from case_import import (
    MAX_WORKBOOK_BYTES,
    extract_case_title_client_names,
    normalize_binary_indicator,
    read_workbook,
    resolve_incident_location,
)
from schemas import CaseImportPayload


def validate_client_contact_number(
    value: Any,
    existing_value: Any = None,
    *,
    required: bool = False,
) -> None:
    if value == existing_value and existing_value not in (None, ""):
        return
    if value in (None, ""):
        if required:
            raise HTTPException(status_code=422, detail="Contact number is required.")
        return
    if not isinstance(value, str) or re.fullmatch(r"[0-9]{1,11}", value) is None:
        raise HTTPException(
            status_code=422,
            detail="Contact number must contain up to 11 digits using numbers only.",
        )


def attach_case_participants(
    record: models.Case,
    participants: list[tuple[models.Client, Any, Any, Any]],
    limit_text,
) -> None:
    """Attach clients through the shared CaseClient relationship used by case creation."""
    for client, party_represented, applicant_role, applicant_role_other in participants:
        record.participants.append(
            models.CaseClient(
                client=client,
                party_represented=limit_text(party_represented, 100),
                applicant_role=applicant_role,
                applicant_role_other=applicant_role_other,
            )
        )


def register_import_routes(
    app: FastAPI,
    *,
    current_user,
    get_db,
    scoped_client_query,
    parse_date,
    limit_text,
    normalize_sex,
    normalize_case_status,
    display_role_name,
    write_audit,
) -> None:
    @app.post("/api/case-imports/preview")
    async def preview_case_import(
        file: UploadFile = File(...),
        case_type: Literal["Criminal", "Civil"] = Form(...),
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        filename = Path(file.filename or "").name
        if Path(filename).suffix.lower() not in {".xlsx", ".xls"}:
            raise HTTPException(status_code=422, detail="Choose an .xlsx or .xls file.")
        content = await file.read(MAX_WORKBOOK_BYTES + 1)
        try:
            source_rows, rows_processed, workbook_format = await run_in_threadpool(read_workbook, content, filename)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        finally:
            await file.close()

        control_numbers = [str(row.get("control_no") or "").strip() for row in source_rows]
        duplicate_types: dict[str, set[str]] = {}
        if control_numbers:
            duplicate_rows = (
                db.query(models.IntakeRecord.control_no, models.Case.case_type)
                .join(models.Case, models.Case.intake_id == models.IntakeRecord.intake_id)
                .filter(models.IntakeRecord.control_no.in_(set(filter(None, control_numbers))))
                .all()
            )
            for control_no, existing_type in duplicate_rows:
                duplicate_types.setdefault(str(control_no), set()).add(existing_type or "Criminal")

        grouped: OrderedDict[str, dict[str, Any]] = OrderedDict()
        for row in source_rows:
            control_no = str(row.get("control_no") or "").strip()
            group_key = control_no or f"__missing_control_{row['_row_number']}"
            group = grouped.setdefault(
                group_key,
                {
                    "control_no": control_no,
                    "source_rows": [],
                    "clients": [],
                    "conflicts": [],
                    "conflict_values": {},
                    "fields": {},
                    "location_indicator_rows": [],
                    "has_client_name_column": bool(row.get("_client_name_column_present")),
                },
            )
            group["source_rows"].append(row["_row_number"])
            shared_fields = (
                "title",
                "court",
                "case_no",
                "cause_of_action",
                "nature_of_case",
                "status",
                "last_action",
                "cause_of_termination",
                "date_of_termination",
                "date_of_confinement",
                "place_of_detention",
                "case_received",
                "location_type",
                "incident_barangay",
            )
            for field in shared_fields:
                value = row.get(field)
                if value in (None, ""):
                    continue
                if field not in {"date_of_termination", "date_of_confinement", "case_received"}:
                    value = str(value).strip()
                existing = group["fields"].get(field)
                if existing in (None, ""):
                    group["fields"][field] = value
                elif str(existing).strip() != str(value).strip():
                    if field not in group["conflicts"]:
                        group["conflicts"].append(field)
                    values = group["conflict_values"].setdefault(field, [existing])
                    if all(str(candidate).strip() != str(value).strip() for candidate in values):
                        values.append(value)
            client_values = {
                field: row.get(field)
                for field in (
                    "client_name",
                    "age",
                    "sex",
                    "civil_status",
                    "religion",
                    "educational_attainment",
                    "citizenship",
                    "language_dialect",
                    "address",
                    "contact_no",
                    "relationship",
                    "party_represented",
                    "urban",
                    "rural",
                    "drugs",
                    "female",
                    "senior",
                    "cicl",
                )
            }
            for field in (
                "client_name",
                "sex",
                "civil_status",
                "religion",
                "educational_attainment",
                "citizenship",
                "language_dialect",
                "address",
                "contact_no",
                "relationship",
                "party_represented",
            ):
                if client_values[field] not in (None, ""):
                    client_values[field] = str(client_values[field]).strip()

            for flag in ("urban", "rural"):
                client_values[flag] = normalize_binary_indicator(client_values[flag])
            grouped[group_key]["location_indicator_rows"].append((client_values["urban"], client_values["rural"]))
            for flag in ("drugs", "female", "senior", "cicl"):
                client_values[flag] = normalize_binary_indicator(client_values[flag])
            client_values["location_indicators_present"] = bool(
                row.get("_urban_column_present") or row.get("_rural_column_present")
            )
            client_values["source_row"] = row["_row_number"]
            client_values["flags_reviewed"] = True
            client_values["possible_matches"] = []
            grouped[group_key]["clients"].append(client_values)

        names_to_match = set()
        for group in grouped.values():
            clients = group["clients"]
            if not group["has_client_name_column"] and "title" not in group["conflicts"]:
                title_names = extract_case_title_client_names(group["fields"].get("title"))
                if title_names and len(title_names) == len(clients):
                    for client, name in zip(clients, title_names):
                        client["client_name"] = name
            names_to_match.update(
                str(client.get("client_name") or "").strip().casefold()
                for client in clients
                if str(client.get("client_name") or "").strip()
            )

        clients_by_name: dict[str, list[models.Client]] = {}
        if names_to_match:
            existing_clients = (
                scoped_client_query(db, user)
                .options(joinedload(models.Client.details))
                .filter(func.lower(models.Client.name).in_(names_to_match))
                .order_by(models.Client.client_id)
                .all()
            )
            for existing_client in existing_clients:
                clients_by_name.setdefault(existing_client.name.strip().casefold(), []).append(existing_client)
        for group in grouped.values():
            for client in group["clients"]:
                name = str(client.get("client_name") or "").strip().casefold()
                client["possible_matches"] = [
                    {
                        "client_id": candidate.client_id,
                        "name": candidate.name,
                        "age": candidate.age,
                        "sex": candidate.sex,
                        "address": candidate.details.address if candidate.details else None,
                    }
                    for candidate in clients_by_name.get(name, [])[:5]
                ]

        results = []
        for index, (_, group) in enumerate(grouped.items()):
            fields = dict(group["fields"])
            mapped_location, location_conflict = resolve_incident_location(group["location_indicator_rows"])
            for conflict in group["conflicts"]:
                fields[conflict] = ""
            fields["location_type"] = mapped_location or ""
            fields["incident_barangay"] = ""
            errors: list[str] = []
            if location_conflict:
                errors.append("Conflicting Urban/Rural indicators require Incident Location review.")
                group["conflict_values"]["incident_location_indicators"] = [
                    f"Urban={urban or '(blank)'}, Rural={rural or '(blank)'}"
                    for urban, rural in group["location_indicator_rows"]
                ]
            control_no = group["control_no"]
            if not control_no:
                errors.append("Control Number is missing.")
            elif len(control_no) > 20:
                errors.append("Control Number exceeds the 20-character database limit.")
            if not fields.get("title"):
                errors.append("Title of the Case is required.")
            elif len(str(fields.get("title"))) > 255:
                errors.append("Title of the Case exceeds the 255-character database limit.")
            if len(str(fields.get("case_no") or "")) > 20:
                errors.append("Case Number exceeds the 20-character database limit.")
            if len(str(fields.get("court") or "")) > 255:
                errors.append("Court / Body exceeds the 255-character database limit.")
            if str(fields.get("status") or "").strip().lower() not in {"pending", "terminated"}:
                errors.append("Status must be Pending or Terminated.")
            received = fields.get("case_received")
            if received in (None, ""):
                errors.append("Case Received date is required.")
            elif parse_date(received) is None:
                errors.append("Case Received date is invalid.")
            for date_field in ("date_of_termination", "date_of_confinement"):
                date_value = fields.get(date_field)
                if date_value not in (None, "") and parse_date(date_value) is None:
                    errors.append(f"{date_field.replace('_', ' ').title()} is invalid.")
            for conflict in group["conflicts"]:
                errors.append(f"Conflicting {conflict.replace('_', ' ')} values share this Control Number.")
            if not group["clients"]:
                errors.append("At least one client row is required.")
            for client_index, client in enumerate(group["clients"]):
                if not str(client.get("client_name") or "").strip():
                    errors.append(f"Client {client_index + 1}: Client Name is missing; enter it before import.")
                elif len(str(client.get("client_name"))) > 255:
                    errors.append(f"Client {client_index + 1}: Client Name exceeds the 255-character database limit.")
                age = client.get("age")
                if age in (None, ""):
                    errors.append(f"Client {client_index + 1}: Age is required for a new client.")
                else:
                    try:
                        numeric_age = float(age)
                        if not numeric_age.is_integer() or numeric_age < 0 or numeric_age > 150:
                            raise ValueError
                    except (TypeError, ValueError):
                        errors.append(f"Client {client_index + 1}: Age must be a whole number from 0 to 150.")
                sex = str(client.get("sex") or "").strip().lower()
                if sex not in {"m", "male", "f", "female"}:
                    errors.append(f"Client {client_index + 1}: Gender / Sex is required and must be Male or Female.")
                for field, label in (
                    ("civil_status", "Civil Status"),
                    ("religion", "Religion"),
                    ("educational_attainment", "Educational Attainment"),
                    ("citizenship", "Citizenship"),
                    ("language_dialect", "Language / Dialect"),
                    ("address", "Address"),
                ):
                    if not str(client.get(field) or "").strip():
                        errors.append(f"Client {client_index + 1}: {label} is required for a new client.")
                for field, label, max_length in (
                    ("civil_status", "Civil Status", 50),
                    ("religion", "Religion", 100),
                    ("educational_attainment", "Educational Attainment", 150),
                    ("citizenship", "Citizenship", 100),
                    ("language_dialect", "Language / Dialect", 100),
                    ("relationship", "Relationship to Applicant", 100),
                ):
                    if len(str(client.get(field) or "")) > max_length:
                        errors.append(f"Client {client_index + 1}: {label} exceeds the {max_length}-character limit.")
                contact = str(client.get("contact_no") or "").strip()
                if not contact or re.fullmatch(r"[0-9]{1,11}", contact) is None:
                    errors.append(f"Client {client_index + 1}: Contact Number is required and must contain up to 11 digits.")
                for flag in ("drugs", "female", "senior", "cicl"):
                    flag_value = str(client.get(flag) or "").strip().lower()
                    if flag_value and flag_value not in {"1", "0", "yes", "no", "true", "false", "y", "n"}:
                        errors.append(f"Client {client_index + 1}: {flag.title()} must be a yes/no value.")
                if any(client.get(flag) not in (None, "") for flag in ("female", "senior", "cicl")) and not client.get("flags_reviewed"):
                    errors.append(f"Client {client_index + 1}: review the Female, Senior, and CICL indicators before import.")
            found_types = duplicate_types.get(control_no, set()) if control_no else set()
            duplicate = bool(found_types)
            duplicate_message = None
            if duplicate:
                duplicate_message = (
                    "Control Number already exists in this case category."
                    if case_type in found_types
                    else "Control Number already exists under a different case category."
                )
            results.append(
                {
                    "import_key": f"case-{index + 1}",
                    "control_no": control_no,
                    "title": fields.get("title") or "",
                    "court": fields.get("court") or "",
                    "case_no": fields.get("case_no") or "",
                    "cause_of_action": fields.get("cause_of_action") or "",
                    "nature_of_case": fields.get("nature_of_case") or "",
                    "status": fields.get("status") or "",
                    "last_action": fields.get("last_action") or "",
                    "cause_of_termination": fields.get("cause_of_termination") or "",
                    "date_of_termination": fields.get("date_of_termination") or "",
                    "date_of_confinement": fields.get("date_of_confinement") or "",
                    "place_of_detention": fields.get("place_of_detention") or "",
                    "case_received": received or "",
                    "location_type": fields.get("location_type") or "",
                    "incident_barangay": fields.get("incident_barangay") or "",
                    "incident_city": "Panabo City" if fields.get("location_type") or fields.get("incident_barangay") else "",
                    "clients": group["clients"],
                    "source_rows": group["source_rows"],
                    "errors": errors,
                    "conflicting_values": {
                        field: [value.isoformat() if isinstance(value, (date, datetime)) else str(value) for value in values]
                        for field, values in group["conflict_values"].items()
                    },
                    "duplicate": duplicate,
                    "duplicate_message": duplicate_message,
                    "ready": not errors and not duplicate,
                }
            )
        return {
            "source_filename": filename,
            "workbook_format": workbook_format,
            "case_type": case_type,
            "rows_processed": rows_processed,
            "cases": results,
            "summary": {
                "unique_cases": len(results),
                "client_records": sum(len(item["clients"]) for item in results),
                "ready_cases": sum(bool(item["ready"]) for item in results),
                "correction_cases": sum(bool(item["errors"]) for item in results),
                "duplicate_cases": sum(bool(item["duplicate"]) for item in results),
                "client_matches": sum(bool(client["possible_matches"]) for item in results for client in item["clients"]),
            },
        }

    @app.post("/api/case-imports")
    def import_case_records(
        payload: CaseImportPayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        imported = created_clients = linked_clients = failed = 0
        held = max(0, payload.held_case_count)
        failures: list[dict[str, str]] = []
        urban_barangays = {
            "Cagangohan",
            "Datu Abdul Dadia",
            "Gredu (Poblacion)",
            "J.P. Laurel",
            "New Pandan (Poblacion)",
            "New Visayas",
            "Quezon",
            "San Francisco (Poblacion)",
            "San Vicente",
            "Salvacion",
            "Santo Nino (Poblacion)",
        }
        rural_barangays = {
            "A. O. Floirendo",
            "Buenavista",
            "Cacao",
            "Consolacion",
            "Dapco",
            "Kasilak",
            "Katipunan",
            "Katualan",
            "Kauswagan",
            "Kiotoy",
            "Little Panay",
            "Lower Panaga (Roxas)",
            "Mabunao",
            "Maduao",
            "Malativas",
            "Manay",
            "Nanyo",
            "New Malaga (Dalisay)",
            "New Malitbog",
            "San Nicolas",
            "San Pedro",
            "San Roque",
            "Santa Cruz",
            "Sindaton",
            "Southern Davao",
            "Tagpore",
            "Tibungol",
            "Upper Licanan",
            "Waterfall",
        }
        for entry in payload.cases:
            entry_case_type = entry.get("case_type")
            if entry_case_type not in (None, "", payload.case_type):
                failed += 1
                failures.append(
                    {
                        "control_no": str(entry.get("control_no") or "(missing)"),
                        "reason": "Case classification must match the selected import destination.",
                    }
                )
                continue
            control_no = str(entry.get("control_no") or "").strip()
            title = str(entry.get("title") or "").strip()
            status_raw = str(entry.get("status") or "").strip()
            clients = entry.get("clients") or []
            received_raw = entry.get("case_received")
            if (
                not control_no
                or len(control_no) > 20
                or not title
                or len(title) > 255
                or str(entry.get("nature_of_case") or "").strip()
                not in {"Criminal", "Administrative", "Civil", "Labor", "Appeal"}
                or status_raw.lower() not in {"pending", "terminated"}
                or not clients
                or parse_date(received_raw) is None
                or len(str(entry.get("case_no") or "")) > 20
                or len(str(entry.get("court") or "")) > 255
                or any(
                    entry.get(field) not in (None, "") and parse_date(entry.get(field)) is None
                    for field in ("date_of_termination", "date_of_confinement")
                )
                or (entry.get("has_conflicts") and not entry.get("conflict_reviewed"))
            ):
                held += 1
                continue
            location_type = str(entry.get("location_type") or "").strip()
            incident_barangay = str(entry.get("incident_barangay") or "").strip()
            allowed_barangays = (
                urban_barangays
                if location_type == "Urban"
                else rural_barangays
                if location_type == "Rural"
                else set()
            )
            if (
                location_type not in {"Urban", "Rural"}
                or not incident_barangay
                or incident_barangay not in allowed_barangays
            ):
                held += 1
                failures.append(
                    {
                        "control_no": control_no or "(missing)",
                        "reason": "Review and select a valid Incident Location type and matching Panabo Barangay.",
                    }
                )
                continue
            if (
                db.query(models.Case.case_id)
                .join(models.IntakeRecord, models.Case.intake_id == models.IntakeRecord.intake_id)
                .filter(models.IntakeRecord.control_no == control_no)
                .first()
            ):
                held += 1
                failures.append(
                    {"control_no": control_no, "reason": "Duplicate Control Number; existing record was not changed."}
                )
                continue
            savepoint = db.begin_nested()
            case_created_clients = case_linked_clients = 0
            try:
                resolved_clients = []
                for client_data in clients:
                    if len(str(client_data.get("party_represented") or "")) > 100:
                        raise ValueError("Party Represented exceeds the 100-character limit.")
                    for indicator in ("drugs", "female", "senior", "cicl"):
                        raw_value = str(client_data.get(indicator) or "").strip().lower()
                        if raw_value and raw_value not in {"1", "0", "yes", "no", "true", "false", "y", "n"}:
                            raise ValueError(f"{indicator.title()} must be a yes/no value.")
                    if any(client_data.get(flag) not in (None, "") for flag in ("female", "senior", "cicl")) and not client_data.get("flags_reviewed"):
                        raise ValueError("Review the Female, Senior, and CICL indicators before import.")
                    client_id = client_data.get("existing_client_id")
                    if client_id:
                        existing_client = (
                            scoped_client_query(db, user)
                            .filter(models.Client.client_id == int(client_id))
                            .first()
                        )
                        if not existing_client:
                            raise ValueError("A selected existing client is no longer available.")
                        selected_name = str(client_data.get("client_name") or "").strip()
                        if selected_name and existing_client.name.strip().casefold() != selected_name.casefold():
                            raise ValueError("The selected client name no longer matches the extracted client.")
                        resolved_clients.append((existing_client, client_data))
                        case_linked_clients += 1
                        continue
                    client_name = str(client_data.get("client_name") or "").strip()
                    if not client_name or len(client_name) > 255:
                        raise ValueError("Client Name is required and must be 255 characters or fewer.")
                    for field, label, max_length in (
                        ("civil_status", "Civil Status", 50),
                        ("religion", "Religion", 100),
                        ("educational_attainment", "Educational Attainment", 150),
                        ("citizenship", "Citizenship", 100),
                        ("language_dialect", "Language / Dialect", 100),
                        ("relationship", "Relationship to Applicant", 100),
                    ):
                        if len(str(client_data.get(field) or "")) > max_length:
                            raise ValueError(f"{label} exceeds the {max_length}-character limit.")
                    age_value = client_data.get("age")
                    if age_value in (None, ""):
                        raise ValueError("Age is required for a new client.")
                    numeric_age = float(age_value)
                    age = int(numeric_age)
                    if not numeric_age.is_integer():
                        raise ValueError(f"Age for {client_name} must be a whole number.")
                    if age is not None and (age < 0 or age > 150):
                        raise ValueError(f"Invalid age for {client_name}.")
                    sex_value = str(client_data.get("sex") or "").strip().lower()
                    if sex_value and sex_value not in {"m", "male", "f", "female"}:
                        raise ValueError(f"Invalid Gender / Sex for {client_name}.")
                    if not sex_value:
                        raise ValueError("Gender / Sex is required for a new client.")
                    for field, label in (
                        ("civil_status", "Civil Status"),
                        ("religion", "Religion"),
                        ("educational_attainment", "Educational Attainment"),
                        ("citizenship", "Citizenship"),
                        ("language_dialect", "Language / Dialect"),
                        ("address", "Address"),
                    ):
                        if not str(client_data.get(field) or "").strip():
                            raise ValueError(f"{label} is required for a new client.")
                    client = models.Client(
                        name=client_name,
                        age=age,
                        sex=normalize_sex(client_data.get("sex")),
                        civil_status=limit_text(client_data.get("civil_status"), 50),
                        religion=limit_text(client_data.get("religion"), 100),
                        educational_attainment=limit_text(client_data.get("educational_attainment"), 150),
                        citizenship=limit_text(client_data.get("citizenship"), 100),
                        language_dialect=limit_text(client_data.get("language_dialect"), 100),
                        created_by_user_id=user.user_id,
                    )
                    validate_client_contact_number(str(client_data.get("contact_no") or ""), required=True)
                    client.details = models.ClientDetails(
                        address=limit_text(client_data.get("address"), 500),
                        contact_no=limit_text(client_data.get("contact_no"), 100),
                        representative_relationship=limit_text(client_data.get("relationship"), 100),
                    )
                    classification_flags = {
                        "drugs": "class_drug_related",
                        "female": "class_female",
                        "senior": "class_senior_citizen",
                        "cicl": "class_cicl",
                    }
                    classification_values = {}
                    for input_name, model_name in classification_flags.items():
                        raw_flag = str(client_data.get(input_name) or "").strip().lower()
                        if raw_flag:
                            if input_name in {"female", "senior", "cicl"} and not client_data.get("flags_reviewed"):
                                raise ValueError("Review the Female, Senior, and CICL indicators before import.")
                            classification_values[model_name] = raw_flag in {"1", "yes", "true", "y"}
                    if classification_values:
                        client.classification = models.ClientClassification(
                            **classification_values,
                            flags_reviewed=bool(client_data.get("flags_reviewed")),
                        )
                    db.add(client)
                    db.flush()
                    resolved_clients.append((client, client_data))
                    case_created_clients += 1
                primary_client = resolved_clients[0][0]
                party = limit_text(resolved_clients[0][1].get("party_represented"), 100)
                form_date = parse_date(received_raw)
                intake = models.IntakeRecord(
                    client_id=primary_client.client_id,
                    interviewer_id=user.user_id,
                    control_no=control_no,
                    form_date=form_date,
                    party_represented=party,
                    applicant_role=party,
                    nature_of_case=limit_text(entry.get("nature_of_case"), 50),
                )
                db.add(intake)
                db.flush()
                db.add(
                    models.Representative(
                        intake_id=intake.intake_id,
                        rep_name="Not applicable",
                        relationship_to_applicant=limit_text(resolved_clients[0][1].get("relationship"), 50),
                    )
                )
                normalized_status = normalize_case_status(status_raw)
                record = models.Case(
                    intake_id=intake.intake_id,
                    client_id=primary_client.client_id,
                    case_type=payload.case_type,
                    title_of_case=title,
                    case_no=limit_text(entry.get("case_no"), 20),
                    court_body=limit_text(entry.get("court"), 255),
                    cause_of_action=entry.get("cause_of_action"),
                    status_of_case=normalized_status,
                    case_status=normalized_status,
                    last_action_taken=entry.get("last_action"),
                    cause_of_termination=entry.get("cause_of_termination"),
                    date_of_termination=parse_date(entry.get("date_of_termination")),
                    date_of_confinement=parse_date(entry.get("date_of_confinement")),
                    place_of_detention=limit_text(entry.get("place_of_detention"), 255),
                    incident_barangay=incident_barangay or None,
                    incident_city="Panabo City" if location_type or incident_barangay else None,
                    location_type=location_type or None,
                    detained=bool(entry.get("date_of_confinement") or entry.get("place_of_detention")),
                    pending_in_court=normalized_status == "Pending",
                    is_terminated=normalized_status == "Terminated",
                )
                db.add(record)
                db.flush()
                attach_case_participants(
                    record,
                    [
                        (
                            participant,
                            limit_text(participant_data.get("party_represented"), 100),
                            limit_text(participant_data.get("party_represented"), 100),
                            None,
                        )
                        for participant, participant_data in resolved_clients
                    ],
                    limit_text,
                )
                db.add(
                    models.CaseHistory(
                        case_id=record.case_id,
                        updated_by=user.user_id,
                        previous_status=None,
                        new_status=normalized_status,
                        action_taken=record.last_action_taken or "Case imported from Excel",
                        remarks=f"Initial case record imported by {display_role_name(user)}",
                    )
                )
                db.flush()
                savepoint.commit()
                imported += 1
                created_clients += case_created_clients
                linked_clients += case_linked_clients
            except Exception as exc:
                savepoint.rollback()
                held += 1
                failed += 1
                reason = (
                    str(exc)
                    if isinstance(exc, ValueError)
                    else "Database error; the case and its new clients were rolled back."
                )
                failures.append({"control_no": control_no or "(missing)", "reason": reason[:240]})

        source_filename = Path(payload.source_filename or "").name[:255]
        write_audit(
            db,
            user.user_id,
            "Import Excel Cases",
            "case_import",
            f"Imported {imported} {payload.case_type} cases from {source_filename}; created {created_clients} client records, linked {linked_clients}, held {held}, skipped {max(0, payload.duplicate_case_count)} possible duplicates.",
            source_filename,
            request,
        )
        db.commit()
        return {
            "case_type": payload.case_type,
            "cases_imported": imported,
            "clients_created": created_clients,
            "existing_clients_linked": linked_clients,
            "cases_held": held,
            "duplicate_cases_skipped": max(0, payload.duplicate_case_count),
            "failed_records": failed,
            "failures": failures,
        }
