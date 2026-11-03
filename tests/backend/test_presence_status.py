import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from presence_status import calculate_presence_status, personnel_designation


class PresenceStatusTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 2, 10, 0)
        self.expires_at = self.now + timedelta(hours=1)

    def get_status(self, last_seen_at, last_interaction_at, **kwargs):
        return calculate_presence_status(
            last_seen_at,
            last_interaction_at,
            kwargs.pop("expires_at", self.expires_at),
            self.now,
            stale_after_seconds=120,
            away_after_seconds=300,
            **kwargs,
        )

    def test_recent_interaction_is_online(self):
        self.assertEqual(self.get_status(self.now, self.now), "Online")

    def test_active_session_without_recent_interaction_is_away(self):
        self.assertEqual(
            self.get_status(self.now, self.now - timedelta(minutes=6)),
            "Away",
        )

    def test_stale_heartbeat_is_offline(self):
        self.assertEqual(
            self.get_status(self.now - timedelta(seconds=121), self.now),
            "Offline",
        )

    def test_expired_or_revoked_session_is_offline(self):
        self.assertEqual(
            self.get_status(self.now, self.now, expires_at=self.now),
            "Offline",
        )
        self.assertEqual(self.get_status(self.now, self.now, revoked=True), "Offline")

    def test_designations_only_map_supported_roles(self):
        self.assertEqual(personnel_designation("staff", False), "Attorney")
        self.assertEqual(personnel_designation("Admin", True), "Administrator")
        self.assertEqual(personnel_designation("Admin Staff", True), "Admin Staff")
        self.assertIsNone(personnel_designation("user", False))


if __name__ == "__main__":
    unittest.main()
