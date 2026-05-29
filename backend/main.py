import base64
import hashlib
import hmac
import json
import os
import secrets
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func, text
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
    "A. O. Floirendo": (7.3376, 125.6578),
    "Cacao": (7.2654, 125.7109),
    "Cagangohan": (7.3358, 125.6069),
    "Consolacion": (7.3423, 125.6906),
    "Dapco": (7.3978, 125.6542),
    "Gredu": (7.3087, 125.6951),
    "J. P. Laurel": (7.2959, 125.7075),
    "Kasilak": (7.3927, 125.6954),
    "Katipunan": (7.3608, 125.6813),
    "Katualan": (7.2647, 125.6718),
    "Kauswagan": (7.2824, 125.6811),
    "Kiotoy": (7.3189, 125.7147),
    "Little Panay": (7.3311, 125.7273),
    "Lower Panaga": (7.3174, 125.6748),
    "Mabunao": (7.3498, 125.7286),
    "Maduao": (7.2856, 125.6267),
    "Malativas": (7.3536, 125.6334),
    "Manay": (7.3776, 125.7103),
    "Nanyo": (7.3073, 125.6483),
    "New Malaga": (7.2555, 125.6914),
    "New Malitbog": (7.4051, 125.6791),
    "New Pandan": (7.2973, 125.6731),
    "New Visayas": (7.3223, 125.7009),
    "Quezon": (7.2701, 125.6502),
    "Salvacion": (7.3832, 125.6341),
    "San Francisco": (7.2895, 125.7012),
    "San Nicolas": (7.3065, 125.6294),
    "San Pedro": (7.3251, 125.6241),
    "San Roque": (7.3069, 125.6875),
    "San Vicente": (7.3117, 125.6628),
    "Santa Cruz": (7.2817, 125.7162),
    "Santo Nino": (7.2952, 125.6842),
    "Sindaton": (7.3584, 125.7049),
    "Southern Davao": (7.3704, 125.6572),
    "Tagpore": (7.2463, 125.6328),
    "Tibungol": (7.3302, 125.6436),
    "Upper Licanan": (7.4078, 125.6194),
    "Waterfall": (7.3842, 125.7444),
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
                SELECT 'user', 'clients,cases,documents'
                WHERE NOT EXISTS (SELECT 1 FROM role WHERE role_name = 'user')
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
    role_name = user.role.role_name if user.role else ""
    if role_name != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def role_id(db: Session, name: str) -> int:
    role = db.query(models.Role).filter(models.Role.role_name == name).first()
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
    role_name = user.role.role_name if user.role else "user"
    return {
        "user_id": user.user_id,
        "email": user.email or user.username,
        "role": "admin" if role_name == "admin" else "staff",
        "approval_status": user.approval_status,
        "full_name": user.full_name or "",
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
) -> None:
    db.add(
        models.AuditLog(
            user_id=user_id,
            action=action[:50],
            target_entity=target_entity,
            description=description,
            entity_id=entity_id,
            ip_address=request.client.host if request and request.client else None,
        )
    )


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
    normalized = barangay.strip().lower()
    for name, coords in BARANGAY_CENTROIDS.items():
        if name.lower() == normalized:
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
        lat = parse_float(record.latitude)
        lng = parse_float(record.longitude)
        if lat is not None and lng is not None:
            bucket["latitude"] = lat
            bucket["longitude"] = lng

    stats: list[dict[str, Any]] = []
    for bucket in buckets.values():
        categories = bucket.pop("categories")
        if bucket["latitude"] is None or bucket["longitude"] is None:
            fallback = barangay_coordinates(bucket["barangay"])
            if fallback:
                bucket["latitude"], bucket["longitude"] = fallback
        most_common = max(categories.items(), key=lambda item: item[1])[0] if categories else "Uncategorized"
        stats.append({**bucket, "most_common_category": most_common})
    return sorted(stats, key=lambda row: row["total_cases"], reverse=True)


