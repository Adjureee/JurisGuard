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
from sqlalchemy import text
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


class AuditLogPayload(BaseModel):
    action: str
    module: str | None = None
    description: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None


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
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS date_of_confinement TIMESTAMP',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS place_of_detention VARCHAR(255)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS location_type VARCHAR(20)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS cause_of_action TEXT',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS facts_of_case TEXT',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS pending_in_court BOOLEAN DEFAULT false',
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


def limit_text(value: Any, max_length: int, fallback: str | None = None) -> str | None:
    if value in (None, ""):
        return fallback
    return str(value)[:max_length]


def user_to_auth(user: models.User) -> dict[str, Any]:
    role_name = user.role.role_name if user.role else "user"
    return {
        "user_id": user.user_id,
        "email": user.email or user.username,
        "role": "admin" if role_name == "admin" else "user",
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
        },
        "last_updated": record.last_updated.date().isoformat() if record.last_updated else "",
    }


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
    write_audit(
        db,
        current.user_id,
        "Update Approval",
        "user",
        f"Set approval status to {payload.approval_status}",
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
    write_audit(db, user.user_id, "Create Client", "client", f"Created client {client.name}", str(client.client_id), request)
    db.commit()
    db.refresh(client)
    return get_client_payload(client)


@app.get("/api/cases/")
def list_cases(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    records = db.query(models.Case).order_by(models.Case.last_updated.desc()).all()
    return [get_case_payload(record) for record in records]


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
        last_action_taken=case_data.get("last_action_taken"),
        date_of_confinement=parse_date(case_data.get("date_of_confinement")),
        place_of_detention=case_data.get("place_of_detention"),
        location_type=case_data.get("location_type"),
        cause_of_action=case_data.get("cause_of_action"),
        facts_of_case=case_data.get("facts_of_case"),
        pending_in_court=bool(case_data.get("pending_in_court")),
        cause_of_termination=case_data.get("cause_of_termination"),
        date_of_termination=parse_date(case_data.get("date_of_termination")),
    )
    db.add(record)
    db.flush()
    write_audit(db, user.user_id, "Create Case", "case", f"Created case {record.title_of_case}", str(record.case_id), request)
    db.commit()
    db.refresh(record)
    return get_case_payload(record)


@app.get("/api/audit-logs/")
def list_audit_logs(_: models.User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(models.AuditLog).order_by(models.AuditLog.timestamp.desc()).limit(100).all()
    return [
        {
            "id": str(row.log_id),
            "timestamp": row.timestamp.isoformat() if row.timestamp else "",
            "userId": row.user_id,
            "createdBy": row.user_id,
            "user_id": row.user_id,
            "user": str(row.user_id or "System"),
            "action": row.action,
            "module": row.target_entity or "System",
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
