from datetime import datetime, timedelta
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

import models
from schemas import CaseSubmissionPayload, SubmissionFeedbackPayload, SubmissionPreviewPayload


def case_submission_group_id(submission: models.CaseSubmission) -> int:
    return submission.parent_submission_id or submission.submission_id


def normalize_submission_status(status: str | None) -> str:
    if status == "Correction Requested":
        return "Correction Required"
    return status or "Draft"


def latest_submission_version(db: Session, submission: models.CaseSubmission) -> int:
    group_id = case_submission_group_id(submission)
    return int(
        db.query(func.max(models.CaseSubmission.version))
        .filter(
            or_(
                models.CaseSubmission.submission_id == group_id,
                models.CaseSubmission.parent_submission_id == group_id,
            )
        )
        .scalar()
        or submission.version
    )


def ensure_latest_submission_version(db: Session, submission: models.CaseSubmission) -> None:
    if submission.version != latest_submission_version(db, submission):
        raise HTTPException(status_code=409, detail="Historical submission versions are read-only")


def register_submission_routes(
    app: FastAPI,
    *,
    current_user,
    admin_user,
    get_db,
    is_admin,
    display_role_name,
    scoped_case_query,
    get_case_payload,
    get_client_payload,
    parse_date,
    write_audit,
):
    def submission_case_snapshot(record: models.Case) -> dict[str, Any]:
        return {
            "record": get_case_payload(record),
            "client": get_client_payload(record.client) if record.client else None,
            "client_name": record.client.name if record.client else "Unknown client",
        }

    def submission_to_payload(submission: models.CaseSubmission, include_items: bool = True) -> dict[str, Any]:
        staff = submission.staff
        reviewer = submission.reviewer
        items = sorted(submission.items, key=lambda item: item.submission_item_id)
        feedback = sorted(submission.feedback, key=lambda item: item.created_at or datetime.min)
        return {
            "submission_id": str(submission.submission_id),
            "group_id": str(case_submission_group_id(submission)),
            "staff_id": submission.staff_id,
            "staff_name": staff.full_name or staff.email or staff.username if staff else "Unknown staff",
            "staff_role": display_role_name(staff) or "staff",
            "staff_profile_image_path": staff.profile_image_path if staff else None,
            "title": submission.title,
            "date_from": submission.date_from.date().isoformat() if submission.date_from else "",
            "date_to": submission.date_to.date().isoformat() if submission.date_to else "",
            "status": normalize_submission_status(submission.status),
            "version": submission.version,
            "notes": submission.notes or "",
            "case_count": len(items),
            "submitted_at": submission.submitted_at.isoformat() if submission.submitted_at else None,
            "approved_at": submission.approved_at.isoformat() if submission.approved_at else None,
            "reviewed_by": submission.reviewed_by,
            "reviewer_name": reviewer.full_name or reviewer.email or reviewer.username if reviewer else None,
            "created_at": submission.created_at.isoformat() if submission.created_at else "",
            "updated_at": submission.updated_at.isoformat() if submission.updated_at else "",
            "items": [
                {
                    "submission_item_id": str(item.submission_item_id),
                    "case_id": str(item.case_id),
                    "snapshot": item.snapshot_json,
                }
                for item in items
            ]
            if include_items
            else [],
            "feedback": [
                {
                    "feedback_id": str(item.feedback_id),
                    "reviewer_id": item.reviewer_id,
                    "reviewer_name": item.reviewer.full_name or item.reviewer.email or item.reviewer.username
                    if item.reviewer
                    else "Reviewer",
                    "comments": item.comments,
                    "created_at": item.created_at.isoformat() if item.created_at else "",
                }
                for item in feedback
            ],
        }

    def accessible_submission_query(db: Session, user: models.User):
        query = db.query(models.CaseSubmission)
        if is_admin(user):
            return query.filter(models.CaseSubmission.status != "Draft")
        return query.filter(models.CaseSubmission.staff_id == user.user_id)

    def ensure_submission_access(
        submission_id: int,
        user: models.User,
        db: Session,
    ) -> models.CaseSubmission:
        submission = db.get(models.CaseSubmission, submission_id)
        if not submission:
            raise HTTPException(status_code=404, detail="Submission not found")
        if is_admin(user) or submission.staff_id == user.user_id:
            return submission
        raise HTTPException(status_code=403, detail="Submission access denied")

    def submission_case_records(
        db: Session,
        user: models.User,
        date_from: datetime,
        date_to: datetime,
    ) -> list[models.Case]:
        end = date_to + timedelta(days=1)
        return (
            scoped_case_query(db, user)
            .filter(
                models.IntakeRecord.form_date >= date_from,
                models.IntakeRecord.form_date < end,
            )
            .order_by(models.IntakeRecord.form_date.asc(), models.Case.case_id.asc())
            .all()
        )

    def populate_submission_items(
        db: Session,
        submission: models.CaseSubmission,
        records: list[models.Case],
    ) -> None:
        for record in records:
            db.add(
                models.CaseSubmissionItem(
                    submission_id=submission.submission_id,
                    case_id=record.case_id,
                    snapshot_json=submission_case_snapshot(record),
                )
            )

    @app.post("/api/case-submissions/preview")
    def preview_case_submission(
        payload: SubmissionPreviewPayload,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        if is_admin(user):
            raise HTTPException(status_code=403, detail="Staff account required")
        date_from = parse_date(payload.date_from)
        date_to = parse_date(payload.date_to)
        if not date_from or not date_to:
            raise HTTPException(status_code=422, detail="Valid coverage dates are required")
        if date_to < date_from:
            raise HTTPException(status_code=422, detail="End date cannot be before start date")
        records = submission_case_records(db, user, date_from, date_to)
        return {
            "date_from": date_from.date().isoformat(),
            "date_to": date_to.date().isoformat(),
            "case_count": len(records),
            "items": [submission_case_snapshot(record) for record in records],
        }

    @app.get("/api/case-submissions")
    def list_case_submissions(
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        submissions = (
            accessible_submission_query(db, user)
            .order_by(models.CaseSubmission.updated_at.desc(), models.CaseSubmission.submission_id.desc())
            .all()
        )
        latest_by_group: dict[int, models.CaseSubmission] = {}
        for submission in submissions:
            group_id = case_submission_group_id(submission)
            current = latest_by_group.get(group_id)
            if (
                current is None
                or submission.version > current.version
                or (
                    submission.version == current.version
                    and submission.submission_id > current.submission_id
                )
            ):
                latest_by_group[group_id] = submission
        latest = sorted(
            latest_by_group.values(),
            key=lambda item: (item.updated_at or item.created_at or datetime.min, item.submission_id),
            reverse=True,
        )
        return [submission_to_payload(submission, include_items=False) for submission in latest]

    @app.post("/api/case-submissions")
    def create_case_submission(
        payload: CaseSubmissionPayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        if is_admin(user):
            raise HTTPException(status_code=403, detail="Staff account required")
        date_from = parse_date(payload.date_from)
        date_to = parse_date(payload.date_to)
        if not date_from or not date_to:
            raise HTTPException(status_code=422, detail="Valid coverage dates are required")
        if date_to < date_from:
            raise HTTPException(status_code=422, detail="End date cannot be before start date")
        records = submission_case_records(db, user, date_from, date_to)
        submission = models.CaseSubmission(
            staff_id=user.user_id,
            title=payload.title.strip() or f"{date_from.strftime('%B %Y')} Intake Submission",
            date_from=date_from,
            date_to=date_to,
            notes=payload.notes,
            status="Draft",
            version=1,
        )
        db.add(submission)
        db.flush()
        populate_submission_items(db, submission, records)
        write_audit(
            db,
            user.user_id,
            "Create Draft",
            "case_submission",
            f"{user.full_name or user.email or user.username} created draft submission {submission.title} version {submission.version}",
            str(submission.submission_id),
            request,
        )
        db.commit()
        db.refresh(submission)
        return submission_to_payload(submission)

    @app.get("/api/case-submissions/{submission_id}")
    def get_case_submission(
        submission_id: int,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        submission = ensure_submission_access(submission_id, user, db)
        return submission_to_payload(submission)

    @app.get("/api/case-submissions/{submission_id}/history")
    def get_case_submission_history(
        submission_id: int,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        submission = ensure_submission_access(submission_id, user, db)
        group_id = case_submission_group_id(submission)
        history = (
            accessible_submission_query(db, user)
            .filter(
                or_(
                    models.CaseSubmission.submission_id == group_id,
                    models.CaseSubmission.parent_submission_id == group_id,
                )
            )
            .order_by(models.CaseSubmission.version.desc())
            .all()
        )
        return [submission_to_payload(item, include_items=False) for item in history]

    @app.patch("/api/case-submissions/{submission_id}")
    def update_case_submission(
        submission_id: int,
        payload: CaseSubmissionPayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        submission = ensure_submission_access(submission_id, user, db)
        if is_admin(user) or submission.status != "Draft":
            raise HTTPException(status_code=403, detail="Only staff can edit draft submissions")
        date_from = parse_date(payload.date_from)
        date_to = parse_date(payload.date_to)
        if not date_from or not date_to:
            raise HTTPException(status_code=422, detail="Valid coverage dates are required")
        if date_to < date_from:
            raise HTTPException(status_code=422, detail="End date cannot be before start date")
        submission.title = payload.title.strip() or submission.title
        submission.date_from = date_from
        submission.date_to = date_to
        submission.notes = payload.notes
        submission.updated_at = datetime.now()
        for item in list(submission.items):
            db.delete(item)
        db.flush()
        populate_submission_items(db, submission, submission_case_records(db, user, date_from, date_to))
        write_audit(
            db,
            user.user_id,
            "Edited Submission",
            "case_submission",
            f"Edited draft submission {submission.title}",
            str(submission.submission_id),
            request,
        )
        db.commit()
        db.refresh(submission)
        return submission_to_payload(submission)

    @app.post("/api/case-submissions/{submission_id}/submit")
    def submit_case_submission(
        submission_id: int,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        submission = ensure_submission_access(submission_id, user, db)
        if is_admin(user) or submission.status != "Draft":
            raise HTTPException(status_code=403, detail="Only draft submissions can be submitted by staff")
        submission.status = "Submitted"
        submission.submitted_at = datetime.now()
        submission.updated_at = datetime.now()
        write_audit(
            db,
            user.user_id,
            "Report Submitted",
            "case_submission",
            f"Submitted {submission.title} version {submission.version} for review",
            str(submission.submission_id),
            request,
        )
        db.commit()
        db.refresh(submission)
        return submission_to_payload(submission)

    @app.post("/api/case-submissions/{submission_id}/review")
    def start_case_submission_review(
        submission_id: int,
        request: Request,
        user: models.User = Depends(admin_user),
        db: Session = Depends(get_db),
    ):
        submission = ensure_submission_access(submission_id, user, db)
        ensure_latest_submission_version(db, submission)
        status = normalize_submission_status(submission.status)
        if status in {"Submitted", "Resubmitted"}:
            submission.status = "Under Review"
            submission.reviewed_by = user.user_id
            submission.updated_at = datetime.now()
            write_audit(
                db,
                user.user_id,
                "Viewed Submission",
                "case_submission",
                f"Started review for {submission.title} version {submission.version}",
                str(submission.submission_id),
                request,
            )
            db.commit()
            db.refresh(submission)
        return submission_to_payload(submission)

    @app.post("/api/case-submissions/{submission_id}/request-correction")
    def request_submission_correction(
        submission_id: int,
        payload: SubmissionFeedbackPayload,
        request: Request,
        user: models.User = Depends(admin_user),
        db: Session = Depends(get_db),
    ):
        submission = ensure_submission_access(submission_id, user, db)
        ensure_latest_submission_version(db, submission)
        status = normalize_submission_status(submission.status)
        if status not in {"Submitted", "Under Review", "Correction Required", "Resubmitted"}:
            raise HTTPException(status_code=400, detail="Submission is not available for correction review")
        submission.status = "Correction Required"
        submission.reviewed_by = user.user_id
        submission.updated_at = datetime.now()
        db.add(models.SubmissionFeedback(submission_id=submission.submission_id, reviewer_id=user.user_id, comments=payload.comments))
        write_audit(
            db,
            user.user_id,
            "Correction Requested",
            "case_submission",
            f"Requested correction for {submission.title} version {submission.version}",
            str(submission.submission_id),
            request,
        )
        db.commit()
        db.refresh(submission)
        return submission_to_payload(submission)

    @app.post("/api/case-submissions/{submission_id}/approve")
    def approve_case_submission(
        submission_id: int,
        request: Request,
        user: models.User = Depends(admin_user),
        db: Session = Depends(get_db),
    ):
        submission = ensure_submission_access(submission_id, user, db)
        ensure_latest_submission_version(db, submission)
        status = normalize_submission_status(submission.status)
        if status not in {"Submitted", "Under Review", "Correction Required", "Resubmitted"}:
            raise HTTPException(status_code=400, detail="Submission is not ready for approval")
        submission.status = "Approved"
        submission.reviewed_by = user.user_id
        submission.approved_at = datetime.now()
        submission.updated_at = datetime.now()
        write_audit(
            db,
            user.user_id,
            "Version Approved",
            "case_submission",
            f"Approved {submission.title} version {submission.version}",
            str(submission.submission_id),
            request,
        )
        db.commit()
        db.refresh(submission)
        return submission_to_payload(submission)

    @app.post("/api/case-submissions/{submission_id}/resubmit")
    def resubmit_case_submission(
        submission_id: int,
        payload: CaseSubmissionPayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        source = ensure_submission_access(submission_id, user, db)
        ensure_latest_submission_version(db, source)
        source_status = normalize_submission_status(source.status)
        if is_admin(user) or source.staff_id != user.user_id or source_status != "Correction Required":
            raise HTTPException(status_code=403, detail="Only corrected staff submissions can be resubmitted")
        date_from = parse_date(payload.date_from) or source.date_from
        date_to = parse_date(payload.date_to) or source.date_to
        if date_to < date_from:
            raise HTTPException(status_code=422, detail="End date cannot be before start date")
        group_id = case_submission_group_id(source)
        latest_version = latest_submission_version(db, source)
        submission = models.CaseSubmission(
            staff_id=user.user_id,
            title=payload.title.strip() or source.title,
            date_from=date_from,
            date_to=date_to,
            status="Resubmitted",
            version=int(latest_version) + 1,
            parent_submission_id=group_id,
            notes=payload.notes,
            submitted_at=datetime.now(),
        )
        db.add(submission)
        db.flush()
        populate_submission_items(db, submission, submission_case_records(db, user, date_from, date_to))
        write_audit(
            db,
            user.user_id,
            "Version Created",
            "case_submission",
            f"Created {submission.title} version {submission.version} from correction workflow",
            str(submission.submission_id),
            request,
        )
        write_audit(
            db,
            user.user_id,
            "Version Resubmitted",
            "case_submission",
            f"Resubmitted {submission.title} version {submission.version}",
            str(submission.submission_id),
            request,
        )
        db.commit()
        db.refresh(submission)
        return submission_to_payload(submission)

    return ensure_submission_access
