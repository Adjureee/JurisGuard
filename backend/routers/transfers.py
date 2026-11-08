from datetime import datetime
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

import models
from case_transfer_permissions import can_edit_transfer_report, can_submit_transfer_report
from routers.messaging import create_user_notification
from schemas import TransferReportPayload, TransferReturnPayload


def transfer_group_id(report: models.CaseTransferReport) -> int:
    return report.parent_report_id or report.report_id


def build_transfer_payload(report: models.CaseTransferReport, include_items: bool = True) -> dict[str, Any]:
    items = sorted(report.items, key=lambda item: (item.section, item.item_id))
    admin_entries = sorted(
        report.administrative_entries,
        key=lambda entry: (entry.section, entry.row_number, entry.entry_id),
    )
    return {
        "report_id": report.report_id,
        "parent_report_id": report.parent_report_id,
        "title": report.title,
        "report_date": report.report_date.isoformat() if report.report_date else "",
        "date_received": report.date_received.isoformat() if report.date_received else None,
        "status": report.status,
        "remarks": report.remarks or "",
        "version": report.version,
        "from_user_id": report.from_user_id,
        "from_user_name": report.from_user.full_name or report.from_user.email or report.from_user.username,
        "to_user_id": report.to_user_id,
        "to_user_name": report.to_user.full_name or report.to_user.email or report.to_user.username,
        "initiated_by_user_id": report.initiated_by_user_id,
        "initiated_by_user_name": (
            (report.initiated_by_user.full_name or report.initiated_by_user.email or report.initiated_by_user.username)
            if report.initiated_by_user
            else None
        ),
        "submitted_at": report.submitted_at.isoformat() if report.submitted_at else None,
        "returned_at": report.returned_at.isoformat() if report.returned_at else None,
        "confirmed_at": report.confirmed_at.isoformat() if report.confirmed_at else None,
        "created_at": report.created_at.isoformat() if report.created_at else "",
        "updated_at": report.updated_at.isoformat() if report.updated_at else "",
        "items": [
            {
                "item_id": item.item_id,
                "case_id": item.case_id,
                "section": item.section,
                "snapshot": item.snapshot_json,
            }
            for item in items
        ]
        if include_items
        else [],
        "administrative_entries": [
            {
                "entry_id": entry.entry_id,
                "section": entry.section,
                "row_number": entry.row_number,
                "control_no": entry.control_no or "",
                "title_of_case": entry.title_of_case or "",
                "docket_no": entry.docket_no or "",
                "date_received": entry.date_received.isoformat() if entry.date_received else "",
                "status_of_case": entry.status_of_case or "",
                "cause_of_action": entry.cause_of_action or "",
            }
            for entry in admin_entries
        ],
    }