def dashboard_records(db: Session) -> list[models.Case]:
    return db.query(models.Case).outerjoin(models.IntakeRecord).all()


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
def dashboard_overview(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    now = datetime.now()
    month_start = datetime(now.year, now.month, 1)
    total_clients = db.query(func.count(models.Client.client_id)).filter(models.Client.deleted_at.is_(None)).scalar() or 0
    total_cases = db.query(func.count(models.Case.case_id)).scalar() or 0
    terminated_cases = (
        db.query(func.count(models.Case.case_id))
        .filter((models.Case.is_terminated.is_(True)) | (models.Case.status_of_case == "Terminated"))
        .scalar()
        or 0
    )
    cases_this_month = (
        db.query(func.count(models.Case.case_id))
        .join(models.IntakeRecord, models.Case.intake_id == models.IntakeRecord.intake_id, isouter=True)
        .filter(func.coalesce(models.IntakeRecord.form_date, models.Case.last_updated) >= month_start)
        .scalar()
        or 0
    )
    ocr_scanned_documents = (
        db.query(func.count(models.Document.document_id))
        .filter(models.Document.ocr_status == "COMPLETED")
        .scalar()
        or 0
    )
    return {
        "total_clients": total_clients,
        "total_cases": total_cases,
        "active_cases": max(total_cases - terminated_cases, 0),
        "terminated_cases": terminated_cases,
        "cases_this_month": cases_this_month,
        "ocr_scanned_documents": ocr_scanned_documents,
    }


@app.get("/api/dashboard/monthly-trends")
def dashboard_monthly_trends(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(
            func.to_char(func.coalesce(models.IntakeRecord.form_date, models.Case.last_updated), "YYYY-MM").label("month"),
            func.count(models.Case.case_id).label("total_cases"),
        )
        .join(models.IntakeRecord, models.Case.intake_id == models.IntakeRecord.intake_id, isouter=True)
        .group_by("month")
        .order_by("month")
        .all()
    )
    return [{"month": row.month or "Unscheduled", "total_cases": row.total_cases} for row in rows]


@app.get("/api/dashboard/intake-load")
def dashboard_intake_load(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    weekday_rows = (
        db.query(
            func.extract("dow", func.coalesce(models.IntakeRecord.form_date, models.Case.last_updated)).label("weekday"),
            func.count(models.Case.case_id).label("total_cases"),
        )
        .join(models.IntakeRecord, models.Case.intake_id == models.IntakeRecord.intake_id, isouter=True)
        .group_by("weekday")
        .all()
    )
    hour_rows = (
        db.query(
            func.extract("hour", func.coalesce(models.IntakeRecord.form_date, models.Case.last_updated)).label("hour"),
            func.count(models.Case.case_id).label("total_cases"),
        )
        .join(models.IntakeRecord, models.Case.intake_id == models.IntakeRecord.intake_id, isouter=True)
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
        {"hour": f"{hour:02d}:00", "total_cases": 0}
        for hour in range(8, 18)
    ]
    hour_lookup = {int(row.hour): row.total_cases for row in hour_rows if row.hour is not None}
    for entry in hourly:
        hour = int(entry["hour"].split(":", 1)[0])
        entry["total_cases"] = hour_lookup.get(hour, 0)
    busiest_day = max(weekly, key=lambda item: item["total_cases"]) if weekly else None
    busiest_hour = max(hourly, key=lambda item: item["total_cases"]) if hourly else None
    return {"weekly": weekly, "hourly": hourly, "busiest_day": busiest_day, "busiest_hour": busiest_hour}


@app.get("/api/dashboard/case-categories")
def dashboard_case_categories(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(models.IntakeRecord.nature_of_case, func.count(models.Case.case_id).label("total_cases"))
        .join(models.Case, models.Case.intake_id == models.IntakeRecord.intake_id)
        .group_by(models.IntakeRecord.nature_of_case)
        .order_by(func.count(models.Case.case_id).desc())
        .all()
    )
    uncategorized = db.query(func.count(models.Case.case_id)).filter(models.Case.intake_id.is_(None)).scalar() or 0
    categories = [
        {"category": row.nature_of_case or "Uncategorized", "total_cases": row.total_cases}
        for row in rows
    ]
    if uncategorized:
        categories.append({"category": "Uncategorized", "total_cases": uncategorized})
    return categories


@app.get("/api/dashboard/barangay-stats")
def dashboard_barangay_stats(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    return build_barangay_stats(dashboard_records(db))


@app.get("/api/dashboard/heatmap")
def dashboard_heatmap(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    records = dashboard_records(db)
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
def dashboard_terminated_cases(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    records = (
        db.query(models.Case)
        .outerjoin(models.IntakeRecord)
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
    return {
        "total": len(records),
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
def dashboard_recent_activities(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(models.AuditLog).outerjoin(models.User).order_by(models.AuditLog.timestamp.desc()).limit(12).all()
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
def dashboard_ocr_analytics(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(models.Document).order_by(models.Document.uploaded_at.desc()).all()
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
    if db.query(models.User).filter((models.User.email == email) | (models.User.username == email)).first():
        raise HTTPException(status_code=400, detail="Email is already registered")

    is_first_user = db.query(models.User).count() == 0
    user = models.User(
        role_id=role_id(db, "admin" if is_first_user else "user"),
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
    db: Session = Depends(get_db),
):
    username = form.username.lower().strip()
    user = db.query(models.User).filter((models.User.email == username) | (models.User.username == username)).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    if not user.is_active or user.approval_status != "approved":
        raise HTTPException(status_code=401, detail="Account is not approved")

    user.last_login_at = datetime.now()
    write_audit(db, user.user_id, "Login", "user", "User signed in", str(user.user_id), request)
    db.commit()
    return {"access_token": create_access_token(user.user_id), "token_type": "bearer"}


@app.get("/api/auth/me")
def me(user: models.User = Depends(current_user)):
    return user_to_auth(user)


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


@app.get("/api/clients/")
def list_clients(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    clients = db.query(models.Client).filter(models.Client.deleted_at.is_(None)).order_by(models.Client.created_at.desc()).all()
    return [get_client_payload(client) for client in clients]


@app.get("/api/clients/{client_id}")
def get_client(client_id: int, _: models.User = Depends(current_user), db: Session = Depends(get_db)):
    client = db.get(models.Client, client_id)
    if not client or client.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Client not found")
    return get_client_payload(client)


@app.get("/api/clients/{client_id}/cases")
def get_client_cases(client_id: int, _: models.User = Depends(current_user), db: Session = Depends(get_db)):
    if not db.get(models.Client, client_id):
        raise HTTPException(status_code=404, detail="Client not found")
    records = (
        db.query(models.Case)
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
    client = db.get(models.Client, client_id)
    if not client or client.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Client not found")
    apply_client_payload(client, payload)
    write_audit(db, user.user_id, "Update Client", "client", f"{user.full_name or user.email or user.username} updated client {client.name}", str(client.client_id), request)
    db.commit()
    db.refresh(client)
    return get_client_payload(client)


@app.get("/api/cases/")
def list_cases(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    records = db.query(models.Case).order_by(models.Case.last_updated.desc()).all()
    return [get_case_payload(record) for record in records]


@app.get("/api/cases/terminated")
def list_terminated_cases(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    records = (
        db.query(models.Case)
        .filter((models.Case.is_terminated.is_(True)) | (models.Case.status_of_case == "Terminated"))
        .order_by(models.Case.terminated_at.desc().nullslast(), models.Case.last_updated.desc())
        .all()
    )
    return [get_case_payload(record) for record in records]


@app.get("/api/printable-intake/{case_id}")
def get_printable_intake(case_id: int, _: models.User = Depends(current_user), db: Session = Depends(get_db)):
    record = db.get(models.Case, case_id)
    if not record:
        raise HTTPException(status_code=404, detail="Case not found")
    if not record.client:
        raise HTTPException(status_code=404, detail="Case client not found")
    cases = (
        db.query(models.Case)
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
    if not db.get(models.Client, client_id):
        raise HTTPException(status_code=404, detail="Client not found")

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
    record = db.get(models.Case, case_id)
    if not record:
        raise HTTPException(status_code=404, detail="Case not found")
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
    record = db.get(models.Case, case_id)
    if not record:
        raise HTTPException(status_code=404, detail="Case not found")
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
def list_audit_logs(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(models.AuditLog).outerjoin(models.User).order_by(models.AuditLog.timestamp.desc()).limit(100).all()
    module_labels = {
        "user": "Admin",
        "client": "Clients",
        "case": "Cases",
        "ocr": "Cases",
        "export": "Export",
        "Authentication": "Authentication",
    }
    return [
        {
            "id": str(row.log_id),
            "timestamp": row.timestamp.isoformat() if row.timestamp else "",
            "userId": row.user_id,
            "createdBy": row.user_id,
            "user_id": row.user_id,
            "user": row.user.full_name or row.user.email or row.user.username if row.user else "System",
            "action": row.action,
            "module": module_labels.get(row.target_entity or "", row.target_entity or "Admin"),
            "description": row.description or "",
            "entity_type": row.target_entity,
            "entity_id": row.entity_id,
        }
        for row in rows
    ]


@app.post("/api/audit-logs/")
def create_audit_log(
    payload: AuditLogPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    write_audit(db, user.user_id, payload.action, payload.entity_type or payload.module, payload.description, payload.entity_id, request)
    db.commit()
    return {"message": "Audit log saved"}


@app.post("/api/upload-document/")
async def upload_document(
    request: Request,
    user_id: int,
    file: UploadFile = File(...),
    case_id: int | None = None,
    intake_id: int | None = None,
    db: Session = Depends(get_db),
):
    new_document = None
    try:
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
            uploaded_by=user_id,
            document_type=file.content_type,
            encrypted_file_path=str(file_location),
            ocr_status="PROCESSING",
        )
        db.add(new_document)
        db.commit()
        db.refresh(new_document)

        extracted_json = process_document(str(file_location))

        print("\n===== AI EXTRACTION RESULTS =====")
        print(extracted_json)
        print("=================================\n")

        db.add(
            models.ExtractedMetadata(
                document_id=new_document.document_id,
                extracted_json=extracted_json,
                verification_status="PENDING",
            )
        )

        new_document.ocr_status = "COMPLETED"
        write_audit(
            db,
            user_id,
            "OCR Scan",
            "ocr",
            f"User {user_id} scanned document #{new_document.document_id}",
            str(new_document.document_id),
            request,
        )
        db.commit()

        return {
            "message": "Document processed successfully!",
            "document_id": new_document.document_id,
            "extracted_data": extracted_json,
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
