import asyncio
import base64
import hashlib
import hmac
import json
import os
import secrets
import struct
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import func, or_, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

import models
from auth_limits import auth_attempts, source_attempts
from bootstrap import (
    BARANGAY_CENTROIDS,
    PANABO_CENTER,
    ensure_schema_compatibility,
    seed_calendar_holidays,
    seed_roles,
)
from classification_evidence import reviewed_flag_input, stored_reviewed_flags
from database import engine, get_db
from extraction_mapping import ocr_status_for_result, public_extraction_payload
from extraction_runtime import (
    ExtractionBusy,
    ExtractionCancelled,
    ExtractionTimeout,
    ExtractionWorkerError,
    extract_document,
)
from routers.admin import register_admin_routes
from routers.cases import register_case_and_client_routes
from routers.dashboard import register_dashboard_routes
from routers.imports import register_import_routes
from routers.intakes import register_intake_routes, store_paper_draft
from routers.messaging import register_messaging_routes
from routers.reminders import register_reminder_routes
from routers.submissions import register_submission_routes
from routers.transfers import register_transfer_routes
from schemas import (
    AuditLogPayload,
    CasePayload,
    ClientPayload,
    RegisterPayload,
    RegisterResponse,
)
from upload_validation import save_bounded_upload, verify_image


models.Base.metadata.create_all(bind=engine)
for _case_list_index in (
    models.IntakeRecord.__table__.indexes,
    models.Case.__table__.indexes,
):
    for _index in _case_list_index:
        if _index.name in {
            "ix_intake_interviewer_form_date",
            "ix_case_type_status_updated_id",
            "ix_case_intake_id",
            "ix_case_client_id",
        }:
            _index.create(bind=engine, checkfirst=True)

seed_calendar_holidays()

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

SECRET_KEY = os.getenv("SECRET_KEY", "").strip()
if len(SECRET_KEY) < 32:
    raise RuntimeError("SECRET_KEY must be set to a private random value of at least 32 characters.")
TOKEN_TTL_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "720"))
REQUIRE_MFA = os.getenv("REQUIRE_MFA", "false").strip().lower() in {"true", "1", "yes"}
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))
PROFILE_UPLOAD_DIR = UPLOAD_DIR / "profiles"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PROFILE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
# No upload directory is mounted as static content; photos require API authorization.

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".jfif", ".webp"}
DOCUMENT_CONTENT_TYPES = {
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".jfif": {"image/jpeg"},
    ".png": {"image/png"},
    ".webp": {"image/webp"},
    ".pdf": {"application/pdf"},
}
MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    mfa_trusted_device_token: str | None = None


class MfaSetupResponse(BaseModel):
    secret: str
    otpauth_uri: str


class MfaVerifyPayload(BaseModel):
    code: str


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
        return False

    parts = stored_hash.split("$")
    if len(parts) != 3:
        return False
    _, salt, digest_hex = parts
    if not salt or len(digest_hex) != 64 or any(c not in "0123456789abcdef" for c in digest_hex):
        return False
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
    normalized = code.strip().replace(" ", "")
    if len(normalized) != 6 or any(ch not in "0123456789" for ch in normalized):
        return False
    now = datetime.now(timezone.utc)
    try:
        return any(
            hmac.compare_digest(generate_totp(secret, now + timedelta(seconds=30 * step)), normalized)
            for step in range(-window, window + 1)
        )
    except (ValueError, TypeError):
        return False


def mfa_otpauth_uri(user: models.User, secret: str) -> str:
    label = f"JurisGuard:{user.email or user.username}"
    return f"otpauth://totp/{quote(label)}?secret={secret}&issuer=JurisGuard&digits=6&period=30"


def create_mfa_trusted_device_token(user: models.User, expires_in_days: int = 14) -> str:
    secret_fingerprint = hashlib.sha256((user.mfa_secret or "").encode("utf-8")).hexdigest()
    payload = {
        "sub": user.user_id,
        "purpose": "mfa_trusted_device",
        "mfa": secret_fingerprint,
        "exp": int((datetime.now(timezone.utc) + timedelta(days=expires_in_days)).timestamp()),
    }
    payload_segment = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(
        SECRET_KEY.encode("utf-8"),
        payload_segment.encode("utf-8"),
        hashlib.sha256,
    )
    return f"{payload_segment}.{b64url(signature.digest())}"


def verify_mfa_trusted_device_token(user: models.User, token: str | None) -> bool:
    if not token or not user.mfa_secret:
        return False
    try:
        payload_segment, signature_segment = token.split(".", 1)
        expected = hmac.new(
            SECRET_KEY.encode("utf-8"),
            payload_segment.encode("utf-8"),
            hashlib.sha256,
        )
        if not hmac.compare_digest(b64url(expected.digest()), signature_segment):
            return False
        payload = json.loads(b64url_decode(payload_segment))
        secret_fingerprint = hashlib.sha256(user.mfa_secret.encode("utf-8")).hexdigest()
        return (
            payload.get("purpose") == "mfa_trusted_device"
            and int(payload.get("sub", 0)) == user.user_id
            and payload.get("mfa") == secret_fingerprint
            and int(payload.get("exp", 0)) > int(datetime.now(timezone.utc).timestamp())
        )
    except Exception:
        return False


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def create_access_token(user_id: int, mfa_fingerprint: str | None = None) -> str:
    payload = {
        "purpose": "access",
        "sub": user_id,
        "exp": int((datetime.now(timezone.utc) + timedelta(minutes=TOKEN_TTL_MINUTES)).timestamp()),
        "jti": secrets.token_hex(16),
        "mfa": mfa_fingerprint,
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
    admin_role_names = {"admin", "administrator", "system admin", "system administrator"}
    admin_permissions = {"all", "all_access", "*", "admin"}
    return role_name in admin_role_names or permissions in admin_permissions


def read_access_token(token: str) -> int:
    try:
        payload_segment, signature_segment = token.split(".", 1)
        expected = hmac.new(
            SECRET_KEY.encode("utf-8"), payload_segment.encode("utf-8"), hashlib.sha256
        )
        if not hmac.compare_digest(b64url(expected.digest()), signature_segment):
            raise ValueError("Invalid token signature")
        payload = json.loads(b64url_decode(payload_segment))
        if payload.get("purpose") != "access":
            raise ValueError("Invalid token purpose")
        if int(payload["exp"]) <= int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("Expired token")
        return int(payload["sub"])
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Could not validate credentials") from exc


def current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    request: Request = None,
) -> models.User:
    user_id = read_access_token(token)
    if db.get(models.RevokedAccessToken, hashlib.sha256(token.encode("utf-8")).hexdigest()):
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    user = db.get(models.User, user_id)
    if not user or not user.is_active or user.approval_status != "approved":
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    if REQUIRE_MFA:
        fingerprint = (
            hashlib.sha256(user.mfa_secret.encode()).hexdigest()
            if user.mfa_enabled and user.mfa_secret
            else None
        )
        payload = json.loads(b64url_decode(token.split(".", 1)[0]))
        enrollment_routes = {
            ("GET", "/api/auth/me"),
            ("POST", "/api/auth/me/mfa/setup"),
            ("POST", "/api/auth/me/mfa/enable"),
            ("POST", "/api/auth/logout"),
        }
        enrollment_request = request and (request.method, request.url.path) in enrollment_routes
        if (not fingerprint or payload.get("mfa") != fingerprint) and not enrollment_request:
            raise HTTPException(
                status_code=403,
                detail="Set up MFA in your profile, then sign in with your authenticator code.",
            )
    return user


