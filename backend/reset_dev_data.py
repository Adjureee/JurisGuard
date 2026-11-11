"""Preview or reset JurisGuard development data while retaining admin access.

Default invocation is read-only. Applying requires a fresh matching preview,
an explicit database confirmation, an explicit development-target confirmation,
and a verified PostgreSQL custom-format backup.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Any

import argon2
from sqlalchemy import MetaData, Table, func, inspect, or_, select, text
from sqlalchemy.engine import URL

from database import engine


DELETE_ORDER = (
    "extracted_metadata",
    "case_transfer_item",
    "case_transfer_administrative_entry",
    "case_submission_item",
    "submission_feedback",
    "document",
    "case_history",
    "case_client",
    "case_transfer_report",
    "case_submission",
    "case",
    "representative",
    "adverse_party",
    "intake_record",
    "client_classification",
    "client_details",
    "client",
)
PRESERVED_TABLES = {
    "audit_log",
    "role",
    "case_nature",
    "court_branch",
    "alembic_version",
    "spatial_ref_sys",
    "geometry_columns",
    "geography_columns",
}
ADMIN_ROLE_NAMES = {"admin", "administrator", "system admin", "system administrator"}
ADMIN_PERMISSIONS = {"all", "all_access", "*", "admin"}
LOCAL_HOSTS = {None, "", "localhost", "127.0.0.1", "::1"}
BROWSER_ONLY_STORAGE_KEYS = (
    "jurisguard_notifications",
    "jurisguard_audit_logs",
    "jurisguard_dashboard_reminders",
)


def is_admin(role_name: str | None, permissions: str | None) -> bool:
    return (role_name or "").strip().lower() in ADMIN_ROLE_NAMES or (
        (permissions or "").strip().lower() in ADMIN_PERMISSIONS
    )


def safe_target(url: URL) -> str:
    return f"{url.get_backend_name()}://{url.host or 'local-socket'}:{url.port or 'default'}/{url.database or 'unknown'}"


def count_rows(connection: Any, table: Table) -> int:
    return int(connection.execute(select(func.count()).select_from(table)).scalar_one())


def uploads_root() -> Path:
    configured = os.getenv("UPLOAD_DIR")
    path = Path(configured).expanduser() if configured else Path(__file__).resolve().parent / "uploads"
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def referenced_upload_path(value: Any, root: Path) -> Path | None:
    if not isinstance(value, str) or not value.strip() or value.startswith("data:"):
        return None
    if value.startswith("/uploads/profiles/"):
        candidate = root / "profiles" / Path(value).name
    else:
        candidate = Path(value).expanduser()
        if not candidate.is_absolute():
            candidate = Path.cwd() / candidate
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        return None
    return resolved if resolved.is_file() else None


def backup_uploads(files: list[Path], root: Path, destination: Path) -> Path | None:
    if not files:
        return None
    archive_path = destination.expanduser().resolve().with_suffix(destination.suffix + ".uploads.zip")
    if archive_path.exists():
        raise RuntimeError(f"Upload backup destination already exists: {archive_path}")
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file_path in files:
                archive.write(file_path, file_path.relative_to(root).as_posix())
        with zipfile.ZipFile(archive_path) as archive:
            if archive.testzip() is not None:
                raise RuntimeError("Upload backup archive failed its CRC check.")
    except Exception:
        archive_path.unlink(missing_ok=True)
        raise
    print(f"Verified upload backup: {archive_path}")
    return archive_path


def backup_database(url: URL, destination: Path) -> None:
    pg_dump = shutil.which("pg_dump")
    pg_restore = shutil.which("pg_restore")
    if not pg_dump or not pg_restore:
        raise RuntimeError("pg_dump and pg_restore must be installed before applying a reset.")
    destination = destination.expanduser().resolve()
    if destination.exists():
        raise RuntimeError(f"Backup destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)

    command = [pg_dump, "--format=custom", "--no-owner", "--no-acl", "--file", str(destination)]
    if url.host:
        command.extend(["--host", url.host])
    if url.port:
        command.extend(["--port", str(url.port)])
    if url.username:
        command.extend(["--username", url.username])
    if url.database:
        command.extend(["--dbname", url.database])
    child_env = os.environ.copy()
    if url.password:
        child_env["PGPASSWORD"] = url.password
    sslmode = url.query.get("sslmode")
    if sslmode:
        child_env["PGSSLMODE"] = str(sslmode)

    try:
        subprocess.run(command, check=True, env=child_env, capture_output=True, text=True)
        listing = subprocess.run(
            [pg_restore, "--list", str(destination)],
            check=True,
            capture_output=True,
            text=True,
        )
        if not listing.stdout.strip():
            raise RuntimeError("pg_restore returned an empty archive listing.")
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    print(f"Verified backup: {destination}")


def read_plan() -> dict[str, Any]:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    metadata = MetaData()
    metadata.reflect(bind=engine, only=sorted(table_names))
    tables = metadata.tables
    target_names = [name for name in DELETE_ORDER if name in tables]
    if "user" not in tables or "role" not in tables:
        raise RuntimeError("Required user/role tables are missing; refusing to prepare a reset.")

    with engine.connect() as connection:
        counts = {name: count_rows(connection, tables[name]) for name in sorted(table_names)}
        user_table = tables["user"]
        role_table = tables["role"]
        role_id_col = role_table.c.role_id
        user_columns = [
            user_table.c.user_id,
            user_table.c.username,
            user_table.c.role_id,
            *[user_table.c[name] for name in ("profile_image_path", "profile_picture_path") if name in user_table.c],
        ]
        rows = connection.execute(
            select(
                *user_columns,
                role_table.c.role_name,
                role_table.c.permissions,
            ).select_from(user_table.outerjoin(role_table, user_table.c.role_id == role_id_col))
        ).mappings().all()
        admins = [row for row in rows if is_admin(row["role_name"], row["permissions"])]
        non_admins = [row for row in rows if not is_admin(row["role_name"], row["permissions"])]
        admin_ids = {int(row["user_id"]) for row in admins}
        non_admin_ids = {int(row["user_id"]) for row in non_admins}

        user_ids = {int(row["user_id"]) for row in non_admins}
        audit_user_ids: set[int] = set()
        if "audit_log" in tables and "user_id" in tables["audit_log"].c:
            audit_user_ids = {
                int(user_id)
                for user_id in connection.execute(
                    select(tables["audit_log"].c.user_id)
                    .where(tables["audit_log"].c.user_id.is_not(None))
                    .distinct()
                ).scalars()
            }
        tombstone_user_ids = sorted(user_ids & audit_user_ids)
        delete_user_ids = sorted(user_ids - audit_user_ids)
        revoked_token_count = 0
        if "revoked_access_token" in tables and user_ids and "user_id" in tables["revoked_access_token"].c:
            revoked_token_count = int(
                connection.execute(
                    select(func.count()).select_from(tables["revoked_access_token"]).where(
                        tables["revoked_access_token"].c.user_id.in_(user_ids)
                    )
                ).scalar_one()
            )
        case_breakdown = {"criminal": 0, "civil": 0, "terminated": 0}
        if "case" in tables:
            case_table = tables["case"]
            if "case_type" in case_table.c:
                case_breakdown["civil"] = int(
                    connection.execute(
                        select(func.count()).select_from(case_table).where(func.lower(case_table.c.case_type) == "civil")
                    ).scalar_one()
                )
                case_breakdown["criminal"] = counts.get("case", 0) - case_breakdown["civil"]
            if "is_terminated" in case_table.c and "status_of_case" in case_table.c:
                case_breakdown["terminated"] = int(
                    connection.execute(
                        select(func.count()).select_from(case_table).where(
                            or_(case_table.c.is_terminated.is_(True), func.lower(case_table.c.status_of_case) == "terminated")
                        )
                    ).scalar_one()
                )

        root = uploads_root()
        admin_profile_paths: set[Path] = set()
        non_admin_profile_paths: set[Path] = set()
        if "profile_image_path" in user_table.c:
            for row in rows:
                path = referenced_upload_path(row.get("profile_image_path"), root)
                if path and path.parent == root / "profiles" and path.name.startswith(f"profile-{row['user_id']}-"):
                    (admin_profile_paths if int(row["user_id"]) in admin_ids else non_admin_profile_paths).add(path)
        if "profile_picture_path" in user_table.c:
            for row in rows:
                path = referenced_upload_path(row.get("profile_picture_path"), root)
                if path and path.parent == root / "profiles" and path.name.startswith(f"profile-{row['user_id']}-"):
                    (admin_profile_paths if int(row["user_id"]) in admin_ids else non_admin_profile_paths).add(path)
        document_paths: set[Path] = set()
        if "document" in tables and "encrypted_file_path" in tables["document"].c:
            for value in connection.execute(select(tables["document"].c.encrypted_file_path)).scalars():
                path = referenced_upload_path(value, root)
                if path:
                    document_paths.add(path)
        if "case" in tables and "supporting_document_path" in tables["case"].c:
            for value in connection.execute(select(tables["case"].c.supporting_document_path)).scalars():
                path = referenced_upload_path(value, root)
                if path:
                    document_paths.add(path)
        upload_files = sorted((non_admin_profile_paths | document_paths) - admin_profile_paths)
        upload_file_stats = {
            str(path.relative_to(root)): (path.stat().st_size, path.stat().st_mtime_ns)
            for path in upload_files
        }

    known_tables = set(DELETE_ORDER) | PRESERVED_TABLES | {"user", "revoked_access_token"}
    unknown_counts = {name: count for name, count in counts.items() if name not in known_tables and count > 0}
    inbound_fks: list[dict[str, str]] = []
    for table_name in sorted(table_names):
        for foreign_key in inspector.get_foreign_keys(table_name):
            referred = foreign_key.get("referred_table")
            if referred in {"user", "client", "case", "intake_record", "document", "case_submission", "case_transfer_report"}:
                inbound_fks.append(
                    {
                        "table": table_name,
                        "columns": ",".join(foreign_key.get("constrained_columns") or []),
                        "references": referred,
                        "ondelete": str((foreign_key.get("options") or {}).get("ondelete") or "RESTRICT/default"),
                    }
                )

    plan_material = {
        "target": safe_target(engine.url),
        "counts": counts,
        "admins": sorted(int(row["user_id"]) for row in admins),
        "delete_users": delete_user_ids,
        "tombstone_users": tombstone_user_ids,
        "revoked_token_count": revoked_token_count,
        "case_breakdown": case_breakdown,
        "upload_files": sorted(upload_file_stats),
        "upload_file_stats": upload_file_stats,
    }
    fingerprint = hashlib.sha256(json.dumps(plan_material, sort_keys=True).encode()).hexdigest()[:16]
    return {
        "target": safe_target(engine.url),
        "environment": os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or os.getenv("JURISGUARD_ENV") or "unspecified",
        "counts": counts,
        "admins": admins,
        "non_admins": non_admins,
        "delete_user_ids": delete_user_ids,
        "tombstone_user_ids": tombstone_user_ids,
        "revoked_token_count": revoked_token_count,
        "case_breakdown": case_breakdown,
        "upload_files": upload_files,
        "upload_file_stats": upload_file_stats,
        "uploads_root": root,
        "protected_admin_profile_files": len(admin_profile_paths),
        "non_admin_profile_files": len(non_admin_profile_paths),
        "target_tables": target_names,
        "unknown_counts": unknown_counts,
        "inbound_fks": inbound_fks,
        "fingerprint": fingerprint,
        "tables": tables,
    }


def print_plan(plan: dict[str, Any]) -> None:
    print("JurisGuard data reset preview (read-only)")
    print(f"Target: {plan['target']}")
    print(f"Environment label: {plan['environment']}")
    print(f"Preview fingerprint: {plan['fingerprint']}")
    print("Administrator accounts preserved (ID and username only):")
    for row in plan["admins"]:
        print(f"  user_id={row['user_id']} username={row['username']}")
    if not plan["admins"]:
        print("  NONE; apply will be refused")
    print("Operational tables scheduled for deletion:")
    for name in plan["target_tables"]:
        print(f"  {name}: {plan['counts'].get(name, 0)}")
    if "revoked_access_token" in plan["counts"]:
        print(f"  revoked_access_token (non-admin owners): {plan['revoked_token_count']}")
    print(f"  non-admin user accounts removed: {len(plan['delete_user_ids'])}")
    print(f"  audit-linked non-admin accounts retained as disabled, PII-scrubbed tombstones: {len(plan['tombstone_user_ids'])}")
    if "audit_log" in plan["counts"]:
        print(f"  audit_log retained for security/accountability: {plan['counts']['audit_log']}")
    if "case" in plan["counts"]:
        breakdown = plan["case_breakdown"]
        print(f"  case breakdown (overlapping terminated subset): Criminal={breakdown['criminal']}, Civil={breakdown['civil']}, Terminated={breakdown['terminated']}")
    print("Preserved tables:")
    for name in sorted(PRESERVED_TABLES | {"role", "user"}):
        if name in plan["counts"]:
            print(f"  {name}: {plan['counts'][name]}")
    print(f"  upload files associated with deleted records/accounts: {len(plan['upload_files'])}")
    print(f"  protected admin profile files: {plan['protected_admin_profile_files']}")
    print(f"Upload root: {plan['uploads_root']}")
    print("Audit logs are preserved. Their foreign keys require disabled, PII-scrubbed user tombstones; original audit rows and hashes remain unchanged.")
    print("Roles, reference data, migrations, admin profile files, and admin authentication settings will be preserved.")
    print("Browser-local operational caches are outside this database reset and must be cleared per browser profile:")
    for key in BROWSER_ONLY_STORAGE_KEYS:
        print(f"  localStorage[{key!r}]")
    print("Unclassified non-empty tables (preserved; block apply until reviewed):")
    if plan["unknown_counts"]:
        for name, count in sorted(plan["unknown_counts"].items()):
            print(f"  {name}: {count}")
    else:
        print("  none")
    print("Foreign-key edges touching affected entities:")
    for edge in plan["inbound_fks"]:
        print(f"  {edge['table']}.{edge['columns']} -> {edge['references']} ({edge['ondelete']})")


def apply_plan(plan: dict[str, Any], args: argparse.Namespace) -> None:
    url = engine.url
    db_name = url.database or ""
    host = url.host
    if url.get_backend_name() != "postgresql":
        raise RuntimeError("Only PostgreSQL is supported by this reset utility.")
    if host not in LOCAL_HOSTS:
        raise RuntimeError("Remote database targets are not allowed by this utility.")
    if any(part in db_name.lower() for part in ("prod", "production", "live")):
        raise RuntimeError("Production-like database name detected; refusing reset.")
    if not plan["admins"]:
        raise RuntimeError("No administrator accounts were identified; refusing reset.")
    if plan["unknown_counts"]:
        raise RuntimeError("Unclassified non-empty tables must be reviewed before apply.")
    if args.confirm_database != db_name:
        raise RuntimeError("--confirm-database must exactly match the active database name.")
    if args.confirm_plan != plan["fingerprint"]:
        raise RuntimeError("Preview fingerprint changed or confirmation does not match. Re-preview first.")
    if not args.confirm_development_target:
        raise RuntimeError("Pass --confirm-development-target only after confirming this is disposable development/test data.")
    if not args.backup_file:
        raise RuntimeError("--backup-file is required; a verified backup must precede deletion.")

    backup_database(url, Path(args.backup_file))
    backup_uploads(plan["upload_files"], plan["uploads_root"], Path(args.backup_file))
    current_plan = read_plan()
    if current_plan["fingerprint"] != plan["fingerprint"]:
        raise RuntimeError("Database contents changed since the preview/backup. Review a new preview before applying.")
    plan = current_plan
    tables: dict[str, Table] = plan["tables"]
    admin_ids = {int(row["user_id"]) for row in plan["admins"]}
    tombstone_ids = set(plan["tombstone_user_ids"])
    user_table = tables["user"]
    role_table = tables["role"]
    with engine.connect() as connection:
        preserved_admin_auth = {
            int(row["user_id"]): (row["role_id"], row["password_hash"], row["mfa_enabled"], row["mfa_secret"], row["is_active"], row["approval_status"])
            for row in connection.execute(
                select(
                    user_table.c.user_id,
                    user_table.c.role_id,
                    user_table.c.password_hash,
                    user_table.c.mfa_enabled,
                    user_table.c.mfa_secret,
                    user_table.c.is_active,
                    user_table.c.approval_status,
                ).where(user_table.c.user_id.in_(admin_ids))
            ).mappings()
        }

    with engine.begin() as connection:
        locked_names = set(plan["counts"])
        for table_name in sorted(name for name in locked_names if name in tables):
            table = tables[table_name]
            preparer = engine.dialect.identifier_preparer
            qualified_name = preparer.quote(table.name)
            if table.schema:
                qualified_name = f"{preparer.quote_schema(table.schema)}.{qualified_name}"
            connection.execute(text(f"LOCK TABLE {qualified_name} IN SHARE ROW EXCLUSIVE MODE"))

        for table_name in locked_names:
            if table_name in tables and table_name in plan["counts"]:
                actual_count = count_rows(connection, tables[table_name])
                if actual_count != plan["counts"][table_name]:
                    raise RuntimeError(f"{table_name} changed since preview/backup; transaction rolled back.")

        current_users = connection.execute(
            select(
                user_table.c.user_id,
                role_table.c.role_name,
                role_table.c.permissions,
            ).select_from(user_table.outerjoin(role_table, user_table.c.role_id == role_table.c.role_id))
        ).mappings()
        current_admin_ids = {
            int(row["user_id"])
            for row in current_users
            if is_admin(row["role_name"], row["permissions"])
        }
        if current_admin_ids != admin_ids:
            raise RuntimeError("Administrator roles changed since preview; transaction rolled back.")

        for table_name in plan["target_tables"]:
            deleted = connection.execute(tables[table_name].delete()).rowcount
            print(f"Deleted {deleted or 0} rows from {table_name}")

        non_admin_ids = set(plan["delete_user_ids"])
        non_admin_ids.update(tombstone_ids)
        if "revoked_access_token" in tables and non_admin_ids:
            token_table = tables["revoked_access_token"]
            if "user_id" in token_table.c:
                connection.execute(token_table.delete().where(token_table.c.user_id.in_(non_admin_ids)))

        if tombstone_ids:
            tombstone_values: dict[str, Any] = {}
            if "password_hash" in user_table.c:
                # Argon2id hash of a random secret nobody knows, so archived accounts can never sign in.
                tombstone_values["password_hash"] = argon2.PasswordHasher(
                    time_cost=3, memory_cost=65536, parallelism=4, type=argon2.Type.ID
                ).hash(secrets.token_urlsafe(32))
            for column, value in {
                "email": None,
                "full_name": "Archived account",
                "approval_status": "suspended",
                "is_active": False,
                "mfa_enabled": False,
                "mfa_secret": None,
                "last_login_at": None,
                "profile_image_path": None,
                "profile_picture_path": None,
                "profile_completed": False,
                "first_name": None,
                "middle_name": None,
                "last_name": None,
                "suffix": None,
                "mobile_number": None,
                "address": None,
                "sex": None,
                "birth_date": None,
            }.items():
                if column in user_table.c:
                    tombstone_values[column] = value
            for user_id in tombstone_ids:
                values = dict(tombstone_values)
                if "username" in user_table.c:
                    values["username"] = f"archived-{user_id}"[: user_table.c.username.type.length or 30]
                connection.execute(user_table.update().where(user_table.c.user_id == user_id).values(**values))

        if plan["delete_user_ids"]:
            connection.execute(user_table.delete().where(user_table.c.user_id.in_(plan["delete_user_ids"])))

        after_admins = {
            int(row["user_id"]): (row["role_id"], row["password_hash"], row["mfa_enabled"], row["mfa_secret"], row["is_active"], row["approval_status"])
            for row in connection.execute(
                select(
                    user_table.c.user_id,
                    user_table.c.role_id,
                    user_table.c.password_hash,
                    user_table.c.mfa_enabled,
                    user_table.c.mfa_secret,
                    user_table.c.is_active,
                    user_table.c.approval_status,
                ).where(user_table.c.user_id.in_(admin_ids))
            ).mappings()
        }
        if after_admins != preserved_admin_auth:
            raise RuntimeError("Administrator authentication state changed; transaction rolled back.")
        remaining_user_ids = {
            int(user_id) for user_id in connection.execute(select(user_table.c.user_id)).scalars()
        }
        if remaining_user_ids != admin_ids | tombstone_ids:
            raise RuntimeError("Unexpected user rows remain; transaction rolled back.")
        if tombstone_ids:
            tombstones = connection.execute(
                select(user_table.c.user_id, user_table.c.is_active, user_table.c.email)
                .where(user_table.c.user_id.in_(tombstone_ids))
            ).mappings()
            if any(row["is_active"] or row["email"] is not None for row in tombstones):
                raise RuntimeError("Audit-linked tombstones were not safely disabled/scrubbed; transaction rolled back.")
        for table_name in plan["target_tables"]:
            if connection.execute(select(func.count()).select_from(tables[table_name])).scalar_one():
                raise RuntimeError(f"Rows remain in {table_name}; transaction rolled back.")
        connection.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))

    print("Reset committed. Administrator password hashes, MFA settings, roles, and account IDs were preserved.")
    print("Operational data was deleted. Audit history was retained; linked non-admin identities were disabled and scrubbed.")
    removed_files = 0
    retained_files = 0
    for relative_path, expected_stat in plan["upload_file_stats"].items():
        file_path = (plan["uploads_root"] / relative_path).resolve()
        try:
            file_path.relative_to(plan["uploads_root"])
            file_stat = file_path.stat()
            if (file_stat.st_size, file_stat.st_mtime_ns) != tuple(expected_stat):
                retained_files += 1
                continue
            file_path.unlink()
            removed_files += 1
        except (OSError, ValueError):
            retained_files += 1
    print(f"Removed {removed_files} referenced upload/profile files; retained {retained_files} changed or inaccessible files.")
    if plan["upload_files"]:
        print("Referenced uploads are backed up in the companion .uploads.zip archive.")
    print("Administrator sign-in must still be tested through the application; this utility does not change auth code.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="apply the reset after all explicit safeguards pass")
    parser.add_argument("--confirm-database", help="exact database name shown in the preview")
    parser.add_argument("--confirm-plan", help="exact preview fingerprint shown in the preview")
    parser.add_argument("--confirm-development-target", action="store_true", help="confirm this is disposable local development/test data")
    parser.add_argument("--backup-file", help="new path for a custom-format pg_dump backup")
    args = parser.parse_args()

    try:
        plan = read_plan()
        print_plan(plan)
        if not args.apply:
            print("No data was changed. Review this plan before using --apply.")
            return 0
        apply_plan(plan, args)
        return 0
    except Exception as error:
        print(f"RESET NOT APPLIED: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
