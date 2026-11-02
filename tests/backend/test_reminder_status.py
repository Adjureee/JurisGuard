import sys
import unittest
from datetime import date, datetime, time, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from reminder_status import PHILIPPINE_TIMEZONE, calculate_reminder_status, can_complete_reminder


class ReminderStatusTests(unittest.TestCase):
    def test_future_reminder_is_upcoming(self):
        now = datetime(2026, 5, 1, 8, 0, tzinfo=PHILIPPINE_TIMEZONE)
        self.assertEqual(calculate_reminder_status(date(2026, 5, 1), time(9), "Upcoming", now), "Upcoming")

    def test_timed_reminder_becomes_overdue_at_due_time(self):
        now = datetime(2026, 5, 1, 9, 0, tzinfo=PHILIPPINE_TIMEZONE)
        self.assertEqual(calculate_reminder_status(date(2026, 5, 1), time(9), "Upcoming", now), "Overdue")

    def test_all_day_reminder_stays_upcoming_through_end_of_day(self):
        now = datetime(2026, 5, 1, 23, 59, 59, tzinfo=PHILIPPINE_TIMEZONE)
        self.assertEqual(calculate_reminder_status(date(2026, 5, 1), None, "Upcoming", now), "Upcoming")

    def test_all_day_reminder_becomes_overdue_at_next_midnight(self):
        now = datetime(2026, 5, 2, 0, 0, tzinfo=PHILIPPINE_TIMEZONE)
        self.assertEqual(calculate_reminder_status(date(2026, 5, 1), None, "Upcoming", now), "Overdue")

    def test_overdue_reminder_moved_to_future_becomes_upcoming(self):
        now = datetime(2026, 5, 1, 8, 0, tzinfo=PHILIPPINE_TIMEZONE)
        self.assertEqual(calculate_reminder_status(date(2026, 5, 1), time(9), "Overdue", now), "Upcoming")

    def test_completed_legacy_and_current_statuses_never_become_overdue(self):
        now = datetime(2026, 5, 2, 0, 0, tzinfo=PHILIPPINE_TIMEZONE)
        for status in ("Done", "Completed"):
            with self.subTest(status=status):
                self.assertEqual(calculate_reminder_status(date(2026, 5, 1), None, status, now), "Done")

    def test_due_instant_is_compared_in_philippine_timezone(self):
        due_in_utc = datetime(2026, 5, 1, 1, 0, tzinfo=timezone.utc)
        self.assertEqual(calculate_reminder_status(date(2026, 5, 1), time(9), "Upcoming", due_in_utc), "Overdue")

    def test_timed_reminder_cannot_be_completed_one_minute_early(self):
        now = datetime(2026, 5, 1, 14, 59, tzinfo=PHILIPPINE_TIMEZONE)
        self.assertFalse(can_complete_reminder(date(2026, 5, 1), time(15), "Upcoming", now))

    def test_timed_reminder_can_be_completed_at_or_after_scheduled_time(self):
        for now in (
            datetime(2026, 5, 1, 15, 0, tzinfo=PHILIPPINE_TIMEZONE),
            datetime(2026, 5, 1, 15, 1, tzinfo=PHILIPPINE_TIMEZONE),
        ):
            with self.subTest(now=now):
                self.assertTrue(can_complete_reminder(date(2026, 5, 1), time(15), "Upcoming", now))

    def test_all_day_reminder_is_eligible_from_midnight_on_scheduled_date(self):
        before = datetime(2026, 4, 30, 23, 59, 59, tzinfo=PHILIPPINE_TIMEZONE)
        midnight = datetime(2026, 5, 1, 0, 0, tzinfo=PHILIPPINE_TIMEZONE)
        self.assertFalse(can_complete_reminder(date(2026, 5, 1), None, "Upcoming", before))
        self.assertTrue(can_complete_reminder(date(2026, 5, 1), None, "Upcoming", midnight))

    def test_overdue_reminder_can_be_completed(self):
        now = datetime(2026, 5, 1, 15, 1, tzinfo=PHILIPPINE_TIMEZONE)
        self.assertTrue(can_complete_reminder(date(2026, 5, 1), time(15), "Overdue", now))

    def test_completed_reminder_cannot_be_completed_again(self):
        now = datetime(2026, 5, 2, 12, 0, tzinfo=PHILIPPINE_TIMEZONE)
        for status in ("Done", "Completed"):
            with self.subTest(status=status):
                self.assertFalse(can_complete_reminder(date(2026, 5, 1), None, status, now))

    def test_due_instant_uses_philippine_timezone(self):
        due_in_utc = datetime(2026, 5, 1, 7, 0, tzinfo=timezone.utc)
        before_in_utc = datetime(2026, 5, 1, 6, 59, tzinfo=timezone.utc)
        self.assertFalse(can_complete_reminder(date(2026, 5, 1), time(15), "Upcoming", before_in_utc))
        self.assertTrue(can_complete_reminder(date(2026, 5, 1), time(15), "Upcoming", due_in_utc))


if __name__ == "__main__":
    unittest.main()