def admin_user(user: models.User = Depends(current_user)) -> models.User:
    if not is_admin_role(user.role):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def is_admin(user: models.User) -> bool:
    return is_admin_role(user.role)


def can_collaborate_on_cases(user: models.User) -> bool:
    return is_admin(user)


def display_role_name(user: models.User | None) -> str | None:
    if not user:
        return None
    return "admin" if is_admin_role(user.role) else "staff"


def scoped_case_query(db: Session, user: models.User):
    query = db.query(models.Case).outerjoin(models.IntakeRecord)
    if can_collaborate_on_cases(user):
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
    owned_ids = {
        row[0]
        for row in db.query(models.Client.client_id)
        .filter(models.Client.created_by_user_id == user.user_id)
        .all()
    }
    return intake_ids | owned_ids


def scoped_client_query(db: Session, user: models.User):
    query = db.query(models.Client).filter(models.Client.deleted_at.is_(None))
    if can_collaborate_on_cases(user):
        return query
    ids = staff_client_ids(db, user)
    if not ids:
        return query.filter(models.Client.client_id == -1)
    return query.filter(models.Client.client_id.in_(ids))


def ensure_case_access(record: models.Case | None, user: models.User) -> models.Case:
    if not record:
        raise HTTPException(status_code=404, detail="Case not found")
    if can_collaborate_on_cases(user):
        return record
    if not record.intake or record.intake.interviewer_id != user.user_id:
        raise HTTPException(status_code=403, detail="Record access denied")
    return record


def ensure_client_access(client: models.Client | None, user: models.User, db: Session) -> models.Client:
    if not client or client.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Client not found")
    if can_collaborate_on_cases(user) or client.client_id in staff_client_ids(db, user):
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


def normalize_sex(value: Any) -> str | None:
    if value in (None, ""):
        return None
    normalized = str(value).strip().lower()
    if normalized in {"m", "male"}:
        return "Male"
    if normalized in {"f", "female"}:
        return "Female"
    return None


def normalize_case_status(value: Any) -> str:
    return "Terminated" if str(value or "").strip().lower() == "terminated" else "Pending"


def normalize_case_type(value: Any) -> str:
    return "Civil" if str(value or "").strip().lower() == "civil" else "Criminal"


def is_none_value(value: Any) -> bool:
    return str(value or "").strip().lower() in {"none", "not applicable", "n/a"}


def none_if_not_applicable(value: Any, fallback: str | None = None) -> str | None:
    if is_none_value(value):
        return "None"
    if value in (None, ""):
        return fallback
    return str(value)


