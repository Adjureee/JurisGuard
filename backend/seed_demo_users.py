"""Seed fresh test accounts in a separate local JurisGuard database.

This script never writes to the DATABASE_URL database. It targets only a new
allowlisted database on the same loopback PostgreSQL server.
"""

import argparse
import hashlib
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import Session


DEMO_DB_NAME = "jurisguard_demo"
FRESH_DB_NAME = "jurisguard_fresh"
DEMO_ACCOUNTS = (
    ("demo.admin@example.com", "Synthetic Demo Administrator", "admin"),
    ("demo.staff01@example.com", "Synthetic Demo Staff One", "staff"),
    ("demo.staff02@example.com", "Synthetic Demo Staff Two", "staff"),
)
FRESH_ACCOUNTS = (
    ("admin@local.test", "Fresh Local Administrator", "admin"),
    ("staff@local.test", "Fresh Local Staff", "staff"),
)
ALLOWED_TARGETS = {DEMO_DB_NAME, FRESH_DB_NAME}


def marker_for(database_name: str) -> str:
    if database_name == DEMO_DB_NAME:
        return "JurisGuard synthetic demo users v1"
    return f"JurisGuard isolated seed v1: {database_name}"


def target_url(source: str, database_name: str = DEMO_DB_NAME) -> URL:
    if database_name not in ALLOWED_TARGETS:
        raise ValueError("Target database is not an allowed JurisGuard test database")
    url = make_url(source)
    if not url.drivername.startswith("postgresql"):
        raise ValueError("Demo seeding requires local PostgreSQL")
    if url.host not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("Demo seeding is restricted to a loopback PostgreSQL server")
    if url.database in ALLOWED_TARGETS:
        raise ValueError("DATABASE_URL must name the existing source database, not a seeded test database")
    return url.set(database=database_name)


def hash_password(password: str) -> str:
    """Match the application's PBKDF2-SHA256 storage format."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def seed_accounts(engine, accounts=DEMO_ACCOUNTS, *, rotate_passwords: bool = False) -> list[tuple[str, str]]:
    # Import models only after the demo target is selected. Use the explicit
    # demo engine below, never the application's configured default engine.
    import models

    models.Base.metadata.create_all(bind=engine)
    created_credentials: list[tuple[str, str]] = []
    with Session(engine) as session:
        role_ids: dict[str, int] = {}
        for name, permissions in (("admin", "all"), ("staff", "clients,cases,documents")):
            role = session.query(models.Role).filter(models.Role.role_name == name).first()
            if role is None:
                role = models.Role(role_name=name, permissions=permissions)
                session.add(role)
                session.flush()
            role_ids[name] = role.role_id

        for email, full_name, role_name in accounts:
            user = session.query(models.User).filter(models.User.email == email).first()
            if user is not None and not rotate_passwords:
                continue
            password = secrets.token_urlsafe(24)
            if user is None:
                local_part = email.split("@", 1)[0]
                suffix = hashlib.sha1(email.encode("utf-8")).hexdigest()[:6]
                user = models.User(
                    username=f"{local_part[:23]}-{suffix}"[:30],
                    email=email,
                    full_name=full_name,
                    role_id=role_ids[role_name],
                    is_active=True,
                    approval_status="approved",
                    profile_completed=True,
                    password_hash=hash_password(password),
                )
                session.add(user)
            else:
                user.password_hash = hash_password(password)
            created_credentials.append((email, password))
        session.commit()
    return created_credentials


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create or update the separate test database")
    parser.add_argument("--fresh-local", action="store_true", help="Use a blank jurisguard_fresh database with admin@local.test and staff@local.test")
    parser.add_argument("--reuse-demo", "--reuse-existing", dest="reuse_existing", action="store_true", help="Allow an existing marked test database")
    parser.add_argument("--rotate-passwords", action="store_true", help="Generate new passwords for existing demo accounts")
    args = parser.parse_args()
    if args.rotate_passwords and not args.reuse_existing:
        parser.error("--rotate-passwords requires --reuse-existing")

    project_root = Path(__file__).resolve().parent.parent
    load_dotenv(project_root / ".env")
    source = os.getenv("DATABASE_URL", "").strip()
    if not source:
        parser.error("Set DATABASE_URL to an existing local PostgreSQL database")
    database_name = FRESH_DB_NAME if args.fresh_local else DEMO_DB_NAME
    accounts = FRESH_ACCOUNTS if args.fresh_local else DEMO_ACCOUNTS
    target = target_url(source, database_name)
    print(f"Test target: {target.host}/{target.database}")
    print("Accounts: " + ", ".join(email for email, _, _ in accounts))
    if not args.apply:
        print("Dry run only. Add --apply to create the separate test database and accounts.")
        return 0

    # PostgreSQL CREATE DATABASE requires autocommit. The source connection is
    # used only to check/create the distinct test database.
    source_engine = create_engine(source, isolation_level="AUTOCOMMIT", connect_args={"connect_timeout": 5})
    with source_engine.connect() as connection:
        exists = bool(connection.execute(text("SELECT 1 FROM pg_database WHERE datname=:name"), {"name": database_name}).scalar())
        if exists and not args.reuse_existing:
            raise RuntimeError("Test database already exists; inspect it before passing --reuse-existing")
        if not exists:
            connection.exec_driver_sql(f'CREATE DATABASE "{database_name}"')

    demo_engine = create_engine(target, connect_args={"connect_timeout": 5})
    if exists:
        with demo_engine.connect() as connection:
            marker_table = connection.execute(text("SELECT to_regclass('public.demo_seed_metadata')")).scalar()
            marker = (connection.execute(text("SELECT value FROM demo_seed_metadata WHERE key='marker'")).scalar()
                      if marker_table else None)
            if marker != marker_for(database_name):
                raise RuntimeError("Existing test database has no matching seed marker; no accounts changed")
    credentials = seed_accounts(demo_engine, accounts, rotate_passwords=args.rotate_passwords)
    with demo_engine.begin() as connection:
        connection.execute(text("CREATE TABLE IF NOT EXISTS demo_seed_metadata (key text PRIMARY KEY, value text NOT NULL)"))
        connection.execute(text("INSERT INTO demo_seed_metadata (key, value) VALUES ('marker', :value) ON CONFLICT (key) DO NOTHING"), {"value": marker_for(database_name)})
    print(f"Created or rotated {len(credentials)} account password(s). Existing accounts were otherwise left unchanged.")
    if credentials:
        print("Copy these one-time demo credentials now; they are not saved to a file:")
        for email, password in credentials:
            print(f"  {email}: {password}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
