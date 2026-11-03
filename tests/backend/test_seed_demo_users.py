"""Demo account creation must stay isolated from the configured database."""

import hashlib
import unittest

from seed_demo_users import DEMO_ACCOUNTS, FRESH_ACCOUNTS, hash_password, marker_for, target_url


class DemoSeedTests(unittest.TestCase):
    def test_target_is_distinct_local_database(self):
        target = target_url("postgresql://sample:secret@localhost:5432/jurisguard")
        self.assertEqual(target.database, "jurisguard_demo")
        self.assertEqual(target.host, "localhost")
        fresh = target_url("postgresql://sample:secret@localhost:5432/jurisguard", "jurisguard_fresh")
        self.assertEqual(fresh.database, "jurisguard_fresh")
        self.assertEqual([email for email, _, _ in FRESH_ACCOUNTS], ["admin@local.test", "staff@local.test"])
        self.assertEqual(marker_for("jurisguard_demo"), "JurisGuard synthetic demo users v1")

    def test_remote_or_non_postgres_targets_are_rejected(self):
        for source in (
            "postgresql://sample:secret@remote.example.com/jurisguard",
            "postgresql://sample:secret@localhost/jurisguard_demo",
            "postgresql://sample:secret@localhost/jurisguard_fresh",
            "sqlite:///jurisguard.db",
        ):
            with self.subTest(source=source), self.assertRaises(ValueError):
                target_url(source)
        with self.assertRaises(ValueError):
            target_url("postgresql://sample:secret@localhost/jurisguard", "jurisguard")

    def test_fixtures_are_synthetic_and_passwords_match_app_format(self):
        self.assertEqual(len(DEMO_ACCOUNTS), 3)
        self.assertTrue(all(email.endswith("@example.com") for email, _, _ in DEMO_ACCOUNTS))
        first = hash_password("synthetic-test-password")
        second = hash_password("synthetic-test-password")
        self.assertNotEqual(first, second)
        scheme, salt, digest = first.split("$", 2)
        self.assertEqual(scheme, "pbkdf2_sha256")
        self.assertEqual(
            hashlib.pbkdf2_hmac("sha256", b"synthetic-test-password", salt.encode(), 120_000).hex(),
            digest,
        )


if __name__ == "__main__":
    unittest.main()
