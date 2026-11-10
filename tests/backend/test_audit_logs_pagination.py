import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
os.environ.setdefault("SECRET_KEY", "s" * 40)

import models  # noqa: E402


class AuditLogPaginationAndIndexTests(unittest.TestCase):
    def test_audit_log_model_declares_pagination_and_filter_indexes(self):
        index_Map = {
            idx.name: tuple(col.name for col in idx.columns)
            for idx in models.AuditLog.__table__.indexes
        }
        self.assertEqual(
            index_Map.get("ix_audit_log_timestamp_log_id"),
            ("timestamp", "log_id"),
        )
        self.assertEqual(
            index_Map.get("ix_audit_log_user_timestamp_log_id"),
            ("user_id", "timestamp", "log_id"),
        )
        self.assertEqual(
            index_Map.get("ix_audit_log_action_timestamp_log_id"),
            ("action", "timestamp", "log_id"),
        )
        self.assertEqual(
            index_Map.get("ix_audit_log_target_entity_id"),
            ("target_entity", "entity_id"),
        )

    def test_paged_audit_logs_supports_pagination_scoping_and_filters(self):
        from unittest.mock import patch

        with (
            patch("database.engine"),
            patch("models.Base.metadata.create_all"),
            patch("bootstrap.ensure_schema_compatibility"),
            patch("bootstrap.seed_roles"),
            patch("bootstrap.seed_calendar_holidays"),
        ):
            import main

        sqlite_engine = create_engine("sqlite:///:memory:")
        for table in (
            models.Role.__table__,
            models.User.__table__,
            models.AuditLog.__table__,
        ):
            table.create(bind=sqlite_engine)
        SessionLocal = sessionmaker(bind=sqlite_engine)

        with SessionLocal() as db:
            admin_role = models.Role(role_id=1, role_name="admin", permissions="all")
            staff_role = models.Role(role_id=2, role_name="staff", permissions="cases")
            db.add_all([admin_role, staff_role])
            db.flush()

            admin_user = models.User(
                user_id=10,
                role_id=1,
                username="admin_syn",
                email="admin@synthetic.local",
                full_name="SYNTHETIC Admin",
                password_hash="x",
                approval_status="approved",
                is_active=True,
            )
            staff_user = models.User(
                user_id=20,
                role_id=2,
                username="staff_syn",
                email="staff@synthetic.local",
                full_name="SYNTHETIC Staff",
                password_hash="x",
                approval_status="approved",
                is_active=True,
            )
            db.add_all([admin_user, staff_user])
            db.flush()

            entries = [
                models.AuditLog(
                    log_id=1,
                    user_id=10,
                    action="Login",
                    target_entity="Authentication",
                    description="Admin signed in",
                    timestamp=datetime(2026, 1, 10, 8, 0, tzinfo=timezone.utc),
                ),
                models.AuditLog(
                    log_id=2,
                    user_id=20,
                    action="Create Client",
                    target_entity="client",
                    entity_id="101",
                    description="Created synthetic client 101",
                    timestamp=datetime(2026, 1, 11, 9, 30, tzinfo=timezone.utc),
                ),
                models.AuditLog(
                    log_id=3,
                    user_id=20,
                    action="Create Case",
                    target_entity="case",
                    entity_id="202",
                    description="Created synthetic case 202",
                    timestamp=datetime(2026, 1, 12, 11, 15, tzinfo=timezone.utc),
                ),
                models.AuditLog(
                    log_id=4,
                    user_id=10,
                    action="Export Excel",
                    target_entity="criminal_case_export",
                    description="Admin exported synthetic report",
                    timestamp=datetime(2026, 1, 13, 14, 0, tzinfo=timezone.utc),
                ),
                models.AuditLog(
                    log_id=5,
                    user_id=None,
                    action="System Maintenance",
                    target_entity="user",
                    description="Automated synthetic check",
                    timestamp=datetime(2026, 1, 14, 16, 0, tzinfo=timezone.utc),
                ),
            ]
            db.add_all(entries)
            db.commit()

            # 1. Admin pagination: page 1 and page 2 with page_size=2
            page1 = main.list_audit_logs_paged(
                user=admin_user,
                db=db,
                page=1,
                page_size=2,
                action=None,
                date_from=None,
                date_to=None,
                user_id=None,
                user_role=None,
                search=None,
            )
            self.assertEqual(page1["total"], 5)
            self.assertEqual(page1["total_pages"], 3)
            self.assertEqual(page1["page"], 1)
            self.assertEqual([item["id"] for item in page1["items"]], ["5", "4"])
            self.assertEqual(
                page1["available_actions"],
                [
                    "Create Case",
                    "Create Client",
                    "Export Excel",
                    "Login",
                    "System Maintenance",
                ],
            )
            self.assertEqual(page1["available_roles"], ["admin", "staff", "system"])

            page2 = main.list_audit_logs_paged(
                user=admin_user,
                db=db,
                page=2,
                page_size=2,
                action=None,
                date_from=None,
                date_to=None,
                user_id=None,
                user_role=None,
                search=None,
            )
            self.assertEqual([item["id"] for item in page2["items"]], ["3", "2"])

            # 2. Admin role filter ('staff' vs 'system')
            staff_role_page = main.list_audit_logs_paged(
                user=admin_user,
                db=db,
                page=1,
                page_size=10,
                action=None,
                date_from=None,
                date_to=None,
                user_id=None,
                user_role="staff",
                search=None,
            )
            self.assertEqual(staff_role_page["total"], 2)
            self.assertEqual([item["id"] for item in staff_role_page["items"]], ["3", "2"])

            system_role_page = main.list_audit_logs_paged(
                user=admin_user,
                db=db,
                page=1,
                page_size=10,
                action=None,
                date_from=None,
                date_to=None,
                user_id=None,
                user_role="system",
                search=None,
            )
            self.assertEqual(system_role_page["total"], 1)
            self.assertEqual(system_role_page["items"][0]["id"], "5")

            # 3. Staff user is strictly scoped to their own logs even if user_id=10 is passed
            staff_scoped = main.list_audit_logs_paged(
                user=staff_user,
                db=db,
                page=1,
                page_size=10,
                action=None,
                date_from=None,
                date_to=None,
                user_id=10,
                user_role="admin",
                search=None,
            )
            self.assertEqual(staff_scoped["total"], 2)
            self.assertEqual([item["id"] for item in staff_scoped["items"]], ["3", "2"])
            self.assertEqual(staff_scoped["available_actions"], ["Create Case", "Create Client"])
            self.assertEqual(staff_scoped["available_users"], [])

            # 4. Date range and search filtering
            filtered = main.list_audit_logs_paged(
                user=admin_user,
                db=db,
                page=1,
                page_size=10,
                action=None,
                date_from="2026-01-11",
                date_to="2026-01-13",
                user_id=None,
                user_role=None,
                search="202",
            )
            self.assertEqual(filtered["total"], 1)
            self.assertEqual(filtered["items"][0]["id"], "3")


if __name__ == "__main__":
    unittest.main()
