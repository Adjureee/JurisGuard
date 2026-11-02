def can_edit_transfer_report(report, user, is_admin: bool) -> bool:
    return report.from_user_id == user.user_id or (
        is_admin and report.initiated_by_user_id == user.user_id
    )


def can_submit_transfer_report(report, user, is_admin: bool) -> bool:
    return not is_admin and report.from_user_id == user.user_id
