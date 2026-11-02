import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from case_transfer_permissions import can_edit_transfer_report, can_submit_transfer_report


class CaseTransferPermissionTests(unittest.TestCase):
    def setUp(self):
        self.admin = SimpleNamespace(user_id=1)
        self.from_attorney = SimpleNamespace(user_id=2)
        self.to_attorney = SimpleNamespace(user_id=3)
        self.unrelated_attorney = SimpleNamespace(user_id=4)
        self.admin_created_report = SimpleNamespace(
            from_user_id=self.from_attorney.user_id,
            to_user_id=self.to_attorney.user_id,
            initiated_by_user_id=self.admin.user_id,
        )

    def test_assigned_from_attorney_can_edit_admin_created_draft(self):
        self.assertTrue(
            can_edit_transfer_report(self.admin_created_report, self.from_attorney, False)
        )

    def test_admin_creator_retains_draft_edit_permission(self):
        self.assertTrue(
            can_edit_transfer_report(self.admin_created_report, self.admin, True)
        )

    def test_only_assigned_from_attorney_can_submit(self):
        self.assertTrue(
            can_submit_transfer_report(self.admin_created_report, self.from_attorney, False)
        )
        self.assertFalse(
            can_submit_transfer_report(self.admin_created_report, self.to_attorney, False)
        )
        self.assertFalse(
            can_submit_transfer_report(self.admin_created_report, self.unrelated_attorney, False)
        )
        self.assertFalse(
            can_submit_transfer_report(self.admin_created_report, self.admin, True)
        )

    def test_attorney_created_report_remains_editable_and_submittable_by_from(self):
        report = SimpleNamespace(
            from_user_id=self.from_attorney.user_id,
            to_user_id=self.to_attorney.user_id,
            initiated_by_user_id=None,
        )
        self.assertTrue(can_edit_transfer_report(report, self.from_attorney, False))
        self.assertTrue(can_submit_transfer_report(report, self.from_attorney, False))

    def test_recipient_and_unrelated_attorneys_cannot_edit_draft(self):
        self.assertFalse(
            can_edit_transfer_report(self.admin_created_report, self.to_attorney, False)
        )
        self.assertFalse(
            can_edit_transfer_report(self.admin_created_report, self.unrelated_attorney, False)
        )


if __name__ == "__main__":
    unittest.main()
