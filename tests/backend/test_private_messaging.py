import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from messaging_permissions import can_message_designations, normalize_message_content
from presence_status import personnel_designation


class PrivateMessagingPermissionTests(unittest.TestCase):
    def test_attorneys_can_message_each_other_and_administrators(self):
        self.assertTrue(can_message_designations("Administrator", "Attorney"))
        self.assertTrue(can_message_designations("Attorney", "Administrator"))
        self.assertTrue(can_message_designations("Attorney", "Attorney"))
        self.assertFalse(can_message_designations("Administrator", "Administrator"))
        self.assertFalse(can_message_designations("Admin Staff", "Attorney"))
        self.assertFalse(can_message_designations(None, "Administrator"))

    def test_message_content_is_trimmed_and_plain_text_length_is_bounded(self):
        self.assertEqual(normalize_message_content("  Hello office  "), "Hello office")
        with self.assertRaises(ValueError):
            normalize_message_content(" \n ")
        with self.assertRaises(ValueError):
            normalize_message_content("Invalid\x00message")
        with self.assertRaises(ValueError):
            normalize_message_content("x" * 2001)

    def test_designations_follow_the_existing_role_mapping(self):
        self.assertEqual(personnel_designation("staff", False), "Attorney")
        self.assertEqual(personnel_designation("admin", True), "Administrator")
        self.assertEqual(personnel_designation("admin staff", False), "Admin Staff")
        self.assertIsNone(personnel_designation("unknown", False))


if __name__ == "__main__":
    unittest.main()