def register_transfer_routes(
    app: FastAPI,
    *,
    current_user,
    get_db,
    is_admin,
    scoped_case_query,
    ensure_case_access,
    get_case_payload,
    parse_date,
    write_audit,
):
    def transfer_case_snapshot(record: models.Case) -> dict[str, Any]:
        payload = get_case_payload(record)
        return {
            "case_id": record.case_id,
            "case_type": record.case_type,
            "control_no": payload["intake_record"].get("control_no", ""),
            "title_of_case": record.title_of_case or "",
            "case_no": record.case_no or "",
            "date_received": payload["intake_record"].get("form_date", ""),
            "status_of_case": record.status_of_case or record.case_status or "",
            "cause_of_action": record.cause_of_action or "",
            "assigned_pao": record.assigned_pao or "",
        }

    def transfer_report_access(report: models.CaseTransferReport, user: models.User) -> bool:
        return is_admin(user) or report.from_user_id == user.user_id or report.to_user_id == user.user_id

    def ensure_transfer_access(report_id: int, user: models.User, db: Session) -> models.CaseTransferReport:
        report = db.get(models.CaseTransferReport, report_id)
        if not report or not transfer_report_access(report, user):
            raise HTTPException(status_code=404, detail="Transfer report not found")
        return report

    def transfer_user(db: Session, user_id: int) -> models.User:
        person = (
            db.query(models.User)
            .join(models.Role)
            .filter(
                models.User.user_id == user_id,
                models.User.is_active.is_(True),
                models.User.approval_status == "approved",
            )
            .first()
        )
        if not person or is_admin(person):
            raise HTTPException(status_code=422, detail="Select an active approved staff recipient")
        return person

    def transfer_report_editor(report: models.CaseTransferReport, user: models.User) -> bool:
        return can_edit_transfer_report(report, user, is_admin(user))

    def validate_transfer_case_ids(
        db: Session,
        user: models.User,
        case_ids: list[int],
        source_user_id: int,
        exclude_report_id: int | None = None,
    ) -> list[models.Case]:
        unique_ids = list(dict.fromkeys(case_ids))
        if len(unique_ids) != len(case_ids):
            raise HTTPException(status_code=422, detail="Duplicate case references are not allowed")
        if not unique_ids:
            raise HTTPException(status_code=422, detail="Select at least one Criminal or Civil case")
        records = []
        for case_id in unique_ids:
            record = ensure_case_access(db.get(models.Case, case_id), user)
            if record.is_terminated or (record.status_of_case or "").lower() == "terminated":
                raise HTTPException(status_code=409, detail=f"Case {case_id} is not eligible for transfer")
            if not record.intake or record.intake.interviewer_id != source_user_id:
                raise HTTPException(
                    status_code=403,
                    detail=f"Case {case_id} is not assigned to the selected transferring attorney",
                )
            records.append(record)
        conflict_query = (
            db.query(models.CaseTransferItem)
            .join(models.CaseTransferReport)
            .filter(
                models.CaseTransferItem.case_id.in_(unique_ids),
                models.CaseTransferReport.status == "Pending Receipt",
            )
        )
        if exclude_report_id is not None:
            conflict_query = conflict_query.filter(models.CaseTransferReport.report_id != exclude_report_id)
        if conflict_query.first():
            raise HTTPException(status_code=409, detail="One or more selected cases are already in a pending transfer")
        return records

    @app.get("/api/case-transfers/attorneys")
    def list_transfer_attorneys(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
        people = (
            db.query(models.User)
            .join(models.Role)
            .filter(
                models.User.is_active.is_(True),
                models.User.approval_status == "approved",
            )
            .order_by(models.User.full_name, models.User.user_id)
            .all()
        )
        return [
            {"user_id": person.user_id, "full_name": person.full_name or person.email or person.username}
            for person in people
            if not is_admin(person)
        ]

    @app.get("/api/case-transfers/cases")
    def list_transfer_cases(
        case_type: Literal["Criminal", "Civil"],
        search: str | None = None,
        source_user_id: int | None = None,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        if is_admin(user):
            if source_user_id is None:
                raise HTTPException(status_code=422, detail="Select a transferring attorney before loading cases")
            source = transfer_user(db, source_user_id)
            query = (
                db.query(models.Case)
                .outerjoin(models.IntakeRecord)
                .filter(models.IntakeRecord.interviewer_id == source.user_id)
            )
        else:
            if source_user_id is not None and source_user_id != user.user_id:
                raise HTTPException(status_code=403, detail="Staff may only list their own assigned cases")
            query = scoped_case_query(db, user).filter(models.IntakeRecord.interviewer_id == user.user_id)
        query = query.filter(
            models.Case.case_type == case_type,
            func.lower(func.coalesce(models.Case.status_of_case, "")) != "terminated",
            or_(models.Case.is_terminated.is_(False), models.Case.is_terminated.is_(None)),
        )
        if search and search.strip():
            pattern = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    models.Case.title_of_case.ilike(pattern),
                    models.Case.case_no.ilike(pattern),
                    models.IntakeRecord.control_no.ilike(pattern),
                )
            )
        return [
            transfer_case_snapshot(record)
            for record in query.order_by(models.Case.last_updated.desc()).limit(250).all()
        ]

    @app.get("/api/case-transfers")
    def list_case_transfers(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
        query = db.query(models.CaseTransferReport)
        if not is_admin(user):
            query = query.filter(
                or_(
                    models.CaseTransferReport.from_user_id == user.user_id,
                    models.CaseTransferReport.to_user_id == user.user_id,
                )
            )
        reports = query.order_by(
            models.CaseTransferReport.updated_at.desc(),
            models.CaseTransferReport.report_id.desc(),
        ).all()
        return [build_transfer_payload(report) for report in reports]

    @app.post("/api/case-transfers")
    def create_case_transfer(
        payload: TransferReportPayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        source = transfer_user(db, payload.from_user_id) if is_admin(user) and payload.from_user_id else user
        if is_admin(user) and payload.from_user_id is None:
            raise HTTPException(status_code=422, detail="Select a transferring attorney")
        recipient = transfer_user(db, payload.to_user_id)
        if source.user_id == recipient.user_id:
            raise HTTPException(status_code=422, detail="The transferring and receiving attorneys must be different")
        report_date = parse_date(payload.report_date)
        if not report_date:
            raise HTTPException(status_code=422, detail="A valid report date is required")
        records = validate_transfer_case_ids(db, user, payload.case_ids, source.user_id)
        report = models.CaseTransferReport(
            from_user_id=source.user_id,
            to_user_id=recipient.user_id,
            initiated_by_user_id=user.user_id if is_admin(user) else None,
            title=payload.title.strip() or "Transfer of Cases",
            report_date=report_date,
            status="Draft",
            remarks=payload.remarks,
        )
        db.add(report)
        db.flush()
        for record in records:
            db.add(
                models.CaseTransferItem(
                    report_id=report.report_id,
                    case_id=record.case_id,
                    section="Criminal" if record.case_type == "Criminal" else "Civil",
                    snapshot_json=transfer_case_snapshot(record),
                )
            )
        for raw in payload.administrative_entries:
            section = str(raw.get("section") or "").upper()
            if section not in {"ADMIN 1", "ADMIN 2", "ADMIN 3"}:
                raise HTTPException(status_code=422, detail="Administrative section must be ADMIN 1, ADMIN 2, or ADMIN 3")
            db.add(
                models.CaseTransferAdministrativeEntry(
                    report_id=report.report_id,
                    section=section,
                    row_number=int(raw.get("row_number") or 1),
                    control_no=raw.get("control_no"),
                    title_of_case=raw.get("title_of_case"),
                    docket_no=raw.get("docket_no"),
                    date_received=parse_date(raw.get("date_received")),
                    status_of_case=raw.get("status_of_case"),
                    cause_of_action=raw.get("cause_of_action"),
                )
            )
        if report.initiated_by_user_id is not None:
            recipient_name = report.to_user.full_name or report.to_user.email or report.to_user.username
            create_user_notification(
                db,
                report.from_user_id,
                f"case-transfer:{report.report_id}:draft-created",
                "Transfer Draft Ready for Review",
                f"An administrator prepared '{report.title}' for your review and submission. Receiving attorney: {recipient_name}.",
                f"/case-transfers?report={report.report_id}",
                "case_transfer",
                str(report.report_id),
            )
        write_audit(
            db,
            user.user_id,
            "Create Transfer Draft",
            "case_transfer",
            f"Created transfer report {report.title}",
            str(report.report_id),
            request,
        )
        db.commit()
        db.refresh(report)
        return build_transfer_payload(report)

    @app.get("/api/case-transfers/{report_id}")
    def get_case_transfer(report_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
        return build_transfer_payload(ensure_transfer_access(report_id, user, db))

    @app.patch("/api/case-transfers/{report_id}")
    def update_case_transfer(
        report_id: int,
        payload: TransferReportPayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        report = ensure_transfer_access(report_id, user, db)
        if not transfer_report_editor(report, user) or report.status not in {"Draft", "Returned for Correction"}:
            raise HTTPException(status_code=403, detail="Only editable transfer reports may be changed")
        source = (
            transfer_user(db, payload.from_user_id)
            if is_admin(user) and payload.from_user_id
            else db.get(models.User, report.from_user_id)
        )
        if not source or is_admin(source):
            raise HTTPException(status_code=422, detail="Select a valid transferring attorney")
        recipient = transfer_user(db, payload.to_user_id)
        if source.user_id == recipient.user_id:
            raise HTTPException(status_code=422, detail="The transferring and receiving attorneys must be different")
        report_date = parse_date(payload.report_date)
        if not report_date:
            raise HTTPException(status_code=422, detail="A valid report date is required")
        records = validate_transfer_case_ids(db, user, payload.case_ids, source.user_id, report.report_id)
        report.from_user_id = source.user_id
        report.to_user_id = recipient.user_id
        report.title = payload.title.strip() or "Transfer of Cases"
        report.report_date = report_date
        report.remarks = payload.remarks
        report.items.clear()
        report.administrative_entries.clear()
        db.flush()
        for record in records:
            report.items.append(
                models.CaseTransferItem(
                    case_id=record.case_id,
                    section=record.case_type,
                    snapshot_json=transfer_case_snapshot(record),
                )
            )
        for raw in payload.administrative_entries:
            report.administrative_entries.append(
                models.CaseTransferAdministrativeEntry(
                    section=str(raw.get("section") or "").upper(),
                    row_number=int(raw.get("row_number") or 1),
                    control_no=raw.get("control_no"),
                    title_of_case=raw.get("title_of_case"),
                    docket_no=raw.get("docket_no"),
                    date_received=parse_date(raw.get("date_received")),
                    status_of_case=raw.get("status_of_case"),
                    cause_of_action=raw.get("cause_of_action"),
                )
            )
        report.status = "Draft"
        report.updated_at = datetime.now()
        write_audit(
            db,
            user.user_id,
            "Update Transfer Draft",
            "case_transfer",
            f"Updated transfer report {report.title}",
            str(report.report_id),
            request,
        )
        db.commit()
        db.refresh(report)
        return build_transfer_payload(report)

    @app.post("/api/case-transfers/{report_id}/submit")
    def submit_case_transfer(
        report_id: int,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        report = ensure_transfer_access(report_id, user, db)
        if not can_submit_transfer_report(report, user, is_admin(user)) or report.status not in {
            "Draft",
            "Returned for Correction",
        }:
            raise HTTPException(status_code=403, detail="Only editable transfer reports may be submitted")
        is_resubmission = report.status == "Returned for Correction"
        if not report.items:
            raise HTTPException(status_code=422, detail="Select at least one case before submission")
        validate_transfer_case_ids(
            db,
            user,
            [item.case_id for item in report.items],
            report.from_user_id,
            report.report_id,
        )
        report.status = "Pending Receipt"
        report.submitted_at = datetime.now()
        report.updated_at = datetime.now()
        source_name = report.from_user.full_name or report.from_user.email or report.from_user.username
        create_user_notification(
            db,
            report.to_user_id,
            f"case-transfer:{report.report_id}:submitted:{report.returned_at.isoformat() if report.returned_at else 'initial'}",
            "Case Transfer Awaiting Receipt",
            f"{source_name} submitted '{report.title}'. Review the report and confirm receipt.",
            f"/case-transfers?report={report.report_id}",
            "case_transfer",
            str(report.report_id),
        )
        write_audit(
            db,
            user.user_id,
            "Resubmit Case Transfer" if is_resubmission else "Submit Case Transfer",
            "case_transfer",
            f"Submitted transfer report {report.title}",
            str(report.report_id),
            request,
        )
        db.commit()
        db.refresh(report)
        return build_transfer_payload(report)

    @app.post("/api/case-transfers/{report_id}/return")
    def return_case_transfer(
        report_id: int,
        payload: TransferReturnPayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        report = ensure_transfer_access(report_id, user, db)
        remarks = payload.remarks.strip()
        if report.to_user_id != user.user_id or report.status != "Pending Receipt":
            raise HTTPException(status_code=403, detail="Only the receiving attorney may return a pending transfer")
        if len(remarks) < 5:
            raise HTTPException(status_code=422, detail="Meaningful correction remarks are required")
        report.status = "Returned for Correction"
        report.remarks = remarks
        report.returned_at = datetime.now()
        report.updated_at = datetime.now()
        recipient_name = report.to_user.full_name or report.to_user.email or report.to_user.username
        create_user_notification(
            db,
            report.from_user_id,
            f"case-transfer:{report.report_id}:returned:{report.returned_at.isoformat()}",
            "Case Transfer Returned for Correction",
            f"{recipient_name} returned '{report.title}' for correction: {remarks}",
            f"/case-transfers?report={report.report_id}",
            "case_transfer",
            str(report.report_id),
        )
        write_audit(db, user.user_id, "Return Case Transfer", "case_transfer", remarks, str(report.report_id), request)
        db.commit()
        db.refresh(report)
        return build_transfer_payload(report)

    @app.post("/api/case-transfers/{report_id}/confirm")
    def confirm_case_transfer(
        report_id: int,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        report = (
            db.query(models.CaseTransferReport)
            .filter(models.CaseTransferReport.report_id == report_id)
            .with_for_update()
            .first()
        )
        if not report or report.to_user_id != user.user_id:
            raise HTTPException(status_code=404, detail="Transfer report not found")
        if report.status != "Pending Receipt":
            raise HTTPException(status_code=409, detail="Transfer is no longer pending receipt")
        case_ids = [item.case_id for item in report.items]
        if len(case_ids) != len(set(case_ids)):
            raise HTTPException(status_code=409, detail="Transfer contains duplicate case references")
        records = [
            db.query(models.Case).filter(models.Case.case_id == case_id).with_for_update().first()
            for case_id in case_ids
        ]
        if any(
            record is None
            or record.is_terminated
            or (record.status_of_case or "").lower() == "terminated"
            or not record.intake
            or record.intake.interviewer_id != report.from_user_id
            or record.case_type != item.section
            for record, item in zip(records, report.items)
        ):
            raise HTTPException(status_code=409, detail="One or more cases are no longer eligible for transfer")
        previous_names = []
        for record in records:
            previous_names.append(
                record.assigned_pao
                or (
                    record.intake.interviewer.full_name
                    if record.intake and getattr(record.intake, "interviewer", None)
                    else ""
                )
            )
            record.assigned_pao = user.full_name or user.email or user.username
            if record.intake:
                record.intake.interviewer_id = user.user_id
            db.add(
                models.CaseHistory(
                    case_id=record.case_id,
                    updated_by=user.user_id,
                    previous_status=record.status_of_case,
                    new_status=record.status_of_case or "Pending",
                    action_taken="Case transferred",
                    remarks=f"Transfer report #{report.report_id}; previous assignment: {previous_names[-1]}",
                )
            )
        report.status = "Completed"
        report.date_received = datetime.now()
        report.confirmed_at = datetime.now()
        report.updated_at = datetime.now()
        source_name = report.from_user.full_name or report.from_user.email or report.from_user.username
        notification_event_key = f"case-transfer:{report.report_id}:confirmed"
        notification_message = f"'{report.title}' was received and confirmed by {user.full_name or user.email or user.username}. The transfer is complete."
        notification_link = f"/case-transfers?report={report.report_id}"
        create_user_notification(
            db,
            report.from_user_id,
            notification_event_key,
            "Case Transfer Completed",
            notification_message,
            notification_link,
            "case_transfer",
            str(report.report_id),
        )
        if report.initiated_by_user_id is not None and report.initiated_by_user_id != report.from_user_id:
            create_user_notification(
                db,
                report.initiated_by_user_id,
                notification_event_key,
                "Case Transfer Completed",
                f"'{report.title}' from {source_name} was received and confirmed. The transfer is complete.",
                notification_link,
                "case_transfer",
                str(report.report_id),
            )
        write_audit(
            db,
            user.user_id,
            "Confirm Case Transfer",
            "case_transfer",
            f"{user.full_name or user.email or user.username} confirmed receipt of transfer report {report.title} from {source_name}.",
            str(report.report_id),
            request,
        )
        write_audit(
            db,
            user.user_id,
            "Transfer Assignments Updated",
            "case_transfer",
            f"{len(case_ids)} case assignment(s) updated to {user.full_name or user.email or user.username} after receipt confirmation.",
            str(report.report_id),
            request,
        )
        db.commit()
        db.refresh(report)
        return build_transfer_payload(report)

    return ensure_transfer_access