def normalize_spouse_details(details_data: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(details_data)
    if is_none_value(normalized.get("spouse")):
        normalized["spouse"] = "None"
        normalized["address_of_spouse"] = "None"
        normalized["contact_no_of_spouse"] = "None"
    return normalized


def normalize_representative_details(details_data: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(details_data)
    if is_none_value(normalized.get("representative_civil_status")):
        normalized["representative_civil_status"] = "None"
        normalized["representative_name"] = "None"
        normalized["representative_sex"] = "None"
        normalized["representative_address"] = "None"
        normalized["representative_contact_no"] = "None"
        normalized["representative_relationship"] = "None"
    return normalized


def update_latest_client_representative(
    client: models.Client,
    representative_data: dict[str, Any],
    representative_none: bool,
) -> None:
    details = client.details
    if details is None:
        details = models.ClientDetails(client_id=client.client_id)
        client.details = details
    details.representative_name = (
        "None" if representative_none else representative_data.get("rep_name") or "Not applicable"
    )
    details.representative_age = None if representative_none else representative_data.get("rep_age") or None
    details.representative_sex = (
        "None" if representative_none else normalize_sex(representative_data.get("rep_sex"))
    )
    details.representative_civil_status = (
        "None" if representative_none else representative_data.get("civil_status")
    )
    details.representative_address = (
        "None" if representative_none else representative_data.get("rep_address")
    )
    details.representative_contact_no = (
        "None" if representative_none else representative_data.get("rep_contact_no")
    )
    details.representative_relationship = (
        "None"
        if representative_none
        else limit_text(representative_data.get("relationship_to_applicant"), 100)
    )
    details.representative_email = (
        "None" if representative_none else representative_data.get("rep_email") or None
    )


def generated_case_title(client: models.Client | None, case_type: str = "Criminal") -> str:
    name = (client.name if client else "") or "Client"
    normalized_type = normalize_case_type(case_type)
    if normalized_type == "Civil":
        return limit_text(f"Civil Case - {name.strip() or 'Client'}", 255, "Civil Case - Client") or "Civil Case - Client"
    return limit_text(f"PP vs. {name.strip() or 'Client'}", 50, "PP vs. Client") or "PP vs. Client"


def represented_party_from_role(applicant_role: Any, applicant_role_other: Any = None) -> str | None:
    if applicant_role == "Others":
        return limit_text(applicant_role_other, 100)
    return limit_text(applicant_role, 100)


def case_participants(record: models.Case) -> list[models.CaseClient]:
    participants = list(record.participants or [])
    if participants:
        return participants
    if record.client:
        return [
            models.CaseClient(
                case_id=record.case_id,
                client_id=record.client.client_id,
                client=record.client,
                party_represented=record.intake.party_represented if record.intake else None,
                applicant_role=record.intake.applicant_role if record.intake else None,
                applicant_role_other=record.intake.applicant_role_other if record.intake else None,
            )
        ]
    return []


def generated_case_title_for_case(record: models.Case) -> str:
    case_type = normalize_case_type(getattr(record, "case_type", "Criminal"))
    names = [
        participant.client.name.strip()
        for participant in case_participants(record)
        if participant.client and participant.client.name and participant.client.name.strip()
    ]
    if not names:
        return generated_case_title(record.client, case_type)
    if len(names) == 1:
        represented = names[0]
    elif len(names) == 2:
        represented = f"{names[0]} and {names[1]}"
    else:
        represented = f"{', '.join(names[:-1])}, and {names[-1]}"
    if case_type == "Civil":
        return limit_text(f"Civil Case - {represented}", 255, "Civil Case - Client") or "Civil Case - Client"
    return limit_text(f"PP vs. {represented}", 255, "PP vs. Client") or "PP vs. Client"


def case_participant_payload(
    participant: models.CaseClient,
    case_location: str | None = None,
) -> dict[str, Any]:
    client = participant.client
    classification = client.classification if client and client.classification else None
    details = client.details if client and client.details else None
    reviewed_flags = stored_reviewed_flags(classification)
    case_location = case_location or (participant.case.location_type if participant.case else None)
    case_representative = None
    if participant.case and participant.case.intake and participant.case.intake.representatives:
        case_representative = participant.case.intake.representatives[0]
    case_is_primary_client = bool(
        participant.case
        and (
            participant.client_id == participant.case.client_id
            or len(case_participants(participant.case)) == 1
        )
    )
    case_representative_available = bool(
        case_representative
        and not is_none_value(case_representative.rep_name)
        and not is_none_value(case_representative.civil_status)
        and case_representative.rep_name != "Not applicable"
    )
    representative = {
        "rep_name": getattr(participant, "representative_name", None)
        or (case_representative.rep_name if case_is_primary_client and case_representative_available else ""),
        "rep_age": getattr(participant, "representative_age", None)
        or (case_representative.rep_age if case_is_primary_client and case_representative_available else 0)
        or 0,
        "rep_sex": getattr(participant, "representative_sex", None)
        or (case_representative.rep_sex if case_is_primary_client and case_representative_available else ""),
        "civil_status": getattr(participant, "representative_civil_status", None)
        or (case_representative.civil_status if case_is_primary_client and case_representative_available else ""),
        "rep_address": getattr(participant, "representative_address", None)
        or (case_representative.rep_address if case_is_primary_client and case_representative_available else ""),
        "rep_contact_no": getattr(participant, "representative_contact_no", None)
        or (case_representative.rep_contact_no if case_is_primary_client and case_representative_available else ""),
        "relationship_to_applicant": getattr(participant, "representative_relationship", None)
        or (
            case_representative.relationship_to_applicant
            if case_is_primary_client and case_representative_available
            else ""
        ),
        "rep_email": getattr(participant, "representative_email", None) or "",
    }
    return {
        "case_client_id": str(participant.case_client_id or ""),
        "client_id": str(participant.client_id or (client.client_id if client else "")),
        "name": client.name if client else "",
        "sex": client.sex if client else "",
        "age": (client.age or 0) if client else 0,
        "party_represented": participant.party_represented
        or represented_party_from_role(participant.applicant_role, participant.applicant_role_other)
        or "",
        "applicant_role": participant.applicant_role or "",
        "applicant_role_other": participant.applicant_role_other or "",
        "relationship_to_applicant": representative["relationship_to_applicant"],
        "representative": representative,
        "address": details.address if details else "",
        "contact_no": details.contact_no if details else "",
        "classification": {
            **reviewed_flags,
            "flags_reviewed": classification is not None and classification.flags_reviewed is True,
            "flag_urban": case_location == "Urban",
            "flag_rural": case_location == "Rural",
            "flag_drugs": bool(classification.class_drug_related or classification.class_9165)
            if classification
            else False,
        },
    }


def detention_fields_for_client(
    client: models.Client | None,
    case_data: dict[str, Any],
) -> tuple[datetime | None, str | None]:
    if "detained" in case_data:
        if not bool(case_data.get("detained")):
            return None, None
        return (
            parse_date(case_data.get("date_of_confinement")),
            case_data.get("place_of_detention"),
        )
    details = client.details if client else None
    if not details or not details.detained:
        return None, None
    return (
        parse_date(case_data.get("date_of_confinement")) or details.detained_since,
        case_data.get("place_of_detention") or details.place_of_detention,
    )


def user_to_auth(user: models.User) -> dict[str, Any]:
    employee_id_path = user.profile_picture_path
    return {
        "user_id": user.user_id,
        "email": user.email or user.username,
        "role": "admin" if is_admin_role(user.role) else "staff",
        "approval_status": user.approval_status,
        "full_name": user.full_name or "",
        "mfa_enabled": bool(user.mfa_enabled),
        "profile_image_path": user.profile_image_path,
        "profile_picture_path": user.profile_picture_path,
        "employee_id_path": employee_id_path,
        "profile_completed": bool(user.profile_completed),
        "created_at": user.created_at.isoformat() if user.created_at else "",
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
            "employee_id_path": user.profile_picture_path,
            "profile_completed": bool(user.profile_completed),
        },
    }


def get_client_payload(client: models.Client) -> dict[str, Any]:
    details = client.details or models.ClientDetails(client_id=client.client_id)
    classification = client.classification or models.ClientClassification(client_id=client.client_id)
    reviewed_flags = stored_reviewed_flags(classification)
    return {
        "client_id": str(client.client_id),
        "paper_intake": (
            {
                "document_id": client.paper_intake.document_id,
                "sections": client.paper_intake.sections,
                "field_reviews": client.paper_intake.field_reviews,
                "checkbox_states": client.paper_intake.checkbox_states,
                "source_draft_id": client.paper_intake.source_draft_id,
                "candidate_snapshot": client.paper_intake.candidate_snapshot,
                "unreadable_fields": client.paper_intake.unreadable_fields,
            }
            if client.paper_intake
            else None
        ),
        "created_by_user_id": client.created_by_user_id,
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
            "detained": details.detained if client.paper_intake else bool(details.detained),
            "detained_since": details.detained_since.date().isoformat() if details.detained_since else "",
            "place_of_detention": details.place_of_detention or "",
        },
        "client_classification": {
            **reviewed_flags,
            "flags_reviewed": classification.flags_reviewed is True,
            "flag_urban": False,
            "flag_rural": False,
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
    display_status = normalize_case_status(record.status_of_case or record.case_status)
    return {
        "case_id": str(record.case_id),
        "client_id": str(record.client_id or ""),
        "case_type": normalize_case_type(getattr(record, "case_type", "Criminal")),
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
            "proof_submission_satisfied": bool(getattr(intake, "proof_submission_satisfied", False)),
            "proof_itr_satisfied": bool(getattr(intake, "proof_itr_satisfied", False)),
            "proof_itr_date": format_date(intake.proof_itr_date),
            "proof_brgy_satisfied": bool(getattr(intake, "proof_brgy_satisfied", False)),
            "proof_brgy_date": format_date(intake.proof_brgy_date),
            "proof_dswd_satisfied": bool(getattr(intake, "proof_dswd_satisfied", False)),
            "proof_dswd_date": format_date(intake.proof_dswd_date),
            "proof_others_satisfied": bool(getattr(intake, "proof_others_satisfied", False)),
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
            "title_of_case": generated_case_title_for_case(record),
            "case_no": record.case_no or "",
            "court_body": record.court_body or "",
            "status_of_case": display_status,
            "case_status": display_status,
            "incident_barangay": record.incident_barangay or "",
            "incident_city": record.incident_city or "",
            "incident_address": record.incident_address or "",
            "latitude": record.latitude or "",
            "longitude": record.longitude or "",
            "last_action_taken": record.last_action_taken or "",
            "detained": bool(
                getattr(record, "detained", False)
                or record.date_of_confinement
                or record.place_of_detention
            ),
            "date_of_confinement": record.date_of_confinement.date().isoformat()
            if record.date_of_confinement
            else "",
            "place_of_detention": record.place_of_detention or "",
            "location_type": record.location_type or "",
            "cause_of_action": record.cause_of_action or "",
            "facts_of_case": record.facts_of_case or "",
            "pending_in_court": display_status == "Pending",
            "cause_of_termination": record.cause_of_termination or "",
            "date_of_termination": record.date_of_termination.date().isoformat()
            if record.date_of_termination
            else "",
            "is_terminated": bool(record.is_terminated or display_status == "Terminated"),
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
        "participants": [
            case_participant_payload(participant, record.location_type)
            for participant in case_participants(record)
        ],
        "last_updated": record.last_updated.date().isoformat() if record.last_updated else "",
    }


def get_case_list_item(record: models.Case) -> dict[str, Any]:
    intake = record.intake
    participants = case_participants(record)
    participant_rows = [
        {
            "client_id": str(participant.client_id or (participant.client.client_id if participant.client else "")),
            "name": participant.client.name if participant.client else "",
            "sex": participant.client.sex if participant.client else "",
            "party_represented": participant.party_represented
            or represented_party_from_role(participant.applicant_role, participant.applicant_role_other)
            or "",
            "applicant_role": participant.applicant_role or "",
            "applicant_role_other": participant.applicant_role_other or "",
        }
        for participant in participants
    ]
    return {
        "case_id": str(record.case_id),
        "client_id": str(record.client_id or ""),
        "case_type": normalize_case_type(getattr(record, "case_type", "Criminal")),
        "created_by_user_id": intake.interviewer_id if intake else None,
        "control_no": intake.control_no or "" if intake else "",
        "form_date": format_date(intake.form_date) if intake else "",
        "party_represented": intake.party_represented or "" if intake else "",
        "nature_of_case": intake.nature_of_case or "" if intake else "",
        "title_of_case": generated_case_title_for_case(record),
        "case_no": record.case_no or "",
        "court_body": record.court_body or "",
        "status_of_case": normalize_case_status(record.status_of_case or record.case_status),
        "is_terminated": bool(record.is_terminated or record.status_of_case == "Terminated"),
        "location_type": record.location_type or "",
        "cause_of_action": record.cause_of_action or "",
        "participants": participant_rows,
        "last_updated": record.last_updated.date().isoformat() if record.last_updated else "",
    }


def apply_client_payload(client: models.Client, payload: ClientPayload) -> None:
    client_data = payload.client
    details_data = normalize_representative_details(normalize_spouse_details(payload.client_details))
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
    details.spouse = none_if_not_applicable(details_data.get("spouse"))
    details.address_of_spouse = none_if_not_applicable(details_data.get("address_of_spouse"))
    details.contact_no_of_spouse = none_if_not_applicable(details_data.get("contact_no_of_spouse"))
    details.representative_name = none_if_not_applicable(details_data.get("representative_name"))
    details.representative_age = details_data.get("representative_age") or None
    details.representative_sex = none_if_not_applicable(details_data.get("representative_sex"))
    details.representative_civil_status = none_if_not_applicable(details_data.get("representative_civil_status"))
    details.representative_address = none_if_not_applicable(details_data.get("representative_address"))
    details.representative_contact_no = none_if_not_applicable(details_data.get("representative_contact_no"))
    details.representative_relationship = none_if_not_applicable(details_data.get("representative_relationship"))
    details.representative_email = details_data.get("representative_email")
    details.detained = bool(details_data.get("detained"))
    details.detained_since = parse_date(details_data.get("detained_since"))
    details.place_of_detention = details_data.get("place_of_detention")

    reviewed_flags = reviewed_flag_input(class_data)
    if reviewed_flags is not None:
        classification.class_senior_citizen = reviewed_flags["flag_senior"]
        classification.class_cicl = reviewed_flags["flag_cicl"]
        classification.class_female = reviewed_flags["flag_female"]
        classification.flags_reviewed = True
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


def commit_or_client_error(db: Session, action: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Unable to {action} client because the submitted data conflicts with an existing database record.",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Database error while trying to {action} client. Refresh the page and try again.",
        ) from exc


def commit_or_case_error(db: Session, action: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Unable to {action} case. Check duplicate control number or case number.",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Database error while trying to {action} case. Refresh the page and try again.",
        ) from exc


def apply_case_payload(record: models.Case, payload: CasePayload) -> None:
    intake = record.intake
    if intake is None:
        raise HTTPException(status_code=400, detail="Case intake record is missing")
    representative = intake.representatives[0] if intake.representatives else None
    intake_data = payload.intake_record
    rep_data = payload.representative
    case_data = payload.cases
    normalized_status = normalize_case_status(case_data.get("status_of_case") or case_data.get("case_status"))
    confinement_date, detention_place = detention_fields_for_client(record.client, case_data)
    case_detained = (
        bool(case_data.get("detained"))
        if "detained" in case_data
        else bool(confinement_date or detention_place)
    )

    intake.control_no = limit_text(intake_data.get("control_no"), 20)
    intake.form_date = parse_date(intake_data.get("form_date"), intake.form_date) or intake.form_date
    intake.region = intake_data.get("region")
    intake.district_office = limit_text(intake_data.get("district_office"), 255)
    represented_party = intake_data.get("party_represented") or (
        intake_data.get("applicant_role_other")
        if intake_data.get("applicant_role") == "Others"
        else intake_data.get("applicant_role")
    )
    intake.party_represented = limit_text(represented_party, 50)
    intake.applicant_role = intake_data.get("applicant_role")
    intake.applicant_role_other = intake_data.get("applicant_role_other")
    intake.nature_of_request = intake_data.get("nature_of_request")
    intake.nature_of_case = limit_text(intake_data.get("nature_of_case"), 50)
    intake.proof_submission_deadline = parse_date(intake_data.get("proof_submission_deadline"))
    intake.proof_submission_satisfied = bool(intake_data.get("proof_submission_satisfied"))
    intake.proof_itr_satisfied = bool(intake_data.get("proof_itr_satisfied"))
    intake.proof_itr_date = parse_date(intake_data.get("proof_itr_date"))
    intake.proof_brgy_satisfied = bool(intake_data.get("proof_brgy_satisfied"))
    intake.proof_brgy_date = parse_date(intake_data.get("proof_brgy_date"))
    intake.proof_dswd_satisfied = bool(intake_data.get("proof_dswd_satisfied"))
    intake.proof_dswd_date = parse_date(intake_data.get("proof_dswd_date"))
    intake.proof_others_satisfied = bool(intake_data.get("proof_others_satisfied"))
    intake.proof_others_details = intake_data.get("proof_others_details")
    intake.proof_others_date = parse_date(intake_data.get("proof_others_date"))

    if representative is None:
        representative = models.Representative(intake_id=intake.intake_id, rep_name="Not applicable")
        intake.representatives.append(representative)
    representative_none = is_none_value(rep_data.get("civil_status"))
    representative.rep_name = "None" if representative_none else rep_data.get("rep_name") or "Not applicable"
    representative.rep_age = rep_data.get("rep_age") or None
    representative.rep_sex = "None" if representative_none else normalize_sex(rep_data.get("rep_sex"))
    representative.civil_status = "None" if representative_none else rep_data.get("civil_status")
    representative.rep_address = "None" if representative_none else rep_data.get("rep_address")
    representative.rep_contact_no = "None" if representative_none else rep_data.get("rep_contact_no")
    representative.relationship_to_applicant = (
        "None" if representative_none else limit_text(rep_data.get("relationship_to_applicant"), 50)
    )
    if record.client is not None:
        update_latest_client_representative(
            record.client,
            rep_data,
            representative_none,
        )

    primary_participant = next(
        (participant for participant in record.participants if participant.client_id == record.client_id),
        None,
    )
    if primary_participant is not None:
        primary_participant.applicant_role = intake.applicant_role
        primary_participant.applicant_role_other = intake.applicant_role_other
        primary_participant.party_represented = limit_text(represented_party, 100)

    record.title_of_case = generated_case_title_for_case(record)
    record.case_no = limit_text(case_data.get("case_no"), 20)
    record.court_body = case_data.get("court_body")
    record.status_of_case = normalized_status
    record.case_status = normalized_status
    record.incident_barangay = case_data.get("incident_barangay")
    record.incident_city = limit_text(case_data.get("incident_city"), 120)
    record.incident_address = case_data.get("incident_address")
    record.latitude = str(case_data.get("latitude")) if case_data.get("latitude") not in (None, "") else None
    record.longitude = str(case_data.get("longitude")) if case_data.get("longitude") not in (None, "") else None
    record.last_action_taken = case_data.get("last_action_taken")
    record.detained = case_detained
    record.date_of_confinement = confinement_date
    record.place_of_detention = detention_place
    record.location_type = case_data.get("location_type")
    record.cause_of_action = case_data.get("cause_of_action")
    record.facts_of_case = case_data.get("facts_of_case")
    record.pending_in_court = normalized_status == "Pending"
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
    # Serialize chain appends across workers. Flush each row so a second
    # event in the same transaction sees it.
    db.execute(text("SELECT pg_advisory_xact_lock(746236901)"))
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
    row = models.AuditLog(
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
    db.add(row)
    db.flush()


def case_date_column():
    return func.coalesce(models.IntakeRecord.form_date, models.Case.last_updated)


def analytics_client_query(db, user, date_from=None, date_to=None):
    query = scoped_client_query(db, user)
    start, end = parse_date(date_from), parse_date(date_to)
    if start:
        query = query.filter(models.Client.created_at >= start)
    if end:
        query = query.filter(models.Client.created_at < end + timedelta(days=1))
    return query


def apply_case_date_filters(query, date_from: str | None = None, date_to: str | None = None):
    from_date = parse_date(date_from)
    if from_date:
        query = query.filter(case_date_column() >= from_date)
    to_date = parse_date(date_to)
    if to_date:
        query = query.filter(case_date_column() < to_date + timedelta(days=1))
    return query


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


@app.get("/api/dashboard/case-categories")
def dashboard_case_categories(
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    case_type_col = getattr(models.Case, "case_type", None)
    category = (
        func.coalesce(
            func.nullif(models.IntakeRecord.nature_of_case, ""),
            func.nullif(case_type_col, ""),
            "Uncategorized",
        )
        if case_type_col is not None
        else func.coalesce(func.nullif(models.IntakeRecord.nature_of_case, ""), "Uncategorized")
    )
    rows = (
        apply_case_date_filters(scoped_case_query(db, user), date_from, date_to)
        .with_entities(category.label("category"), func.count(models.Case.case_id).label("total_cases"))
        .group_by(category)
        .order_by(func.count(models.Case.case_id).desc())
        .all()
    )
    categories = [
        {"category": row.category or "Uncategorized", "total_cases": row.total_cases}
        for row in rows
    ]
    return categories


@app.post("/api/auth/register", response_model=RegisterResponse)
def register(payload: RegisterPayload, request: Request, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()
    existing_user = (
        db.query(models.User)
        .filter((models.User.email == email) | (models.User.username == email))
        .first()
    )
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
            raise HTTPException(
                status_code=400, detail="This email is suspended. Please contact the administrator"
            )
        raise HTTPException(status_code=400, detail="Email is already registered")

    db.execute(text("SELECT pg_advisory_xact_lock(7264821)"))
    is_first_user = db.query(models.User).count() == 0
    if is_first_user:
        configured_key = os.getenv("ADMIN_BOOTSTRAP_KEY", "")
        if len(configured_key) < 32:
            raise HTTPException(status_code=503, detail="Admin bootstrap is not configured")
        if not hmac.compare_digest(payload.bootstrap_key or "", configured_key):
            raise HTTPException(status_code=403, detail="Invalid admin bootstrap key")
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
    trusted_device_token: str | None = Form(default=None),
    remember_device: bool = Form(default=False),
    db: Session = Depends(get_db),
):
    username = form.username.lower().strip()
    if request is not None and request.client is not None:
        source_attempts.consume(request.client.host)
    auth_attempts.consume(f"login:{username}")
    user = (
        db.query(models.User)
        .filter((models.User.email == username) | (models.User.username == username))
        .first()
    )

    def record_failed_login(reason: str) -> None:
        actor = user.user_id if user else None
        write_audit(
            db,
            actor,
            "Login Failed",
            "Authentication",
            reason,
            str(actor) if actor is not None else None,
            request,
        )
        db.commit()

    if not user or not verify_password(form.password, user.password_hash):
        record_failed_login("Invalid sign-in credentials")
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    if not user.is_active or user.approval_status != "approved":
        record_failed_login("Account is inactive or unapproved")
        raise HTTPException(status_code=401, detail="Account is not approved")
    new_trusted_device_token = None
    mfa_fingerprint = None
    if user.mfa_enabled:
        trusted_device_ok = not REQUIRE_MFA and verify_mfa_trusted_device_token(user, trusted_device_token)
        if not trusted_device_ok:
            if not verify_totp(user.mfa_secret, otp_code):
                if otp_code:
                    record_failed_login("Invalid authenticator code")
                raise HTTPException(
                    status_code=401, detail="Invalid MFA code" if otp_code else "MFA code required"
                )
            mfa_fingerprint = hashlib.sha256(user.mfa_secret.encode()).hexdigest()
            if remember_device and not REQUIRE_MFA:
                new_trusted_device_token = create_mfa_trusted_device_token(user)

    user.last_login_at = datetime.now()
    write_audit(db, user.user_id, "Login", "user", "User signed in", str(user.user_id), request)
    db.commit()
    return {
        "access_token": create_access_token(user.user_id, mfa_fingerprint),
        "token_type": "bearer",
        "mfa_trusted_device_token": new_trusted_device_token,
    }


@app.get("/api/auth/me")
def me(user: models.User = Depends(current_user)):
    return user_to_auth(user)


@app.post("/api/auth/logout")
def logout_access_token(
    request: Request,
    token: str = Depends(oauth2_scheme),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    payload_segment = token.split(".", 1)[0]
    expiry = int(json.loads(b64url_decode(payload_segment))["exp"])
    db.add(
        models.RevokedAccessToken(
            token_hash=hashlib.sha256(token.encode("utf-8")).hexdigest(),
            user_id=user.user_id,
            expires_at=datetime.fromtimestamp(expiry, timezone.utc).replace(tzinfo=None),
        )
    )
    write_audit(db, user.user_id, "Logout", "user", "Session revoked", str(user.user_id), request)
    db.commit()
    return {"message": "Signed out"}


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
    auth_attempts.consume(f"mfa:{user.user_id}")
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
    auth_attempts.consume(f"mfa:{user.user_id}")
    if user.mfa_enabled and not verify_totp(user.mfa_secret, payload.code):
        raise HTTPException(status_code=400, detail="Invalid MFA code")
    user.mfa_enabled = False
    user.mfa_secret = None
    write_audit(db, user.user_id, "Disable MFA", "user", "MFA disabled", str(user.user_id), request)
    db.commit()
    return {"message": "MFA disabled"}


@app.get("/uploads/profiles/{filename}")
def get_profile_image(
    filename: str,
    viewer: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if not filename.startswith("profile-") or not filename.lower().endswith(tuple(ALLOWED_EXTENSIONS)):
        raise HTTPException(status_code=404, detail="Profile image not found")
    path = f"/uploads/profiles/{filename}"
    owner = db.query(models.User).filter(models.User.profile_image_path == path).first()
    if not owner or not owner.is_active or owner.approval_status != "approved":
        raise HTTPException(status_code=404, detail="Profile image not found")
    if viewer.user_id != owner.user_id and not is_admin(viewer):
        raise HTTPException(status_code=403, detail="Profile image access denied")
    location = PROFILE_UPLOAD_DIR / filename
    if not location.is_file():
        raise HTTPException(status_code=404, detail="Profile image not found")
    return FileResponse(location, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


def remove_owned_profile_file(path: str | None, user_id: int) -> None:
    if not path:
        return
    filename = Path(path).name
    if path == f"/uploads/profiles/{filename}" and filename.startswith(f"profile-{user_id}-"):
        (PROFILE_UPLOAD_DIR / filename).unlink(missing_ok=True)


@app.post("/api/auth/me/profile-image")
def upload_profile_image(
    file: UploadFile = File(...),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS or file.content_type not in DOCUMENT_CONTENT_TYPES[extension]:
        raise HTTPException(status_code=400, detail="Profile picture must be a JPG, PNG, or WEBP file.")
    filename = f"profile-{user.user_id}-{uuid.uuid4()}{extension}"
    location = PROFILE_UPLOAD_DIR / filename
    save_bounded_upload(file.file, location, MAX_PROFILE_IMAGE_BYTES)
    previous_path = user.profile_image_path
    try:
        verify_image(location, extension)
        user.profile_image_path = f"/uploads/profiles/{filename}"
        db.commit()
    except Exception:
        db.rollback()
        location.unlink(missing_ok=True)
        raise
    remove_owned_profile_file(previous_path, user.user_id)
    db.refresh(user)
    return user_to_auth(user)


@app.delete("/api/auth/me/profile-image")
def remove_profile_image(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    previous_path = user.profile_image_path
    user.profile_image_path = None
    db.commit()
    remove_owned_profile_file(previous_path, user.user_id)
    db.refresh(user)
    return user_to_auth(user)


@app.post("/api/upload-document/")
async def upload_document(
    request: Request,
    user: models.User = Depends(current_user),
    user_id: int | None = None,
    file: UploadFile = File(...),
    ocr_image: UploadFile | None = File(None),
    crop_plan: str | None = Form(None),
    case_id: int | None = None,
    intake_id: int | None = None,
    extraction_mode: Literal["auto", "offline", "cloud"] = Query(default="auto"),
    extraction_target: Literal["full", "client", "paper_intake"] = Query(default="full"),
    db: Session = Depends(get_db),
):
    new_document = None
    file_location = None
    processing_location = None
    plaintext_dir = None
    try:
        from tempfile import TemporaryDirectory
        from document_storage import document_cipher, encrypt_document

        # Keep the legacy query parameter for client compatibility, but never
        # trust it as an ownership or attribution source.
        uploader = user
        if case_id is not None:
            ensure_case_access(db.get(models.Case, case_id), user)
        if intake_id is not None:
            intake = db.get(models.IntakeRecord, intake_id)
            if not intake:
                raise HTTPException(
                    status_code=400,
                    detail="Intake record does not exist. Save the intake record before attaching a document.",
                )
            if not is_admin(user) and intake.interviewer_id != user.user_id:
                raise HTTPException(status_code=403, detail="Record access denied")

        original_name = Path(file.filename or "uploaded-document").name
        extension = Path(original_name).suffix.lower()
        if extension not in DOCUMENT_CONTENT_TYPES or file.content_type not in DOCUMENT_CONTENT_TYPES[extension]:
            raise HTTPException(
                status_code=400, detail="Unsupported file type. Upload a JPG, PNG, WEBP, or PDF document."
            )
        if extension == ".pdf" and extraction_mode == "cloud":
            raise HTTPException(
                status_code=400, detail="Cloud mode does not support PDFs. Select offline or auto mode."
            )

        safe_filename = f"{uuid.uuid4()}{extension}"
        file_location = UPLOAD_DIR / safe_filename
        cipher = document_cipher()
        original_location = file_location
        if cipher is not None:
            plaintext_dir = TemporaryDirectory(prefix="jurisguard-upload-")
            original_location = Path(plaintext_dir.name) / safe_filename
            file_location = file_location.with_suffix(extension + ".enc")

        save_bounded_upload(file.file, original_location, MAX_DOCUMENT_BYTES)
        if extension != ".pdf":
            try:
                verify_image(original_location, extension)
            except HTTPException:
                original_location.unlink(missing_ok=True)
                raise

        processing = None
        if crop_plan:
            if extraction_target != "paper_intake" or ocr_image is not None:
                raise HTTPException(400, "Use one PAO image preparation method at a time.")
            from paper_capture import PaperCropError, build_ocr_image

            processing_location = UPLOAD_DIR / f"{uuid.uuid4()}-paper-crop.jpg"
            try:
                plan = json.loads(crop_plan)
                processing = await asyncio.to_thread(build_ocr_image, original_location, plan, processing_location)
            except (ValueError, PaperCropError) as exc:
                raise HTTPException(422, str(exc)) from exc
        if ocr_image is not None:
            processing_extension = Path(ocr_image.filename or "").suffix.lower()
            if (
                processing_extension not in (".jpg", ".jpeg", ".png", ".webp")
                or ocr_image.content_type not in DOCUMENT_CONTENT_TYPES.get(processing_extension, set())
            ):
                raise HTTPException(status_code=400, detail="The selected OCR image must be a JPG, PNG, or WEBP image.")
            processing_location = UPLOAD_DIR / f"{uuid.uuid4()}-ocr{processing_extension}"
            save_bounded_upload(ocr_image.file, processing_location, MAX_DOCUMENT_BYTES)
            verify_image(processing_location, processing_extension)

        if cipher is not None:
            encrypt_document(original_location, file_location, cipher)
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

        extracted_json = await extract_document(
            str(processing_location or original_location),
            extraction_mode,
            extraction_target,
            is_disconnected=request.is_disconnected,
        )
        if processing:
            from paper_capture import remap_field_evidence

            remap_field_evidence(extracted_json, processing)
        public_extracted_json = public_extraction_payload(extracted_json)
        public_extracted_json.setdefault("diagnostics", {})["image_preparation"] = {
            "original_retained": True,
            "selected_copy": processing_location is not None and processing is None,
        }

        db.add(
            models.ExtractedMetadata(
                document_id=new_document.document_id,
                extracted_json=public_extracted_json,
                verification_status="PENDING",
            )
        )

        draft_id = (
            store_paper_draft(db, new_document.document_id, public_extracted_json)
            if extraction_target == "paper_intake"
            else None
        )
        new_document.ocr_status = ocr_status_for_result(extracted_json)
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
            "message": "Document uploaded; OCR needs review."
            if new_document.ocr_status == "FAILED"
            else "Document processed successfully!",
            "document_id": new_document.document_id,
            "extracted_data": public_extracted_json,
            "source_draft_id": draft_id,
        }

    except (Exception, asyncio.CancelledError) as exc:
        if isinstance(exc, HTTPException):
            if new_document is None and file_location is not None:
                file_location.unlink(missing_ok=True)
            raise exc

        db.rollback()
        if new_document is None and file_location is not None:
            file_location.unlink(missing_ok=True)
        if new_document is not None:
            new_document.ocr_status = "FAILED"
            db.add(new_document)
            db.commit()
        if isinstance(exc, asyncio.CancelledError):
            raise
        if isinstance(exc, ExtractionBusy):
            raise HTTPException(status_code=503, detail=str(exc), headers={"Retry-After": "5"}) from exc
        if isinstance(exc, ExtractionTimeout):
            raise HTTPException(status_code=504, detail=str(exc)) from exc
        if isinstance(exc, ExtractionCancelled):
            raise HTTPException(status_code=499, detail="Document extraction cancelled.") from exc
        if isinstance(exc, ExtractionWorkerError):
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        raise HTTPException(status_code=500, detail="Document extraction failed. Review server diagnostics.") from exc
    finally:
        if processing_location is not None:
            processing_location.unlink(missing_ok=True)
        if plaintext_dir is not None:
            plaintext_dir.cleanup()


register_reminder_routes(
    app,
    current_user=current_user,
    get_db=get_db,
    is_admin=is_admin,
    write_audit=write_audit,
)

register_dashboard_routes(
    app,
    current_user=current_user,
    get_db=get_db,
    is_admin=is_admin,
    scoped_client_query=scoped_client_query,
    scoped_case_query=scoped_case_query,
    case_date_column=case_date_column,
    apply_case_date_filters=apply_case_date_filters,
    analytics_client_query=analytics_client_query,
    parse_date=parse_date,
    normalize_case_status=normalize_case_status,
    get_case_payload=get_case_payload,
    get_client_payload=get_client_payload,
    barangay_centroids=BARANGAY_CENTROIDS,
    panabo_center=PANABO_CENTER,
)

register_admin_routes(
    app,
    admin_user=admin_user,
    get_db=get_db,
    is_admin=is_admin,
    user_to_admin=user_to_admin,
    user_to_details=user_to_details,
    write_audit=write_audit,
)

ensure_submission_access = register_submission_routes(
    app,
    current_user=current_user,
    admin_user=admin_user,
    get_db=get_db,
    is_admin=is_admin,
    display_role_name=display_role_name,
    scoped_case_query=scoped_case_query,
    get_case_payload=get_case_payload,
    get_client_payload=get_client_payload,
    parse_date=parse_date,
    write_audit=write_audit,
)

register_import_routes(
    app,
    current_user=current_user,
    get_db=get_db,
    scoped_client_query=scoped_client_query,
    parse_date=parse_date,
    limit_text=limit_text,
    normalize_sex=normalize_sex,
    normalize_case_status=normalize_case_status,
    display_role_name=display_role_name,
    write_audit=write_audit,
)

register_case_and_client_routes(
    app,
    current_user=current_user,
    get_db=get_db,
    scoped_client_query=scoped_client_query,
    scoped_case_query=scoped_case_query,
    ensure_client_access=ensure_client_access,
    ensure_case_access=ensure_case_access,
    get_client_payload=get_client_payload,
    get_case_payload=get_case_payload,
    get_case_list_item=get_case_list_item,
    apply_client_payload=apply_client_payload,
    apply_case_payload=apply_case_payload,
    commit_or_client_error=commit_or_client_error,
    commit_or_case_error=commit_or_case_error,
    normalize_spouse_details=normalize_spouse_details,
    none_if_not_applicable=none_if_not_applicable,
    parse_date=parse_date,
    normalize_case_type=normalize_case_type,
    normalize_case_status=normalize_case_status,
    detention_fields_for_client=detention_fields_for_client,
    is_none_value=is_none_value,
    limit_text=limit_text,
    normalize_sex=normalize_sex,
    generated_case_title=generated_case_title,
    generated_case_title_for_case=generated_case_title_for_case,
    update_latest_client_representative=update_latest_client_representative,
    represented_party_from_role=represented_party_from_role,
    case_participants=case_participants,
    write_audit=write_audit,
)

register_intake_routes(
    app,
    current_user=current_user,
    get_db=get_db,
    is_admin=is_admin,
    ensure_case_access=ensure_case_access,
    ensure_client_access=ensure_client_access,
    get_client_payload=get_client_payload,
    commit_or_client_error=commit_or_client_error,
    write_audit=write_audit,
    upload_dir=UPLOAD_DIR,
    document_content_types=DOCUMENT_CONTENT_TYPES,
    max_document_bytes=MAX_DOCUMENT_BYTES,
    get_extract_document=lambda: extract_document,
)

register_messaging_routes(
    app,
    current_user=current_user,
    get_db=get_db,
    is_admin=is_admin,
)

ensure_transfer_access = register_transfer_routes(
    app,
    current_user=current_user,
    get_db=get_db,
    is_admin=is_admin,
    scoped_case_query=scoped_case_query,
    ensure_case_access=ensure_case_access,
    get_case_payload=get_case_payload,
    parse_date=parse_date,
    write_audit=write_audit,
)


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
    rows = (
        query.order_by(models.AuditLog.timestamp.desc(), models.AuditLog.log_id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
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
        export_event = row.action.startswith("Export ") or row.action == "Print Form"
        module = (
            "Export"
            if export_event or "export" in target_key
            else module_labels.get(target_key, target or "Admin")
        )
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
    if (
        payload.action not in {"Export Excel", "Export CSV", "Export PDF", "Export PNG", "Print Form"}
        or payload.module != "Export"
    ):
        raise HTTPException(status_code=403, detail="Only export activity may be reported by the browser")
    if payload.action != "Print Form" and not is_admin(user):
        raise HTTPException(status_code=403, detail="Data exports are available to administrators only")
    scope = payload.entity_type
    if scope == "admin_report_export" and not is_admin(user):
        raise HTTPException(status_code=403, detail="Admin access required")
    entity_id = None
    if scope in {"case_submission", "case_transfer_export", "intake_export"}:
        try:
            record_id = int(payload.entity_id or "")
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="A valid export record ID is required") from exc
        if scope == "case_submission":
            ensure_submission_access(record_id, user, db)
        elif scope == "case_transfer_export":
            ensure_transfer_access(record_id, user, db)
        else:
            ensure_case_access(db.get(models.Case, record_id), user)
        entity_id = str(record_id)
    elif scope not in {
        "criminal_case_export",
        "terminated_case_export",
        "analytics_chart_export",
        "staff_report_export",
        "admin_report_export",
    }:
        scope = "export"
    write_audit(
        db,
        user.user_id,
        payload.action,
        scope,
        "Browser reported an export request",
        entity_id,
        request,
    )
    db.commit()
    return {"message": "Audit log saved"}
