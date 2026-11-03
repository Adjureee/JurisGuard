from datetime import datetime, timedelta
from typing import Literal


PresenceStatus = Literal["Online", "Away", "Offline"]


def calculate_presence_status(
    last_seen_at: datetime | None,
    last_interaction_at: datetime | None,
    expires_at: datetime | None,
    now: datetime,
    *,
    stale_after_seconds: int,
    away_after_seconds: int,
    revoked: bool = False,
) -> PresenceStatus:
    if revoked or last_seen_at is None or expires_at is None:
        return "Offline"
    if expires_at <= now or last_seen_at < now - timedelta(seconds=stale_after_seconds):
        return "Offline"
    if last_interaction_at and last_interaction_at >= now - timedelta(seconds=away_after_seconds):
        return "Online"
    return "Away"


def personnel_designation(role_name: str | None, is_admin: bool) -> str | None:
    normalized_role = (role_name or "").strip().casefold()
    if normalized_role == "admin staff":
        return "Admin Staff"
    if is_admin:
        return "Administrator"
    if normalized_role == "staff":
        return "Attorney"
    return None
