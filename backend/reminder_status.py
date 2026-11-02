from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


try:
    PHILIPPINE_TIMEZONE = ZoneInfo("Asia/Manila")
except ZoneInfoNotFoundError:
    PHILIPPINE_TIMEZONE = timezone(timedelta(hours=8), "Asia/Manila")


def calculate_reminder_status(
    reminder_date: date,
    start_time: time | None,
    current_status: str,
    now: datetime,
) -> str:
    if current_status in {"Done", "Completed"}:
        return "Done"

    if start_time:
        due_at = datetime.combine(reminder_date, start_time, tzinfo=PHILIPPINE_TIMEZONE)
    else:
        due_at = datetime.combine(reminder_date + timedelta(days=1), time.min, tzinfo=PHILIPPINE_TIMEZONE)
    return "Overdue" if now.astimezone(PHILIPPINE_TIMEZONE) >= due_at else "Upcoming"


def can_complete_reminder(
    reminder_date: date,
    start_time: time | None,
    current_status: str,
    now: datetime,
) -> bool:
    if current_status in {"Done", "Completed"}:
        return False

    eligible_at = datetime.combine(
        reminder_date,
        start_time or time.min,
        tzinfo=PHILIPPINE_TIMEZONE,
    )
    return now.astimezone(PHILIPPINE_TIMEZONE) >= eligible_at
