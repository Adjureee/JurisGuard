from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, joinedload, selectinload

import models
from classification_evidence import reviewed_flag_input
from schemas import CaseClientPayload, CasePayload, ClientPayload, TerminationPayload


def template_path(language: str) -> Path:
    if language == "filipino":
        candidate = Path(__file__).resolve().parent.parent.parent / "formx.html"
        return candidate if candidate.exists() else Path(__file__).resolve().parent.parent.parent / "formex.html"
    return Path(__file__).resolve().parent.parent.parent / "form.html"


def read_form_template(language: str) -> str:
    path = template_path(language)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Printable form template not found: {path.name}")
    return path.read_text(encoding="utf-8")


def register_case_and_client_routes(
    app: FastAPI,
    *,
    current_user,
    get_db,
    scoped_client_query,
    scoped_case_query,
    ensure_client_access,
    ensure_case_access,
    get_client_payload,
    get_case_payload,
    get_case_list_item,
    apply_client_payload,
    apply_case_payload,
    commit_or_client_error,
    commit_or_case_error,
    normalize_spouse_details,
    none_if_not_applicable,
    parse_date,
    normalize_case_type,
    normalize_case_status,
    detention_fields_for_client,
    is_none_value,
    limit_text,
    normalize_sex,
    generated_case_title,
    generated_case_title_for_case,
    update_latest_client_representative,
    represented_party_from_role,
    case_participants,
    write_audit,
) -> None:
    @app.get("/api/clients/")
    def list_clients(request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
        clients = scoped_client_query(db, user).order_by(models.Client.created_at.desc()).all()
        payload = [get_client_payload(client) for client in clients]
        write_audit(db, user.user_id, "Read Clients", "client", f"Loaded {len(clients)} client records", request=request)
        db.commit()
        return payload

    @app.get("/api/clients/{client_id}")
    def get_client(
        client_id: int,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        client = ensure_client_access(db.get(models.Client, client_id), user, db)
        payload = get_client_payload(client)
        write_audit(db, user.user_id, "Read Client", "client", entity_id=str(client_id), request=request)
        db.commit()
        return payload

    @app.get("/api/clients/{client_id}/cases")
    def get_client_cases(
        client_id: int,
        request: Request,
        case_type: Literal["Criminal", "Civil", "All"] = Query(default="Criminal"),
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        ensure_client_access(db.get(models.Client, client_id), user, db)
        query = (
            scoped_case_query(db, user)
            .outerjoin(models.CaseClient)
            .filter(or_(models.Case.client_id == client_id, models.CaseClient.client_id == client_id))
            .options(
                joinedload(models.Case.intake).selectinload(models.IntakeRecord.representatives),
                joinedload(models.Case.intake).selectinload(models.IntakeRecord.adverse_parties),
                joinedload(models.Case.client).selectinload(models.Client.details),
                joinedload(models.Case.client).selectinload(models.Client.classification),
                selectinload(models.Case.participants)
                .joinedload(models.CaseClient.client)
                .selectinload(models.Client.details),
                selectinload(models.Case.participants)
                .joinedload(models.CaseClient.client)
                .selectinload(models.Client.classification),
            )
        )
        if case_type != "All":
            query = query.filter(models.Case.case_type == case_type)
        records = query.order_by(models.Case.last_updated.desc()).distinct().all()
        payload = [get_case_payload(record) for record in records]
        write_audit(
            db,
            user.user_id,
            "Read Client Cases",
            "client",
            f"Loaded {len(payload)} linked case records",
            str(client_id),
            request,
        )
        db.commit()
        return payload

    @app.post("/api/clients/")
    def create_client(
        payload: ClientPayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        try:
            client_data = payload.client
            details_data = normalize_spouse_details(dict(payload.client_details))
            class_data = payload.client_classification
            client = models.Client(
                created_by_user_id=user.user_id,
                name=client_data.get("name") or "Unnamed Client",
                age=client_data.get("age"),
                sex=client_data.get("sex") or "",
                civil_status=client_data.get("civil_status") or "",
                religion=client_data.get("religion") or "",
                educational_attainment=client_data.get("educational_attainment") or "",
                citizenship=client_data.get("citizenship") or "",
                language_dialect=client_data.get("language_dialect") or "",
            )
            reviewed_flags = reviewed_flag_input(class_data)
            db.add(client)
            db.flush()
            db.add(
                models.ClientDetails(
                    client_id=client.client_id,
                    address=details_data.get("address"),
                    contact_no=details_data.get("contact_no"),
                    email=details_data.get("email"),
                    individual_monthly_income=details_data.get("individual_monthly_income"),
                    spouse=none_if_not_applicable(details_data.get("spouse")),
                    address_of_spouse=none_if_not_applicable(details_data.get("address_of_spouse")),
                    contact_no_of_spouse=none_if_not_applicable(details_data.get("contact_no_of_spouse")),
                    representative_name=none_if_not_applicable(details_data.get("representative_name")),
                    representative_age=(
                        details_data.get("representative_age")
                        if details_data.get("representative_age") not in (None, "")
                        else None
                    ),
                    representative_sex=none_if_not_applicable(details_data.get("representative_sex")),
                    representative_civil_status=none_if_not_applicable(
                        details_data.get("representative_civil_status")
                    ),
                    representative_address=none_if_not_applicable(details_data.get("representative_address")),
                    representative_contact_no=none_if_not_applicable(details_data.get("representative_contact_no")),
                    representative_relationship=none_if_not_applicable(
                        details_data.get("representative_relationship")
                    ),
                    representative_email=details_data.get("representative_email"),
                    detained=bool(details_data.get("detained")),
                    detained_since=parse_date(details_data.get("detained_since")),
                    place_of_detention=details_data.get("place_of_detention"),
                )
            )
            db.add(
                models.ClientClassification(
                    client_id=client.client_id,
                    class_senior_citizen=reviewed_flags["flag_senior"] if reviewed_flags else None,
                    class_cicl=reviewed_flags["flag_cicl"] if reviewed_flags else None,
                    class_female=reviewed_flags["flag_female"] if reviewed_flags else None,
                    flags_reviewed=reviewed_flags is not None,
                    class_urban=False,
                    class_rural=False,
                    class_drug_related=bool(class_data.get("flag_drugs")),
                    class_foreign_national="Yes" if class_data.get("flag_foreign_national") else None,
                    class_vawc_victim=bool(class_data.get("flag_vawc_victim")),
                    class_refugee="Yes" if class_data.get("flag_refugee_evacuee") else None,
                    class_law_enforcer=bool(class_data.get("flag_law_enforcer")),
                    class_tenant_agrarian=bool(class_data.get("flag_tenant_agrarian")),
                    class_ofw_land=bool(class_data.get("flag_ofw_land_based")),
                    class_ofw_sea=bool(class_data.get("flag_ofw_sea_based")),
                    class_terrorism_arrested=bool(class_data.get("flag_arrested_terrorism")),
                    class_indigenous_people="Yes" if class_data.get("flag_indigenous_people") else None,
                    class_pwd_type="PWD" if class_data.get("flag_pwd") else None,
                    class_former_rebel=bool(class_data.get("flag_former_rebel_fve")),
                    class_torture_victim=bool(class_data.get("flag_torture_victim")),
                    class_trafficking_victim=bool(class_data.get("flag_trafficking_victim")),
                    class_voluntary_rehab=bool(class_data.get("flag_voluntary_rehab_petitioner")),
                    classification_notes=class_data.get("classification_notes"),
                )
            )
            write_audit(
                db,
                user.user_id,
                "Create Client",
                "client",
                f"{user.full_name or user.email or user.username} created client {client.name}",
                str(client.client_id),
                request,
            )
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=422, detail=f"Invalid client payload: {exc}") from exc
        commit_or_client_error(db, "create")
        db.refresh(client)
        return get_client_payload(client)

    @app.patch("/api/clients/{client_id}")
    def update_client(
        client_id: int,
        payload: ClientPayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        client = ensure_client_access(db.get(models.Client, client_id), user, db)
        try:
            apply_client_payload(client, payload)
        except HTTPException:
            raise
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=422, detail=f"Invalid client update payload: {exc}") from exc
        write_audit(
            db,
            user.user_id,
            "Update Client",
            "client",
            f"{user.full_name or user.email or user.username} updated client {client.name}",
            str(client.client_id),
            request,
        )
        commit_or_client_error(db, "update")
        db.refresh(client)
        return get_client_payload(client)

    @app.get("/api/cases/")
    def list_cases(
        request: Request,
        case_type: Literal["Criminal", "Civil", "All"] = Query(default="Criminal"),
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        query = scoped_case_query(db, user)
        if case_type != "All":
            query = query.filter(models.Case.case_type == case_type)
        records = query.order_by(models.Case.last_updated.desc()).all()
        payload = [get_case_payload(record) for record in records]
        write_audit(db, user.user_id, "Read Cases", "case", f"Loaded {len(payload)} case records", request=request)
        db.commit()
        return payload

    @app.get("/api/cases/paged")
    def list_cases_paged(
        request: Request,
        case_type: Literal["Criminal", "Civil", "All"] = Query(default="Criminal"),
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=50, ge=1, le=100),
        search: str = Query(default="", max_length=200),
        gender: Literal["All", "Male", "Female"] = Query(default="All"),
        location: Literal["All", "Urban", "Rural"] = Query(default="All"),
        court: str = Query(default="All", max_length=255),
        date_from: date | None = Query(default=None),
        date_to: date | None = Query(default=None),
        include_details: bool = Query(default=False),
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        """Return a bounded, filtered case page for table views."""
        query = scoped_case_query(db, user).filter(
            models.Case.is_terminated.is_not(True),
            models.Case.status_of_case != "Terminated",
        )
        if case_type != "All":
            query = query.filter(models.Case.case_type == case_type)
        if location != "All":
            query = query.filter(models.Case.location_type == location)
        if court and court != "All":
            query = query.filter(models.Case.court_body == court)
        if gender != "All":
            sex_values = ("m", "male") if gender == "Male" else ("f", "female")
            query = query.filter(
                or_(
                    models.Case.client.has(func.lower(func.trim(models.Client.sex)).in_(sex_values)),
                    models.Case.participants.any(
                        models.CaseClient.client.has(func.lower(func.trim(models.Client.sex)).in_(sex_values))
                    ),
                )
            )
        normalized_search = search.strip()
        if normalized_search:
            escaped_search = normalized_search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            term = f"%{escaped_search}%"
            query = query.filter(
                or_(
                    models.Case.case_no.ilike(term, escape="\\"),
                    models.Case.title_of_case.ilike(term, escape="\\"),
                    models.Case.court_body.ilike(term, escape="\\"),
                    models.Case.cause_of_action.ilike(term, escape="\\"),
                    models.Case.intake.has(models.IntakeRecord.control_no.ilike(term, escape="\\")),
                    models.Case.client.has(models.Client.name.ilike(term, escape="\\")),
                    models.Case.participants.any(
                        models.CaseClient.client.has(models.Client.name.ilike(term, escape="\\"))
                    ),
                )
            )
        date_column = func.coalesce(models.IntakeRecord.form_date, models.Case.last_updated)
        if date_from:
            query = query.filter(date_column >= datetime.combine(date_from, time.min))
        if date_to:
            query = query.filter(date_column < datetime.combine(date_to + timedelta(days=1), time.min))

        total = query.order_by(None).count()
        eager_options = (
            [
                joinedload(models.Case.intake).selectinload(models.IntakeRecord.representatives),
                joinedload(models.Case.intake).selectinload(models.IntakeRecord.adverse_parties),
                joinedload(models.Case.client).selectinload(models.Client.details),
                joinedload(models.Case.client).selectinload(models.Client.classification),
                selectinload(models.Case.participants)
                .joinedload(models.CaseClient.client)
                .selectinload(models.Client.details),
                selectinload(models.Case.participants)
                .joinedload(models.CaseClient.client)
                .selectinload(models.Client.classification),
            ]
            if include_details
            else [
                joinedload(models.Case.intake),
                joinedload(models.Case.client),
                selectinload(models.Case.participants).joinedload(models.CaseClient.client),
            ]
        )
        records = (
            query.options(*eager_options)
            .order_by(models.Case.last_updated.desc().nullslast(), models.Case.case_id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        payload = (
            [get_case_payload(record) for record in records]
            if include_details
            else [get_case_list_item(record) for record in records]
        )
        write_audit(
            db,
            user.user_id,
            "Read Cases",
            "case",
            f"Loaded page {page} with {len(records)} of {total} matching case records",
            request=request,
        )
        db.commit()
        return {"items": payload, "total": total, "page": page, "page_size": page_size}

    @app.get("/api/cases/by-id/{case_id}")
    def get_case_record(
        case_id: int,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        record = (
            scoped_case_query(db, user)
            .filter(models.Case.case_id == case_id)
            .options(
                joinedload(models.Case.intake).selectinload(models.IntakeRecord.representatives),
                joinedload(models.Case.intake).selectinload(models.IntakeRecord.adverse_parties),
                joinedload(models.Case.client).selectinload(models.Client.details),
                joinedload(models.Case.client).selectinload(models.Client.classification),
                selectinload(models.Case.participants)
                .joinedload(models.CaseClient.client)
                .selectinload(models.Client.details),
                selectinload(models.Case.participants)
                .joinedload(models.CaseClient.client)
                .selectinload(models.Client.classification),
            )
            .first()
        )
        if record is None:
            raise HTTPException(status_code=404, detail="Case record not found")
        payload = get_case_payload(record)
        write_audit(db, user.user_id, "Read Case", "case", entity_id=str(case_id), request=request)
        db.commit()
        return payload

    @app.get("/api/cases/terminated")
    def list_terminated_cases(
        request: Request,
        case_type: Literal["Criminal", "Civil", "All"] = Query(default="Criminal"),
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        query = scoped_case_query(db, user).filter(
            (models.Case.is_terminated.is_(True)) | (models.Case.status_of_case == "Terminated")
        )
        if case_type != "All":
            query = query.filter(models.Case.case_type == case_type)
        records = query.order_by(models.Case.terminated_at.desc().nullslast(), models.Case.last_updated.desc()).all()
        payload = [get_case_payload(record) for record in records]
        write_audit(
            db,
            user.user_id,
            "Read Terminated Cases",
            "case",
            f"Loaded {len(payload)} terminated case records",
            request=request,
        )
        db.commit()
        return payload

    @app.get("/api/printable-intake/{case_id}")
    def get_printable_intake(
        case_id: int,
        request: Request,
        client_id: int | None = Query(default=None),
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        record = ensure_case_access(db.get(models.Case, case_id), user)
        selected_client = record.client
        selected_participant = None
        if client_id is not None:
            selected_participant = next(
                (
                    participant
                    for participant in case_participants(record)
                    if participant.client_id == client_id
                ),
                None,
            )
            if selected_participant is None:
                raise HTTPException(status_code=404, detail="Case participant not found")
            selected_client = ensure_client_access(
                selected_participant.client or db.get(models.Client, client_id),
                user,
                db,
            )
        if not selected_client:
            raise HTTPException(status_code=404, detail="Case client not found")
        cases = (
            scoped_case_query(db, user)
            .outerjoin(models.CaseClient, models.Case.case_id == models.CaseClient.case_id)
            .filter(models.Case.case_type == normalize_case_type(getattr(record, "case_type", "Criminal")))
            .filter(
                or_(
                    models.Case.client_id == selected_client.client_id,
                    models.CaseClient.client_id == selected_client.client_id,
                )
            )
            .distinct()
            .order_by(models.Case.last_updated.desc())
            .all()
        )
        selected_case = get_case_payload(record)
        if selected_participant is not None:
            involvement = selected_participant.applicant_role or ""
            selected_case["client_id"] = str(selected_client.client_id)
            selected_case["intake_record"]["party_represented"] = (
                selected_participant.party_represented
                or represented_party_from_role(
                    selected_participant.applicant_role,
                    selected_participant.applicant_role_other,
                )
                or ""
            )
            selected_case["intake_record"]["applicant_role"] = involvement
            selected_case["intake_record"]["applicant_role_other"] = selected_participant.applicant_role_other or ""
            for role_key, role_name in [
                ("inv_plaintiff", "Plaintiff"),
                ("inv_defendant", "Defendant"),
                ("inv_oppositor", "Oppositor"),
                ("inv_petitioner", "Petitioner"),
                ("inv_respondent", "Respondent"),
                ("inv_complainant", "Complainant"),
                ("inv_accused", "Accused"),
            ]:
                selected_case["intake_record"][role_key] = involvement == role_name
            selected_case["intake_record"]["inv_others"] = (
                selected_participant.applicant_role_other if involvement == "Others" else ""
            )
        payload = {
            "client": get_client_payload(selected_client),
            "selected_case": selected_case,
            "cases": [get_case_payload(case) for case in cases],
            "templates": {
                "english": read_form_template("english"),
                "filipino": read_form_template("filipino"),
            },
        }
        write_audit(db, user.user_id, "Read Printable Intake", "case", entity_id=str(case_id), request=request)
        db.commit()
        return payload

    @app.post("/api/cases/")
    def create_case(
        payload: CasePayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        try:
            primary_client_id = int(payload.client_id)
            participant_ids: list[int] = []
            for raw_client_id in [primary_client_id, *(payload.client_ids or [])]:
                participant_id = int(raw_client_id)
                if participant_id not in participant_ids:
                    participant_ids.append(participant_id)
            client = ensure_client_access(db.get(models.Client, primary_client_id), user, db)
            participant_clients = []
            for participant_id in participant_ids:
                participant_clients.append(ensure_client_access(db.get(models.Client, participant_id), user, db))

            client_representatives: dict[str, dict[str, Any]] = {}
            for entry in payload.client_representatives or []:
                participant_id = str(entry.get("client_id") or "")
                if participant_id not in {str(value) for value in participant_ids}:
                    raise HTTPException(
                        status_code=422, detail="Representative data references an unselected client."
                    )
                if participant_id in client_representatives:
                    raise HTTPException(status_code=422, detail="Representative data contains a duplicate client.")
                representative_data = entry.get("representative")
                client_representatives[participant_id] = (
                    representative_data if isinstance(representative_data, dict) else {}
                )

            intake_data = payload.intake_record
            rep_data = payload.representative
            case_data = payload.cases
            case_type = normalize_case_type(payload.case_type)
            normalized_status = normalize_case_status(case_data.get("status_of_case") or case_data.get("case_status"))
            confinement_date, detention_place = detention_fields_for_client(client, case_data)
            case_detained = (
                bool(case_data.get("detained"))
                if "detained" in case_data
                else bool(confinement_date or detention_place)
            )
            represented_party = intake_data.get("party_represented") or (
                intake_data.get("applicant_role_other")
                if intake_data.get("applicant_role") == "Others"
                else intake_data.get("applicant_role")
            )
            representative_none = is_none_value(rep_data.get("civil_status"))

            intake = models.IntakeRecord(
                client_id=primary_client_id,
                interviewer_id=user.user_id,
                control_no=limit_text(intake_data.get("control_no"), 20),
                form_date=parse_date(intake_data.get("form_date"), datetime.now()) or datetime.now(),
                region=intake_data.get("region"),
                district_office=limit_text(intake_data.get("district_office"), 255),
                party_represented=limit_text(represented_party, 50),
                applicant_role=intake_data.get("applicant_role"),
                applicant_role_other=intake_data.get("applicant_role_other"),
                nature_of_request=intake_data.get("nature_of_request"),
                nature_of_case=limit_text(intake_data.get("nature_of_case"), 50),
                coi_agree_different_office=False,
                coi_agree_same_dept_appeal=False,
                coi_waive_right_to_complain=False,
                coi_trust_assigned_counsel=False,
                proof_submission_deadline=parse_date(intake_data.get("proof_submission_deadline")),
                proof_submission_satisfied=bool(intake_data.get("proof_submission_satisfied")),
                proof_itr_satisfied=bool(intake_data.get("proof_itr_satisfied")),
                proof_itr_date=parse_date(intake_data.get("proof_itr_date")),
                proof_brgy_satisfied=bool(intake_data.get("proof_brgy_satisfied")),
                proof_brgy_date=parse_date(intake_data.get("proof_brgy_date")),
                proof_dswd_satisfied=bool(intake_data.get("proof_dswd_satisfied")),
                proof_dswd_date=parse_date(intake_data.get("proof_dswd_date")),
                proof_others_satisfied=bool(intake_data.get("proof_others_satisfied")),
                proof_others_details=intake_data.get("proof_others_details"),
                proof_others_date=parse_date(intake_data.get("proof_others_date")),
                inv_plaintiff=bool(intake_data.get("inv_plaintiff")),
                inv_defendant=bool(intake_data.get("inv_defendant")),
                inv_oppositor=bool(intake_data.get("inv_oppositor")),
                inv_petitioner=bool(intake_data.get("inv_petitioner")),
                inv_respondent=bool(intake_data.get("inv_respondent")),
                inv_complainant=bool(intake_data.get("inv_complainant")),
                inv_accused=bool(intake_data.get("inv_accused")),
                inv_others=intake_data.get("inv_others"),
            )
            db.add(intake)
            db.flush()

            db.add(
                models.Representative(
                    intake_id=intake.intake_id,
                    rep_name="None" if representative_none else rep_data.get("rep_name") or "Not applicable",
                    rep_age=rep_data.get("rep_age") or None,
                    rep_sex="None" if representative_none else normalize_sex(rep_data.get("rep_sex")),
                    civil_status="None" if representative_none else rep_data.get("civil_status"),
                    rep_address="None" if representative_none else rep_data.get("rep_address"),
                    rep_contact_no="None" if representative_none else rep_data.get("rep_contact_no"),
                    relationship_to_applicant="None"
                    if representative_none
                    else limit_text(rep_data.get("relationship_to_applicant"), 50),
                )
            )

            record = models.Case(
                intake_id=intake.intake_id,
                client_id=primary_client_id,
                case_type=case_type,
                title_of_case=generated_case_title(client, case_type),
                case_no=limit_text(case_data.get("case_no"), 20),
                court_body=case_data.get("court_body"),
                status_of_case=normalized_status,
                case_status=normalized_status,
                incident_barangay=case_data.get("incident_barangay"),
                incident_city=limit_text(case_data.get("incident_city"), 120),
                incident_address=case_data.get("incident_address"),
                latitude=str(case_data.get("latitude")) if case_data.get("latitude") not in (None, "") else None,
                longitude=str(case_data.get("longitude")) if case_data.get("longitude") not in (None, "") else None,
                last_action_taken=case_data.get("last_action_taken"),
                detained=case_detained,
                date_of_confinement=confinement_date,
                place_of_detention=detention_place,
                location_type=case_data.get("location_type"),
                cause_of_action=case_data.get("cause_of_action"),
                facts_of_case=case_data.get("facts_of_case"),
                pending_in_court=normalized_status == "Pending",
                cause_of_termination=case_data.get("cause_of_termination"),
                date_of_termination=parse_date(case_data.get("date_of_termination")),
                assigned_pao=case_data.get("assigned_pao"),
                hearing_schedule=case_data.get("hearing_schedule"),
                remarks=case_data.get("remarks"),
            )
            db.add(record)
            db.flush()
            for participant_client in participant_clients:
                participant_rep = client_representatives.get(str(participant_client.client_id), {})
                participant_rep_none = is_none_value(participant_rep.get("civil_status"))
                record.participants.append(
                    models.CaseClient(
                        client=participant_client,
                        party_represented=limit_text(represented_party, 100),
                        applicant_role=intake.applicant_role,
                        applicant_role_other=intake.applicant_role_other,
                        representative_name=(
                            "None" if participant_rep_none else participant_rep.get("rep_name") or None
                        ),
                        representative_age=participant_rep.get("rep_age") or None,
                        representative_sex=(
                            "None" if participant_rep_none else normalize_sex(participant_rep.get("rep_sex"))
                        ),
                        representative_civil_status=(
                            "None" if participant_rep_none else participant_rep.get("civil_status") or None
                        ),
                        representative_address=(
                            "None" if participant_rep_none else participant_rep.get("rep_address") or None
                        ),
                        representative_contact_no=(
                            "None" if participant_rep_none else participant_rep.get("rep_contact_no") or None
                        ),
                        representative_relationship=(
                            "None"
                            if participant_rep_none
                            else limit_text(participant_rep.get("relationship_to_applicant"), 100)
                        ),
                        representative_email=(
                            "None" if participant_rep_none else participant_rep.get("rep_email") or None
                        ),
                    )
                )
                participant_has_representative = any(
                    str(participant_rep.get(field) or "").strip()
                    for field in (
                        "rep_name",
                        "rep_sex",
                        "civil_status",
                        "rep_address",
                        "rep_contact_no",
                        "relationship_to_applicant",
                        "rep_email",
                    )
                ) or bool(participant_rep.get("rep_age"))
                if payload.client_representatives is None and participant_client.client_id == client.client_id:
                    participant_rep = rep_data
                    participant_has_representative = True
                    participant_rep_none = representative_none
                if participant_has_representative:
                    update_latest_client_representative(
                        participant_client,
                        participant_rep,
                        participant_rep_none,
                    )
            db.flush()
            record.title_of_case = generated_case_title_for_case(record)
            db.add(
                models.CaseHistory(
                    case_id=record.case_id,
                    updated_by=user.user_id,
                    previous_status=None,
                    new_status=record.status_of_case,
                    action_taken=record.last_action_taken or "Case created",
                    remarks="Initial case record",
                )
            )
            write_audit(
                db,
                user.user_id,
                "Create Case",
                "case",
                f"{user.full_name or user.email or user.username} created {case_type} Case #{record.case_id}",
                str(record.case_id),
                request,
            )
        except HTTPException:
            raise
        except ValueError as exc:
            db.rollback()
            raise HTTPException(status_code=422, detail=f"Invalid case payload: {exc}") from exc
        except SQLAlchemyError as exc:
            db.rollback()
            raise HTTPException(
                status_code=500,
                detail="Database error while creating case. Check duplicate control number or missing migrated columns.",
            ) from exc

        commit_or_case_error(db, "create")
        db.refresh(record)
        return get_case_payload(record)

    @app.patch("/api/cases/{case_id}")
    def update_case(
        case_id: int,
        payload: CasePayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        record = ensure_case_access(db.get(models.Case, case_id), user)
        created_by_user_id = record.intake.interviewer_id if record.intake else None
        previous_status = record.status_of_case
        try:
            apply_case_payload(record, payload)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Invalid case update payload: {exc}") from exc
        actor_name = user.full_name or user.email or user.username
        case_type = normalize_case_type(getattr(record, "case_type", "Criminal"))
        if created_by_user_id and created_by_user_id != user.user_id:
            description = (
                f"{actor_name} collaboratively updated {case_type} Case #{record.case_id} "
                f"originally created by User #{created_by_user_id}"
            )
        else:
            description = f"{actor_name} updated {case_type} Case #{record.case_id}"
        db.add(
            models.CaseHistory(
                case_id=record.case_id,
                updated_by=user.user_id,
                previous_status=previous_status,
                new_status=record.status_of_case or "Pending",
                action_taken=record.last_action_taken or "Case updated",
                remarks="Case updated from workspace",
            )
        )
        write_audit(db, user.user_id, "Update Case", "case", description, str(record.case_id), request)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            detail = "Case update conflicts with an existing record. Check duplicate control number or case number."
            raise HTTPException(status_code=409, detail=detail) from exc
        except SQLAlchemyError as exc:
            db.rollback()
            raise HTTPException(
                status_code=500, detail="Database error while updating case. Please retry after refreshing the page."
            ) from exc
        db.refresh(record)
        return get_case_payload(record)

    @app.post("/api/cases/{case_id}/clients")
    def attach_client_to_case(
        case_id: int,
        payload: CaseClientPayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        record = ensure_case_access(db.get(models.Case, case_id), user)
        try:
            client_id = int(payload.client_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid client id") from exc
        client = ensure_client_access(db.get(models.Client, client_id), user, db)
        existing = (
            db.query(models.CaseClient)
            .filter(models.CaseClient.case_id == record.case_id, models.CaseClient.client_id == client.client_id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail="Client is already attached to this case")

        applicant_role = payload.applicant_role or payload.party_represented or "Accused"
        represented_party = payload.party_represented or represented_party_from_role(
            applicant_role,
            payload.applicant_role_other,
        )
        try:
            record.participants.append(
                models.CaseClient(
                    client=client,
                    party_represented=limit_text(represented_party, 100),
                    applicant_role=applicant_role,
                    applicant_role_other=payload.applicant_role_other,
                )
            )
            db.flush()
            record.title_of_case = generated_case_title_for_case(record)
            record.last_updated = datetime.now()
            write_audit(
                db,
                user.user_id,
                "Attach Client to Case",
                "case",
                f"{user.full_name or user.email or user.username} attached client #{client.client_id} to Criminal Case #{record.case_id}",
                str(record.case_id),
                request,
            )
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail="Client is already attached to this case") from exc
        except SQLAlchemyError as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail="Database error while attaching client to case") from exc

        commit_or_case_error(db, "attach client to")
        db.refresh(record)
        return get_case_payload(record)

    @app.post("/api/cases/{case_id}/terminate")
    def terminate_case(
        case_id: int,
        payload: TerminationPayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        record = ensure_case_access(db.get(models.Case, case_id), user)
        created_by_user_id = record.intake.interviewer_id if record.intake else None
        terminated_at = parse_date(payload.date_terminated, datetime.now()) or datetime.now()
        record.status_of_case = "Terminated"
        record.case_status = "Terminated"
        record.is_terminated = True
        record.terminated_at = terminated_at
        record.date_of_termination = terminated_at
        record.termination_reason = payload.termination_reason
        record.cause_of_termination = payload.termination_reason
        record.termination_remarks = payload.final_remarks
        record.remarks = payload.final_remarks
        record.resolution_type = payload.resolution_type
        record.terminated_by = user.user_id
        record.handled_by = payload.handled_by or user.full_name or user.email or user.username
        record.supporting_document_path = payload.supporting_document_path
        record.last_updated = datetime.now()
        actor_name = user.full_name or user.email or user.username
        case_type = normalize_case_type(getattr(record, "case_type", "Criminal"))
        if created_by_user_id and created_by_user_id != user.user_id:
            description = (
                f"{actor_name} collaboratively terminated {case_type} Case #{record.case_id} "
                f"originally created by User #{created_by_user_id}"
            )
        else:
            description = f"{actor_name} terminated {case_type} Case #{record.case_id}"
        write_audit(db, user.user_id, "Terminate Case", "case", description, str(record.case_id), request)
        db.commit()
        db.refresh(record)
        return get_case_payload(record)
