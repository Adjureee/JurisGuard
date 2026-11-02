import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from reminder_permissions import (
    can_access_reminder,
    can_edit_reminder,
    can_manage_shared_reminders,
)


class ReminderPermissionTests(unittest.TestCase):
    def setUp(self):
        self.admin = SimpleNamespace(user_id=1, role=SimpleNamespace(permissions="all"))
        self.staff = SimpleNamespace(user_id=2, role=SimpleNamespace(permissions="clients,cases,documents"))
        self.shared_manager = SimpleNamespace(
            user_id=3,
            role=SimpleNamespace(permissions="clients,manage_shared_reminders"),
        )
        self.other_staff = SimpleNamespace(user_id=4, role=SimpleNamespace(permissions="clients"))
        self.personal = SimpleNamespace(visibility="personal", created_by_user_id=self.staff.user_id)
        self.shared = SimpleNamespace(visibility="shared", created_by_user_id=self.admin.user_id)

    def test_personal_reminders_are_owner_only_including_from_admin(self):
        self.assertTrue(can_access_reminder(self.personal, self.staff))
        self.assertFalse(can_access_reminder(self.personal, self.admin))
        self.assertFalse(can_access_reminder(self.personal, self.other_staff))

    def test_shared_reminders_are_visible_to_authenticated_office_roles(self):
        self.assertTrue(can_access_reminder(self.shared, self.admin))
        self.assertTrue(can_access_reminder(self.shared, self.staff))
        self.assertTrue(can_access_reminder(self.shared, self.other_staff))

    def test_shared_management_requires_admin_or_explicit_permission(self):
        self.assertTrue(can_manage_shared_reminders(self.admin, True))
        self.assertFalse(can_manage_shared_reminders(self.staff))
        self.assertTrue(can_manage_shared_reminders(self.shared_manager))

    def test_edit_scope_respects_visibility_and_shared_permission(self):
        self.assertTrue(can_edit_reminder(self.personal, self.staff, False))
        self.assertFalse(can_edit_reminder(self.personal, self.admin, True))
        self.assertFalse(can_edit_reminder(self.shared, self.staff, False))
        self.assertTrue(can_edit_reminder(self.shared, self.shared_manager, True))


if __name__ == "__main__":
    unittest.main()
