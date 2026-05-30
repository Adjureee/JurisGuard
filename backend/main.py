import base64
import hashlib
import hmac
import json
import os
import secrets
import shutil
import struct
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

import models
from ai_service import process_document
from database import engine, get_db


models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="JurisGuard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(
        {
            os.getenv("FRONTEND_ORIGIN", "http://localhost:5173"),
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        }
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = os.getenv("SECRET_KEY", "jurisguard-dev-secret-change-me")
TOKEN_TTL_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "720"))
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))
PROFILE_UPLOAD_DIR = UPLOAD_DIR / "profiles"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PROFILE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".jfif", ".webp"}
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
DEFAULT_INCIDENT_CITY = "Panabo City"
PANABO_CENTER = {"lat": 7.3081, "lng": 125.6841}
BARANGAY_CENTROIDS: dict[str, tuple[float, float]] = {
    "A. O. Floirendo": (7.3977, 125.5802),
    "Buenavista": (7.2756, 125.5907),
    "Cacao": (7.3083, 125.6077),
    "Cagangohan": (7.2815, 125.6829),
    "Consolacion": (7.3169, 125.5538),
    "Dapco": (7.3921, 125.5983),
    "Datu Abdul Dadia": (7.3153, 125.6548),
    "Gredu": (7.2957, 125.6776),
    "J. P. Laurel": (7.2759, 125.6700),
    "Kasilak": (7.3268, 125.5951),
    "Katipunan": (7.3007, 125.6306),
    "Katualan": (7.2301, 125.5543),
    "Kauswagan": (7.3102, 125.5831),
    "Kiotoy": (7.2443, 125.6077),
    "Little Panay": (7.2979, 125.6482),
    "Lower Panaga": (7.4320, 125.5640),
    "Mabunao": (7.2543, 125.5745),
    "Maduao": (7.2796, 125.6433),
    "Malativas": (7.2936, 125.5648),
    "Manay": (7.3456, 125.6022),
    "Nanyo": (7.3329, 125.6361),
    "New Malaga": (7.3442, 125.5725),
    "New Malitbog": (7.3339, 125.6209),
    "New Pandan": (7.2973, 125.6801),
    "New Visayas": (7.3081, 125.6682),
    "Quezon": (7.3327, 125.6795),
    "Salvacion": (7.3182, 125.6882),
    "San Francisco": (7.3068, 125.6803),
    "San Nicolas": (7.2626, 125.6181),
    "San Pedro": (7.2973, 125.7106),
    "San Roque": (7.2552, 125.5533),
    "San Vicente": (7.3088, 125.7003),
    "Santa Cruz": (7.2365, 125.5896),
    "Santo Nino": (7.3082, 125.6867),
    "Santo Niño": (7.3082, 125.6867),
    "Sindaton": (7.4396, 125.5842),
    "Southern Davao": (7.3323, 125.6577),
    "Tagpore": (7.2743, 125.6250),
    "Tibungol": (7.3947, 125.5555),
    "Upper Licanan": (7.2856, 125.6325),
    "Waterfall": (7.2886, 125.5834),
}


class RegisterPayload(BaseModel):
    full_name: str
    email: str
    password: str
    employee_id_path: str


class RegisterResponse(BaseModel):
    message: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"


class MfaSetupResponse(BaseModel):
    secret: str
    otpauth_uri: str


class MfaVerifyPayload(BaseModel):
    code: str


class ApprovalUpdatePayload(BaseModel):
    approval_status: Literal["pending", "under_review", "approved", "rejected", "suspended"]


class ClientPayload(BaseModel):
    client: dict[str, Any]
    client_details: dict[str, Any]
    client_classification: dict[str, Any]


class CasePayload(BaseModel):
    client_id: int | str
    intake_record: dict[str, Any]
    representative: dict[str, Any]
    adverse_party: dict[str, Any]
    cases: dict[str, Any]


class TerminationPayload(BaseModel):
    termination_reason: str
    resolution_type: str | None = None
    date_terminated: str | None = None
    final_remarks: str | None = None
    handled_by: str | None = None
    supporting_document_path: str | None = None


class AuditLogPayload(BaseModel):
    action: str
    module: str | None = None
    description: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    extraction_mode: str | None = None
    fallback_reason: str | None = None


class SubmissionPreviewPayload(BaseModel):
    date_from: str
    date_to: str


class CaseSubmissionPayload(BaseModel):
    title: str
    date_from: str
    date_to: str
    notes: str | None = None


class SubmissionFeedbackPayload(BaseModel):
    comments: str


def template_path(language: str) -> Path:
    if language == "filipino":
        candidate = Path(__file__).resolve().parent.parent / "formx.html"
        return candidate if candidate.exists() else Path(__file__).resolve().parent.parent / "formex.html"
    return Path(__file__).resolve().parent.parent / "form.html"


def read_form_template(language: str) -> str:
    path = template_path(language)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Printable form template not found: {path.name}")
    return path.read_text(encoding="utf-8")


def ensure_schema_compatibility() -> None:
    statements = [
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS email VARCHAR(255)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS full_name VARCHAR(255) DEFAULT \'\'',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) NOT NULL DEFAULT \'pending\'',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS profile_image_path TEXT',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS profile_picture_path TEXT',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT false',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS first_name VARCHAR(100)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS middle_name VARCHAR(100)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_name VARCHAR(100)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS suffix VARCHAR(30)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(30)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS address TEXT',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS sex VARCHAR(20)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS birth_date VARCHAR(30)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(64)',
        'UPDATE "user" SET email = username WHERE email IS NULL',
        "ALTER TABLE document ADD COLUMN IF NOT EXISTS intake_id INTEGER",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_name TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_age INTEGER",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_sex VARCHAR(20)",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_civil_status VARCHAR(50)",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_address TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_contact_no TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_relationship VARCHAR(100)",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_email TEXT",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS classification_notes TEXT",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS district_office VARCHAR(255)",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS applicant_role VARCHAR(100)",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS applicant_role_other VARCHAR(255)",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS nature_of_request TEXT",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS coi_agree_different_office BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS coi_agree_same_dept_appeal BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS coi_waive_right_to_complain BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS coi_trust_assigned_counsel BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_submission_deadline TIMESTAMP",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_itr_date TIMESTAMP",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_brgy_date TIMESTAMP",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_dswd_date TIMESTAMP",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_others_details TEXT",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_others_date TIMESTAMP",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS inv_plaintiff BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS inv_defendant BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS inv_oppositor BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS inv_petitioner BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS inv_respondent BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS inv_complainant BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS inv_accused BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS inv_others TEXT",
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS court_body VARCHAR(255)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS case_status VARCHAR(30)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS incident_barangay VARCHAR(120)',
        f'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS incident_city VARCHAR(120) DEFAULT \'{DEFAULT_INCIDENT_CITY}\'',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS incident_address TEXT',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS latitude VARCHAR(50)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS longitude VARCHAR(50)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS date_of_confinement TIMESTAMP',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS place_of_detention VARCHAR(255)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS location_type VARCHAR(20)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS cause_of_action TEXT',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS facts_of_case TEXT',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS pending_in_court BOOLEAN DEFAULT false',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS assigned_pao VARCHAR(255)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS hearing_schedule VARCHAR(255)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS remarks TEXT',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS terminated_at TIMESTAMP',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS termination_reason TEXT',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS termination_remarks TEXT',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS resolution_type VARCHAR(100)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS terminated_by INTEGER',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS handled_by VARCHAR(255)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS supporting_document_path TEXT',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS is_terminated BOOLEAN DEFAULT false',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
        """
        CREATE TABLE IF NOT EXISTS case_history (
            history_id SERIAL PRIMARY KEY,
            case_id INTEGER NOT NULL REFERENCES "case"(case_id),
            updated_by INTEGER NOT NULL REFERENCES "user"(user_id),
            previous_status VARCHAR(20),
            new_status VARCHAR(20) NOT NULL,
            action_taken TEXT NOT NULL,
            remarks TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_case_history_history_id ON case_history (history_id)",
        "ALTER TABLE case_history ADD COLUMN IF NOT EXISTS case_id INTEGER",
        "ALTER TABLE case_history ADD COLUMN IF NOT EXISTS updated_by INTEGER",
        "ALTER TABLE case_history ADD COLUMN IF NOT EXISTS previous_status VARCHAR(20)",
        "ALTER TABLE case_history ADD COLUMN IF NOT EXISTS new_status VARCHAR(20)",
        "ALTER TABLE case_history ADD COLUMN IF NOT EXISTS action_taken TEXT",
        "ALTER TABLE case_history ADD COLUMN IF NOT EXISTS remarks TEXT",
        "ALTER TABLE case_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS description TEXT",
        "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_id VARCHAR(100)",
    ]
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def seed_roles() -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO role (role_name, permissions)
                SELECT 'admin', 'all'
                WHERE NOT EXISTS (SELECT 1 FROM role WHERE role_name = 'admin')
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO role (role_name, permissions)
                SELECT 'staff', 'clients,cases,documents'
                WHERE NOT EXISTS (SELECT 1 FROM role WHERE role_name = 'staff')
                """
            )
        )


ensure_schema_compatibility()
seed_roles()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    if not stored_hash:
        return False
    if not stored_hash.startswith("pbkdf2_sha256$"):
        return hmac.compare_digest(password, stored_hash)

    _, salt, digest_hex = stored_hash.split("$", 2)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return hmac.compare_digest(digest.hex(), digest_hex)


def generate_mfa_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("utf-8").rstrip("=")


def _mfa_secret_bytes(secret: str) -> bytes:
    padded = secret.strip().replace(" ", "").upper()
    padded += "=" * (-len(padded) % 8)
    return base64.b32decode(padded)


