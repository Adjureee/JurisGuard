"""Run with the isolated E2E PostgreSQL URL; synthetic records are rolled back."""
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
from fastapi import Response

EXPECTED = "postgresql://jurisguard_test@127.0.0.1:55439/jurisguard_synthetic"
if os.environ.get("DATABASE_URL") != EXPECTED or os.environ.get("E2E_ISOLATED_DB") != "jurisguard_synthetic:55439":
    raise SystemExit("Refusing to test on a non-isolated database")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
import main  # noqa: E402
import models  # noqa: E402
from database import SessionLocal  # noqa: E402

main.ensure_schema_compatibility()  # startup migration is repeatable
with SessionLocal() as db:
    staff = db.query(models.User).join(models.Role).filter(models.Role.role_name == "staff", models.User.approval_status == "approved").order_by(models.User.user_id).limit(2).all()
    admin = db.query(models.User).join(models.Role).filter(models.Role.role_name == "admin").first()
    assert len(staff) == 2 and admin, "Run tests/live_api_smoke.py first to seed two synthetic staff"
    a, b = staff
    try:
        known = models.Client(name="Synthetic legacy: known owner", created_by_user_id=a.user_id)
        sole = models.Client(name="Synthetic legacy: single interviewer")
        mixed = models.Client(name="Synthetic legacy: conflicting interviewers")
        unknown = models.Client(name="Synthetic legacy: audit only")
        db.add_all((known, sole, mixed, unknown))
        db.flush()
        db.add_all([
            models.IntakeRecord(client_id=sole.client_id, interviewer_id=a.user_id, form_date=main.datetime.now()),
            models.IntakeRecord(client_id=mixed.client_id, interviewer_id=a.user_id, form_date=main.datetime.now()),
            models.IntakeRecord(client_id=mixed.client_id, interviewer_id=b.user_id, form_date=main.datetime.now()),
            models.AuditLog(user_id=b.user_id, action="Create Client", target_entity="client", entity_id=str(unknown.client_id)),
        ])
        db.flush()
        # Run the actual idempotent migration on the same isolated transaction
        # after legacy-like rows exist; rollback removes the fixture afterwards.
        @contextmanager
        def migration_connection():
            yield db.connection()

        with patch.object(main.engine, "begin", migration_connection):
            main.ensure_schema_compatibility()
        db.expire_all()
        assert known.created_by_user_id == a.user_id
        assert all(c.created_by_user_id is None for c in (sole, mixed, unknown))
        assert known.client_id in main.staff_client_ids(db, a)
        assert sole.client_id in main.staff_client_ids(db, a)
        assert sole.client_id not in main.staff_client_ids(db, b)
        assert mixed.client_id in main.staff_client_ids(db, a) and mixed.client_id in main.staff_client_ids(db, b)
        assert unknown.client_id not in main.staff_client_ids(db, a) | main.staff_client_ids(db, b)
        unresolved = main.list_unresolved_client_owners(Response(), admin, db)
        for client in (sole, mixed, unknown):
            assert client.client_id in {item["client_id"] for item in unresolved}
        assert known.client_id not in {item["client_id"] for item in unresolved}
        print("PASS: idempotent migration, explicit owner, interviewer access, and unresolved/forged audit records")
    finally:
        db.rollback()
