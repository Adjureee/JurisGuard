import re


def can_manage_shared_reminders(user, is_admin_user: bool = False) -> bool:
    if is_admin_user:
        return True
    role = getattr(user, "role", None)
    permissions = {
        item.strip().lower()
        for item in re.split(r"[,;\s]+", getattr(role, "permissions", "") or "")
        if item.strip()
    }
    return bool(permissions & {"shared_reminders", "manage_shared_reminders", "calendar:shared"})


def can_access_reminder(reminder, user) -> bool:
    return reminder.visibility == "shared" or reminder.created_by_user_id == user.user_id


def can_edit_reminder(reminder, user, can_manage_shared: bool) -> bool:
    if reminder.visibility == "personal":
        return reminder.created_by_user_id == user.user_id
    return can_manage_shared
