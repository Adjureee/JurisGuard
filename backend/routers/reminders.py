from datetime import datetime
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session

import models
from reminder_permissions import (
    can_access_reminder,
    can_edit_reminder,
    can_manage_shared_reminders as role_can_manage_shared_reminders,
)
from reminder_status import PHILIPPINE_TIMEZONE, calculate_reminder_status, can_complete_reminder
from schemas import ReminderPayload

REMINDER_TIMEZONE = PHILIPPINE_TIMEZONE
REMINDER_NOTIFICATION_LEADS = {0, 5, 15, 30, 60, 1440}


def reminder_status_at(reminder: models.Reminder, now: datetime) -> str:
    return calculate_reminder_status(reminder.reminder_date, reminder.start_time, reminder.status, now)


def refresh_reminder_status(reminder: models.Reminder, now: datetime | None = None) -> bool:
    calculated = reminder_status_at(reminder, now or datetime.now(REMINDER_TIMEZONE))
    if reminder.status != calculated:
        reminder.status = calculated
        reminder.updated_at = datetime.now(REMINDER_TIMEZONE).replace(tzinfo=None)
        return True
    return False


def reconcile_reminder_statuses(db: Session, reminders: list[models.Reminder] | None = None) -> None:
    candidates = reminders if reminders is not None else db.query(models.Reminder).filter(
        models.Reminder.status != "Done",
    ).all()
    now = datetime.now(REMINDER_TIMEZONE)
    changed = False
    for reminder in candidates:
        changed = refresh_reminder_status(reminder, now) or changed
    if changed:
        db.flush()


def validate_reminder_payload(payload: ReminderPayload) -> None:
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="Reminder title is required")
    if len(payload.title.strip()) > 200:
        raise HTTPException(status_code=422, detail="Reminder title must be 200 characters or fewer")
    if len(payload.description) > 4000:
        raise HTTPException(status_code=422, detail="Reminder notes must be 4,000 characters or fewer")
    if any(value and value.tzinfo is not None for value in (payload.start_time, payload.end_time)):
        raise HTTPException(status_code=422, detail="Reminder times must use local office time without a timezone offset")
    if payload.end_time and not payload.start_time:
        raise HTTPException(status_code=422, detail="An end time requires a start time")
    if payload.start_time and payload.end_time and payload.end_time <= payload.start_time:
        raise HTTPException(status_code=422, detail="End time must be later than start time")
    if payload.notification_minutes_before not in REMINDER_NOTIFICATION_LEADS | {None}:
        raise HTTPException(status_code=422, detail="Choose a supported notification time")


def reminder_payload(reminder: models.Reminder) -> dict[str, Any]:
    return {
        "reminder_id": reminder.reminder_id,
        "created_by_user_id": reminder.created_by_user_id,
        "title": reminder.title,
        "description": reminder.description or "",
        "date": reminder.reminder_date.isoformat(),
        "start_time": reminder.start_time.isoformat(timespec="minutes") if reminder.start_time else None,
        "end_time": reminder.end_time.isoformat(timespec="minutes") if reminder.end_time else None,
        "category": reminder.category,
        "priority": reminder.priority,
        "visibility": reminder.visibility,
        "notification_minutes_before": reminder.notification_minutes_before,
        "status": reminder.status,
        "created_at": reminder.created_at.isoformat() if reminder.created_at else None,
        "updated_at": reminder.updated_at.isoformat() if reminder.updated_at else None,
    }


def apply_reminder_payload(reminder: models.Reminder, payload: ReminderPayload) -> None:
    validate_reminder_payload(payload)
    reminder.title = payload.title.strip()
    reminder.description = payload.description.strip()
    reminder.reminder_date = payload.date
    reminder.start_time = payload.start_time
    reminder.end_time = payload.end_time
    reminder.category = payload.category
    reminder.priority = payload.priority
    reminder.visibility = payload.visibility
    reminder.notification_minutes_before = payload.notification_minutes_before
    if reminder.status not in {"Done", "Completed"}:
        refresh_reminder_status(reminder)
    else:
        reminder.status = "Done"
    reminder.updated_at = datetime.now(REMINDER_TIMEZONE).replace(tzinfo=None)


def calendar_holiday_payload(holiday: models.CalendarHoliday) -> dict[str, Any]:
    return {
        "holiday_id": holiday.holiday_id,
        "source_key": holiday.source_key,
        "name": holiday.name,
        "date": holiday.holiday_date.isoformat(),
        "classification": holiday.classification,
        "coverage": holiday.coverage,
        "geographic_scope": holiday.geographic_scope,
        "reference": holiday.reference,
        "source_url": holiday.source_url,
        "year": holiday.year,
        "updated_at": holiday.updated_at.isoformat() if holiday.updated_at else None,
    }