def generate_totp(secret: str, at_time: datetime | None = None, interval: int = 30) -> str:
    current_time = at_time or datetime.now(timezone.utc)
    counter = int(current_time.timestamp()) // interval
    digest = hmac.new(_mfa_secret_bytes(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code_int = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{code_int % 1_000_000:06d}"


def verify_totp(secret: str | None, code: str | None, window: int = 1) -> bool:
    if not secret or not code:
        return False
    normalized = "".join(ch for ch in code if ch.isdigit())
    if len(normalized) != 6:
        return False
    now = datetime.now(timezone.utc)
    return any(
        hmac.compare_digest(generate_totp(secret, now + timedelta(seconds=30 * step)), normalized)
        for step in range(-window, window + 1)
    )


def mfa_otpauth_uri(user: models.User, secret: str) -> str:
    label = f"JurisGuard:{user.email or user.username}"
    return f"otpauth://totp/{quote(label)}?secret={secret}&issuer=JurisGuard&digits=6&period=30"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def create_access_token(user_id: int) -> str:
    payload = {
        "sub": user_id,
        "exp": int((datetime.now(timezone.utc) + timedelta(minutes=TOKEN_TTL_MINUTES)).timestamp()),
    }
    payload_segment = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(SECRET_KEY.encode("utf-8"), payload_segment.encode("utf-8"), hashlib.sha256)
    return f"{payload_segment}.{b64url(signature.digest())}"


def make_username(email: str) -> str:
    local_part = email.split("@", 1)[0].lower()
    suffix = hashlib.sha1(email.encode("utf-8")).hexdigest()[:6]
    return f"{local_part[:23]}-{suffix}"[:30]


def is_admin_role(role: models.Role | None) -> bool:
    if not role:
        return False
    role_name = (role.role_name or "").strip().lower()
    permissions = (role.permissions or "").strip().lower()
    return role_name in {"admin", "system admin"} or permissions == "all_access"


def read_access_token(token: str) -> int:
    try:
        payload_segment, signature_segment = token.split(".", 1)
        expected = hmac.new(
            SECRET_KEY.encode("utf-8"), payload_segment.encode("utf-8"), hashlib.sha256
        )
        if not hmac.compare_digest(b64url(expected.digest()), signature_segment):
            raise ValueError("Invalid token signature")
        payload = json.loads(b64url_decode(payload_segment))
        if int(payload["exp"]) < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("Expired token")
        return int(payload["sub"])
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Could not validate credentials") from exc


def current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    user = db.get(models.User, read_access_token(token))
    if not user or not user.is_active or user.approval_status != "approved":
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    return user


def admin_user(user: models.User = Depends(current_user)) -> models.User:
    if not is_admin_role(user.role):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def is_admin(user: models.User) -> bool:
    return (user.role.role_name if user.role else "").lower() == "admin"


def display_role_name(user: models.User | None) -> str | None:
    if not user or not user.role:
        return None
    role_name = (user.role.role_name or "").lower()
    return "admin" if role_name == "admin" else "staff"


def scoped_case_query(db: Session, user: models.User):
    query = db.query(models.Case).outerjoin(models.IntakeRecord)
    if is_admin(user):
        return query
    return query.filter(models.IntakeRecord.interviewer_id == user.user_id)


def staff_client_ids(db: Session, user: models.User) -> set[int]:
    intake_ids = {
        row[0]
        for row in db.query(models.IntakeRecord.client_id)
        .filter(models.IntakeRecord.interviewer_id == user.user_id)
        .all()
        if row[0] is not None
    }
    audit_ids: set[int] = set()
    for row in (
        db.query(models.AuditLog.entity_id)
        .filter(models.AuditLog.user_id == user.user_id, models.AuditLog.action == "Create Client")
        .all()
    ):
        try:
            if row[0]:
                audit_ids.add(int(row[0]))
        except (TypeError, ValueError):
            continue
    return intake_ids | audit_ids


def scoped_client_query(db: Session, user: models.User):
    query = db.query(models.Client).filter(models.Client.deleted_at.is_(None))
    if is_admin(user):
        return query
    ids = staff_client_ids(db, user)
    if not ids:
        return query.filter(models.Client.client_id == -1)
    return query.filter(models.Client.client_id.in_(ids))


def ensure_case_access(record: models.Case | None, user: models.User) -> models.Case:
    if not record:
        raise HTTPException(status_code=404, detail="Case not found")
    if is_admin(user):
        return record
    if not record.intake or record.intake.interviewer_id != user.user_id:
        raise HTTPException(status_code=403, detail="Record access denied")
    return record


def ensure_client_access(client: models.Client | None, user: models.User, db: Session) -> models.Client:
    if not client or client.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Client not found")
    if is_admin(user) or client.client_id in staff_client_ids(db, user):
        return client
    raise HTTPException(status_code=403, detail="Record access denied")


def role_id(db: Session, name: str) -> int:
    role = db.query(models.Role).filter(models.Role.role_name == name).first()
    if not role and name == "staff":
        role = db.query(models.Role).filter(models.Role.role_name == "user").first()
    if not role:
        raise HTTPException(status_code=500, detail=f"Missing role: {name}")
    return role.role_id


def parse_date(value: Any, fallback: datetime | None = None) -> datetime | None:
    if value in (None, ""):
        return fallback
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        value = value.strip()
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            pass

        for date_format in ("%m/%d/%Y", "%m-%d-%Y", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                return datetime.strptime(value, date_format)
            except ValueError:
                continue

        return fallback
    return fallback


def format_date(value: datetime | None) -> str:
    return value.strftime("%m/%d/%Y") if value else ""


def parse_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def limit_text(value: Any, max_length: int, fallback: str | None = None) -> str | None:
    if value in (None, ""):
        return fallback
    return str(value)[:max_length]


def user_to_auth(user: models.User) -> dict[str, Any]:
    return {
        "user_id": user.user_id,
        "email": user.email or user.username,
        "role": "admin" if role_name == "admin" else "staff",
        "approval_status": user.approval_status,
        "full_name": user.full_name or "",
        "mfa_enabled": bool(user.mfa_enabled),
        "profile_image_path": user.profile_image_path,
        "profile_picture_path": user.profile_picture_path,
        "profile_completed": bool(user.profile_completed),
    }


def user_to_admin(user: models.User) -> dict[str, Any]:
    return {
        **user_to_auth(user),
        "is_active": bool(user.is_active),
        "created_at": user.created_at.isoformat() if user.created_at else "",
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


def user_to_details(user: models.User) -> dict[str, Any]:
    return {
        **user_to_admin(user),
        "profile": {
            "full_name": user.full_name or "",
            "first_name": user.first_name,
            "middle_name": user.middle_name,
            "last_name": user.last_name,
            "suffix": user.suffix,
            "mobile_number": user.mobile_number,
            "address": user.address,
            "sex": user.sex,
            "birth_date": user.birth_date,
            "profile_image_path": user.profile_image_path,
            "profile_picture_path": user.profile_picture_path,
            "profile_completed": bool(user.profile_completed),
        },
    }


def get_client_payload(client: models.Client) -> dict[str, Any]:
    details = client.details or models.ClientDetails(client_id=client.client_id)
    classification = client.classification or models.ClientClassification(client_id=client.client_id)
    return {
        "client_id": str(client.client_id),
        "created_by_user_id": None,
        "client": {
            "client_id": str(client.client_id),
            "name": client.name,
            "age": client.age or 0,
            "sex": client.sex or "",
            "civil_status": client.civil_status or "",
            "religion": client.religion or "",
            "educational_attainment": client.educational_attainment or "",
            "citizenship": client.citizenship or "",
            "language_dialect": client.language_dialect or "",
        },
        "client_details": {
            "address": details.address or "",
            "contact_no": details.contact_no or "",
            "email": details.email or "",
            "individual_monthly_income": details.individual_monthly_income or "",
            "spouse": details.spouse or "",
            "address_of_spouse": details.address_of_spouse or "",
            "contact_no_of_spouse": details.contact_no_of_spouse or "",
            "representative_name": details.representative_name or "",
            "representative_age": details.representative_age or 0,
            "representative_sex": details.representative_sex or "",
            "representative_civil_status": details.representative_civil_status or "",
            "representative_address": details.representative_address or "",
            "representative_contact_no": details.representative_contact_no or "",
            "representative_relationship": details.representative_relationship or "",
            "representative_email": details.representative_email or "",
            "detained": bool(details.detained),
            "detained_since": details.detained_since.date().isoformat() if details.detained_since else "",
            "place_of_detention": details.place_of_detention or "",
        },
        "client_classification": {
            "flag_senior": bool(classification.class_senior_citizen),
            "flag_cicl": bool(classification.class_cicl),
            "flag_female": bool(classification.class_female or classification.class_woman),
            "flag_urban": bool(classification.class_urban),
            "flag_rural": bool(classification.class_rural),
            "flag_drugs": bool(classification.class_drug_related or classification.class_9165),
            "flag_foreign_national": bool(classification.class_foreign_national),
            "flag_vawc_victim": bool(classification.class_vawc_victim),
            "flag_refugee_evacuee": bool(classification.class_refugee),
            "flag_law_enforcer": bool(classification.class_law_enforcer),
            "flag_tenant_agrarian": bool(classification.class_tenant_agrarian),
            "flag_ofw_land_based": bool(classification.class_ofw_land),
            "flag_ofw_sea_based": bool(classification.class_ofw_sea),
            "flag_arrested_terrorism": bool(classification.class_terrorism_arrested),
            "flag_indigenous_people": bool(classification.class_indigenous_people),
            "flag_pwd": bool(classification.class_pwd_type),
            "flag_former_rebel_fve": bool(classification.class_former_rebel),
            "flag_torture_victim": bool(classification.class_torture_victim),
            "flag_trafficking_victim": bool(classification.class_trafficking_victim),
            "flag_voluntary_rehab_petitioner": bool(classification.class_voluntary_rehab),
            "classification_notes": classification.classification_notes or "",
        },
    }


def get_case_payload(record: models.Case) -> dict[str, Any]:
    intake = record.intake or models.IntakeRecord(form_date=datetime.now())
    representative = intake.representatives[0] if intake.representatives else None
    adverse_party = intake.adverse_parties[0] if intake.adverse_parties else None
    terminated_at = record.terminated_at or record.date_of_termination
    return {
        "case_id": str(record.case_id),
        "client_id": str(record.client_id or ""),
        "created_by_user_id": intake.interviewer_id,
        "intake_record": {
            "control_no": intake.control_no or "",
            "form_date": format_date(intake.form_date),
            "region": intake.region or "",
            "district_office": intake.district_office or "",
            "party_represented": intake.party_represented or "",
            "applicant_role": intake.applicant_role or "",
            "applicant_role_other": intake.applicant_role_other or "",
            "nature_of_request": intake.nature_of_request or "",
            "nature_of_case": intake.nature_of_case or "",
            "coi_agree_different_office": bool(intake.coi_agree_different_office),
            "coi_agree_same_dept_appeal": bool(intake.coi_agree_same_dept_appeal),
            "coi_waive_right_to_complain": bool(intake.coi_waive_right_to_complain),
            "coi_trust_assigned_counsel": bool(intake.coi_trust_assigned_counsel),
            "proof_submission_deadline": format_date(intake.proof_submission_deadline),
            "proof_itr_date": format_date(intake.proof_itr_date),
            "proof_brgy_date": format_date(intake.proof_brgy_date),
            "proof_dswd_date": format_date(intake.proof_dswd_date),
            "proof_others_details": intake.proof_others_details or "",
            "proof_others_date": format_date(intake.proof_others_date),
            "inv_plaintiff": bool(intake.inv_plaintiff),
            "inv_defendant": bool(intake.inv_defendant),
            "inv_oppositor": bool(intake.inv_oppositor),
            "inv_petitioner": bool(intake.inv_petitioner),
            "inv_respondent": bool(intake.inv_respondent),
            "inv_complainant": bool(intake.inv_complainant),
            "inv_accused": bool(intake.inv_accused),
            "inv_others": intake.inv_others or "",
        },
        "representative": {
            "rep_name": representative.rep_name if representative else "",
            "rep_age": representative.rep_age if representative else 0,
            "rep_sex": representative.rep_sex if representative else "",
            "civil_status": representative.civil_status if representative else "",
            "rep_address": representative.rep_address if representative else "",
            "rep_contact_no": representative.rep_contact_no if representative else "",
            "relationship_to_applicant": representative.relationship_to_applicant if representative else "",
        },
        "adverse_party": {
            "role": (
                "Plaintiff/Complainant"
                if adverse_party and adverse_party.role_plaintiff_complainant
                else "Defendant/Respondent/Accused"
                if adverse_party and adverse_party.role_defendant_respondent_accused
                else "Oppositor/Others"
                if adverse_party and adverse_party.role_oppositor_others
                else ""
            ),
            "name": adverse_party.name if adverse_party else "",
            "address": adverse_party.address if adverse_party else "",
        },
        "cases": {
            "title_of_case": record.title_of_case or "",
            "case_no": record.case_no or "",
            "court_body": record.court_body or "",
            "status_of_case": record.status_of_case or "Pending",
            "case_status": record.case_status or record.status_of_case or "Pending",
            "incident_barangay": record.incident_barangay or "",
            "incident_city": record.incident_city or DEFAULT_INCIDENT_CITY,
            "incident_address": record.incident_address or "",
            "latitude": record.latitude or "",
            "longitude": record.longitude or "",
            "last_action_taken": record.last_action_taken or "",
            "date_of_confinement": record.date_of_confinement.date().isoformat()
            if record.date_of_confinement
            else "",
            "place_of_detention": record.place_of_detention or "",
            "location_type": record.location_type or "",
            "cause_of_action": record.cause_of_action or "",
            "facts_of_case": record.facts_of_case or "",
            "pending_in_court": bool(record.pending_in_court),
            "cause_of_termination": record.cause_of_termination or "",
            "date_of_termination": record.date_of_termination.date().isoformat()
            if record.date_of_termination
            else "",
            "is_terminated": bool(record.is_terminated or record.status_of_case == "Terminated"),
            "terminated_at": terminated_at.date().isoformat() if terminated_at else "",
            "termination_reason": record.termination_reason or record.cause_of_termination or "",
            "termination_remarks": record.termination_remarks or "",
            "resolution_type": record.resolution_type or "",
            "terminated_by": record.terminated_by,
            "handled_by": record.handled_by or "",
            "supporting_document_path": record.supporting_document_path or "",
            "assigned_pao": record.assigned_pao or "",
            "filing_date": format_date(intake.form_date),
            "hearing_schedule": record.hearing_schedule or "",
            "remarks": record.remarks or record.last_action_taken or "",
        },
        "last_updated": record.last_updated.date().isoformat() if record.last_updated else "",
    }


def case_submission_group_id(submission: models.CaseSubmission) -> int:
    return submission.parent_submission_id or submission.submission_id


def normalize_submission_status(status: str | None) -> str:
    if status == "Correction Requested":
        return "Correction Required"
    return status or "Draft"


def submission_case_snapshot(record: models.Case) -> dict[str, Any]:
    return {
        "record": get_case_payload(record),
        "client": get_client_payload(record.client) if record.client else None,
        "client_name": record.client.name if record.client else "Unknown client",
    }


def submission_to_payload(submission: models.CaseSubmission, include_items: bool = True) -> dict[str, Any]:
    staff = submission.staff
    reviewer = submission.reviewer
    items = sorted(submission.items, key=lambda item: item.submission_item_id)
    feedback = sorted(submission.feedback, key=lambda item: item.created_at or datetime.min)
    return {
        "submission_id": str(submission.submission_id),
        "group_id": str(case_submission_group_id(submission)),
        "staff_id": submission.staff_id,
        "staff_name": staff.full_name or staff.email or staff.username if staff else "Unknown staff",
        "staff_role": display_role_name(staff) or "staff",
        "staff_profile_image_path": staff.profile_image_path if staff else None,
        "title": submission.title,
        "date_from": submission.date_from.date().isoformat() if submission.date_from else "",
        "date_to": submission.date_to.date().isoformat() if submission.date_to else "",
        "status": normalize_submission_status(submission.status),
        "version": submission.version,
        "notes": submission.notes or "",
        "case_count": len(items),
        "submitted_at": submission.submitted_at.isoformat() if submission.submitted_at else None,
        "approved_at": submission.approved_at.isoformat() if submission.approved_at else None,
        "reviewed_by": submission.reviewed_by,
        "reviewer_name": reviewer.full_name or reviewer.email or reviewer.username if reviewer else None,
        "created_at": submission.created_at.isoformat() if submission.created_at else "",
        "updated_at": submission.updated_at.isoformat() if submission.updated_at else "",
        "items": [
            {
                "submission_item_id": str(item.submission_item_id),
                "case_id": str(item.case_id),
                "snapshot": item.snapshot_json,
            }
            for item in items
        ] if include_items else [],
        "feedback": [
            {
                "feedback_id": str(item.feedback_id),
                "reviewer_id": item.reviewer_id,
                "reviewer_name": item.reviewer.full_name or item.reviewer.email or item.reviewer.username if item.reviewer else "Reviewer",
                "comments": item.comments,
                "created_at": item.created_at.isoformat() if item.created_at else "",
            }
            for item in feedback
        ],
    }


def accessible_submission_query(db: Session, user: models.User):
    query = db.query(models.CaseSubmission)
    if is_admin(user):
        return query.filter(models.CaseSubmission.status != "Draft")
    return query.filter(models.CaseSubmission.staff_id == user.user_id)


def ensure_submission_access(
    submission_id: int,
    user: models.User,
    db: Session,
) -> models.CaseSubmission:
    submission = db.get(models.CaseSubmission, submission_id)
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    if is_admin(user) or submission.staff_id == user.user_id:
        return submission
    raise HTTPException(status_code=403, detail="Submission access denied")


def latest_submission_version(db: Session, submission: models.CaseSubmission) -> int:
    group_id = case_submission_group_id(submission)
    return int(
        db.query(func.max(models.CaseSubmission.version))
        .filter(
            or_(
                models.CaseSubmission.submission_id == group_id,
                models.CaseSubmission.parent_submission_id == group_id,
            )
        )
        .scalar()
        or submission.version
    )


def ensure_latest_submission_version(db: Session, submission: models.CaseSubmission) -> None:
    if submission.version != latest_submission_version(db, submission):
        raise HTTPException(status_code=409, detail="Historical submission versions are read-only")


def submission_case_records(db: Session, user: models.User, date_from: datetime, date_to: datetime) -> list[models.Case]:
    end = date_to + timedelta(days=1)
    return (
        db.query(models.Case)
        .join(models.IntakeRecord)
        .filter(
            models.IntakeRecord.interviewer_id == user.user_id,
            models.IntakeRecord.form_date >= date_from,
            models.IntakeRecord.form_date < end,
        )
        .order_by(models.IntakeRecord.form_date.asc(), models.Case.case_id.asc())
        .all()
    )


def populate_submission_items(
    db: Session,
    submission: models.CaseSubmission,
    records: list[models.Case],
) -> None:
    for record in records:
        db.add(
            models.CaseSubmissionItem(
                submission_id=submission.submission_id,
                case_id=record.case_id,
                snapshot_json=submission_case_snapshot(record),
            )
        )


def apply_client_payload(client: models.Client, payload: ClientPayload) -> None:
    client_data = payload.client
    details_data = payload.client_details
    class_data = payload.client_classification
    details = client.details
    classification = client.classification
    if details is None:
        details = models.ClientDetails(client_id=client.client_id)
        client.details = details
    if classification is None:
        classification = models.ClientClassification(client_id=client.client_id)
        client.classification = classification

    client.name = client_data.get("name") or client.name
    client.age = client_data.get("age") or None
    client.sex = client_data.get("sex") or ""
    client.civil_status = client_data.get("civil_status") or ""
    client.religion = client_data.get("religion") or ""
    client.educational_attainment = client_data.get("educational_attainment") or ""
    client.citizenship = client_data.get("citizenship") or ""
    client.language_dialect = client_data.get("language_dialect") or ""

    details.address = details_data.get("address")
    details.contact_no = details_data.get("contact_no")
    details.email = details_data.get("email")
    details.individual_monthly_income = details_data.get("individual_monthly_income")
    details.spouse = details_data.get("spouse")
    details.address_of_spouse = details_data.get("address_of_spouse")
    details.contact_no_of_spouse = details_data.get("contact_no_of_spouse")
    details.representative_name = details_data.get("representative_name")
    details.representative_age = details_data.get("representative_age") or None
    details.representative_sex = details_data.get("representative_sex")
    details.representative_civil_status = details_data.get("representative_civil_status")
    details.representative_address = details_data.get("representative_address")
    details.representative_contact_no = details_data.get("representative_contact_no")
    details.representative_relationship = details_data.get("representative_relationship")
    details.representative_email = details_data.get("representative_email")
    details.detained = bool(details_data.get("detained"))
    details.detained_since = parse_date(details_data.get("detained_since"))
    details.place_of_detention = details_data.get("place_of_detention")

    classification.class_senior_citizen = bool(class_data.get("flag_senior"))
    classification.class_cicl = bool(class_data.get("flag_cicl"))
    classification.class_female = bool(class_data.get("flag_female"))
    classification.class_woman = bool(class_data.get("flag_female"))
    classification.class_urban = bool(class_data.get("flag_urban"))
    classification.class_rural = bool(class_data.get("flag_rural"))
    classification.class_drug_related = bool(class_data.get("flag_drugs"))
    classification.class_foreign_national = "Yes" if class_data.get("flag_foreign_national") else None
    classification.class_vawc_victim = bool(class_data.get("flag_vawc_victim"))
    classification.class_refugee = "Yes" if class_data.get("flag_refugee_evacuee") else None
    classification.class_law_enforcer = bool(class_data.get("flag_law_enforcer"))
    classification.class_tenant_agrarian = bool(class_data.get("flag_tenant_agrarian"))
    classification.class_ofw_land = bool(class_data.get("flag_ofw_land_based"))
    classification.class_ofw_sea = bool(class_data.get("flag_ofw_sea_based"))
    classification.class_terrorism_arrested = bool(class_data.get("flag_arrested_terrorism"))
    classification.class_indigenous_people = "Yes" if class_data.get("flag_indigenous_people") else None
    classification.class_pwd_type = "PWD" if class_data.get("flag_pwd") else None
    classification.class_former_rebel = bool(class_data.get("flag_former_rebel_fve"))
    classification.class_torture_victim = bool(class_data.get("flag_torture_victim"))
    classification.class_trafficking_victim = bool(class_data.get("flag_trafficking_victim"))
    classification.class_voluntary_rehab = bool(class_data.get("flag_voluntary_rehab_petitioner"))
    classification.classification_notes = class_data.get("classification_notes")


def apply_case_payload(record: models.Case, payload: CasePayload) -> None:
    intake = record.intake
    if intake is None:
        raise HTTPException(status_code=400, detail="Case intake record is missing")
    representative = intake.representatives[0] if intake.representatives else None
    adverse_party = intake.adverse_parties[0] if intake.adverse_parties else None
    intake_data = payload.intake_record
    rep_data = payload.representative
    adverse_data = payload.adverse_party
    case_data = payload.cases

    intake.control_no = limit_text(intake_data.get("control_no"), 20)
    intake.form_date = parse_date(intake_data.get("form_date"), intake.form_date) or intake.form_date
    intake.region = intake_data.get("region")
    intake.district_office = intake_data.get("district_office")
    intake.party_represented = limit_text(intake_data.get("party_represented"), 50)
    intake.applicant_role = intake_data.get("applicant_role")
    intake.applicant_role_other = intake_data.get("applicant_role_other")
    intake.nature_of_request = intake_data.get("nature_of_request")
    intake.nature_of_case = limit_text(intake_data.get("nature_of_case"), 50)

    if representative is None:
        representative = models.Representative(intake_id=intake.intake_id, rep_name="Not applicable")
        intake.representatives.append(representative)
    representative.rep_name = rep_data.get("rep_name") or "Not applicable"
    representative.rep_age = rep_data.get("rep_age") or None
    representative.rep_sex = rep_data.get("rep_sex")
    representative.civil_status = rep_data.get("civil_status")
    representative.rep_address = rep_data.get("rep_address")
    representative.rep_contact_no = rep_data.get("rep_contact_no")
    representative.relationship_to_applicant = limit_text(rep_data.get("relationship_to_applicant"), 50)

    if adverse_party is None:
        adverse_party = models.AdverseParty(intake_id=intake.intake_id, name="Not provided")
        intake.adverse_parties.append(adverse_party)
    role = (adverse_data.get("role") or "").lower()
    adverse_party.role_plaintiff_complainant = "plaintiff" in role or "complainant" in role
    adverse_party.role_defendant_respondent_accused = any(key in role for key in ["defendant", "respondent", "accused"])
    adverse_party.role_oppositor_others = "oppositor" in role or "other" in role
    adverse_party.name = adverse_data.get("name") or "Not provided"
    adverse_party.address = adverse_data.get("address")

    record.title_of_case = limit_text(case_data.get("title_of_case"), 50, "Untitled Case")
    record.case_no = limit_text(case_data.get("case_no"), 20)
    record.court_body = case_data.get("court_body")
    record.status_of_case = case_data.get("status_of_case") or "Pending"
    record.case_status = case_data.get("case_status") or record.status_of_case
    record.incident_barangay = case_data.get("incident_barangay")
    record.incident_city = case_data.get("incident_city") or DEFAULT_INCIDENT_CITY
    record.incident_address = case_data.get("incident_address")
    record.latitude = str(case_data.get("latitude")) if case_data.get("latitude") not in (None, "") else None
    record.longitude = str(case_data.get("longitude")) if case_data.get("longitude") not in (None, "") else None
    record.last_action_taken = case_data.get("last_action_taken")
    record.date_of_confinement = parse_date(case_data.get("date_of_confinement"))
    record.place_of_detention = case_data.get("place_of_detention")
    record.location_type = case_data.get("location_type")
    record.cause_of_action = case_data.get("cause_of_action")
    record.facts_of_case = case_data.get("facts_of_case")
    record.pending_in_court = bool(case_data.get("pending_in_court"))
    record.cause_of_termination = case_data.get("cause_of_termination")
    record.date_of_termination = parse_date(case_data.get("date_of_termination"))
    record.assigned_pao = case_data.get("assigned_pao")
    record.hearing_schedule = case_data.get("hearing_schedule")
    record.remarks = case_data.get("remarks")
    record.last_updated = datetime.now()


def write_audit(
    db: Session,
    user_id: int | None,
    action: str,
    target_entity: str | None = None,
    description: str | None = None,
    entity_id: str | None = None,
    request: Request | None = None,
    extraction_mode: str | None = None,
    fallback_reason: str | None = None,
) -> None:
    previous_hash = (
        db.query(models.AuditLog.current_hash)
        .filter(models.AuditLog.current_hash.isnot(None))
        .order_by(models.AuditLog.log_id.desc())
        .limit(1)
        .scalar()
    )
    timestamp = datetime.now(timezone.utc)
    hash_payload = "|".join(
        [
            str(user_id or ""),
            action[:50],
            target_entity or "",
            entity_id or "",
            description or "",
            extraction_mode or "",
            fallback_reason or "",
            previous_hash or "",
            timestamp.isoformat(),
        ]
    )
    current_hash = hashlib.sha256(hash_payload.encode("utf-8")).hexdigest()
    db.add(
        models.AuditLog(
            user_id=user_id,
            action=action[:50],
            target_entity=target_entity,
            timestamp=timestamp,
            description=description,
            entity_id=entity_id,
            ip_address=request.client.host if request and request.client else None,
            extraction_mode=extraction_mode,
            fallback_reason=fallback_reason,
            previous_hash=previous_hash,
            current_hash=current_hash,
        )
    )


def public_extraction_payload(extracted: dict[str, Any]) -> dict[str, Any]:
    """Return only the standardized sectioned OCR result for API/storage use."""
    sections = extracted.get("sections")
    if not isinstance(sections, dict):
        sections = {}

    return {
        "sections": sections,
        "extraction_mode": extracted.get("extraction_mode"),
        "raw_text": extracted.get("raw_text"),
    }


def case_category(record: models.Case) -> str:
    if record.intake and record.intake.nature_of_case:
        return record.intake.nature_of_case
    if record.cause_of_action:
        return str(record.cause_of_action).split(";")[0][:80]
    return "Uncategorized"


def case_barangay(record: models.Case) -> str:
    return record.incident_barangay or "Unspecified"


def is_case_terminated(record: models.Case) -> bool:
    return bool(record.is_terminated or (record.status_of_case or "").lower() == "terminated")


def barangay_coordinates(barangay: str) -> tuple[float, float] | None:
    if not barangay:
        return None
    normalized = unicodedata.normalize("NFKD", barangay.strip().lower()).encode("ascii", "ignore").decode("ascii")
    for name, coords in BARANGAY_CENTROIDS.items():
        candidate = unicodedata.normalize("NFKD", name.lower()).encode("ascii", "ignore").decode("ascii")
        if candidate == normalized:
            return coords
    return None


def build_barangay_stats(records: list[models.Case]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    for record in records:
        barangay = case_barangay(record)
        bucket = buckets.setdefault(
            barangay,
            {
                "barangay": barangay,
                "city": record.incident_city or DEFAULT_INCIDENT_CITY,
                "total_cases": 0,
                "active_cases": 0,
                "terminated_cases": 0,
                "categories": {},
                "latitude": None,
                "longitude": None,
            },
        )
        bucket["total_cases"] += 1
        if is_case_terminated(record):
            bucket["terminated_cases"] += 1
        else:
            bucket["active_cases"] += 1
        category = case_category(record)
        bucket["categories"][category] = bucket["categories"].get(category, 0) + 1

    stats: list[dict[str, Any]] = []
    for bucket in buckets.values():
        categories = bucket.pop("categories")
        fallback = barangay_coordinates(bucket["barangay"])
        if fallback:
            bucket["latitude"], bucket["longitude"] = fallback
        most_common = max(categories.items(), key=lambda item: item[1])[0] if categories else "Uncategorized"
        stats.append({**bucket, "most_common_category": most_common})
    return sorted(stats, key=lambda row: row["total_cases"], reverse=True)


def dashboard_records(db: Session, user: models.User) -> list[models.Case]:
    return scoped_case_query(db, user).all()


def case_date_column():
    return func.coalesce(models.IntakeRecord.form_date, models.Case.last_updated)


def apply_case_date_filters(query, date_from: str | None = None, date_to: str | None = None):
    from_date = parse_date(date_from)
    if from_date:
        query = query.filter(case_date_column() >= from_date)
    to_date = parse_date(date_to)
    if to_date:
        query = query.filter(case_date_column() < to_date + timedelta(days=1))
    return query


def apply_termination_date_filters(query, date_from: str | None = None, date_to: str | None = None):
    termination_date = func.coalesce(models.Case.terminated_at, models.Case.date_of_termination, models.Case.last_updated)
    from_date = parse_date(date_from)
    if from_date:
        query = query.filter(termination_date >= from_date)
    to_date = parse_date(date_to)
    if to_date:
        query = query.filter(termination_date < to_date + timedelta(days=1))
    return query


def trend_bucket_format(date_from: str | None = None, date_to: str | None = None) -> str:
    from_date = parse_date(date_from)
    to_date = parse_date(date_to)
    if from_date and to_date and (to_date - from_date).days <= 45:
        return "YYYY-MM-DD"
    return "YYYY-MM"


@app.get("/")
def read_root():
    return {"message": "Welcome to the JurisGuard AI Backend"}


@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    try:
        user_count = db.query(models.User).count()
        return {"status": "Database is connected!", "total users": user_count}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database Connection failed: {str(exc)}") from exc


@app.get("/api/dashboard/overview")
def dashboard_overview(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    now = datetime.now()
    month_start = datetime(now.year, now.month, 1)
    total_clients = scoped_client_query(db, user).count()
    case_query = scoped_case_query(db, user)
    total_cases = case_query.count()
    terminated_cases = (
        scoped_case_query(db, user)
        .filter((models.Case.is_terminated.is_(True)) | (models.Case.status_of_case == "Terminated"))
        .count()
    )
    cases_this_month = (
        scoped_case_query(db, user)
        .filter(func.coalesce(models.IntakeRecord.form_date, models.Case.last_updated) >= month_start)
        .count()
    )
    cases_in_range = apply_case_date_filters(scoped_case_query(db, user), date_from, date_to).count()
    client_range_query = scoped_client_query(db, user)
    client_from = parse_date(date_from)
    if client_from:
        client_range_query = client_range_query.filter(models.Client.created_at >= client_from)
    client_to = parse_date(date_to)
    if client_to:
        client_range_query = client_range_query.filter(models.Client.created_at < client_to + timedelta(days=1))
    clients_in_range = client_range_query.count()
    ocr_query = db.query(models.Document).filter(models.Document.ocr_status == "COMPLETED")
    if not is_admin(user):
        ocr_query = ocr_query.filter(models.Document.uploaded_by == user.user_id)
    ocr_scanned_documents = ocr_query.count()
    return {
        "total_clients": total_clients,
        "total_cases": total_cases,
        "active_cases": max(total_cases - terminated_cases, 0),
        "terminated_cases": terminated_cases,
        "cases_this_month": cases_this_month,
        "cases_in_range": cases_in_range,
        "clients_in_range": clients_in_range,
        "ocr_scanned_documents": ocr_scanned_documents,
    }


@app.get("/api/dashboard/monthly-trends")
def dashboard_monthly_trends(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    bucket_format = trend_bucket_format(date_from, date_to)
    rows = (
        apply_case_date_filters(scoped_case_query(db, user), date_from, date_to)
        .with_entities(
            func.to_char(case_date_column(), bucket_format).label("month"),
            func.count(models.Case.case_id).label("total_cases"),
        )
        .group_by("month")
        .order_by("month")
        .all()
    )
    return [{"month": row.month or "Unscheduled", "total_cases": row.total_cases} for row in rows]


@app.get("/api/dashboard/intake-load")
def dashboard_intake_load(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    weekday_rows = (
        apply_case_date_filters(scoped_case_query(db, user), date_from, date_to)
        .with_entities(
            func.extract("dow", case_date_column()).label("weekday"),
            func.count(models.Case.case_id).label("total_cases"),
        )
        .group_by("weekday")
        .all()
    )
    hour_rows = (
        apply_case_date_filters(scoped_case_query(db, user), date_from, date_to)
        .with_entities(
            func.extract("hour", case_date_column()).label("hour"),
            func.count(models.Case.case_id).label("total_cases"),
        )
        .group_by("hour")
        .all()
    )
    weekday_names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    weekly = [
        {"day": weekday_names[index], "total_cases": 0}
        for index in range(7)
    ]
    for row in weekday_rows:
        if row.weekday is not None:
            weekly[int(row.weekday)]["total_cases"] = row.total_cases
    hourly = [
        {"hour": f"{int(row.hour):02d}:00", "total_cases": row.total_cases}
        for row in sorted(hour_rows, key=lambda item: item.hour or 0)
        if row.hour is not None
    ]
    busiest_day = max(weekly, key=lambda item: item["total_cases"]) if weekly else None
    busiest_hour = max(hourly, key=lambda item: item["total_cases"]) if hourly else None
    total_weekly = sum(item["total_cases"] for item in weekly)
    return {
        "weekly": weekly,
        "hourly": hourly,
        "busiest_day": busiest_day,
        "busiest_hour": busiest_hour,
        "average_daily_intake": round(total_weekly / 7, 2),
        "total_weekly_cases": total_weekly,
    }


@app.get("/api/dashboard/case-categories")
def dashboard_case_categories(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    rows = (
        scoped_case_query(db, user)
        .with_entities(models.IntakeRecord.nature_of_case, func.count(models.Case.case_id).label("total_cases"))
        .group_by(models.IntakeRecord.nature_of_case)
        .order_by(func.count(models.Case.case_id).desc())
        .all()
    )
    uncategorized = scoped_case_query(db, user).filter(models.Case.intake_id.is_(None)).count()
    categories = [
        {"category": row.nature_of_case or "Uncategorized", "total_cases": row.total_cases}
        for row in rows
    ]
    if uncategorized:
        categories.append({"category": "Uncategorized", "total_cases": uncategorized})
    return categories


@app.get("/api/dashboard/barangay-stats")
def dashboard_barangay_stats(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    return build_barangay_stats(dashboard_records(db, user))


@app.get("/api/dashboard/heatmap")
def dashboard_heatmap(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    records = dashboard_records(db, user)
    points: list[dict[str, Any]] = []
    for record in records:
        lat = parse_float(record.latitude)
        lng = parse_float(record.longitude)
        source = "coordinates"
        if lat is None or lng is None:
            fallback = barangay_coordinates(record.incident_barangay or "")
            if not fallback:
                continue
            lat, lng = fallback
            source = "barangay"
        points.append(
            {
                "case_id": record.case_id,
                "barangay": case_barangay(record),
                "latitude": lat,
                "longitude": lng,
                "weight": 1,
                "source": source,
                "status": record.status_of_case or record.case_status or "Pending",
                "category": case_category(record),
            }
        )
    return {"center": PANABO_CENTER, "points": points, "barangays": build_barangay_stats(records)}


@app.get("/api/dashboard/terminated-cases")
def dashboard_terminated_cases(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    records = (
        apply_termination_date_filters(scoped_case_query(db, user), date_from, date_to)
        .filter((models.Case.is_terminated.is_(True)) | (models.Case.status_of_case == "Terminated"))
        .all()
    )
    reason_counts: dict[str, int] = {}
    monthly_counts: dict[str, int] = {}
    for record in records:
        reason = record.termination_reason or record.cause_of_termination or "Unspecified"
        reason_counts[reason] = reason_counts.get(reason, 0) + 1
        date_value = record.terminated_at or record.date_of_termination or record.last_updated
        month = date_value.strftime("%Y-%m") if date_value else "Unscheduled"
        monthly_counts[month] = monthly_counts.get(month, 0) + 1
    total_in_range = apply_case_date_filters(scoped_case_query(db, user), date_from, date_to).count()
    most_common_reason = max(reason_counts.items(), key=lambda item: item[1])[0] if reason_counts else None
    return {
        "total": len(records),
        "closure_rate": round((len(records) / total_in_range) * 100, 2) if total_in_range else 0,
        "most_common_reason": most_common_reason,
        "by_reason": [
            {"reason": reason, "total_cases": total}
            for reason, total in sorted(reason_counts.items(), key=lambda item: item[1], reverse=True)
        ],
        "monthly": [
            {"month": month, "total_cases": total}
            for month, total in sorted(monthly_counts.items())
        ],
    }


@app.get("/api/dashboard/recent-activities")
def dashboard_recent_activities(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(models.AuditLog).outerjoin(models.User)
    if not is_admin(user):
        query = query.filter(models.AuditLog.user_id == user.user_id)
    rows = query.order_by(models.AuditLog.timestamp.desc()).limit(12).all()
    return [
        {
            "id": str(row.log_id),
            "timestamp": row.timestamp.isoformat() if row.timestamp else "",
            "user": row.user.full_name or row.user.email or row.user.username if row.user else "System",
            "action": row.action,
            "description": row.description or "",
            "entity_type": row.target_entity,
            "entity_id": row.entity_id,
        }
        for row in rows
    ]


@app.get("/api/dashboard/ocr-analytics")
def dashboard_ocr_analytics(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(models.Document)
    if not is_admin(user):
        query = query.filter(models.Document.uploaded_by == user.user_id)
    rows = query.order_by(models.Document.uploaded_at.desc()).all()
    total = len(rows)
    successful = len([row for row in rows if row.ocr_status == "COMPLETED"])
    failed = len([row for row in rows if row.ocr_status == "FAILED"])
    type_counts: dict[str, int] = {}
    trend_counts: dict[str, int] = {}
    for row in rows:
        doc_type = row.document_type or "Unknown"
        type_counts[doc_type] = type_counts.get(doc_type, 0) + 1
        month = row.uploaded_at.strftime("%Y-%m") if row.uploaded_at else "Unscheduled"
        trend_counts[month] = trend_counts.get(month, 0) + 1
    return {
        "total_scans": total,
        "successful_extractions": successful,
        "failed_scans": failed,
        "document_types": [
            {"document_type": key, "total_scans": value}
            for key, value in sorted(type_counts.items(), key=lambda item: item[1], reverse=True)
        ],
        "trends": [
            {"month": key, "total_scans": value}
            for key, value in sorted(trend_counts.items())
        ],
        "recent": [
            {
                "document_id": row.document_id,
                "document_type": row.document_type or "Unknown",
                "ocr_status": row.ocr_status,
                "uploaded_at": row.uploaded_at.isoformat() if row.uploaded_at else "",
                "uploaded_by": row.uploaded_by,
            }
            for row in rows[:10]
        ],
    }


@app.get("/api/dashboard/staff-workload")
def dashboard_staff_workload(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    cases = (
        db.query(models.Case)
        .join(models.IntakeRecord, models.Case.intake_id == models.IntakeRecord.intake_id, isouter=True)
        .filter(models.IntakeRecord.interviewer_id == user.user_id)
        .order_by(models.Case.last_updated.desc())
        .all()
    )
    today = datetime.now().date()
    created_today = [
        record for record in cases
        if record.intake and record.intake.form_date and record.intake.form_date.date() == today
    ]
    pending = [record for record in cases if (record.status_of_case or "").lower() in {"pending", "ongoing", "active"}]
    ocr_rows = db.query(models.Document).filter(models.Document.uploaded_by == user.user_id).order_by(models.Document.uploaded_at.desc()).all()
    logs = (
        db.query(models.AuditLog)
        .filter(models.AuditLog.user_id == user.user_id)
        .order_by(models.AuditLog.timestamp.desc())
        .limit(10)
        .all()
    )
    status_counts: dict[str, int] = {}
    client_ids = []
    for record in cases:
        status = record.status_of_case or "Pending"
        status_counts[status] = status_counts.get(status, 0) + 1
        if record.client_id:
            client_ids.append(record.client_id)
    clients = db.query(models.Client).filter(models.Client.client_id.in_(client_ids[:20])).all() if client_ids else []
    return {
        "assigned_cases": len(cases),
        "cases_created_today": len(created_today),
        "pending_case_work": len(pending),
        "my_ocr_usage": len(ocr_rows),
        "status_breakdown": [
            {"status": key, "total_cases": value}
            for key, value in sorted(status_counts.items())
        ],
        "recent_cases": [get_case_payload(record) for record in cases[:8]],
        "recent_clients": [get_client_payload(client) for client in clients[:8]],
        "recent_actions": [
            {
                "id": str(row.log_id),
                "timestamp": row.timestamp.isoformat() if row.timestamp else "",
                "action": row.action,
                "description": row.description or "",
                "entity_type": row.target_entity,
                "entity_id": row.entity_id,
            }
            for row in logs
        ],
        "ocr_recent": [
            {
                "document_id": row.document_id,
                "ocr_status": row.ocr_status,
                "document_type": row.document_type or "Unknown",
                "uploaded_at": row.uploaded_at.isoformat() if row.uploaded_at else "",
            }
            for row in ocr_rows[:8]
        ],
    }


@app.post("/api/auth/register", response_model=RegisterResponse)
def register(payload: RegisterPayload, request: Request, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()
    existing_user = db.query(models.User).filter(
        (models.User.email == email) | (models.User.username == email)
    ).first()
    if existing_user:
        if existing_user.approval_status == "rejected":
            existing_user.role_id = role_id(db, "user")
            existing_user.full_name = payload.full_name.strip()
            existing_user.password_hash = hash_password(payload.password)
            existing_user.approval_status = "pending"
            existing_user.is_active = True
            existing_user.profile_picture_path = payload.employee_id_path
            existing_user.profile_completed = bool(payload.full_name.strip())
            existing_user.mfa_enabled = False
            existing_user.mfa_secret = None
            write_audit(
                db,
                existing_user.user_id,
                "Register",
                "user",
                "Rejected registration resubmitted",
                str(existing_user.user_id),
                request,
            )
            db.commit()
            return {"message": "Registration resubmitted. Please wait for admin approval."}
        if existing_user.approval_status == "pending":
            raise HTTPException(status_code=400, detail="This email already has a pending application")
        if existing_user.approval_status == "under_review":
            raise HTTPException(status_code=400, detail="This email is already under review")
        if existing_user.approval_status == "suspended":
            raise HTTPException(status_code=400, detail="This email is suspended. Please contact the administrator")
        raise HTTPException(status_code=400, detail="Email is already registered")

    is_first_user = db.query(models.User).count() == 0
    user = models.User(
        role_id=role_id(db, "admin" if is_first_user else "staff"),
        username=make_username(email),
        email=email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        approval_status="approved" if is_first_user else "pending",
        is_active=True,
        profile_picture_path=payload.employee_id_path,
        profile_completed=bool(payload.full_name.strip()),
    )
    db.add(user)
    db.flush()
    write_audit(
        db,
        user.user_id,
        "Register",
        "user",
        "Initial admin account created" if is_first_user else "User registration submitted",
        str(user.user_id),
        request,
    )
    db.commit()
    if is_first_user:
        return {"message": "Admin account created and approved. You may sign in now."}
    return {"message": "Registration submitted. Please wait for admin approval."}


@app.post("/api/auth/token", response_model=TokenResponse)
def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    otp_code: str | None = Form(default=None),
    db: Session = Depends(get_db),
):
    username = form.username.lower().strip()
    user = db.query(models.User).filter((models.User.email == username) | (models.User.username == username)).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    if not user.is_active or user.approval_status != "approved":
        raise HTTPException(status_code=401, detail="Account is not approved")
    if user.mfa_enabled and not verify_totp(user.mfa_secret, otp_code):
        raise HTTPException(status_code=401, detail="MFA code required")

    user.last_login_at = datetime.now()
    write_audit(db, user.user_id, "Login", "user", "User signed in", str(user.user_id), request)
    db.commit()
    return {"access_token": create_access_token(user.user_id), "token_type": "bearer"}


@app.get("/api/auth/me")
def me(user: models.User = Depends(current_user)):
    return user_to_auth(user)


@app.post("/api/auth/me/mfa/setup", response_model=MfaSetupResponse)
def setup_mfa(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    if user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA is already enabled")
    if not user.mfa_secret:
        user.mfa_secret = generate_mfa_secret()
        db.commit()
    return {"secret": user.mfa_secret, "otpauth_uri": mfa_otpauth_uri(user, user.mfa_secret)}


@app.post("/api/auth/me/mfa/enable")
def enable_mfa(
    payload: MfaVerifyPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if not user.mfa_secret:
        raise HTTPException(status_code=400, detail="Start MFA setup first")
    if not verify_totp(user.mfa_secret, payload.code):
        raise HTTPException(status_code=400, detail="Invalid MFA code")
    user.mfa_enabled = True
    write_audit(db, user.user_id, "Enable MFA", "user", "MFA enabled", str(user.user_id), request)
    db.commit()
    return {"message": "MFA enabled"}


@app.post("/api/auth/me/mfa/disable")
def disable_mfa(
    payload: MfaVerifyPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if user.mfa_enabled and not verify_totp(user.mfa_secret, payload.code):
        raise HTTPException(status_code=400, detail="Invalid MFA code")
    user.mfa_enabled = False
    user.mfa_secret = None
    write_audit(db, user.user_id, "Disable MFA", "user", "MFA disabled", str(user.user_id), request)
    db.commit()
    return {"message": "MFA disabled"}


@app.post("/api/auth/me/profile-image")
def upload_profile_image(
    file: UploadFile = File(...),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS or file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Profile picture must be a JPG, PNG, or WEBP file.")
    filename = f"profile-{user.user_id}-{uuid.uuid4()}{extension}"
    location = PROFILE_UPLOAD_DIR / filename
    with open(location, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    user.profile_image_path = f"/uploads/profiles/{filename}"
    db.commit()
    db.refresh(user)
    return user_to_auth(user)


@app.delete("/api/auth/me/profile-image")
def remove_profile_image(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    user.profile_image_path = None
    db.commit()
    db.refresh(user)
    return user_to_auth(user)


@app.get("/api/admin/verification")
def list_applicants(
    approval_status: str | None = None,
    _: models.User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    query = db.query(models.User).order_by(models.User.created_at.desc())
    if approval_status:
        query = query.filter(models.User.approval_status == approval_status)
    return [user_to_admin(user) for user in query.all()]


@app.get("/api/admin/users/{user_id}")
def get_applicant(user_id: int, _: models.User = Depends(admin_user), db: Session = Depends(get_db)):
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user_to_details(user)


@app.patch("/api/admin/users/{user_id}/approval")
def update_applicant_approval(
    user_id: int,
    payload: ApprovalUpdatePayload,
    request: Request,
    current: models.User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.approval_status = payload.approval_status
    action = "Update Approval"
    if payload.approval_status == "approved":
        action = "Approved Registration"
    elif payload.approval_status == "rejected":
        action = "Rejected Registration"
    write_audit(
        db,
        current.user_id,
        action,
        "user",
        f"{current.full_name or current.email or current.username} {payload.approval_status} registration for {user.full_name or user.email or user.username}",
        str(user.user_id),
        request,
    )
    db.commit()
    db.refresh(user)
    return user_to_details(user)


@app.post("/api/case-submissions/preview")
def preview_case_submission(
    payload: SubmissionPreviewPayload,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if is_admin(user):
        raise HTTPException(status_code=403, detail="Staff account required")
    date_from = parse_date(payload.date_from)
    date_to = parse_date(payload.date_to)
    if not date_from or not date_to:
        raise HTTPException(status_code=422, detail="Valid coverage dates are required")
    if date_to < date_from:
        raise HTTPException(status_code=422, detail="End date cannot be before start date")
    records = submission_case_records(db, user, date_from, date_to)
    return {
        "date_from": date_from.date().isoformat(),
        "date_to": date_to.date().isoformat(),
        "case_count": len(records),
        "items": [submission_case_snapshot(record) for record in records],
    }


@app.get("/api/case-submissions")
def list_case_submissions(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    submissions = (
        accessible_submission_query(db, user)
        .order_by(models.CaseSubmission.updated_at.desc(), models.CaseSubmission.submission_id.desc())
        .all()
    )
    latest_by_group: dict[int, models.CaseSubmission] = {}
    for submission in submissions:
        group_id = case_submission_group_id(submission)
        current = latest_by_group.get(group_id)
        if (
            current is None
            or submission.version > current.version
            or (
                submission.version == current.version
                and submission.submission_id > current.submission_id
            )
        ):
            latest_by_group[group_id] = submission
    latest = sorted(
        latest_by_group.values(),
        key=lambda item: (item.updated_at or item.created_at or datetime.min, item.submission_id),
        reverse=True,
    )
    return [submission_to_payload(submission, include_items=False) for submission in latest]


@app.post("/api/case-submissions")
def create_case_submission(
    payload: CaseSubmissionPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if is_admin(user):
        raise HTTPException(status_code=403, detail="Staff account required")
    date_from = parse_date(payload.date_from)
    date_to = parse_date(payload.date_to)
    if not date_from or not date_to:
        raise HTTPException(status_code=422, detail="Valid coverage dates are required")
    if date_to < date_from:
        raise HTTPException(status_code=422, detail="End date cannot be before start date")
    records = submission_case_records(db, user, date_from, date_to)
    submission = models.CaseSubmission(
        staff_id=user.user_id,
        title=payload.title.strip() or f"{date_from.strftime('%B %Y')} Intake Submission",
        date_from=date_from,
        date_to=date_to,
        notes=payload.notes,
        status="Draft",
        version=1,
    )
    db.add(submission)
    db.flush()
    populate_submission_items(db, submission, records)
    write_audit(
        db,
        user.user_id,
        "Create Draft",
        "case_submission",
        f"{user.full_name or user.email or user.username} created draft submission {submission.title} version {submission.version}",
        str(submission.submission_id),
        request,
    )
    db.commit()
    db.refresh(submission)
    return submission_to_payload(submission)


@app.get("/api/case-submissions/{submission_id}")
def get_case_submission(
    submission_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    submission = ensure_submission_access(submission_id, user, db)
    return submission_to_payload(submission)


@app.get("/api/case-submissions/{submission_id}/history")
def get_case_submission_history(
    submission_id: int,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    submission = ensure_submission_access(submission_id, user, db)
    group_id = case_submission_group_id(submission)
    history = (
        accessible_submission_query(db, user)
        .filter(
            or_(
                models.CaseSubmission.submission_id == group_id,
                models.CaseSubmission.parent_submission_id == group_id,
            )
        )
        .order_by(models.CaseSubmission.version.desc())
        .all()
    )
    return [submission_to_payload(item, include_items=False) for item in history]


@app.patch("/api/case-submissions/{submission_id}")
def update_case_submission(
    submission_id: int,
    payload: CaseSubmissionPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    submission = ensure_submission_access(submission_id, user, db)
    if is_admin(user) or submission.status != "Draft":
        raise HTTPException(status_code=403, detail="Only staff can edit draft submissions")
    date_from = parse_date(payload.date_from)
    date_to = parse_date(payload.date_to)
    if not date_from or not date_to:
        raise HTTPException(status_code=422, detail="Valid coverage dates are required")
    if date_to < date_from:
        raise HTTPException(status_code=422, detail="End date cannot be before start date")
    submission.title = payload.title.strip() or submission.title
    submission.date_from = date_from
    submission.date_to = date_to
    submission.notes = payload.notes
    submission.updated_at = datetime.now()
    for item in list(submission.items):
        db.delete(item)
    db.flush()
    populate_submission_items(db, submission, submission_case_records(db, user, date_from, date_to))
    write_audit(db, user.user_id, "Edited Submission", "case_submission", f"Edited draft submission {submission.title}", str(submission.submission_id), request)
    db.commit()
    db.refresh(submission)
    return submission_to_payload(submission)


@app.post("/api/case-submissions/{submission_id}/submit")
def submit_case_submission(
    submission_id: int,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    submission = ensure_submission_access(submission_id, user, db)
    if is_admin(user) or submission.status != "Draft":
        raise HTTPException(status_code=403, detail="Only draft submissions can be submitted by staff")
    submission.status = "Submitted"
    submission.submitted_at = datetime.now()
    submission.updated_at = datetime.now()
    write_audit(db, user.user_id, "Report Submitted", "case_submission", f"Submitted {submission.title} version {submission.version} for review", str(submission.submission_id), request)
    db.commit()
    db.refresh(submission)
    return submission_to_payload(submission)


@app.post("/api/case-submissions/{submission_id}/review")
def start_case_submission_review(
    submission_id: int,
    request: Request,
    user: models.User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    submission = ensure_submission_access(submission_id, user, db)
    ensure_latest_submission_version(db, submission)
    status = normalize_submission_status(submission.status)
    if status in {"Submitted", "Resubmitted"}:
        submission.status = "Under Review"
        submission.reviewed_by = user.user_id
        submission.updated_at = datetime.now()
        write_audit(db, user.user_id, "Viewed Submission", "case_submission", f"Started review for {submission.title} version {submission.version}", str(submission.submission_id), request)
        db.commit()
        db.refresh(submission)
    return submission_to_payload(submission)


@app.post("/api/case-submissions/{submission_id}/request-correction")
def request_submission_correction(
    submission_id: int,
    payload: SubmissionFeedbackPayload,
    request: Request,
    user: models.User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    submission = ensure_submission_access(submission_id, user, db)
    ensure_latest_submission_version(db, submission)
    status = normalize_submission_status(submission.status)
    if status not in {"Submitted", "Under Review", "Correction Required", "Resubmitted"}:
        raise HTTPException(status_code=400, detail="Submission is not available for correction review")
    submission.status = "Correction Required"
    submission.reviewed_by = user.user_id
    submission.updated_at = datetime.now()
    db.add(models.SubmissionFeedback(submission_id=submission.submission_id, reviewer_id=user.user_id, comments=payload.comments))
    write_audit(db, user.user_id, "Correction Requested", "case_submission", f"Requested correction for {submission.title} version {submission.version}", str(submission.submission_id), request)
    db.commit()
    db.refresh(submission)
    return submission_to_payload(submission)


@app.post("/api/case-submissions/{submission_id}/approve")
def approve_case_submission(
    submission_id: int,
    request: Request,
    user: models.User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    submission = ensure_submission_access(submission_id, user, db)
    ensure_latest_submission_version(db, submission)
    status = normalize_submission_status(submission.status)
    if status not in {"Submitted", "Under Review", "Correction Required", "Resubmitted"}:
        raise HTTPException(status_code=400, detail="Submission is not ready for approval")
    submission.status = "Approved"
    submission.reviewed_by = user.user_id
    submission.approved_at = datetime.now()
    submission.updated_at = datetime.now()
    write_audit(db, user.user_id, "Version Approved", "case_submission", f"Approved {submission.title} version {submission.version}", str(submission.submission_id), request)
    db.commit()
    db.refresh(submission)
    return submission_to_payload(submission)


@app.post("/api/case-submissions/{submission_id}/resubmit")
def resubmit_case_submission(
    submission_id: int,
    payload: CaseSubmissionPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    source = ensure_submission_access(submission_id, user, db)
    ensure_latest_submission_version(db, source)
    source_status = normalize_submission_status(source.status)
    if is_admin(user) or source.staff_id != user.user_id or source_status != "Correction Required":
        raise HTTPException(status_code=403, detail="Only corrected staff submissions can be resubmitted")
    date_from = parse_date(payload.date_from) or source.date_from
    date_to = parse_date(payload.date_to) or source.date_to
    if date_to < date_from:
        raise HTTPException(status_code=422, detail="End date cannot be before start date")
    group_id = case_submission_group_id(source)
    latest_version = latest_submission_version(db, source)
    submission = models.CaseSubmission(
        staff_id=user.user_id,
        title=payload.title.strip() or source.title,
        date_from=date_from,
        date_to=date_to,
        status="Resubmitted",
        version=int(latest_version) + 1,
        parent_submission_id=group_id,
        notes=payload.notes,
        submitted_at=datetime.now(),
    )
    db.add(submission)
    db.flush()
    populate_submission_items(db, submission, submission_case_records(db, user, date_from, date_to))
    write_audit(db, user.user_id, "Version Created", "case_submission", f"Created {submission.title} version {submission.version} from correction workflow", str(submission.submission_id), request)
    write_audit(db, user.user_id, "Version Resubmitted", "case_submission", f"Resubmitted {submission.title} version {submission.version}", str(submission.submission_id), request)
    db.commit()
    db.refresh(submission)
    return submission_to_payload(submission)


@app.get("/api/clients/")
def list_clients(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    clients = scoped_client_query(db, user).order_by(models.Client.created_at.desc()).all()
    return [get_client_payload(client) for client in clients]


@app.get("/api/clients/{client_id}")
def get_client(client_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    client = ensure_client_access(db.get(models.Client, client_id), user, db)
    return get_client_payload(client)


@app.get("/api/clients/{client_id}/cases")
def get_client_cases(client_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    ensure_client_access(db.get(models.Client, client_id), user, db)
    records = (
        scoped_case_query(db, user)
        .filter(models.Case.client_id == client_id)
        .order_by(models.Case.last_updated.desc())
        .all()
    )
    return [get_case_payload(record) for record in records]


@app.post("/api/clients/")
def create_client(
    payload: ClientPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    client_data = payload.client
    details_data = payload.client_details
    class_data = payload.client_classification
    client = models.Client(
        name=client_data.get("name") or "Unnamed Client",
        age=client_data.get("age") or None,
        sex=client_data.get("sex") or "",
        civil_status=client_data.get("civil_status") or "",
        religion=client_data.get("religion") or "",
        educational_attainment=client_data.get("educational_attainment") or "",
        citizenship=client_data.get("citizenship") or "",
        language_dialect=client_data.get("language_dialect") or "",
    )
    db.add(client)
    db.flush()
    db.add(
        models.ClientDetails(
            client_id=client.client_id,
            address=details_data.get("address"),
            contact_no=details_data.get("contact_no"),
            email=details_data.get("email"),
            individual_monthly_income=details_data.get("individual_monthly_income"),
            spouse=details_data.get("spouse"),
            address_of_spouse=details_data.get("address_of_spouse"),
            contact_no_of_spouse=details_data.get("contact_no_of_spouse"),
            representative_name=details_data.get("representative_name"),
            representative_age=details_data.get("representative_age") or None,
            representative_sex=details_data.get("representative_sex"),
            representative_civil_status=details_data.get("representative_civil_status"),
            representative_address=details_data.get("representative_address"),
            representative_contact_no=details_data.get("representative_contact_no"),
            representative_relationship=details_data.get("representative_relationship"),
            representative_email=details_data.get("representative_email"),
            detained=bool(details_data.get("detained")),
            detained_since=parse_date(details_data.get("detained_since")),
            place_of_detention=details_data.get("place_of_detention"),
        )
    )
    db.add(
        models.ClientClassification(
            client_id=client.client_id,
            class_senior_citizen=bool(class_data.get("flag_senior")),
            class_cicl=bool(class_data.get("flag_cicl")),
            class_female=bool(class_data.get("flag_female")),
            class_woman=bool(class_data.get("flag_female")),
            class_urban=bool(class_data.get("flag_urban")),
            class_rural=bool(class_data.get("flag_rural")),
            class_drug_related=bool(class_data.get("flag_drugs")),
            class_foreign_national="Yes" if class_data.get("flag_foreign_national") else None,
            class_vawc_victim=bool(class_data.get("flag_vawc_victim")),
            class_refugee="Yes" if class_data.get("flag_refugee_evacuee") else None,
            class_law_enforcer=bool(class_data.get("flag_law_enforcer")),
            class_tenant_agrarian=bool(class_data.get("flag_tenant_agrarian")),
            class_ofw_land=bool(class_data.get("flag_ofw_land_based")),
            class_ofw_sea=bool(class_data.get("flag_ofw_sea_based")),
            class_terrorism_arrested=bool(class_data.get("flag_arrested_terrorism")),
            class_indigenous_people="Yes" if class_data.get("flag_indigenous_people") else None,
            class_pwd_type="PWD" if class_data.get("flag_pwd") else None,
            class_former_rebel=bool(class_data.get("flag_former_rebel_fve")),
            class_torture_victim=bool(class_data.get("flag_torture_victim")),
            class_trafficking_victim=bool(class_data.get("flag_trafficking_victim")),
            class_voluntary_rehab=bool(class_data.get("flag_voluntary_rehab_petitioner")),
            classification_notes=class_data.get("classification_notes"),
        )
    )
    write_audit(db, user.user_id, "Create Client", "client", f"{user.full_name or user.email or user.username} created client {client.name}", str(client.client_id), request)
    db.commit()
    db.refresh(client)
    return get_client_payload(client)


@app.patch("/api/clients/{client_id}")
def update_client(
    client_id: int,
    payload: ClientPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    client = ensure_client_access(db.get(models.Client, client_id), user, db)
    apply_client_payload(client, payload)
    write_audit(db, user.user_id, "Update Client", "client", f"{user.full_name or user.email or user.username} updated client {client.name}", str(client.client_id), request)
    db.commit()
    db.refresh(client)
    return get_client_payload(client)


@app.get("/api/cases/")
def list_cases(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    records = scoped_case_query(db, user).order_by(models.Case.last_updated.desc()).all()
    return [get_case_payload(record) for record in records]


@app.get("/api/cases/terminated")
def list_terminated_cases(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    records = (
        scoped_case_query(db, user)
        .filter((models.Case.is_terminated.is_(True)) | (models.Case.status_of_case == "Terminated"))
        .order_by(models.Case.terminated_at.desc().nullslast(), models.Case.last_updated.desc())
        .all()
    )
    return [get_case_payload(record) for record in records]


@app.get("/api/printable-intake/{case_id}")
def get_printable_intake(case_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    record = ensure_case_access(db.get(models.Case, case_id), user)
    if not record.client:
        raise HTTPException(status_code=404, detail="Case client not found")
    cases = (
        scoped_case_query(db, user)
        .filter(models.Case.client_id == record.client_id)
        .order_by(models.Case.last_updated.desc())
        .all()
    )
    return {
        "client": get_client_payload(record.client),
        "selected_case": get_case_payload(record),
        "cases": [get_case_payload(case) for case in cases],
        "templates": {
            "english": read_form_template("english"),
            "filipino": read_form_template("filipino"),
        },
    }


@app.post("/api/cases/")
def create_case(
    payload: CasePayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    client_id = int(payload.client_id)
    ensure_client_access(db.get(models.Client, client_id), user, db)

    intake_data = payload.intake_record
    rep_data = payload.representative
    adverse_data = payload.adverse_party
    case_data = payload.cases

    intake = models.IntakeRecord(
        client_id=client_id,
        interviewer_id=user.user_id,
        control_no=limit_text(intake_data.get("control_no"), 20),
        form_date=parse_date(intake_data.get("form_date"), datetime.now()) or datetime.now(),
        region=intake_data.get("region"),
        district_office=intake_data.get("district_office"),
        party_represented=limit_text(intake_data.get("party_represented"), 50),
        applicant_role=intake_data.get("applicant_role"),
        applicant_role_other=intake_data.get("applicant_role_other"),
        nature_of_request=intake_data.get("nature_of_request"),
        nature_of_case=limit_text(intake_data.get("nature_of_case"), 50),
        coi_agree_different_office=bool(intake_data.get("coi_agree_different_office")),
        coi_agree_same_dept_appeal=bool(intake_data.get("coi_agree_same_dept_appeal")),
        coi_waive_right_to_complain=bool(intake_data.get("coi_waive_right_to_complain")),
        coi_trust_assigned_counsel=bool(intake_data.get("coi_trust_assigned_counsel")),
        proof_submission_deadline=parse_date(intake_data.get("proof_submission_deadline")),
        proof_itr_date=parse_date(intake_data.get("proof_itr_date")),
        proof_brgy_date=parse_date(intake_data.get("proof_brgy_date")),
        proof_dswd_date=parse_date(intake_data.get("proof_dswd_date")),
        proof_others_details=intake_data.get("proof_others_details"),
        proof_others_date=parse_date(intake_data.get("proof_others_date")),
        inv_plaintiff=bool(intake_data.get("inv_plaintiff")),
        inv_defendant=bool(intake_data.get("inv_defendant")),
        inv_oppositor=bool(intake_data.get("inv_oppositor")),
        inv_petitioner=bool(intake_data.get("inv_petitioner")),
        inv_respondent=bool(intake_data.get("inv_respondent")),
        inv_complainant=bool(intake_data.get("inv_complainant")),
        inv_accused=bool(intake_data.get("inv_accused")),
        inv_others=intake_data.get("inv_others"),
    )
    db.add(intake)
    db.flush()

    db.add(
        models.Representative(
            intake_id=intake.intake_id,
            rep_name=rep_data.get("rep_name") or "Not applicable",
            rep_age=rep_data.get("rep_age") or None,
            rep_sex=rep_data.get("rep_sex"),
            civil_status=rep_data.get("civil_status"),
            rep_address=rep_data.get("rep_address"),
            rep_contact_no=rep_data.get("rep_contact_no"),
            relationship_to_applicant=limit_text(rep_data.get("relationship_to_applicant"), 50),
        )
    )

    role = (adverse_data.get("role") or "").lower()
    db.add(
        models.AdverseParty(
            intake_id=intake.intake_id,
            role_plaintiff_complainant="plaintiff" in role or "complainant" in role,
            role_defendant_respondent_accused=any(key in role for key in ["defendant", "respondent", "accused"]),
            role_oppositor_others="oppositor" in role or "other" in role,
            name=adverse_data.get("name") or "Not provided",
            address=adverse_data.get("address"),
        )
    )

    record = models.Case(
        intake_id=intake.intake_id,
        client_id=client_id,
        title_of_case=limit_text(case_data.get("title_of_case"), 50, "Untitled Case"),
        case_no=limit_text(case_data.get("case_no"), 20),
        court_body=case_data.get("court_body"),
        status_of_case=case_data.get("status_of_case") or "Pending",
        case_status=case_data.get("case_status") or case_data.get("status_of_case") or "Pending",
        incident_barangay=case_data.get("incident_barangay"),
        incident_city=case_data.get("incident_city") or DEFAULT_INCIDENT_CITY,
        incident_address=case_data.get("incident_address"),
        latitude=str(case_data.get("latitude")) if case_data.get("latitude") not in (None, "") else None,
        longitude=str(case_data.get("longitude")) if case_data.get("longitude") not in (None, "") else None,
        last_action_taken=case_data.get("last_action_taken"),
        date_of_confinement=parse_date(case_data.get("date_of_confinement")),
        place_of_detention=case_data.get("place_of_detention"),
        location_type=case_data.get("location_type"),
        cause_of_action=case_data.get("cause_of_action"),
        facts_of_case=case_data.get("facts_of_case"),
        pending_in_court=bool(case_data.get("pending_in_court")),
        cause_of_termination=case_data.get("cause_of_termination"),
        date_of_termination=parse_date(case_data.get("date_of_termination")),
        assigned_pao=case_data.get("assigned_pao"),
        hearing_schedule=case_data.get("hearing_schedule"),
        remarks=case_data.get("remarks"),
    )
    db.add(record)
    db.flush()
    db.add(
        models.CaseHistory(
            case_id=record.case_id,
            updated_by=user.user_id,
            previous_status=None,
            new_status=record.status_of_case,
            action_taken=record.last_action_taken or "Case created",
            remarks="Initial case record",
        )
    )
    write_audit(db, user.user_id, "Create Case", "case", f"{user.full_name or user.email or user.username} created Criminal Case #{record.case_id}", str(record.case_id), request)
    db.commit()
    db.refresh(record)
    return get_case_payload(record)


@app.patch("/api/cases/{case_id}")
def update_case(
    case_id: int,
    payload: CasePayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    record = ensure_case_access(db.get(models.Case, case_id), user)
    apply_case_payload(record, payload)
    write_audit(db, user.user_id, "Update Case", "case", f"{user.full_name or user.email or user.username} updated Criminal Case #{record.case_id}", str(record.case_id), request)
    db.commit()
    db.refresh(record)
    return get_case_payload(record)


@app.post("/api/cases/{case_id}/terminate")
def terminate_case(
    case_id: int,
    payload: TerminationPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    record = ensure_case_access(db.get(models.Case, case_id), user)
    terminated_at = parse_date(payload.date_terminated, datetime.now()) or datetime.now()
    record.status_of_case = "Terminated"
    record.case_status = "Terminated"
    record.is_terminated = True
    record.terminated_at = terminated_at
    record.date_of_termination = terminated_at
    record.termination_reason = payload.termination_reason
    record.cause_of_termination = payload.termination_reason
    record.termination_remarks = payload.final_remarks
    record.remarks = payload.final_remarks
    record.resolution_type = payload.resolution_type
    record.terminated_by = user.user_id
    record.handled_by = payload.handled_by or user.full_name or user.email or user.username
    record.supporting_document_path = payload.supporting_document_path
    record.last_updated = datetime.now()
    write_audit(db, user.user_id, "Terminate Case", "case", f"{user.full_name or user.email or user.username} terminated Criminal Case #{record.case_id}", str(record.case_id), request)
    db.commit()
    db.refresh(record)
    return get_case_payload(record)


@app.get("/api/audit-logs/")
def list_audit_logs(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0),
    action: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    user_id: int | None = Query(None),
    search: str | None = Query(None),
):
    query = db.query(models.AuditLog).outerjoin(models.User)
    if is_admin(user):
        if user_id is not None:
            query = query.filter(models.AuditLog.user_id == user_id)
    else:
        query = query.filter(models.AuditLog.user_id == user.user_id)
    if action and action.lower() != "all":
        query = query.filter(models.AuditLog.action == action)
    from_date = parse_date(date_from)
    if from_date:
        query = query.filter(models.AuditLog.timestamp >= from_date)
    to_date = parse_date(date_to)
    if to_date:
        query = query.filter(models.AuditLog.timestamp < to_date + timedelta(days=1))
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                models.AuditLog.action.ilike(term),
                models.AuditLog.description.ilike(term),
                models.AuditLog.target_entity.ilike(term),
                models.User.full_name.ilike(term),
                models.User.email.ilike(term),
                models.User.username.ilike(term),
            )
        )
    rows = query.order_by(models.AuditLog.timestamp.desc(), models.AuditLog.log_id.desc()).offset(offset).limit(limit).all()
    module_labels = {
        "user": "Admin",
        "client": "Clients",
        "case": "Cases",
        "ocr": "Cases",
        "export": "Export",
        "Authentication": "Authentication",
    }
    payload = []
    for row in rows:
        target = row.target_entity or ""
        target_key = target.lower()
        module = "Export" if "export" in target_key else module_labels.get(target_key, target or "Admin")
        payload.append(
            {
                "id": str(row.log_id),
                "timestamp": row.timestamp.isoformat() if row.timestamp else "",
                "userId": row.user_id,
                "createdBy": row.user_id,
                "user_id": row.user_id,
                "user": row.user.full_name or row.user.email or row.user.username if row.user else "System",
                "userRole": display_role_name(row.user),
                "user_role": display_role_name(row.user),
                "action": row.action,
                "module": module,
                "description": row.description or "",
                "entity_type": row.target_entity,
                "entity_id": row.entity_id,
                "ip_address": row.ip_address,
            "extraction_mode": row.extraction_mode,
            "fallback_reason": row.fallback_reason,
            "previous_hash": row.previous_hash,
            "current_hash": row.current_hash,
        }
        )
    return payload


@app.post("/api/audit-logs/")
def create_audit_log(
    payload: AuditLogPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    target = payload.entity_type or payload.module
    if payload.module == "Export" and not target:
        target = "export"
    write_audit(
        db,
        user.user_id,
        payload.action,
        target,
        payload.description,
        payload.entity_id,
        request,
        payload.extraction_mode,
        payload.fallback_reason,
    )
    db.commit()
    return {"message": "Audit log saved"}


@app.post("/api/upload-document/")
async def upload_document(
    request: Request,
    user_id: int | None = None,
    file: UploadFile = File(...),
    case_id: int | None = None,
    intake_id: int | None = None,
    extraction_mode: Literal["auto", "offline", "cloud"] = Query(default="auto"),
    db: Session = Depends(get_db),
):
    new_document = None
    try:
        uploader = db.get(models.User, user_id)
        if not uploader:
            raise HTTPException(status_code=400, detail=f"Uploader user_id {user_id} does not exist")
        if case_id is not None and not db.get(models.Case, case_id):
            raise HTTPException(status_code=400, detail=f"Case ID {case_id} does not exist. Save the case before attaching a document.")
        if intake_id is not None and not db.get(models.IntakeRecord, intake_id):
            raise HTTPException(status_code=400, detail=f"Intake ID {intake_id} does not exist. Save the intake record before attaching a document.")

        original_name = Path(file.filename or "uploaded-document").name
        extension = Path(original_name).suffix.lower()
        if extension not in ALLOWED_EXTENSIONS or file.content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(status_code=400, detail="Unsupported file type. Please upload a JPG, PNG, or WEBP image.")

        safe_filename = f"{uuid.uuid4()}{extension}"
        file_location = UPLOAD_DIR / safe_filename

        with open(file_location, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        new_document = models.Document(
            case_id=case_id,
            intake_id=intake_id,
            uploaded_by=uploader.user_id,
            document_type=file.content_type,
            encrypted_file_path=str(file_location),
            ocr_status="PROCESSING",
        )
        db.add(new_document)
        db.commit()
        db.refresh(new_document)

        extracted_json = process_document(str(file_location), extraction_mode=extraction_mode)
        public_extracted_json = public_extraction_payload(extracted_json)

        print("\n===== AI EXTRACTION RESULTS =====")
        print(public_extracted_json)
        print("=================================\n")

        db.add(
            models.ExtractedMetadata(
                document_id=new_document.document_id,
                extracted_json=public_extracted_json,
                verification_status="PENDING",
            )
        )

        new_document.ocr_status = "COMPLETED"
        write_audit(
            db,
            uploader.user_id,
            "OCR Scan",
            "ocr",
            f"{uploader.full_name or uploader.email or uploader.username} scanned document #{new_document.document_id}",
            str(new_document.document_id),
            request,
        )
        db.commit()

        return {
            "message": "Document processed successfully!",
            "document_id": new_document.document_id,
            "extracted_data": public_extracted_json,
        }

    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise exc

        db.rollback()
        if new_document is not None:
            new_document.ocr_status = "FAILED"
            db.add(new_document)
            db.commit()
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(exc)}") from exc