def register_reminder_routes(
    app: FastAPI,
    *,
    current_user,
    get_db,
    is_admin,
    write_audit,
) -> None:
    def can_manage_shared_reminders(user: models.User) -> bool:
        return role_can_manage_shared_reminders(user, is_admin(user))

    def ensure_reminder_access(
        reminder_id: int,
        user: models.User,
        db: Session,
        *,
        lock: bool = False,
    ) -> models.Reminder:
        reminder = (
            db.query(models.Reminder)
            .filter(models.Reminder.reminder_id == reminder_id)
            .with_for_update()
            .first()
            if lock
            else db.get(models.Reminder, reminder_id)
        )
        if not reminder or not can_access_reminder(reminder, user):
            raise HTTPException(status_code=404, detail="Reminder not found")
        return reminder

    def ensure_reminder_edit_access(reminder: models.Reminder, user: models.User) -> None:
        if not can_edit_reminder(reminder, user, can_manage_shared_reminders(user)):
            if reminder.visibility == "personal":
                raise HTTPException(status_code=404, detail="Reminder not found")
            raise HTTPException(status_code=403, detail="You cannot manage shared office reminders")

    @app.get("/api/reminders")
    def list_reminders(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
        reminders = db.query(models.Reminder).filter(
            or_(
                models.Reminder.visibility == "shared",
                models.Reminder.created_by_user_id == user.user_id,
            )
        ).order_by(models.Reminder.reminder_date, models.Reminder.start_time, models.Reminder.reminder_id).all()
        reconcile_reminder_statuses(db, reminders)
        db.commit()
        return {
            "items": [reminder_payload(reminder) for reminder in reminders],
            "can_manage_shared": can_manage_shared_reminders(user),
        }

    @app.get("/api/reminders/{reminder_id}")
    def get_reminder(reminder_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
        reminder = ensure_reminder_access(reminder_id, user, db)
        reconcile_reminder_statuses(db, [reminder])
        db.commit()
        return reminder_payload(reminder)

    @app.post("/api/reminders")
    def create_reminder(
        payload: ReminderPayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        validate_reminder_payload(payload)
        if payload.visibility == "shared" and not can_manage_shared_reminders(user):
            raise HTTPException(status_code=403, detail="You cannot create shared office reminders")
        reminder = models.Reminder(created_by_user_id=user.user_id)
        apply_reminder_payload(reminder, payload)
        db.add(reminder)
        db.flush()
        write_audit(db, user.user_id, "Created Reminder", "reminder", reminder.title, str(reminder.reminder_id), request)
        db.commit()
        db.refresh(reminder)
        return reminder_payload(reminder)

    @app.put("/api/reminders/{reminder_id}")
    def update_reminder(
        reminder_id: int,
        payload: ReminderPayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        reminder = ensure_reminder_access(reminder_id, user, db)
        ensure_reminder_edit_access(reminder, user)
        if payload.visibility == "shared" and not can_manage_shared_reminders(user):
            raise HTTPException(status_code=403, detail="You cannot create shared office reminders")
        prior_visibility = reminder.visibility
        apply_reminder_payload(reminder, payload)
        if prior_visibility == "shared" and reminder.visibility == "personal":
            db.query(models.Notification).filter(
                models.Notification.entity_type == "reminder",
                models.Notification.entity_id == str(reminder.reminder_id),
                models.Notification.user_id != reminder.created_by_user_id,
            ).delete(synchronize_session=False)
        write_audit(db, user.user_id, "Updated Reminder", "reminder", reminder.title, str(reminder.reminder_id), request)
        db.commit()
        db.refresh(reminder)
        return reminder_payload(reminder)

    @app.patch("/api/reminders/{reminder_id}/complete")
    def complete_reminder(
        reminder_id: int,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        reminder = ensure_reminder_access(reminder_id, user, db, lock=True)
        ensure_reminder_edit_access(reminder, user)
        if reminder.status in {"Done", "Completed"}:
            raise HTTPException(status_code=409, detail="This reminder is already completed")
        if not can_complete_reminder(
            reminder.reminder_date,
            reminder.start_time,
            reminder.status,
            datetime.now(REMINDER_TIMEZONE),
        ):
            raise HTTPException(status_code=400, detail="The reminder's scheduled time has not yet arrived")
        reminder.status = "Done"
        reminder.updated_at = datetime.now(REMINDER_TIMEZONE).replace(tzinfo=None)
        write_audit(db, user.user_id, "Completed Reminder", "reminder", reminder.title, str(reminder.reminder_id), request)
        db.commit()
        db.refresh(reminder)
        return reminder_payload(reminder)

    @app.delete("/api/reminders/{reminder_id}")
    def delete_reminder(
        reminder_id: int,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        reminder = ensure_reminder_access(reminder_id, user, db)
        ensure_reminder_edit_access(reminder, user)
        write_audit(db, user.user_id, "Deleted Reminder", "reminder", reminder.title, str(reminder.reminder_id), request)
        db.query(models.Notification).filter(
            models.Notification.entity_type == "reminder",
            models.Notification.entity_id == str(reminder.reminder_id),
        ).delete(synchronize_session=False)
        db.delete(reminder)
        db.commit()
        return {"ok": True}

    @app.get("/api/holidays")
    def list_calendar_holidays(
        year: int = Query(ge=1900, le=2200),
        _: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        holidays = db.query(models.CalendarHoliday).filter(
            models.CalendarHoliday.year == year,
        ).order_by(
            models.CalendarHoliday.holiday_date,
            models.CalendarHoliday.coverage,
            models.CalendarHoliday.name,
        ).all()
        return [calendar_holiday_payload(holiday) for holiday in holidays]
