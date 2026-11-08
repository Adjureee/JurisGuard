import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import struct
import unicodedata
import uuid
from collections import OrderedDict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, ConfigDict, StrictStr
from sqlalchemy import func, or_, text, null
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, joinedload, selectinload
from starlette.concurrency import run_in_threadpool

import models
from calendar_holiday_data import CALENDAR_HOLIDAY_SEED
from auth_limits import auth_attempts, source_attempts
from case_transfer_permissions import can_edit_transfer_report, can_submit_transfer_report
from classification_evidence import reviewed_flag_input, stored_reviewed_flags
from extraction_runtime import (
    extract_document, ExtractionBusy, ExtractionTimeout,
    ExtractionCancelled, ExtractionWorkerError,
)
from extraction_mapping import ocr_status_for_result, public_extraction_payload
from database import SessionLocal, engine, get_db
from upload_validation import save_bounded_upload, verify_image
from reminder_permissions import (
    can_access_reminder,
    can_edit_reminder,
    can_manage_shared_reminders as role_can_manage_shared_reminders,
)
from reminder_status import PHILIPPINE_TIMEZONE, calculate_reminder_status, can_complete_reminder
from messaging_permissions import can_message_designations, normalize_message_content
from presence_status import personnel_designation
from case_import import (
    MAX_WORKBOOK_BYTES,
    extract_case_title_client_names,
    normalize_binary_indicator,
    resolve_incident_location,
    read_workbook,
)


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

def seed_calendar_holidays() -> None:
    with SessionLocal() as db:
        for source_key, name, holiday_date, classification, coverage, scope, reference, source_url in CALENDAR_HOLIDAY_SEED:
            parsed_date = date.fromisoformat(holiday_date)
            db.execute(pg_insert(models.CalendarHoliday).values(
                source_key=source_key,
                name=name,
                holiday_date=parsed_date,
                classification=classification,
                coverage=coverage,
                geographic_scope=scope,
                reference=reference,
                source_url=source_url,
                year=parsed_date.year,
            ).on_conflict_do_nothing(index_elements=[models.CalendarHoliday.source_key]))
        db.commit()


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
    ".jpg": {"image/jpeg"}, ".jpeg": {"image/jpeg"}, ".jfif": {"image/jpeg"},
    ".png": {"image/png"}, ".webp": {"image/webp"}, ".pdf": {"application/pdf"},
}
MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024
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
    bootstrap_key: str | None = None


class PrivateMessagePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: StrictStr = Field(min_length=1, max_length=2000)


class PrivateMessageReactionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    emoji: Literal["👍", "❤️", "😂", "😮", "😢", "😡"]


MESSAGE_REACTION_EMOJIS = ("👍", "❤️", "😂", "😮", "😢", "😡")


class RegisterResponse(BaseModel):
    message: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    mfa_trusted_device_token: str | None = None


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


class PaperIntakePayload(BaseModel):
    model_config = ConfigDict(extra='forbid')
    document_id: int
    sections: dict[str, dict[str, StrictStr]]
    unreadable_fields: list[str] | None = None
    field_reviews: dict[str, StrictStr] | None = None
    checkbox_states: dict[str, StrictStr] | None = None
    source_draft_id: StrictStr | None = None
    reviewed: Literal[True]

def paper_compat_text(model, key, value):
    # Lossless text stays in ReviewedPaperIntake. Legacy varchar projections
    # cannot represent every paper entry and must never truncate it.
    limit = getattr(model.__table__.c[key].type, 'length', None)
    return value if limit is None or len(value) <= limit else None

class CasePayload(BaseModel):
    client_id: int | str
    client_ids: list[int | str] | None = None
    case_type: Literal["Criminal", "Civil"] | None = None
    intake_record: dict[str, Any]
    representative: dict[str, Any]
    client_representatives: list[dict[str, Any]] | None = None
    adverse_party: dict[str, Any]
    cases: dict[str, Any]


class CaseClientPayload(BaseModel):
    client_id: int | str
    applicant_role: str | None = None
    applicant_role_other: str | None = None
    party_represented: str | None = None


class CaseImportPayload(BaseModel):
    case_type: Literal["Criminal", "Civil"]
    source_filename: str
    cases: list[dict[str, Any]]
    held_case_count: int = Field(default=0, ge=0)
    duplicate_case_count: int = Field(default=0, ge=0)


class ReminderPayload(BaseModel):
    title: str
    description: str = ""
    date: date
    start_time: time | None = None
    end_time: time | None = None
    category: Literal[
        "Client Meeting", "Court Hearing", "Document Deadline", "Follow-up",
        "Office Meeting", "Personal", "Other",
    ] = "Other"
    priority: Literal["Normal", "Important", "Urgent"] = "Normal"
    visibility: Literal["personal", "shared"] = "personal"
    notification_minutes_before: int | None = 15


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


class ResolveClientOwnerPayload(BaseModel):
    owner_user_id: int
    reason: str
    evidence_reference: str


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
        'ALTER TABLE reviewed_paper_intake ADD COLUMN IF NOT EXISTS field_reviews JSONB',
        'ALTER TABLE reviewed_paper_intake ADD COLUMN IF NOT EXISTS checkbox_states JSONB',
        'ALTER TABLE reviewed_paper_intake ADD COLUMN IF NOT EXISTS source_draft_id VARCHAR(64)',
        'ALTER TABLE reviewed_paper_intake ADD COLUMN IF NOT EXISTS candidate_snapshot JSONB',
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
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(64)',
        'UPDATE "user" SET email = username WHERE email IS NULL',
        "ALTER TABLE document ADD COLUMN IF NOT EXISTS intake_id INTEGER",
        'ALTER TABLE client ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES "user"(user_id)',
        "CREATE INDEX IF NOT EXISTS ix_client_created_by_user_id ON client (created_by_user_id)",
        # Existing intake interviewer grants case/client access, but is not proof of
        # who created the client. Leave legacy owners null for admin resolution.
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS address TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS contact_no TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS email TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS individual_monthly_income TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS spouse TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS address_of_spouse TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS contact_no_of_spouse TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_name TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_age INTEGER",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_sex VARCHAR(20)",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_civil_status VARCHAR(50)",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_address TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_contact_no TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_relationship VARCHAR(100)",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS representative_email TEXT",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS detained BOOLEAN DEFAULT false",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS detained_since TIMESTAMP",
        "ALTER TABLE client_details ADD COLUMN IF NOT EXISTS place_of_detention VARCHAR(255)",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_cicl BOOLEAN",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_woman BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_law_enforcer BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_tenant_agrarian BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_ofw_land BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_ofw_sea BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_former_rebel BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_trafficking_victim BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_senior_citizen BOOLEAN",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_vawc_victim BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_drug_related BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_terrorism_arrested BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_torture_victim BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_voluntary_rehab BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_foreign_national VARCHAR(100)",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_refugee VARCHAR(100)",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_urban_poor VARCHAR(100)",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_rural_poor VARCHAR(100)",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_indigenous_people VARCHAR(100)",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_pwd_type VARCHAR(100)",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_urban BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_rural BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_9165 BOOLEAN DEFAULT false",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS class_female BOOLEAN",
        "ALTER TABLE client_classification ADD COLUMN IF NOT EXISTS flags_reviewed BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE client_classification ALTER COLUMN class_cicl DROP DEFAULT",
        "ALTER TABLE client_classification ALTER COLUMN class_senior_citizen DROP DEFAULT",
        "ALTER TABLE client_classification ALTER COLUMN class_female DROP DEFAULT",
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
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_submission_satisfied BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_itr_satisfied BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_itr_date TIMESTAMP",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_brgy_satisfied BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_brgy_date TIMESTAMP",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_dswd_satisfied BOOLEAN DEFAULT false",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_dswd_date TIMESTAMP",
        "ALTER TABLE intake_record ADD COLUMN IF NOT EXISTS proof_others_satisfied BOOLEAN DEFAULT false",
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
        "ALTER TABLE representative ADD COLUMN IF NOT EXISTS rep_name TEXT",
        "ALTER TABLE representative ADD COLUMN IF NOT EXISTS rep_age INTEGER",
        "ALTER TABLE representative ADD COLUMN IF NOT EXISTS rep_sex VARCHAR(20)",
        "ALTER TABLE representative ADD COLUMN IF NOT EXISTS civil_status VARCHAR(50)",
        "ALTER TABLE representative ADD COLUMN IF NOT EXISTS rep_address TEXT",
        "ALTER TABLE representative ADD COLUMN IF NOT EXISTS rep_contact_no TEXT",
        "ALTER TABLE representative ADD COLUMN IF NOT EXISTS relationship_to_applicant VARCHAR(50)",
        "ALTER TABLE adverse_party ADD COLUMN IF NOT EXISTS role_plaintiff_complainant BOOLEAN DEFAULT false",
        "ALTER TABLE adverse_party ADD COLUMN IF NOT EXISTS role_defendant_respondent_accused BOOLEAN DEFAULT false",
        "ALTER TABLE adverse_party ADD COLUMN IF NOT EXISTS role_oppositor_others BOOLEAN DEFAULT false",
        "ALTER TABLE adverse_party ADD COLUMN IF NOT EXISTS name TEXT",
        "ALTER TABLE adverse_party ADD COLUMN IF NOT EXISTS address TEXT",
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS case_type VARCHAR(30) DEFAULT \'Criminal\'',
        'UPDATE "case" SET case_type = \'Criminal\' WHERE case_type IS NULL OR case_type = \'\'',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS court_body VARCHAR(255)',
        'ALTER TABLE "case" ALTER COLUMN title_of_case TYPE VARCHAR(255)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS case_status VARCHAR(30)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS incident_barangay VARCHAR(120)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS incident_city VARCHAR(120)',
        'ALTER TABLE "case" ALTER COLUMN incident_city DROP DEFAULT',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS incident_address TEXT',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS latitude VARCHAR(50)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS longitude VARCHAR(50)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS detained BOOLEAN DEFAULT false',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS date_of_confinement TIMESTAMP',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS place_of_detention VARCHAR(255)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS location_type VARCHAR(20)',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS cause_of_action TEXT',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS facts_of_case TEXT',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS pending_in_court BOOLEAN DEFAULT false',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS date_of_termination TIMESTAMP',
        'ALTER TABLE "case" ADD COLUMN IF NOT EXISTS cause_of_termination TEXT',
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
        CREATE TABLE IF NOT EXISTS case_client (
            case_client_id SERIAL PRIMARY KEY,
            case_id INTEGER NOT NULL REFERENCES "case"(case_id),
            client_id INTEGER NOT NULL REFERENCES client(client_id),
            party_represented VARCHAR(100),
            applicant_role VARCHAR(100),
            applicant_role_other VARCHAR(255),
            representative_name TEXT,
            representative_age INTEGER,
            representative_sex VARCHAR(20),
            representative_civil_status VARCHAR(50),
            representative_address TEXT,
            representative_contact_no VARCHAR(30),
            representative_relationship VARCHAR(100),
            representative_email TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_case_client_case_client UNIQUE (case_id, client_id)
        )
        """,
        "ALTER TABLE case_client ADD COLUMN IF NOT EXISTS representative_name TEXT",
        "ALTER TABLE case_client ADD COLUMN IF NOT EXISTS representative_age INTEGER",
        "ALTER TABLE case_client ADD COLUMN IF NOT EXISTS representative_sex VARCHAR(20)",
        "ALTER TABLE case_client ADD COLUMN IF NOT EXISTS representative_civil_status VARCHAR(50)",
        "ALTER TABLE case_client ADD COLUMN IF NOT EXISTS representative_address TEXT",
        "ALTER TABLE case_client ADD COLUMN IF NOT EXISTS representative_contact_no VARCHAR(30)",
        "ALTER TABLE case_client ADD COLUMN IF NOT EXISTS representative_relationship VARCHAR(100)",
        "ALTER TABLE case_client ADD COLUMN IF NOT EXISTS representative_email TEXT",
        "CREATE INDEX IF NOT EXISTS ix_case_client_case_client_id ON case_client (case_client_id)",
        "CREATE INDEX IF NOT EXISTS ix_case_client_case_id ON case_client (case_id)",
        "CREATE INDEX IF NOT EXISTS ix_case_client_client_id ON case_client (client_id)",
        """
        INSERT INTO case_client (case_id, client_id, party_represented, applicant_role, applicant_role_other)
        SELECT c.case_id, c.client_id, i.party_represented, i.applicant_role, i.applicant_role_other
        FROM "case" c
        LEFT JOIN intake_record i ON i.intake_id = c.intake_id
        WHERE c.client_id IS NOT NULL
        ON CONFLICT ON CONSTRAINT uq_case_client_case_client DO NOTHING
        """,
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
        """
        CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Audit log is append-only';
        END;
        $$
        """,
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_trigger
                WHERE tgrelid = 'audit_log'::regclass AND tgname = 'audit_log_append_only'
            ) THEN
                CREATE TRIGGER audit_log_append_only
                BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
                FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_log_mutation();
            END IF;
        END;
        $$
        """,
        """
        CREATE TABLE IF NOT EXISTS case_submission (
            submission_id SERIAL PRIMARY KEY,
            parent_submission_id INTEGER REFERENCES case_submission(submission_id),
            staff_id INTEGER NOT NULL REFERENCES "user"(user_id),
            title TEXT NOT NULL,
            date_from TIMESTAMP NOT NULL,
            date_to TIMESTAMP NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'Draft',
            version INTEGER NOT NULL DEFAULT 1,
            notes TEXT,
            submitted_at TIMESTAMP,
            approved_at TIMESTAMP,
            reviewed_by INTEGER REFERENCES "user"(user_id),
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_case_submission_submission_id ON case_submission (submission_id)",
        "CREATE INDEX IF NOT EXISTS ix_case_submission_staff_id ON case_submission (staff_id)",
        "CREATE INDEX IF NOT EXISTS ix_case_submission_status ON case_submission (status)",
        """
        CREATE TABLE IF NOT EXISTS case_submission_item (
            submission_item_id SERIAL PRIMARY KEY,
            submission_id INTEGER NOT NULL REFERENCES case_submission(submission_id),
            case_id INTEGER NOT NULL REFERENCES "case"(case_id),
            snapshot_json JSONB NOT NULL
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_case_submission_item_submission_item_id ON case_submission_item (submission_item_id)",
        "CREATE INDEX IF NOT EXISTS ix_case_submission_item_submission_id ON case_submission_item (submission_id)",
        "CREATE INDEX IF NOT EXISTS ix_case_submission_item_case_id ON case_submission_item (case_id)",
        """
        CREATE TABLE IF NOT EXISTS submission_feedback (
            feedback_id SERIAL PRIMARY KEY,
            submission_id INTEGER NOT NULL REFERENCES case_submission(submission_id),
            reviewer_id INTEGER NOT NULL REFERENCES "user"(user_id),
            comments TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_submission_feedback_feedback_id ON submission_feedback (feedback_id)",
        "CREATE INDEX IF NOT EXISTS ix_submission_feedback_submission_id ON submission_feedback (submission_id)",
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


def current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), request: Request = None) -> models.User:
    user_id = read_access_token(token)
    if db.get(models.RevokedAccessToken, hashlib.sha256(token.encode("utf-8")).hexdigest()):
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    user = db.get(models.User, user_id)
    if not user or not user.is_active or user.approval_status != "approved":
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    if REQUIRE_MFA:
        fingerprint = hashlib.sha256(user.mfa_secret.encode()).hexdigest() if user.mfa_enabled and user.mfa_secret else None
        payload = json.loads(b64url_decode(token.split(".", 1)[0]))
        enrollment_routes = {
            ("GET", "/api/auth/me"),
            ("POST", "/api/auth/me/mfa/setup"),
            ("POST", "/api/auth/me/mfa/enable"),
            ("POST", "/api/auth/logout"),
        }
        enrollment_request = request and (request.method, request.url.path) in enrollment_routes
        if (not fingerprint or payload.get("mfa") != fingerprint) and not enrollment_request:
            raise HTTPException(status_code=403, detail="Set up MFA in your profile, then sign in with your authenticator code.")
    return user


def admin_user(user: models.User = Depends(current_user)) -> models.User:
    if not is_admin_role(user.role):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def is_admin(user: models.User) -> bool:
    return is_admin_role(user.role)


def can_collaborate_on_cases(user: models.User) -> bool:
    # The admin is the centralized supervisor. Every non-admin role gets an
    # ownership-scoped workspace, regardless of its display name.
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
        "rep_name": getattr(participant, "representative_name", None) or (
            case_representative.rep_name if case_is_primary_client and case_representative_available else ""
        ),
        "rep_age": getattr(participant, "representative_age", None) or (
            case_representative.rep_age if case_is_primary_client and case_representative_available else 0
        ) or 0,
        "rep_sex": getattr(participant, "representative_sex", None) or (
            case_representative.rep_sex if case_is_primary_client and case_representative_available else ""
        ),
        "civil_status": getattr(participant, "representative_civil_status", None) or (
            case_representative.civil_status if case_is_primary_client and case_representative_available else ""
        ),
        "rep_address": getattr(participant, "representative_address", None) or (
            case_representative.rep_address if case_is_primary_client and case_representative_available else ""
        ),
        "rep_contact_no": getattr(participant, "representative_contact_no", None) or (
            case_representative.rep_contact_no if case_is_primary_client and case_representative_available else ""
        ),
        "relationship_to_applicant": getattr(participant, "representative_relationship", None) or (
            case_representative.relationship_to_applicant if case_is_primary_client and case_representative_available else ""
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
            "flag_drugs": bool(classification.class_drug_related or classification.class_9165) if classification else False,
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
        "paper_intake": ({'document_id': client.paper_intake.document_id,
                          'sections': client.paper_intake.sections,
                          'field_reviews': client.paper_intake.field_reviews,
                          'checkbox_states': client.paper_intake.checkbox_states,
                          'source_draft_id': client.paper_intake.source_draft_id,
                          'candidate_snapshot': client.paper_intake.candidate_snapshot,
                          'unreadable_fields': client.paper_intake.unreadable_fields}
                         if client.paper_intake else None),
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
        scoped_case_query(db, user)
        .filter(
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
    representative.relationship_to_applicant = "None" if representative_none else limit_text(rep_data.get("relationship_to_applicant"), 50)
    # The case representative is stored once on the case intake. Keep the
    # latest client preference in sync only for the primary client; do not
    # copy one client's representative onto unrelated co-participants.
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
                "city": record.incident_city or "",
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


REMINDER_TIMEZONE = PHILIPPINE_TIMEZONE
REMINDER_NOTIFICATION_LEADS = {0, 5, 15, 30, 60, 1440}


def reminder_status_at(reminder: models.Reminder, now: datetime) -> str:
    return calculate_reminder_status(reminder.reminder_date, reminder.start_time, reminder.status, now)


def refresh_reminder_status(reminder: models.Reminder, now: datetime | None = None) -> bool:
    calculated = reminder_status_at(reminder, now or datetime.now(REMINDER_TIMEZONE))
    if reminder.status != calculated:
        reminder.status = calculated
        reminder.updated_at = datetime.now(REMINDER_TIMEZONE).replace(tzinfo=None)
        return True
    return False


def reconcile_reminder_statuses(db: Session, reminders: list[models.Reminder] | None = None) -> None:
    candidates = reminders if reminders is not None else db.query(models.Reminder).filter(
        models.Reminder.status != "Done",
    ).all()
    now = datetime.now(REMINDER_TIMEZONE)
    changed = False
    for reminder in candidates:
        changed = refresh_reminder_status(reminder, now) or changed
    if changed:
        db.flush()


def can_manage_shared_reminders(user: models.User) -> bool:
    return role_can_manage_shared_reminders(user, is_admin(user))


def ensure_reminder_access(
    reminder_id: int,
    user: models.User,
    db: Session,
    *,
    lock: bool = False,
) -> models.Reminder:
    reminder = (
        db.query(models.Reminder)
        .filter(models.Reminder.reminder_id == reminder_id)
        .with_for_update()
        .first()
        if lock
        else db.get(models.Reminder, reminder_id)
    )
    if not reminder or not can_access_reminder(reminder, user):
        raise HTTPException(status_code=404, detail="Reminder not found")
    return reminder


def ensure_reminder_edit_access(reminder: models.Reminder, user: models.User) -> None:
    if not can_edit_reminder(reminder, user, can_manage_shared_reminders(user)):
        if reminder.visibility == "personal":
            raise HTTPException(status_code=404, detail="Reminder not found")
        raise HTTPException(status_code=403, detail="You cannot manage shared office reminders")


def validate_reminder_payload(payload: ReminderPayload) -> None:
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="Reminder title is required")
    if len(payload.title.strip()) > 200:
        raise HTTPException(status_code=422, detail="Reminder title must be 200 characters or fewer")
    if len(payload.description) > 4000:
        raise HTTPException(status_code=422, detail="Reminder notes must be 4,000 characters or fewer")
    if any(value and value.tzinfo is not None for value in (payload.start_time, payload.end_time)):
        raise HTTPException(status_code=422, detail="Reminder times must use local office time without a timezone offset")
    if payload.end_time and not payload.start_time:
        raise HTTPException(status_code=422, detail="An end time requires a start time")
    if payload.start_time and payload.end_time and payload.end_time <= payload.start_time:
        raise HTTPException(status_code=422, detail="End time must be later than start time")
    if payload.notification_minutes_before not in REMINDER_NOTIFICATION_LEADS | {None}:
        raise HTTPException(status_code=422, detail="Choose a supported notification time")


def reminder_payload(reminder: models.Reminder) -> dict[str, Any]:
    return {
        "reminder_id": reminder.reminder_id,
        "created_by_user_id": reminder.created_by_user_id,
        "title": reminder.title,
        "description": reminder.description or "",
        "date": reminder.reminder_date.isoformat(),
        "start_time": reminder.start_time.isoformat(timespec="minutes") if reminder.start_time else None,
        "end_time": reminder.end_time.isoformat(timespec="minutes") if reminder.end_time else None,
        "category": reminder.category,
        "priority": reminder.priority,
        "visibility": reminder.visibility,
        "notification_minutes_before": reminder.notification_minutes_before,
        "status": reminder.status,
        "created_at": reminder.created_at.isoformat() if reminder.created_at else None,
        "updated_at": reminder.updated_at.isoformat() if reminder.updated_at else None,
    }


def apply_reminder_payload(reminder: models.Reminder, payload: ReminderPayload) -> None:
    validate_reminder_payload(payload)
    reminder.title = payload.title.strip()
    reminder.description = payload.description.strip()
    reminder.reminder_date = payload.date
    reminder.start_time = payload.start_time
    reminder.end_time = payload.end_time
    reminder.category = payload.category
    reminder.priority = payload.priority
    reminder.visibility = payload.visibility
    reminder.notification_minutes_before = payload.notification_minutes_before
    if reminder.status not in {"Done", "Completed"}:
        refresh_reminder_status(reminder)
    else:
        reminder.status = "Done"
    reminder.updated_at = datetime.now(REMINDER_TIMEZONE).replace(tzinfo=None)


@app.get("/api/reminders")
def list_reminders(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    reminders = db.query(models.Reminder).filter(
        or_(
            models.Reminder.visibility == "shared",
            models.Reminder.created_by_user_id == user.user_id,
        )
    ).order_by(models.Reminder.reminder_date, models.Reminder.start_time, models.Reminder.reminder_id).all()
    reconcile_reminder_statuses(db, reminders)
    db.commit()
    return {
        "items": [reminder_payload(reminder) for reminder in reminders],
        "can_manage_shared": can_manage_shared_reminders(user),
    }


@app.get("/api/reminders/{reminder_id}")
def get_reminder(reminder_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    reminder = ensure_reminder_access(reminder_id, user, db)
    reconcile_reminder_statuses(db, [reminder])
    db.commit()
    return reminder_payload(reminder)


@app.post("/api/reminders")
def create_reminder(
    payload: ReminderPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    validate_reminder_payload(payload)
    if payload.visibility == "shared" and not can_manage_shared_reminders(user):
        raise HTTPException(status_code=403, detail="You cannot create shared office reminders")
    reminder = models.Reminder(created_by_user_id=user.user_id)
    apply_reminder_payload(reminder, payload)
    db.add(reminder)
    db.flush()
    write_audit(db, user.user_id, "Created Reminder", "reminder", reminder.title, str(reminder.reminder_id), request)
    db.commit()
    db.refresh(reminder)
    return reminder_payload(reminder)


@app.put("/api/reminders/{reminder_id}")
def update_reminder(
    reminder_id: int,
    payload: ReminderPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    reminder = ensure_reminder_access(reminder_id, user, db)
    ensure_reminder_edit_access(reminder, user)
    if payload.visibility == "shared" and not can_manage_shared_reminders(user):
        raise HTTPException(status_code=403, detail="You cannot create shared office reminders")
    prior_visibility = reminder.visibility
    apply_reminder_payload(reminder, payload)
    if prior_visibility == "shared" and reminder.visibility == "personal":
        db.query(models.Notification).filter(
            models.Notification.entity_type == "reminder",
            models.Notification.entity_id == str(reminder.reminder_id),
            models.Notification.user_id != reminder.created_by_user_id,
        ).delete(synchronize_session=False)
    write_audit(db, user.user_id, "Updated Reminder", "reminder", reminder.title, str(reminder.reminder_id), request)
    db.commit()
    db.refresh(reminder)
    return reminder_payload(reminder)


@app.patch("/api/reminders/{reminder_id}/complete")
def complete_reminder(
    reminder_id: int,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    reminder = ensure_reminder_access(reminder_id, user, db, lock=True)
    ensure_reminder_edit_access(reminder, user)
    if reminder.status in {"Done", "Completed"}:
        raise HTTPException(status_code=409, detail="This reminder is already completed")
    if not can_complete_reminder(
        reminder.reminder_date,
        reminder.start_time,
        reminder.status,
        datetime.now(REMINDER_TIMEZONE),
    ):
        raise HTTPException(status_code=400, detail="The reminder's scheduled time has not yet arrived")
    reminder.status = "Done"
    reminder.updated_at = datetime.now(REMINDER_TIMEZONE).replace(tzinfo=None)
    write_audit(db, user.user_id, "Completed Reminder", "reminder", reminder.title, str(reminder.reminder_id), request)
    db.commit()
    db.refresh(reminder)
    return reminder_payload(reminder)


@app.delete("/api/reminders/{reminder_id}")
def delete_reminder(
    reminder_id: int,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    reminder = ensure_reminder_access(reminder_id, user, db)
    ensure_reminder_edit_access(reminder, user)
    write_audit(db, user.user_id, "Deleted Reminder", "reminder", reminder.title, str(reminder.reminder_id), request)
    db.query(models.Notification).filter(
        models.Notification.entity_type == "reminder",
        models.Notification.entity_id == str(reminder.reminder_id),
    ).delete(synchronize_session=False)
    db.delete(reminder)
    db.commit()
    return {"ok": True}


def calendar_holiday_payload(holiday: models.CalendarHoliday) -> dict[str, Any]:
    return {
        "holiday_id": holiday.holiday_id,
        "source_key": holiday.source_key,
        "name": holiday.name,
        "date": holiday.holiday_date.isoformat(),
        "classification": holiday.classification,
        "coverage": holiday.coverage,
        "geographic_scope": holiday.geographic_scope,
        "reference": holiday.reference,
        "source_url": holiday.source_url,
        "year": holiday.year,
        "updated_at": holiday.updated_at.isoformat() if holiday.updated_at else None,
    }


@app.get("/api/holidays")
def list_calendar_holidays(
    year: int = Query(ge=1900, le=2200),
    _: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    holidays = db.query(models.CalendarHoliday).filter(
        models.CalendarHoliday.year == year,
    ).order_by(
        models.CalendarHoliday.holiday_date,
        models.CalendarHoliday.coverage,
        models.CalendarHoliday.name,
    ).all()
    return [
        {
            "holiday_id": holiday.holiday_id,
            "source_key": holiday.source_key,
            "name": holiday.name,
            "date": holiday.holiday_date.isoformat(),
            "classification": holiday.classification,
            "coverage": holiday.coverage,
            "geographic_scope": holiday.geographic_scope,
            "reference": holiday.reference,
            "source_url": holiday.source_url,
            "year": holiday.year,
            "updated_at": holiday.updated_at.isoformat() if holiday.updated_at else None,
        }
        for holiday in holidays
    ]


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
    range_query = apply_case_date_filters(scoped_case_query(db, user), date_from, date_to)
    range_terminated = range_query.filter((models.Case.is_terminated.is_(True)) | (models.Case.status_of_case == "Terminated")).count()
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
        "range_active_cases": max(cases_in_range - range_terminated, 0),
        "range_terminated_cases": range_terminated,
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
def dashboard_case_categories(user: models.User = Depends(current_user), db: Session = Depends(get_db), date_from: str | None = Query(None), date_to: str | None = Query(None)):
    rows = (
        apply_case_date_filters(scoped_case_query(db, user), date_from, date_to)
        .with_entities(models.IntakeRecord.nature_of_case, func.count(models.Case.case_id).label("total_cases"))
        .group_by(models.IntakeRecord.nature_of_case)
        .order_by(func.count(models.Case.case_id).desc())
        .all()
    )
    categories = [
        {"category": row.nature_of_case or "Uncategorized", "total_cases": row.total_cases}
        for row in rows
    ]
    return categories


@app.get("/api/dashboard/barangay-stats")
def dashboard_barangay_stats(user: models.User = Depends(current_user), db: Session = Depends(get_db), date_from: str | None = Query(None), date_to: str | None = Query(None)):
    from client_hotspots import client_hotspots
    return client_hotspots(analytics_client_query(db, user, date_from, date_to).all(), BARANGAY_CENTROIDS)[0]


@app.get("/api/dashboard/heatmap")
def dashboard_heatmap(user: models.User = Depends(current_user), db: Session = Depends(get_db), date_from: str | None = Query(None), date_to: str | None = Query(None)):
    from client_hotspots import client_hotspots
    stats, points = client_hotspots(analytics_client_query(db, user, date_from, date_to).all(), BARANGAY_CENTROIDS)
    return {"center": PANABO_CENTER, "points": points, "barangays": stats}


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
def dashboard_ocr_analytics(user: models.User = Depends(current_user), db: Session = Depends(get_db), date_from: str | None = Query(None), date_to: str | None = Query(None)):
    query = db.query(models.Document)
    if not is_admin(user):
        query = query.filter(models.Document.uploaded_by == user.user_id)
    start, end = parse_date(date_from), parse_date(date_to)
    if start:
        query = query.filter(models.Document.uploaded_at >= start)
    if end:
        query = query.filter(models.Document.uploaded_at < end + timedelta(days=1))
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
        scoped_case_query(db, user)
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
        status = normalize_case_status(record.status_of_case)
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

    # Serialize first-account creation across workers on the same database.
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
    user = db.query(models.User).filter((models.User.email == username) | (models.User.username == username)).first()
    def record_failed_login(reason: str) -> None:
        actor = user.user_id if user else None
        write_audit(db, actor, "Login Failed", "Authentication", reason, str(actor) if actor is not None else None, request)
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
                raise HTTPException(status_code=401, detail="Invalid MFA code" if otp_code else "MFA code required")
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
    # Store only the token digest, not a reusable bearer credential.
    payload_segment = token.split(".", 1)[0]
    expiry = int(json.loads(b64url_decode(payload_segment))["exp"])
    db.add(models.RevokedAccessToken(
        token_hash=hashlib.sha256(token.encode("utf-8")).hexdigest(),
        user_id=user.user_id,
        expires_at=datetime.fromtimestamp(expiry, timezone.utc).replace(tzinfo=None),
    ))
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
    # Require an exact active DB reference: stale files and guessed names are not readable.
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


@app.get("/api/admin/clients/unresolved-owners")
def list_unresolved_client_owners(
    response: Response, _: models.User = Depends(admin_user), db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "private, no-store"
    return [
        {"client_id": client.client_id, "name": client.name,
         "created_at": client.created_at,
         "interviewers": [
             {"user_id": person.user_id, "full_name": person.full_name}
             for person in db.query(models.User).filter(
                 models.User.user_id.in_({i.interviewer_id for i in client.intakes if i.interviewer_id is not None})
             ).order_by(models.User.user_id).all()
         ],
         "case_ids": sorted(case.case_id for case in client.cases)}
        for client in db.query(models.Client)
        .filter(models.Client.created_by_user_id.is_(None), models.Client.deleted_at.is_(None))
        .order_by(models.Client.client_id).all()
    ]


@app.get("/api/admin/clients/owner-candidates")
def list_client_owner_candidates(
    response: Response, _: models.User = Depends(admin_user), db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "private, no-store"
    return [
        {"user_id": person.user_id, "full_name": person.full_name, "email": person.email}
        for person in db.query(models.User).join(models.Role).filter(
            models.User.is_active.is_(True), models.User.approval_status == "approved",
        ).order_by(models.User.user_id).all() if not is_admin(person)
    ]


@app.post("/api/admin/clients/{client_id}/resolve-owner")
def resolve_client_owner(
    client_id: int, payload: ResolveClientOwnerPayload, request: Request,
    admin: models.User = Depends(admin_user), db: Session = Depends(get_db),
):
    reason = payload.reason.strip()
    evidence = payload.evidence_reference.strip()
    if not (10 <= len(reason) <= 1000) or not (3 <= len(evidence) <= 500):
        raise HTTPException(status_code=422, detail="Provide a reason (10–1000 characters) and trusted evidence reference (3–500 characters)")
    # PostgreSQL row lock serializes competing resolutions. Audit and owner change
    # commit together; a stale second request returns 409 without an audit entry.
    try:
        client = db.query(models.Client).filter(models.Client.client_id == client_id).with_for_update().first()
        if not client or client.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Client not found")
        if client.created_by_user_id is not None:
            raise HTTPException(status_code=409, detail="Owner already resolved; reload the investigation")
        owner = db.get(models.User, payload.owner_user_id)
        if not owner or not owner.is_active or owner.approval_status != "approved" or is_admin(owner):
            raise HTTPException(status_code=422, detail="Select an active approved staff owner")
        previous_owner = client.created_by_user_id
        client.created_by_user_id = owner.user_id
        write_audit(
            db, admin.user_id, "Resolve Client Owner", "client",
            json.dumps({"previous_owner_user_id": previous_owner, "new_owner_user_id": owner.user_id,
                        "reason": reason, "evidence_reference": evidence}, ensure_ascii=False),
            str(client_id), request,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"client_id": client_id, "previous_owner_user_id": previous_owner, "owner_user_id": owner.user_id}


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
def list_clients(request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    clients = scoped_client_query(db, user).order_by(models.Client.created_at.desc()).all()
    payload = [get_client_payload(client) for client in clients]
    write_audit(db, user.user_id, "Read Clients", "client",
                f"Loaded {len(clients)} client records", request=request)
    db.commit()
    return payload


@app.get("/api/clients/{client_id}")
def get_client(client_id: int, request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    client = ensure_client_access(db.get(models.Client, client_id), user, db)
    payload = get_client_payload(client)
    write_audit(db, user.user_id, "Read Client", "client", entity_id=str(client_id), request=request)
    db.commit()
    return payload


@app.get("/api/clients/{client_id}/cases")
def get_client_cases(
    client_id: int,
    request: Request,
    case_type: Literal["Criminal", "Civil", "All"] = Query(default="Criminal"),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    ensure_client_access(db.get(models.Client, client_id), user, db)
    query = (
        scoped_case_query(db, user)
        .outerjoin(models.CaseClient)
        .filter(or_(models.Case.client_id == client_id, models.CaseClient.client_id == client_id))
        .options(
            joinedload(models.Case.intake).selectinload(models.IntakeRecord.representatives),
            joinedload(models.Case.intake).selectinload(models.IntakeRecord.adverse_parties),
            joinedload(models.Case.client).selectinload(models.Client.details),
            joinedload(models.Case.client).selectinload(models.Client.classification),
            selectinload(models.Case.participants).joinedload(models.CaseClient.client).selectinload(models.Client.details),
            selectinload(models.Case.participants).joinedload(models.CaseClient.client).selectinload(models.Client.classification),
        )
    )
    if case_type != "All":
        query = query.filter(models.Case.case_type == case_type)
    records = query.order_by(models.Case.last_updated.desc()).distinct().all()
    payload = [get_case_payload(record) for record in records]
    write_audit(db, user.user_id, "Read Client Cases", "client",
                f"Loaded {len(payload)} linked case records", str(client_id), request)
    db.commit()
    return payload


@app.post("/api/clients/")
def create_client(
    payload: ClientPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    try:
        client_data = payload.client
        # Keep partially entered representative details intact on creation. The
        # representative normalizer is still used by the legacy update flow, but
        # a Civil Status value of "None" must not erase other submitted fields.
        details_data = normalize_spouse_details(dict(payload.client_details))
        class_data = payload.client_classification
        client = models.Client(
            created_by_user_id=user.user_id,
            name=client_data.get("name") or "Unnamed Client",
            age=client_data.get("age"),
            sex=client_data.get("sex") or "",
            civil_status=client_data.get("civil_status") or "",
            religion=client_data.get("religion") or "",
            educational_attainment=client_data.get("educational_attainment") or "",
            citizenship=client_data.get("citizenship") or "",
            language_dialect=client_data.get("language_dialect") or "",
        )
        reviewed_flags = reviewed_flag_input(class_data)
        db.add(client)
        db.flush()
        db.add(
            models.ClientDetails(
                client_id=client.client_id,
                address=details_data.get("address"),
                contact_no=details_data.get("contact_no"),
                email=details_data.get("email"),
                individual_monthly_income=details_data.get("individual_monthly_income"),
                spouse=none_if_not_applicable(details_data.get("spouse")),
                address_of_spouse=none_if_not_applicable(details_data.get("address_of_spouse")),
                contact_no_of_spouse=none_if_not_applicable(details_data.get("contact_no_of_spouse")),
                representative_name=none_if_not_applicable(details_data.get("representative_name")),
                representative_age=(
                    details_data.get("representative_age")
                    if details_data.get("representative_age") not in (None, "")
                    else None
                ),
                representative_sex=none_if_not_applicable(details_data.get("representative_sex")),
                representative_civil_status=none_if_not_applicable(details_data.get("representative_civil_status")),
                representative_address=none_if_not_applicable(details_data.get("representative_address")),
                representative_contact_no=none_if_not_applicable(details_data.get("representative_contact_no")),
                representative_relationship=none_if_not_applicable(details_data.get("representative_relationship")),
                representative_email=details_data.get("representative_email"),
                detained=bool(details_data.get("detained")),
                detained_since=parse_date(details_data.get("detained_since")),
                place_of_detention=details_data.get("place_of_detention"),
            )
        )
        db.add(
            models.ClientClassification(
                client_id=client.client_id,
                class_senior_citizen=reviewed_flags["flag_senior"] if reviewed_flags else None,
                class_cicl=reviewed_flags["flag_cicl"] if reviewed_flags else None,
                class_female=reviewed_flags["flag_female"] if reviewed_flags else None,
                flags_reviewed=reviewed_flags is not None,
                class_urban=False,
                class_rural=False,
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
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=f"Invalid client payload: {exc}") from exc
    commit_or_client_error(db, "create")
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
    try:
        apply_client_payload(client, payload)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=f"Invalid client update payload: {exc}") from exc
    write_audit(db, user.user_id, "Update Client", "client", f"{user.full_name or user.email or user.username} updated client {client.name}", str(client.client_id), request)
    commit_or_client_error(db, "update")
    db.refresh(client)
    return get_client_payload(client)


def validate_client_contact_number(
    value: Any,
    existing_value: Any = None,
    *,
    required: bool = False,
) -> None:
    if value == existing_value and existing_value not in (None, ""):
        return
    if value in (None, ""):
        if required:
            raise HTTPException(status_code=422, detail="Contact number is required.")
        return
    if not isinstance(value, str) or re.fullmatch(r"[0-9]{1,11}", value) is None:
        raise HTTPException(
            status_code=422,
            detail="Contact number must contain up to 11 digits using numbers only.",
        )


def attach_case_participants(
    record: models.Case,
    participants: list[tuple[models.Client, Any, Any, Any]],
) -> None:
    """Attach clients through the shared CaseClient relationship used by case creation."""
    for client, party_represented, applicant_role, applicant_role_other in participants:
        record.participants.append(
            models.CaseClient(
                client=client,
                party_represented=limit_text(party_represented, 100),
                applicant_role=applicant_role,
                applicant_role_other=applicant_role_other,
            )
        )


@app.post("/api/case-imports/preview")
async def preview_case_import(
    file: UploadFile = File(...),
    case_type: Literal["Criminal", "Civil"] = Form(...),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    filename = Path(file.filename or "").name
    if Path(filename).suffix.lower() not in {".xlsx", ".xls"}:
        raise HTTPException(status_code=422, detail="Choose an .xlsx or .xls file.")
    content = await file.read(MAX_WORKBOOK_BYTES + 1)
    try:
        source_rows, rows_processed, workbook_format = await run_in_threadpool(read_workbook, content, filename)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await file.close()

    control_numbers = [str(row.get("control_no") or "").strip() for row in source_rows]
    duplicate_types: dict[str, set[str]] = {}
    if control_numbers:
        duplicate_rows = (
            db.query(models.IntakeRecord.control_no, models.Case.case_type)
            .join(models.Case, models.Case.intake_id == models.IntakeRecord.intake_id)
            .filter(models.IntakeRecord.control_no.in_(set(filter(None, control_numbers))))
            .all()
        )
        for control_no, existing_type in duplicate_rows:
            duplicate_types.setdefault(str(control_no), set()).add(existing_type or "Criminal")

    grouped: OrderedDict[str, dict[str, Any]] = OrderedDict()
    for row in source_rows:
        control_no = str(row.get("control_no") or "").strip()
        group_key = control_no or f"__missing_control_{row['_row_number']}"
        group = grouped.setdefault(
            group_key,
            {
                "control_no": control_no, "source_rows": [], "clients": [], "conflicts": [],
                "conflict_values": {}, "fields": {}, "location_indicator_rows": [],
                "has_client_name_column": bool(row.get("_client_name_column_present")),
            },
        )
        group["source_rows"].append(row["_row_number"])
        shared_fields = (
            "title", "court", "case_no", "cause_of_action", "nature_of_case", "status", "last_action",
            "cause_of_termination", "date_of_termination", "date_of_confinement",
            "place_of_detention", "case_received", "location_type", "incident_barangay",
        )
        for field in shared_fields:
            value = row.get(field)
            if value in (None, ""):
                continue
            if field not in {"date_of_termination", "date_of_confinement", "case_received"}:
                value = str(value).strip()
            existing = group["fields"].get(field)
            if existing in (None, ""):
                group["fields"][field] = value
            elif str(existing).strip() != str(value).strip():
                if field not in group["conflicts"]:
                    group["conflicts"].append(field)
                values = group["conflict_values"].setdefault(field, [existing])
                if all(str(candidate).strip() != str(value).strip() for candidate in values):
                    values.append(value)
        client_values = {
            field: row.get(field)
            for field in (
                "client_name", "age", "sex", "civil_status", "religion", "educational_attainment",
                "citizenship", "language_dialect", "address", "contact_no", "relationship",
                "party_represented", "urban", "rural", "drugs", "female", "senior", "cicl",
            )
        }
        for field in (
            "client_name", "sex", "civil_status", "religion", "educational_attainment",
            "citizenship", "language_dialect", "address", "contact_no", "relationship", "party_represented",
        ):
            if client_values[field] not in (None, ""):
                client_values[field] = str(client_values[field]).strip()

        for flag in ("urban", "rural"):
            client_values[flag] = normalize_binary_indicator(client_values[flag])
        grouped[group_key]["location_indicator_rows"].append((client_values["urban"], client_values["rural"]))
        for flag in ("drugs", "female", "senior", "cicl"):
            client_values[flag] = normalize_binary_indicator(client_values[flag])
        client_values["location_indicators_present"] = bool(
            row.get("_urban_column_present") or row.get("_rural_column_present")
        )
        client_values["source_row"] = row["_row_number"]
        client_values["flags_reviewed"] = True
        client_values["possible_matches"] = []
        grouped[group_key]["clients"].append(client_values)

    # Only use title-derived names when there is no explicit Client Name column and
    # every source client row has a positional name match. This keeps personal data
    # attached to its original row and avoids shifting names on ambiguous titles.
    names_to_match = set()
    for group in grouped.values():
        clients = group["clients"]
        if not group["has_client_name_column"] and "title" not in group["conflicts"]:
            title_names = extract_case_title_client_names(group["fields"].get("title"))
            if title_names and len(title_names) == len(clients):
                for client, name in zip(clients, title_names):
                    client["client_name"] = name
        names_to_match.update(
            str(client.get("client_name") or "").strip().casefold()
            for client in clients if str(client.get("client_name") or "").strip()
        )

    clients_by_name: dict[str, list[models.Client]] = {}
    if names_to_match:
        existing_clients = (
            scoped_client_query(db, user)
            .options(joinedload(models.Client.details))
            .filter(func.lower(models.Client.name).in_(names_to_match))
            .order_by(models.Client.client_id)
            .all()
        )
        for existing_client in existing_clients:
            clients_by_name.setdefault(existing_client.name.strip().casefold(), []).append(existing_client)
    for group in grouped.values():
        for client in group["clients"]:
            name = str(client.get("client_name") or "").strip().casefold()
            client["possible_matches"] = [
                {
                    "client_id": candidate.client_id,
                    "name": candidate.name,
                    "age": candidate.age,
                    "sex": candidate.sex,
                    "address": candidate.details.address if candidate.details else None,
                }
                for candidate in clients_by_name.get(name, [])[:5]
            ]

    results = []
    for index, (key, group) in enumerate(grouped.items()):
        fields = dict(group["fields"])
        mapped_location, location_conflict = resolve_incident_location(group["location_indicator_rows"])
        for conflict in group["conflicts"]:
            fields[conflict] = ""
        fields["location_type"] = mapped_location or ""
        fields["incident_barangay"] = ""
        errors: list[str] = []
        if location_conflict:
            errors.append("Conflicting Urban/Rural indicators require Incident Location review.")
            group["conflict_values"]["incident_location_indicators"] = [
                f"Urban={urban or '(blank)'}, Rural={rural or '(blank)'}"
                for urban, rural in group["location_indicator_rows"]
            ]
        control_no = group["control_no"]
        if not control_no:
            errors.append("Control Number is missing.")
        elif len(control_no) > 20:
            errors.append("Control Number exceeds the 20-character database limit.")
        if not fields.get("title"):
            errors.append("Title of the Case is required.")
        elif len(str(fields.get("title"))) > 255:
            errors.append("Title of the Case exceeds the 255-character database limit.")
        if len(str(fields.get("case_no") or "")) > 20:
            errors.append("Case Number exceeds the 20-character database limit.")
        if len(str(fields.get("court") or "")) > 255:
            errors.append("Court / Body exceeds the 255-character database limit.")
        if str(fields.get("status") or "").strip().lower() not in {"pending", "terminated"}:
            errors.append("Status must be Pending or Terminated.")
        received = fields.get("case_received")
        if received in (None, ""):
            errors.append("Case Received date is required.")
        elif parse_date(received) is None:
            errors.append("Case Received date is invalid.")
        for date_field in ("date_of_termination", "date_of_confinement"):
            date_value = fields.get(date_field)
            if date_value not in (None, "") and parse_date(date_value) is None:
                errors.append(f"{date_field.replace('_', ' ').title()} is invalid.")
        for conflict in group["conflicts"]:
            errors.append(f"Conflicting {conflict.replace('_', ' ')} values share this Control Number.")
        if not group["clients"]:
            errors.append("At least one client row is required.")
        for client_index, client in enumerate(group["clients"]):
            if not str(client.get("client_name") or "").strip():
                errors.append(f"Client {client_index + 1}: Client Name is missing; enter it before import.")
            elif len(str(client.get("client_name"))) > 255:
                errors.append(f"Client {client_index + 1}: Client Name exceeds the 255-character database limit.")
            age = client.get("age")
            if age in (None, ""):
                errors.append(f"Client {client_index + 1}: Age is required for a new client.")
            else:
                try:
                    numeric_age = float(age)
                    if not numeric_age.is_integer() or numeric_age < 0 or numeric_age > 150:
                        raise ValueError
                except (TypeError, ValueError):
                    errors.append(f"Client {client_index + 1}: Age must be a whole number from 0 to 150.")
            sex = str(client.get("sex") or "").strip().lower()
            if sex not in {"m", "male", "f", "female"}:
                errors.append(f"Client {client_index + 1}: Gender / Sex is required and must be Male or Female.")
            for field, label in (
                ("civil_status", "Civil Status"),
                ("religion", "Religion"),
                ("educational_attainment", "Educational Attainment"),
                ("citizenship", "Citizenship"),
                ("language_dialect", "Language / Dialect"),
                ("address", "Address"),
            ):
                if not str(client.get(field) or "").strip():
                    errors.append(f"Client {client_index + 1}: {label} is required for a new client.")
            for field, label, max_length in (
                ("civil_status", "Civil Status", 50),
                ("religion", "Religion", 100),
                ("educational_attainment", "Educational Attainment", 150),
                ("citizenship", "Citizenship", 100),
                ("language_dialect", "Language / Dialect", 100),
                ("relationship", "Relationship to Applicant", 100),
            ):
                if len(str(client.get(field) or "")) > max_length:
                    errors.append(f"Client {client_index + 1}: {label} exceeds the {max_length}-character limit.")
            contact = str(client.get("contact_no") or "").strip()
            if not contact or re.fullmatch(r"[0-9]{1,11}", contact) is None:
                errors.append(f"Client {client_index + 1}: Contact Number is required and must contain up to 11 digits.")
            for flag in ("drugs", "female", "senior", "cicl"):
                flag_value = str(client.get(flag) or "").strip().lower()
                if flag_value and flag_value not in {"1", "0", "yes", "no", "true", "false", "y", "n"}:
                    errors.append(f"Client {client_index + 1}: {flag.title()} must be a yes/no value.")
            if any(client.get(flag) not in (None, "") for flag in ("female", "senior", "cicl")) and not client.get("flags_reviewed"):
                # The importing staff member confirms these tri-state classifications in the review UI.
                errors.append(f"Client {client_index + 1}: review the Female, Senior, and CICL indicators before import.")
        found_types = duplicate_types.get(control_no, set()) if control_no else set()
        duplicate = bool(found_types)
        duplicate_message = None
        if duplicate:
            duplicate_message = (
                "Control Number already exists in this case category."
                if case_type in found_types
                else "Control Number already exists under a different case category."
            )
        results.append(
            {
                "import_key": f"case-{index + 1}",
                "control_no": control_no,
                "title": fields.get("title") or "",
                "court": fields.get("court") or "",
                "case_no": fields.get("case_no") or "",
                "cause_of_action": fields.get("cause_of_action") or "",
                "nature_of_case": fields.get("nature_of_case") or "",
                "status": fields.get("status") or "",
                "last_action": fields.get("last_action") or "",
                "cause_of_termination": fields.get("cause_of_termination") or "",
                "date_of_termination": fields.get("date_of_termination") or "",
                "date_of_confinement": fields.get("date_of_confinement") or "",
                "place_of_detention": fields.get("place_of_detention") or "",
                "case_received": received or "",
                "location_type": fields.get("location_type") or "",
                "incident_barangay": fields.get("incident_barangay") or "",
                "incident_city": "Panabo City" if fields.get("location_type") or fields.get("incident_barangay") else "",
                "clients": group["clients"],
                "source_rows": group["source_rows"],
                "errors": errors,
                "conflicting_values": {
                    field: [value.isoformat() if isinstance(value, (date, datetime)) else str(value) for value in values]
                    for field, values in group["conflict_values"].items()
                },
                "duplicate": duplicate,
                "duplicate_message": duplicate_message,
                "ready": not errors and not duplicate,
            }
        )
    return {
        "source_filename": filename,
        "workbook_format": workbook_format,
        "case_type": case_type,
        "rows_processed": rows_processed,
        "cases": results,
        "summary": {
            "unique_cases": len(results),
            "client_records": sum(len(item["clients"]) for item in results),
            "ready_cases": sum(bool(item["ready"]) for item in results),
            "correction_cases": sum(bool(item["errors"]) for item in results),
            "duplicate_cases": sum(bool(item["duplicate"]) for item in results),
            "client_matches": sum(bool(client["possible_matches"]) for item in results for client in item["clients"]),
        },
    }


@app.post("/api/case-imports")
def import_case_records(
    payload: CaseImportPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    imported = created_clients = linked_clients = failed = 0
    held = max(0, payload.held_case_count)
    failures: list[dict[str, str]] = []
    urban_barangays = {
        "Cagangohan", "Datu Abdul Dadia", "Gredu (Poblacion)", "J.P. Laurel",
        "New Pandan (Poblacion)", "New Visayas", "Quezon", "San Francisco (Poblacion)",
        "San Vicente", "Salvacion", "Santo Nino (Poblacion)",
    }
    rural_barangays = {
        "A. O. Floirendo", "Buenavista", "Cacao", "Consolacion", "Dapco", "Kasilak",
        "Katipunan", "Katualan", "Kauswagan", "Kiotoy", "Little Panay",
        "Lower Panaga (Roxas)", "Mabunao", "Maduao", "Malativas", "Manay", "Nanyo",
        "New Malaga (Dalisay)", "New Malitbog", "San Nicolas", "San Pedro", "San Roque",
        "Santa Cruz", "Sindaton", "Southern Davao", "Tagpore", "Tibungol", "Upper Licanan", "Waterfall",
    }
    for entry in payload.cases:
        entry_case_type = entry.get("case_type")
        if entry_case_type not in (None, "", payload.case_type):
            failed += 1
            failures.append({
                "control_no": str(entry.get("control_no") or "(missing)"),
                "reason": "Case classification must match the selected import destination.",
            })
            continue
        control_no = str(entry.get("control_no") or "").strip()
        title = str(entry.get("title") or "").strip()
        status_raw = str(entry.get("status") or "").strip()
        clients = entry.get("clients") or []
        received_raw = entry.get("case_received")
        if (
            not control_no or len(control_no) > 20 or not title or len(title) > 255
            or str(entry.get("nature_of_case") or "").strip() not in {"Criminal", "Administrative", "Civil", "Labor", "Appeal"}
            or status_raw.lower() not in {"pending", "terminated"}
            or not clients or parse_date(received_raw) is None
            or len(str(entry.get("case_no") or "")) > 20
            or len(str(entry.get("court") or "")) > 255
            or any(
                entry.get(field) not in (None, "") and parse_date(entry.get(field)) is None
                for field in ("date_of_termination", "date_of_confinement")
            )
            or (entry.get("has_conflicts") and not entry.get("conflict_reviewed"))
        ):
            held += 1
            continue
        location_type = str(entry.get("location_type") or "").strip()
        incident_barangay = str(entry.get("incident_barangay") or "").strip()
        allowed_barangays = urban_barangays if location_type == "Urban" else rural_barangays if location_type == "Rural" else set()
        if location_type not in {"Urban", "Rural"} or not incident_barangay or incident_barangay not in allowed_barangays:
            held += 1
            failures.append({"control_no": control_no or "(missing)", "reason": "Review and select a valid Incident Location type and matching Panabo Barangay."})
            continue
        if (
            db.query(models.Case.case_id)
            .join(models.IntakeRecord, models.Case.intake_id == models.IntakeRecord.intake_id)
            .filter(models.IntakeRecord.control_no == control_no)
            .first()
        ):
            held += 1
            failures.append({"control_no": control_no, "reason": "Duplicate Control Number; existing record was not changed."})
            continue
        savepoint = db.begin_nested()
        case_created_clients = case_linked_clients = 0
        try:
            resolved_clients = []
            for client_data in clients:
                if len(str(client_data.get("party_represented") or "")) > 100:
                    raise ValueError("Party Represented exceeds the 100-character limit.")
                for indicator in ("drugs", "female", "senior", "cicl"):
                    raw_value = str(client_data.get(indicator) or "").strip().lower()
                    if raw_value and raw_value not in {"1", "0", "yes", "no", "true", "false", "y", "n"}:
                        raise ValueError(f"{indicator.title()} must be a yes/no value.")
                if any(client_data.get(flag) not in (None, "") for flag in ("female", "senior", "cicl")) and not client_data.get("flags_reviewed"):
                    raise ValueError("Review the Female, Senior, and CICL indicators before import.")
                client_id = client_data.get("existing_client_id")
                if client_id:
                    existing_client = scoped_client_query(db, user).filter(
                        models.Client.client_id == int(client_id)
                    ).first()
                    if not existing_client:
                        raise ValueError("A selected existing client is no longer available.")
                    selected_name = str(client_data.get("client_name") or "").strip()
                    if selected_name and existing_client.name.strip().casefold() != selected_name.casefold():
                        raise ValueError("The selected client name no longer matches the extracted client.")
                    resolved_clients.append((existing_client, client_data))
                    case_linked_clients += 1
                    continue
                client_name = str(client_data.get("client_name") or "").strip()
                if not client_name or len(client_name) > 255:
                    raise ValueError("Client Name is required and must be 255 characters or fewer.")
                for field, label, max_length in (
                    ("civil_status", "Civil Status", 50),
                    ("religion", "Religion", 100),
                    ("educational_attainment", "Educational Attainment", 150),
                    ("citizenship", "Citizenship", 100),
                    ("language_dialect", "Language / Dialect", 100),
                    ("relationship", "Relationship to Applicant", 100),
                ):
                    if len(str(client_data.get(field) or "")) > max_length:
                        raise ValueError(f"{label} exceeds the {max_length}-character limit.")
                age_value = client_data.get("age")
                if age_value in (None, ""):
                    raise ValueError("Age is required for a new client.")
                numeric_age = float(age_value)
                age = int(numeric_age)
                if not numeric_age.is_integer():
                    raise ValueError(f"Age for {client_name} must be a whole number.")
                if age is not None and (age < 0 or age > 150):
                    raise ValueError(f"Invalid age for {client_name}.")
                sex_value = str(client_data.get("sex") or "").strip().lower()
                if sex_value and sex_value not in {"m", "male", "f", "female"}:
                    raise ValueError(f"Invalid Gender / Sex for {client_name}.")
                if not sex_value:
                    raise ValueError("Gender / Sex is required for a new client.")
                for field, label in (
                    ("civil_status", "Civil Status"),
                    ("religion", "Religion"),
                    ("educational_attainment", "Educational Attainment"),
                    ("citizenship", "Citizenship"),
                    ("language_dialect", "Language / Dialect"),
                    ("address", "Address"),
                ):
                    if not str(client_data.get(field) or "").strip():
                        raise ValueError(f"{label} is required for a new client.")
                client = models.Client(
                    name=client_name,
                    age=age,
                    sex=normalize_sex(client_data.get("sex")),
                    civil_status=limit_text(client_data.get("civil_status"), 50),
                    religion=limit_text(client_data.get("religion"), 100),
                    educational_attainment=limit_text(client_data.get("educational_attainment"), 150),
                    citizenship=limit_text(client_data.get("citizenship"), 100),
                    language_dialect=limit_text(client_data.get("language_dialect"), 100),
                    created_by_user_id=user.user_id,
                )
                validate_client_contact_number(str(client_data.get("contact_no") or ""), required=True)
                client.details = models.ClientDetails(
                    address=limit_text(client_data.get("address"), 500),
                    contact_no=limit_text(client_data.get("contact_no"), 100),
                    representative_relationship=limit_text(client_data.get("relationship"), 100),
                )
                classification_flags = {
                    "drugs": "class_drug_related",
                    "female": "class_female",
                    "senior": "class_senior_citizen",
                    "cicl": "class_cicl",
                }
                classification_values = {}
                for input_name, model_name in classification_flags.items():
                    raw_flag = str(client_data.get(input_name) or "").strip().lower()
                    if raw_flag:
                        if input_name in {"female", "senior", "cicl"} and not client_data.get("flags_reviewed"):
                            raise ValueError("Review the Female, Senior, and CICL indicators before import.")
                        classification_values[model_name] = raw_flag in {"1", "yes", "true", "y"}
                if classification_values:
                    client.classification = models.ClientClassification(
                        **classification_values,
                        flags_reviewed=bool(client_data.get("flags_reviewed")),
                    )
                db.add(client)
                db.flush()
                resolved_clients.append((client, client_data))
                case_created_clients += 1
            primary_client = resolved_clients[0][0]
            party = limit_text(resolved_clients[0][1].get("party_represented"), 100)
            form_date = parse_date(received_raw)
            intake = models.IntakeRecord(
                client_id=primary_client.client_id,
                interviewer_id=user.user_id,
                control_no=control_no,
                form_date=form_date,
                party_represented=party,
                applicant_role=party,
                nature_of_case=limit_text(entry.get("nature_of_case"), 50),
            )
            db.add(intake)
            db.flush()
            db.add(
                models.Representative(
                    intake_id=intake.intake_id,
                    rep_name="Not applicable",
                    relationship_to_applicant=limit_text(resolved_clients[0][1].get("relationship"), 50),
                )
            )
            normalized_status = normalize_case_status(status_raw)
            record = models.Case(
                intake_id=intake.intake_id,
                client_id=primary_client.client_id,
                case_type=payload.case_type,
                title_of_case=title,
                case_no=limit_text(entry.get("case_no"), 20),
                court_body=limit_text(entry.get("court"), 255),
                cause_of_action=entry.get("cause_of_action"),
                status_of_case=normalized_status,
                case_status=normalized_status,
                last_action_taken=entry.get("last_action"),
                cause_of_termination=entry.get("cause_of_termination"),
                date_of_termination=parse_date(entry.get("date_of_termination")),
                date_of_confinement=parse_date(entry.get("date_of_confinement")),
                place_of_detention=limit_text(entry.get("place_of_detention"), 255),
                incident_barangay=incident_barangay or None,
                incident_city="Panabo City" if location_type or incident_barangay else None,
                location_type=location_type or None,
                detained=bool(entry.get("date_of_confinement") or entry.get("place_of_detention")),
                pending_in_court=normalized_status == "Pending",
                is_terminated=normalized_status == "Terminated",
            )
            db.add(record)
            db.flush()
            attach_case_participants(
                record,
                [
                    (
                        participant,
                        limit_text(participant_data.get("party_represented"), 100),
                        limit_text(participant_data.get("party_represented"), 100),
                        None,
                    )
                    for participant, participant_data in resolved_clients
                ],
            )
            db.add(
                models.CaseHistory(
                    case_id=record.case_id,
                    updated_by=user.user_id,
                    previous_status=None,
                    new_status=normalized_status,
                    action_taken=record.last_action_taken or "Case imported from Excel",
                    remarks=f"Initial case record imported by {display_role_name(user)}",
                )
            )
            db.flush()
            savepoint.commit()
            imported += 1
            created_clients += case_created_clients
            linked_clients += case_linked_clients
        except Exception as exc:
            savepoint.rollback()
            held += 1
            failed += 1
            reason = str(exc) if isinstance(exc, ValueError) else "Database error; the case and its new clients were rolled back."
            failures.append({"control_no": control_no or "(missing)", "reason": reason[:240]})

    source_filename = Path(payload.source_filename or "").name[:255]
    write_audit(
        db,
        user.user_id,
        "Import Excel Cases",
        "case_import",
        f"Imported {imported} {payload.case_type} cases from {source_filename}; created {created_clients} client records, linked {linked_clients}, held {held}, skipped {max(0, payload.duplicate_case_count)} possible duplicates.",
        source_filename,
        request,
    )
    db.commit()
    return {
        "case_type": payload.case_type,
        "cases_imported": imported,
        "clients_created": created_clients,
        "existing_clients_linked": linked_clients,
        "cases_held": held,
        "duplicate_cases_skipped": max(0, payload.duplicate_case_count),
        "failed_records": failed,
        "failures": failures,
    }


@app.get("/api/cases/")
def list_cases(
    request: Request,
    case_type: Literal["Criminal", "Civil", "All"] = Query(default="Criminal"),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    query = scoped_case_query(db, user)
    if case_type != "All":
        query = query.filter(models.Case.case_type == case_type)
    records = query.order_by(models.Case.last_updated.desc()).all()
    payload = [get_case_payload(record) for record in records]
    write_audit(db, user.user_id, "Read Cases", "case",
                f"Loaded {len(payload)} case records", request=request)
    db.commit()
    return payload


@app.get("/api/cases/paged")
def list_cases_paged(
    request: Request,
    case_type: Literal["Criminal", "Civil", "All"] = Query(default="Criminal"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    search: str = Query(default="", max_length=200),
    gender: Literal["All", "Male", "Female"] = Query(default="All"),
    location: Literal["All", "Urban", "Rural"] = Query(default="All"),
    court: str = Query(default="All", max_length=255),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    include_details: bool = Query(default=False),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Return a bounded, filtered case page for table views."""
    query = scoped_case_query(db, user).filter(
        models.Case.is_terminated.is_not(True),
        models.Case.status_of_case != "Terminated",
    )
    if case_type != "All":
        query = query.filter(models.Case.case_type == case_type)
    if location != "All":
        query = query.filter(models.Case.location_type == location)
    if court and court != "All":
        query = query.filter(models.Case.court_body == court)
    if gender != "All":
        sex_values = ("m", "male") if gender == "Male" else ("f", "female")
        query = query.filter(or_(
            models.Case.client.has(func.lower(func.trim(models.Client.sex)).in_(sex_values)),
            models.Case.participants.any(
                models.CaseClient.client.has(func.lower(func.trim(models.Client.sex)).in_(sex_values))
            ),
        ))
    normalized_search = search.strip()
    if normalized_search:
        escaped_search = normalized_search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        term = f"%{escaped_search}%"
        query = query.filter(or_(
            models.Case.case_no.ilike(term, escape="\\"),
            models.Case.title_of_case.ilike(term, escape="\\"),
            models.Case.court_body.ilike(term, escape="\\"),
            models.Case.cause_of_action.ilike(term, escape="\\"),
            models.Case.intake.has(models.IntakeRecord.control_no.ilike(term, escape="\\")),
            models.Case.client.has(models.Client.name.ilike(term, escape="\\")),
            models.Case.participants.any(models.CaseClient.client.has(models.Client.name.ilike(term, escape="\\"))),
        ))
    date_column = func.coalesce(models.IntakeRecord.form_date, models.Case.last_updated)
    if date_from:
        query = query.filter(date_column >= datetime.combine(date_from, time.min))
    if date_to:
        query = query.filter(date_column < datetime.combine(date_to + timedelta(days=1), time.min))

    total = query.order_by(None).count()
    eager_options = [
        joinedload(models.Case.intake).selectinload(models.IntakeRecord.representatives),
        joinedload(models.Case.intake).selectinload(models.IntakeRecord.adverse_parties),
        joinedload(models.Case.client).selectinload(models.Client.details),
        joinedload(models.Case.client).selectinload(models.Client.classification),
        selectinload(models.Case.participants).joinedload(models.CaseClient.client).selectinload(models.Client.details),
        selectinload(models.Case.participants).joinedload(models.CaseClient.client).selectinload(models.Client.classification),
    ] if include_details else [
        joinedload(models.Case.intake),
        joinedload(models.Case.client),
        selectinload(models.Case.participants).joinedload(models.CaseClient.client),
    ]
    records = (
        query.options(*eager_options)
        .order_by(models.Case.last_updated.desc().nullslast(), models.Case.case_id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    payload = [get_case_payload(record) for record in records] if include_details else [get_case_list_item(record) for record in records]
    write_audit(
        db,
        user.user_id,
        "Read Cases",
        "case",
        f"Loaded page {page} with {len(records)} of {total} matching case records",
        request=request,
    )
    db.commit()
    return {"items": payload, "total": total, "page": page, "page_size": page_size}


@app.get("/api/cases/by-id/{case_id}")
def get_case_record(
    case_id: int,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    record = (
        scoped_case_query(db, user)
        .filter(models.Case.case_id == case_id)
        .options(
            joinedload(models.Case.intake).selectinload(models.IntakeRecord.representatives),
            joinedload(models.Case.intake).selectinload(models.IntakeRecord.adverse_parties),
            joinedload(models.Case.client).selectinload(models.Client.details),
            joinedload(models.Case.client).selectinload(models.Client.classification),
            selectinload(models.Case.participants).joinedload(models.CaseClient.client).selectinload(models.Client.details),
            selectinload(models.Case.participants).joinedload(models.CaseClient.client).selectinload(models.Client.classification),
        )
        .first()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Case record not found")
    payload = get_case_payload(record)
    write_audit(db, user.user_id, "Read Case", "case", entity_id=str(case_id), request=request)
    db.commit()
    return payload


@app.get("/api/cases/terminated")
def list_terminated_cases(
    request: Request,
    case_type: Literal["Criminal", "Civil", "All"] = Query(default="Criminal"),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    query = (
        scoped_case_query(db, user)
        .filter((models.Case.is_terminated.is_(True)) | (models.Case.status_of_case == "Terminated"))
    )
    if case_type != "All":
        query = query.filter(models.Case.case_type == case_type)
    records = query.order_by(models.Case.terminated_at.desc().nullslast(), models.Case.last_updated.desc()).all()
    payload = [get_case_payload(record) for record in records]
    write_audit(db, user.user_id, "Read Terminated Cases", "case",
                f"Loaded {len(payload)} terminated case records", request=request)
    db.commit()
    return payload


@app.get("/api/printable-intake/{case_id}")
def get_printable_intake(
    case_id: int,
    request: Request,
    client_id: int | None = Query(default=None),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    record = ensure_case_access(db.get(models.Case, case_id), user)
    selected_client = record.client
    selected_participant = None
    if client_id is not None:
        selected_participant = next(
            (
                participant
                for participant in case_participants(record)
                if participant.client_id == client_id
            ),
            None,
        )
        if selected_participant is None:
            raise HTTPException(status_code=404, detail="Case participant not found")
        selected_client = ensure_client_access(
            selected_participant.client or db.get(models.Client, client_id),
            user,
            db,
        )
    if not selected_client:
        raise HTTPException(status_code=404, detail="Case client not found")
    cases = (
        scoped_case_query(db, user)
        .outerjoin(models.CaseClient, models.Case.case_id == models.CaseClient.case_id)
        .filter(models.Case.case_type == normalize_case_type(getattr(record, "case_type", "Criminal")))
        .filter(
            or_(
                models.Case.client_id == selected_client.client_id,
                models.CaseClient.client_id == selected_client.client_id,
            )
        )
        .distinct()
        .order_by(models.Case.last_updated.desc())
        .all()
    )
    selected_case = get_case_payload(record)
    if selected_participant is not None:
        involvement = selected_participant.applicant_role or ""
        selected_case["client_id"] = str(selected_client.client_id)
        selected_case["intake_record"]["party_represented"] = (
            selected_participant.party_represented
            or represented_party_from_role(
                selected_participant.applicant_role,
                selected_participant.applicant_role_other,
            )
            or ""
        )
        selected_case["intake_record"]["applicant_role"] = involvement
        selected_case["intake_record"]["applicant_role_other"] = (
            selected_participant.applicant_role_other or ""
        )
        for role_key, role_name in [
            ("inv_plaintiff", "Plaintiff"),
            ("inv_defendant", "Defendant"),
            ("inv_oppositor", "Oppositor"),
            ("inv_petitioner", "Petitioner"),
            ("inv_respondent", "Respondent"),
            ("inv_complainant", "Complainant"),
            ("inv_accused", "Accused"),
        ]:
            selected_case["intake_record"][role_key] = involvement == role_name
        selected_case["intake_record"]["inv_others"] = (
            selected_participant.applicant_role_other
            if involvement == "Others"
            else ""
        )
    payload = {
        "client": get_client_payload(selected_client),
        "selected_case": selected_case,
        "cases": [get_case_payload(case) for case in cases],
        "templates": {
            "english": read_form_template("english"),
            "filipino": read_form_template("filipino"),
        },
    }
    write_audit(db, user.user_id, "Read Printable Intake", "case", entity_id=str(case_id), request=request)
    db.commit()
    return payload


@app.post("/api/cases/")
def create_case(
    payload: CasePayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    try:
        primary_client_id = int(payload.client_id)
        participant_ids: list[int] = []
        for raw_client_id in [primary_client_id, *(payload.client_ids or [])]:
            participant_id = int(raw_client_id)
            if participant_id not in participant_ids:
                participant_ids.append(participant_id)
        client = ensure_client_access(db.get(models.Client, primary_client_id), user, db)
        participant_clients = []
        for participant_id in participant_ids:
            participant_clients.append(
                ensure_client_access(db.get(models.Client, participant_id), user, db)
            )

        client_representatives: dict[str, dict[str, Any]] = {}
        for entry in payload.client_representatives or []:
            participant_id = str(entry.get("client_id") or "")
            if participant_id not in {str(value) for value in participant_ids}:
                raise HTTPException(status_code=422, detail="Representative data references an unselected client.")
            if participant_id in client_representatives:
                raise HTTPException(status_code=422, detail="Representative data contains a duplicate client.")
            representative_data = entry.get("representative")
            client_representatives[participant_id] = (
                representative_data if isinstance(representative_data, dict) else {}
            )

        intake_data = payload.intake_record
        rep_data = payload.representative
        case_data = payload.cases
        case_type = normalize_case_type(payload.case_type)
        normalized_status = normalize_case_status(case_data.get("status_of_case") or case_data.get("case_status"))
        confinement_date, detention_place = detention_fields_for_client(client, case_data)
        case_detained = (
            bool(case_data.get("detained"))
            if "detained" in case_data
            else bool(confinement_date or detention_place)
        )
        represented_party = intake_data.get("party_represented") or (
            intake_data.get("applicant_role_other")
            if intake_data.get("applicant_role") == "Others"
            else intake_data.get("applicant_role")
        )
        representative_none = is_none_value(rep_data.get("civil_status"))

        intake = models.IntakeRecord(
            client_id=primary_client_id,
            interviewer_id=user.user_id,
            control_no=limit_text(intake_data.get("control_no"), 20),
            form_date=parse_date(intake_data.get("form_date"), datetime.now()) or datetime.now(),
            region=intake_data.get("region"),
            district_office=limit_text(intake_data.get("district_office"), 255),
            party_represented=limit_text(represented_party, 50),
            applicant_role=intake_data.get("applicant_role"),
            applicant_role_other=intake_data.get("applicant_role_other"),
            nature_of_request=intake_data.get("nature_of_request"),
            nature_of_case=limit_text(intake_data.get("nature_of_case"), 50),
            coi_agree_different_office=False,
            coi_agree_same_dept_appeal=False,
            coi_waive_right_to_complain=False,
            coi_trust_assigned_counsel=False,
            proof_submission_deadline=parse_date(intake_data.get("proof_submission_deadline")),
            proof_submission_satisfied=bool(intake_data.get("proof_submission_satisfied")),
            proof_itr_satisfied=bool(intake_data.get("proof_itr_satisfied")),
            proof_itr_date=parse_date(intake_data.get("proof_itr_date")),
            proof_brgy_satisfied=bool(intake_data.get("proof_brgy_satisfied")),
            proof_brgy_date=parse_date(intake_data.get("proof_brgy_date")),
            proof_dswd_satisfied=bool(intake_data.get("proof_dswd_satisfied")),
            proof_dswd_date=parse_date(intake_data.get("proof_dswd_date")),
            proof_others_satisfied=bool(intake_data.get("proof_others_satisfied")),
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
                rep_name="None" if representative_none else rep_data.get("rep_name") or "Not applicable",
                rep_age=rep_data.get("rep_age") or None,
                rep_sex="None" if representative_none else normalize_sex(rep_data.get("rep_sex")),
                civil_status="None" if representative_none else rep_data.get("civil_status"),
                rep_address="None" if representative_none else rep_data.get("rep_address"),
                rep_contact_no="None" if representative_none else rep_data.get("rep_contact_no"),
                relationship_to_applicant="None" if representative_none else limit_text(rep_data.get("relationship_to_applicant"), 50),
            )
        )

        record = models.Case(
            intake_id=intake.intake_id,
            client_id=primary_client_id,
            case_type=case_type,
            title_of_case=generated_case_title(client, case_type),
            case_no=limit_text(case_data.get("case_no"), 20),
            court_body=case_data.get("court_body"),
            status_of_case=normalized_status,
            case_status=normalized_status,
            incident_barangay=case_data.get("incident_barangay"),
            incident_city=limit_text(case_data.get("incident_city"), 120),
            incident_address=case_data.get("incident_address"),
            latitude=str(case_data.get("latitude")) if case_data.get("latitude") not in (None, "") else None,
            longitude=str(case_data.get("longitude")) if case_data.get("longitude") not in (None, "") else None,
            last_action_taken=case_data.get("last_action_taken"),
            detained=case_detained,
            date_of_confinement=confinement_date,
            place_of_detention=detention_place,
            location_type=case_data.get("location_type"),
            cause_of_action=case_data.get("cause_of_action"),
            facts_of_case=case_data.get("facts_of_case"),
            pending_in_court=normalized_status == "Pending",
            cause_of_termination=case_data.get("cause_of_termination"),
            date_of_termination=parse_date(case_data.get("date_of_termination")),
            assigned_pao=case_data.get("assigned_pao"),
            hearing_schedule=case_data.get("hearing_schedule"),
            remarks=case_data.get("remarks"),
        )
        db.add(record)
        db.flush()
        for participant_client in participant_clients:
            participant_rep = client_representatives.get(str(participant_client.client_id), {})
            participant_rep_none = is_none_value(participant_rep.get("civil_status"))
            record.participants.append(
                models.CaseClient(
                    client=participant_client,
                    party_represented=limit_text(represented_party, 100),
                    applicant_role=intake.applicant_role,
                    applicant_role_other=intake.applicant_role_other,
                    representative_name=(
                        "None" if participant_rep_none else participant_rep.get("rep_name") or None
                    ),
                    representative_age=participant_rep.get("rep_age") or None,
                    representative_sex=(
                        "None" if participant_rep_none else normalize_sex(participant_rep.get("rep_sex"))
                    ),
                    representative_civil_status=(
                        "None" if participant_rep_none else participant_rep.get("civil_status") or None
                    ),
                    representative_address=(
                        "None" if participant_rep_none else participant_rep.get("rep_address") or None
                    ),
                    representative_contact_no=(
                        "None" if participant_rep_none else participant_rep.get("rep_contact_no") or None
                    ),
                    representative_relationship=(
                        "None" if participant_rep_none
                        else limit_text(participant_rep.get("relationship_to_applicant"), 100)
                    ),
                    representative_email=(
                        "None" if participant_rep_none else participant_rep.get("rep_email") or None
                    ),
                )
            )
            participant_has_representative = any(
                str(participant_rep.get(field) or "").strip()
                for field in (
                    "rep_name", "rep_sex", "civil_status", "rep_address",
                    "rep_contact_no", "relationship_to_applicant", "rep_email",
                )
            ) or bool(participant_rep.get("rep_age"))
            if payload.client_representatives is None and participant_client.client_id == client.client_id:
                participant_rep = rep_data
                participant_has_representative = True
                participant_rep_none = representative_none
            if participant_has_representative:
                update_latest_client_representative(
                    participant_client,
                    participant_rep,
                    participant_rep_none,
                )
        db.flush()
        record.title_of_case = generated_case_title_for_case(record)
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
        write_audit(db, user.user_id, "Create Case", "case", f"{user.full_name or user.email or user.username} created {case_type} Case #{record.case_id}", str(record.case_id), request)
    except HTTPException:
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=f"Invalid case payload: {exc}") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Database error while creating case. Check duplicate control number or missing migrated columns.") from exc

    commit_or_case_error(db, "create")
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
    created_by_user_id = record.intake.interviewer_id if record.intake else None
    previous_status = record.status_of_case
    try:
        apply_case_payload(record, payload)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid case update payload: {exc}") from exc
    actor_name = user.full_name or user.email or user.username
    case_type = normalize_case_type(getattr(record, "case_type", "Criminal"))
    if created_by_user_id and created_by_user_id != user.user_id:
        description = (
            f"{actor_name} collaboratively updated {case_type} Case #{record.case_id} "
            f"originally created by User #{created_by_user_id}"
        )
    else:
        description = f"{actor_name} updated {case_type} Case #{record.case_id}"
    db.add(
        models.CaseHistory(
            case_id=record.case_id,
            updated_by=user.user_id,
            previous_status=previous_status,
            new_status=record.status_of_case or "Pending",
            action_taken=record.last_action_taken or "Case updated",
            remarks="Case updated from workspace",
        )
    )
    write_audit(db, user.user_id, "Update Case", "case", description, str(record.case_id), request)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        detail = "Case update conflicts with an existing record. Check duplicate control number or case number."
        raise HTTPException(status_code=409, detail=detail) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Database error while updating case. Please retry after refreshing the page.") from exc
    db.refresh(record)
    return get_case_payload(record)


@app.post("/api/cases/{case_id}/clients")
def attach_client_to_case(
    case_id: int,
    payload: CaseClientPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    record = ensure_case_access(db.get(models.Case, case_id), user)
    try:
        client_id = int(payload.client_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid client id") from exc
    client = ensure_client_access(db.get(models.Client, client_id), user, db)
    existing = (
        db.query(models.CaseClient)
        .filter(models.CaseClient.case_id == record.case_id, models.CaseClient.client_id == client.client_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Client is already attached to this case")

    applicant_role = payload.applicant_role or payload.party_represented or "Accused"
    represented_party = payload.party_represented or represented_party_from_role(
        applicant_role,
        payload.applicant_role_other,
    )
    try:
        record.participants.append(
            models.CaseClient(
                client=client,
                party_represented=limit_text(represented_party, 100),
                applicant_role=applicant_role,
                applicant_role_other=payload.applicant_role_other,
            )
        )
        db.flush()
        record.title_of_case = generated_case_title_for_case(record)
        record.last_updated = datetime.now()
        write_audit(
            db,
            user.user_id,
            "Attach Client to Case",
            "case",
            f"{user.full_name or user.email or user.username} attached client #{client.client_id} to Criminal Case #{record.case_id}",
            str(record.case_id),
            request,
        )
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Client is already attached to this case") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Database error while attaching client to case") from exc

    commit_or_case_error(db, "attach client to")
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
    created_by_user_id = record.intake.interviewer_id if record.intake else None
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
    actor_name = user.full_name or user.email or user.username
    case_type = normalize_case_type(getattr(record, "case_type", "Criminal"))
    if created_by_user_id and created_by_user_id != user.user_id:
        description = (
            f"{actor_name} collaboratively terminated {case_type} Case #{record.case_id} "
            f"originally created by User #{created_by_user_id}"
        )
    else:
        description = f"{actor_name} terminated {case_type} Case #{record.case_id}"
    write_audit(db, user.user_id, "Terminate Case", "case", description, str(record.case_id), request)
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
        export_event = row.action.startswith("Export ") or row.action == "Print Form"
        module = "Export" if export_event or "export" in target_key else module_labels.get(target_key, target or "Admin")
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
    if payload.action not in {"Export Excel", "Export CSV", "Export PDF", "Export PNG", "Print Form"} or payload.module != "Export":
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
    elif scope not in {"criminal_case_export", "terminated_case_export", "analytics_chart_export", "staff_report_export", "admin_report_export"}:
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
                raise HTTPException(status_code=400, detail="Intake record does not exist. Save the intake record before attaching a document.")
            if not is_admin(user) and intake.interviewer_id != user.user_id:
                raise HTTPException(status_code=403, detail="Record access denied")

        original_name = Path(file.filename or "uploaded-document").name
        extension = Path(original_name).suffix.lower()
        if extension not in DOCUMENT_CONTENT_TYPES or file.content_type not in DOCUMENT_CONTENT_TYPES[extension]:
            raise HTTPException(status_code=400, detail="Unsupported file type. Upload a JPG, PNG, WEBP, or PDF document.")
        if extension == ".pdf" and extraction_mode == "cloud":
            raise HTTPException(status_code=400, detail="Cloud mode does not support PDFs. Select offline or auto mode.")

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
            if extraction_target != 'paper_intake' or ocr_image is not None:
                raise HTTPException(400, 'Use one PAO image preparation method at a time.')
            from paper_capture import build_ocr_image, PaperCropError
            processing_location = UPLOAD_DIR / f'{uuid.uuid4()}-paper-crop.jpg'
            try:
                plan = json.loads(crop_plan)
                processing = await asyncio.to_thread(build_ocr_image, original_location, plan, processing_location)
            except (ValueError, PaperCropError) as exc:
                raise HTTPException(422, str(exc)) from exc
        if ocr_image is not None:
            processing_extension = Path(ocr_image.filename or '').suffix.lower()
            if processing_extension not in ('.jpg', '.jpeg', '.png', '.webp') or ocr_image.content_type not in DOCUMENT_CONTENT_TYPES.get(processing_extension, set()):
                raise HTTPException(status_code=400, detail='The selected OCR image must be a JPG, PNG, or WEBP image.')
            processing_location = UPLOAD_DIR / f'{uuid.uuid4()}-ocr{processing_extension}'
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
            str(processing_location or original_location), extraction_mode, extraction_target, is_disconnected=request.is_disconnected
        )
        if processing:
            from paper_capture import remap_field_evidence
            remap_field_evidence(extracted_json, processing)
        public_extracted_json = public_extraction_payload(extracted_json)
        public_extracted_json.setdefault('diagnostics', {})['image_preparation'] = {
            'original_retained': True, 'selected_copy': processing_location is not None and processing is None,
        }

        db.add(
            models.ExtractedMetadata(
                document_id=new_document.document_id,
                extracted_json=public_extracted_json,
                verification_status="PENDING",
            )
        )

        draft_id = store_paper_draft(db, new_document.document_id, public_extracted_json) if extraction_target == "paper_intake" else None
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
            "message": "Document uploaded; OCR needs review." if new_document.ocr_status == "FAILED" else "Document processed successfully!",
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


def store_paper_draft(db, document_id, extracted):
    from paper_provenance import canonical_digest
    draft_id = canonical_digest({'document_id': document_id, 'extraction': extracted})
    if db.get(models.PaperExtractionDraft, draft_id) is None:
        db.add(models.PaperExtractionDraft(draft_id=draft_id, document_id=document_id, extraction_json=extracted))
    return draft_id


def reviewed_candidate_source(db, payload, fallback=None):
    if payload.source_draft_id is None:
        return fallback
    draft = db.get(models.PaperExtractionDraft, payload.source_draft_id)
    if draft is None or draft.document_id != payload.document_id:
        raise HTTPException(422, 'The extraction draft does not match this original scan. Re-extract and review again.')
    return draft.extraction_json


@app.get('/api/pao-intakes/schema')
def paper_intake_schema(user: models.User = Depends(current_user)):
    from paper_intake import SCHEMA
    return SCHEMA


@app.post('/api/pao-intakes/prepare-camera')
async def prepare_camera_image(file: UploadFile = File(...), user: models.User = Depends(current_user)):
    from camera_preparation import prepare_capture
    extension = Path(file.filename or '').suffix.lower()
    if extension not in ('.jpg', '.jpeg', '.png', '.webp') or file.content_type not in DOCUMENT_CONTENT_TYPES.get(extension, set()):
        raise HTTPException(400, 'Camera review requires a JPG, PNG or WEBP capture.')
    source = UPLOAD_DIR / f'{uuid.uuid4()}-camera{extension}'
    try:
        save_bounded_upload(file.file, source, MAX_DOCUMENT_BYTES)
        verify_image(source, extension)
        return await asyncio.to_thread(prepare_capture, source)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        source.unlink(missing_ok=True)


def authorized_paper_document(document_id: int, user: models.User, db: Session):
    document = db.get(models.Document, document_id)
    if not document:
        raise HTTPException(404, 'Document not found')
    saved = db.query(models.ReviewedPaperIntake).filter_by(document_id=document_id).first()
    if document.case_id is not None:
        ensure_case_access(db.get(models.Case, document.case_id), user)
    elif document.intake_id is not None and not is_admin(user):
        intake = db.get(models.IntakeRecord, document.intake_id)
        if not intake or intake.interviewer_id != user.user_id:
            raise HTTPException(403, 'Record access denied')
    elif saved:
        ensure_client_access(db.get(models.Client, saved.client_id), user, db)
    elif not is_admin(user) and document.uploaded_by != user.user_id:
        raise HTTPException(403, 'Record access denied')
    location = Path(document.encrypted_file_path).resolve()
    if not location.is_relative_to(UPLOAD_DIR.resolve()) or not location.is_file():
        raise HTTPException(404, 'Document not found')
    return location, document.document_type


def read_archived_document(location: Path) -> bytes:
    from cryptography.exceptions import InvalidTag
    from document_storage import read_document

    try:
        return read_document(location)
    except (InvalidTag, RuntimeError, OSError, ValueError) as exc:
        raise HTTPException(503, "The archived document could not be opened.") from exc


@app.get('/api/pao-intakes/documents/{document_id}')
def paper_intake_scan(document_id: int, request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    location, media_type = authorized_paper_document(document_id, user, db)
    headers = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}
    response = (
        Response(read_archived_document(location), media_type=media_type, headers=headers)
        if location.suffix == ".enc" else FileResponse(location, media_type=media_type, headers=headers)
    )
    write_audit(db, user.user_id, "Read Document", "document", entity_id=str(document_id), request=request)
    db.commit()
    return response


@app.get('/api/pao-intakes/documents/{document_id}/pages/{page_number}')
def paper_intake_page(document_id: int, page_number: int, request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """Render at the same scale as local OCR so evidence boxes share coordinates."""
    location, media_type = authorized_paper_document(document_id, user, db)
    if page_number < 1:
        raise HTTPException(404, 'Page not found')
    import io
    import pypdfium2 as pdfium
    from fastapi.responses import Response
    if media_type != 'application/pdf':
        raise HTTPException(400, 'Page preview requires a PDF')
    source = read_archived_document(location) if location.suffix == ".enc" else str(location)
    with pdfium.PdfDocument(source) as document:
        page_count = len(document)
        if page_number > len(document):
            raise HTTPException(404, 'Page not found')
        page = document[page_number - 1]
        try:
            if page.get_width() * page.get_height() * 4 > 40_000_000:
                raise HTTPException(413, 'Page is too large to preview. Open the original scan.')
            bitmap = page.render(scale=2)
            try:
                image = bitmap.to_pil()
                output = io.BytesIO()
                image.save(output, format='PNG')
            finally:
                bitmap.close()
        finally:
            page.close()
    write_audit(db, user.user_id, "Read Document Page", "document", f"Rendered page {page_number}", str(document_id), request)
    db.commit()
    return Response(output.getvalue(), media_type='image/png', headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Page-Count': str(page_count), 'Access-Control-Expose-Headers': 'X-Page-Count'})


@app.post('/api/pao-intakes/')
def save_paper_intake(payload: PaperIntakePayload, request: Request,
                      user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    from paper_intake import APPLICANT, REPRESENTATIVE, validate_review
    try:
        validate_review(payload.sections, payload.unreadable_fields or [], payload.field_reviews)
        from paper_checkboxes import validate_boxes, reviewed_detained
        validate_boxes(payload.checkbox_states, payload.sections)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    # Lock the source to serialize double clicks and concurrent save attempts.
    document = db.query(models.Document).filter_by(document_id=payload.document_id).with_for_update().first()
    if not document:
        raise HTTPException(404, 'Document not found')
    if not is_admin(user) and document.uploaded_by != user.user_id:
        raise HTTPException(403, 'Record access denied')
    metadata = db.query(models.ExtractedMetadata).filter_by(document_id=payload.document_id).first()
    if not metadata or metadata.extracted_json.get('intake_scope') != 'pao_parts_ii_iia':
        raise HTTPException(422, 'Scan the PAO sheet in the intake workflow first.')
    if db.query(models.ReviewedPaperIntake).filter_by(document_id=payload.document_id).first():
        raise HTTPException(409, 'This reviewed sheet is already saved.')
    candidate_snapshot = reviewed_candidate_source(db, payload, metadata.extracted_json)
    applicant, representative = payload.sections[APPLICANT], payload.sections[REPRESENTATIVE]
    # The JSON text above is the canonical reviewed record. Typed compatibility
    # fields only receive directly representable values, never inferred ones.
    def age(value):
        return int(value) if value.isascii() and value.isdigit() and len(value) <= 3 else None
    client = models.Client(created_by_user_id=user.user_id,
        **{key: paper_compat_text(models.Client, key, applicant[key]) for key in ('name', 'sex', 'civil_status', 'religion',
           'educational_attainment', 'citizenship', 'language_dialect')}, age=age(applicant['age']))
    db.add(client)
    db.flush()
    db.add(models.ClientDetails(client_id=client.client_id,
        address=applicant['address'], contact_no=applicant['contact_no'], email=applicant['email'],
        individual_monthly_income=applicant['individual_monthly_income'],
        spouse=applicant['spouse_name'], address_of_spouse=applicant['spouse_address'],
        contact_no_of_spouse=applicant['spouse_contact_no'],
        representative_name=representative['name'], representative_age=age(representative['age']),
        representative_sex=paper_compat_text(models.ClientDetails, 'representative_sex', representative['sex']),
        representative_civil_status=paper_compat_text(models.ClientDetails, 'representative_civil_status', representative['civil_status']),
        representative_address=representative['address'], representative_contact_no=representative['contact_no'],
        representative_relationship=paper_compat_text(models.ClientDetails, 'representative_relationship', representative['relationship_to_applicant']), representative_email=representative['email'],
        detained=reviewed_detained(payload.checkbox_states) if reviewed_detained(payload.checkbox_states) is not None else null(), detained_since=None, place_of_detention=paper_compat_text(models.ClientDetails, 'place_of_detention', applicant['place_of_detention'])))
    db.add(models.ReviewedPaperIntake(client_id=client.client_id, document_id=document.document_id,
        reviewed_by=user.user_id, sections=payload.sections, unreadable_fields=payload.unreadable_fields or [], field_reviews=payload.field_reviews, checkbox_states=payload.checkbox_states, source_draft_id=payload.source_draft_id, candidate_snapshot=candidate_snapshot))
    metadata.verified_by = user.user_id
    metadata.verified_at = datetime.now(timezone.utc)
    metadata.verification_status = 'REVIEWED'
    write_audit(db, user.user_id, 'Review Intake', 'client', 'Reviewed PAO Parts II and II-A', str(client.client_id), request)
    commit_or_client_error(db, 'create')
    db.refresh(client)
    return get_client_payload(client)


@app.patch('/api/pao-intakes/{client_id}')
def update_paper_intake(client_id: int, payload: PaperIntakePayload, request: Request,
                        user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    from paper_intake import APPLICANT, REPRESENTATIVE, validate_review
    client = ensure_client_access(db.get(models.Client, client_id), user, db)
    saved = db.query(models.ReviewedPaperIntake).filter_by(client_id=client_id).with_for_update().first()
    if not saved or saved.document_id != payload.document_id:
        raise HTTPException(422, 'Reviewed intake source does not match.')
    try:
        validate_review(payload.sections, payload.unreadable_fields or [], payload.field_reviews)
        from paper_checkboxes import validate_boxes, reviewed_detained
        validate_boxes(payload.checkbox_states, payload.sections)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if payload.checkbox_states is None and saved.checkbox_states is not None:
        try:
            validate_boxes(saved.checkbox_states, payload.sections)
        except ValueError as exc:
            raise HTTPException(422, 'Review the stored checkbox states before changing Nakakulong.') from exc
    if payload.source_draft_id is not None:
        saved.candidate_snapshot = reviewed_candidate_source(db, payload)
        saved.source_draft_id = payload.source_draft_id
    saved.sections = payload.sections
    if payload.checkbox_states is not None:
        saved.checkbox_states = payload.checkbox_states
    # Simplified intake edits omit status metadata. Preserve existing values;
    # never infer a new field status from a correction or an empty text box.
    if payload.unreadable_fields is not None:
        saved.unreadable_fields = payload.unreadable_fields
    if payload.field_reviews is not None:
        saved.field_reviews = payload.field_reviews
    saved.reviewed_by, saved.reviewed_at = user.user_id, datetime.now(timezone.utc)
    applicant, representative = payload.sections[APPLICANT], payload.sections[REPRESENTATIVE]
    for key in ('name', 'sex', 'civil_status', 'religion', 'educational_attainment', 'citizenship', 'language_dialect'):
        setattr(client, key, paper_compat_text(models.Client, key, applicant[key]))
    def age(value):
        return int(value) if value.isascii() and value.isdigit() and len(value) <= 3 else None
    client.age = age(applicant['age'])
    details = client.details
    if details is None:
        details = models.ClientDetails(client_id=client_id, detained=null())
        db.add(details)
    for source, target in [('address', 'address'), ('contact_no', 'contact_no'), ('email', 'email'),
                           ('individual_monthly_income', 'individual_monthly_income'), ('spouse_name', 'spouse'),
                           ('spouse_address', 'address_of_spouse'), ('spouse_contact_no', 'contact_no_of_spouse'),
                           ('place_of_detention', 'place_of_detention')]:
        setattr(details, target, paper_compat_text(models.ClientDetails, target, applicant[source]))
    for source, target in [('name', 'name'), ('sex', 'sex'), ('civil_status', 'civil_status'),
                           ('address', 'address'), ('contact_no', 'contact_no'), ('email', 'email'),
                           ('relationship_to_applicant', 'relationship')]:
        setattr(details, f'representative_{target}', paper_compat_text(models.ClientDetails, f'representative_{target}', representative[source]))
    if payload.checkbox_states is not None:
        projected = reviewed_detained(payload.checkbox_states)
        details.detained = projected if projected is not None else null()
    details.representative_age = age(representative['age'])
    write_audit(db, user.user_id, 'Review Intake', 'client', 'Corrected reviewed PAO Parts II and II-A', str(client_id), request)
    commit_or_client_error(db, 'update')
    db.refresh(client)
    return get_client_payload(client)


@app.post('/api/pao-intakes/documents/{document_id}/extract')
async def reread_paper_intake(document_id: int, request: Request,
                              extraction_mode: Literal['auto', 'offline', 'cloud'] = Query(default='auto'),
                              user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    location, media_type = authorized_paper_document(document_id, user, db)
    metadata = db.query(models.ExtractedMetadata).filter_by(document_id=document_id).first()
    if not metadata or metadata.extracted_json.get('intake_scope') != 'pao_parts_ii_iia':
        raise HTTPException(422, 'This document is not a PAO paper intake.')
    if media_type == 'application/pdf' and extraction_mode == 'cloud':
        raise HTTPException(400, 'Cloud mode does not support PDFs. Select offline mode.')
    from tempfile import TemporaryDirectory

    try:
        if location.suffix == ".enc":
            with TemporaryDirectory(prefix="jurisguard-reread-") as directory:
                source = Path(directory) / location.stem
                source.write_bytes(read_archived_document(location))
                extracted = await extract_document(str(source), extraction_mode, 'paper_intake', is_disconnected=request.is_disconnected)
        else:
            extracted = await extract_document(str(location), extraction_mode, 'paper_intake', is_disconnected=request.is_disconnected)
    except ExtractionBusy as exc:
        raise HTTPException(503, 'OCR is busy. Retry after the current scan finishes.', headers={'Retry-After': '5'}) from exc
    except ExtractionTimeout as exc:
        raise HTTPException(504, 'OCR timed out. Review the source or retry.') from exc
    except ExtractionCancelled as exc:
        raise HTTPException(499, 'Document extraction cancelled.') from exc
    except ExtractionWorkerError as exc:
        raise HTTPException(503, 'OCR worker failed. Retry or review the scan manually.') from exc
    # Re-reading produces a fresh draft. It must not rewrite either the original
    # OCR evidence or any attorney-reviewed record until an explicit save.
    public = public_extraction_payload(extracted)
    draft_id = store_paper_draft(db, document_id, public)
    write_audit(db, user.user_id, "Re-extract Document", "document", entity_id=str(document_id), request=request)
    db.commit()
    return {'document_id': document_id, 'source_draft_id': draft_id, 'extracted_data': public}


@app.post('/api/pao-intakes/capture-analyze')
async def analyze_paper_capture(request: Request, file: UploadFile = File(...),
                                corners_json: str | None = Form(default=None), rotation: int = Form(default=0),
                                user: models.User = Depends(current_user)):
    """Return local crop suggestions; the uploaded image is not a saved record."""
    from paper_capture import (PaperCropError, detect_document, load_capture, preview_data_url,
                               rectify, suggest_sections, validate_plan)
    original_name = Path(file.filename or 'camera.jpg').name
    extension = Path(original_name).suffix.lower()
    if extension not in DOCUMENT_CONTENT_TYPES or file.content_type not in DOCUMENT_CONTENT_TYPES[extension]:
        raise HTTPException(400, 'Crop review requires a JPG, PNG, WEBP, or single-page PDF scan.')
    if rotation not in (0, 90, 180, 270):
        raise HTTPException(422, 'Choose a quarter-turn rotation.')
    source = UPLOAD_DIR / f'{uuid.uuid4()}{extension}'
    page_file = UPLOAD_DIR / f'{uuid.uuid4()}-crop-preview.jpg'
    try:
        save_bounded_upload(file.file, source, MAX_DOCUMENT_BYTES)
        if extension != '.pdf':
            verify_image(source, extension)
        image = await asyncio.to_thread(load_capture, source)
        detected = await asyncio.to_thread(detect_document, image)
        corners = detected['corners']
        if corners_json:
            try:
                raw_corners = json.loads(corners_json)
                corners = validate_plan({'corners': raw_corners, 'rotation': rotation,
                                         'sections': {'part_ii': [.2, .6], 'part_iia': [.6, .9]},
                                         'document_reviewed': True, 'sections_reviewed': True})['corners']
            except (json.JSONDecodeError, PaperCropError) as exc:
                raise HTTPException(422, str(exc)) from exc
        page, _ = await asyncio.to_thread(rectify, image, corners, rotation)
        import cv2
        if not cv2.imwrite(str(page_file), page, [cv2.IMWRITE_JPEG_QUALITY, 93]):
            raise PaperCropError('Could not prepare the preview.')
        warnings = []
        try:
            headings = await extract_document(str(page_file), 'offline', 'paper_boundaries', is_disconnected=request.is_disconnected)
            positions = headings.get('headings', {})
            warnings.extend(headings.get('warnings') or [])
        except (ExtractionBusy, ExtractionTimeout, ExtractionWorkerError, ExtractionCancelled):
            positions = {}
            warnings.append('Automatic heading detection was unavailable. Set both section boundaries manually.')
        sections = suggest_sections(positions, page.shape[0])
        if detected['confidence'] == 'uncertain' and not corners_json:
            warnings.append(detected['warning'])
        if sections['confidence'] == 'uncertain':
            warnings.append(sections['warning'])
        return {'document': {'corners': corners, 'confidence': 'manual' if corners_json else detected['confidence'],
                             'warning': detected['warning'] if not corners_json else 'Check the adjusted page before OCR.'},
                'rotation': rotation, 'original_size': [image.shape[1], image.shape[0]],
                'page': {'width': page.shape[1], 'height': page.shape[0], 'preview': preview_data_url(page)},
                'original_preview': preview_data_url(image) if extension == '.pdf' else None,
                'sections': sections, 'headings_found': {key: key in positions for key in ('applicant_personal_circumstances', 'representative_personal_circumstances', 'end')},
                'warnings': warnings}
    except HTTPException:
        raise
    except PaperCropError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        source.unlink(missing_ok=True)
        page_file.unlink(missing_ok=True)


class TransferReportPayload(BaseModel):
    title: str
    report_date: str
    from_user_id: int | None = None
    to_user_id: int
    case_ids: list[int] = []
    administrative_entries: list[dict[str, Any]] = []
    remarks: str | None = None


class TransferReturnPayload(BaseModel):
    remarks: str


def transfer_group_id(report: models.CaseTransferReport) -> int:
    return report.parent_report_id or report.report_id


def transfer_case_snapshot(record: models.Case) -> dict[str, Any]:
    payload = get_case_payload(record)
    return {
        "case_id": record.case_id,
        "case_type": record.case_type,
        "control_no": payload["intake_record"].get("control_no", ""),
        "title_of_case": record.title_of_case or "",
        "case_no": record.case_no or "",
        "date_received": payload["intake_record"].get("form_date", ""),
        "status_of_case": record.status_of_case or record.case_status or "",
        "cause_of_action": record.cause_of_action or "",
        "assigned_pao": record.assigned_pao or "",
    }


def transfer_report_access(report: models.CaseTransferReport, user: models.User) -> bool:
    return is_admin(user) or report.from_user_id == user.user_id or report.to_user_id == user.user_id


def ensure_transfer_access(report_id: int, user: models.User, db: Session) -> models.CaseTransferReport:
    report = db.get(models.CaseTransferReport, report_id)
    if not report or not transfer_report_access(report, user):
        raise HTTPException(status_code=404, detail="Transfer report not found")
    return report


def transfer_user(db: Session, user_id: int) -> models.User:
    person = db.query(models.User).join(models.Role).filter(
        models.User.user_id == user_id,
        models.User.is_active.is_(True),
        models.User.approval_status == "approved",
    ).first()
    if not person or is_admin(person):
        raise HTTPException(status_code=422, detail="Select an active approved staff recipient")
    return person


def transfer_report_editor(report: models.CaseTransferReport, user: models.User) -> bool:
    return can_edit_transfer_report(report, user, is_admin(user))


def build_transfer_payload(report: models.CaseTransferReport, include_items: bool = True) -> dict[str, Any]:
    items = sorted(report.items, key=lambda item: (item.section, item.item_id))
    admin_entries = sorted(report.administrative_entries, key=lambda entry: (entry.section, entry.row_number, entry.entry_id))
    return {
        "report_id": report.report_id,
        "parent_report_id": report.parent_report_id,
        "title": report.title,
        "report_date": report.report_date.isoformat() if report.report_date else "",
        "date_received": report.date_received.isoformat() if report.date_received else None,
        "status": report.status,
        "remarks": report.remarks or "",
        "version": report.version,
        "from_user_id": report.from_user_id,
        "from_user_name": report.from_user.full_name or report.from_user.email or report.from_user.username,
        "to_user_id": report.to_user_id,
        "to_user_name": report.to_user.full_name or report.to_user.email or report.to_user.username,
        "initiated_by_user_id": report.initiated_by_user_id,
        "initiated_by_user_name": (
            (report.initiated_by_user.full_name or report.initiated_by_user.email or report.initiated_by_user.username)
            if report.initiated_by_user else None
        ),
        "submitted_at": report.submitted_at.isoformat() if report.submitted_at else None,
        "returned_at": report.returned_at.isoformat() if report.returned_at else None,
        "confirmed_at": report.confirmed_at.isoformat() if report.confirmed_at else None,
        "created_at": report.created_at.isoformat() if report.created_at else "",
        "updated_at": report.updated_at.isoformat() if report.updated_at else "",
        "items": [
            {"item_id": item.item_id, "case_id": item.case_id, "section": item.section, "snapshot": item.snapshot_json}
            for item in items
        ] if include_items else [],
        "administrative_entries": [
            {
                "entry_id": entry.entry_id,
                "section": entry.section,
                "row_number": entry.row_number,
                "control_no": entry.control_no or "",
                "title_of_case": entry.title_of_case or "",
                "docket_no": entry.docket_no or "",
                "date_received": entry.date_received.isoformat() if entry.date_received else "",
                "status_of_case": entry.status_of_case or "",
                "cause_of_action": entry.cause_of_action or "",
            }
            for entry in admin_entries
        ],
    }


def validate_transfer_case_ids(
    db: Session,
    user: models.User,
    case_ids: list[int],
    source_user_id: int,
    exclude_report_id: int | None = None,
) -> list[models.Case]:
    unique_ids = list(dict.fromkeys(case_ids))
    if len(unique_ids) != len(case_ids):
        raise HTTPException(status_code=422, detail="Duplicate case references are not allowed")
    if not unique_ids:
        raise HTTPException(status_code=422, detail="Select at least one Criminal or Civil case")
    records = []
    for case_id in unique_ids:
        record = ensure_case_access(db.get(models.Case, case_id), user)
        if record.is_terminated or (record.status_of_case or "").lower() == "terminated":
            raise HTTPException(status_code=409, detail=f"Case {case_id} is not eligible for transfer")
        if not record.intake or record.intake.interviewer_id != source_user_id:
            raise HTTPException(status_code=403, detail=f"Case {case_id} is not assigned to the selected transferring attorney")
        records.append(record)
    conflict_query = db.query(models.CaseTransferItem).join(models.CaseTransferReport).filter(
        models.CaseTransferItem.case_id.in_(unique_ids),
        models.CaseTransferReport.status == "Pending Receipt",
    )
    if exclude_report_id is not None:
        conflict_query = conflict_query.filter(models.CaseTransferReport.report_id != exclude_report_id)
    if conflict_query.first():
        raise HTTPException(status_code=409, detail="One or more selected cases are already in a pending transfer")
    return records


def create_user_notification(
    db: Session,
    user_id: int,
    event_key: str,
    title: str,
    message: str,
    redirect_to: str,
    entity_type: str,
    entity_id: str,
) -> None:
    statement = pg_insert(models.Notification).values(
        user_id=user_id,
        event_key=event_key,
        notification_type="workflow",
        title=title,
        message=message,
        redirect_to=redirect_to,
        entity_type=entity_type,
        entity_id=entity_id,
        is_read=False,
    ).on_conflict_do_nothing(constraint="uq_notification_user_event")
    db.execute(statement)


def require_messaging_designation(user: models.User) -> str:
    designation = personnel_designation(
        user.role.role_name if user.role else None,
        is_admin(user),
    )
    if designation not in {"Attorney", "Administrator"}:
        raise HTTPException(status_code=403, detail="Private messaging is not available for this designation")
    return designation


def messaging_peer(db: Session, user: models.User, peer_id: int) -> tuple[models.User, str]:
    sender_designation = require_messaging_designation(user)
    if peer_id <= 0 or peer_id == user.user_id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    peer = db.query(models.User).options(joinedload(models.User.role)).filter(
        models.User.user_id == peer_id,
        models.User.is_active.is_(True),
        models.User.approval_status == "approved",
    ).first()
    if not peer:
        raise HTTPException(status_code=404, detail="Conversation not found")
    peer_designation = personnel_designation(
        peer.role.role_name if peer.role else None,
        is_admin(peer),
    )
    if not can_message_designations(sender_designation, peer_designation):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return peer, peer_designation


def private_message_reaction_summary(
    db: Session,
    message_ids: list[int],
    viewer_id: int,
) -> dict[int, list[dict[str, Any]]]:
    if not message_ids:
        return {}
    rows = db.query(
        models.PrivateMessageReaction.message_id,
        models.PrivateMessageReaction.emoji,
        models.PrivateMessageReaction.user_id,
    ).filter(
        models.PrivateMessageReaction.message_id.in_(message_ids),
    ).order_by(
        models.PrivateMessageReaction.message_id,
        models.PrivateMessageReaction.emoji,
    ).all()

    summaries: dict[int, dict[str, dict[str, Any]]] = {}
    for message_id, emoji, user_id in rows:
        if emoji not in MESSAGE_REACTION_EMOJIS:
            continue
        by_emoji = summaries.setdefault(message_id, {})
        summary = by_emoji.setdefault(emoji, {"emoji": emoji, "count": 0, "reacted_by_me": False})
        summary["count"] += 1
        if user_id == viewer_id:
            summary["reacted_by_me"] = True
    return {message_id: list(by_emoji.values()) for message_id, by_emoji in summaries.items()}


def private_message_payload(
    message: models.PrivateMessage,
    viewer_id: int,
    reactions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "message_id": message.message_id,
        "sender_user_id": message.sender_user_id,
        "recipient_user_id": message.recipient_user_id,
        "content": message.content,
        "created_at": message.created_at.isoformat() if message.created_at else "",
        "read_at": message.read_at.isoformat() if message.read_at else None,
        "is_mine": message.sender_user_id == viewer_id,
        "reactions": reactions or [],
    }


@app.get("/api/messages/personnel")
def list_messaging_personnel(
    response: Response,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "private, no-store"
    sender_designation = require_messaging_designation(user)
    candidates = db.query(models.User).options(joinedload(models.User.role)).filter(
        models.User.is_active.is_(True),
        models.User.approval_status == "approved",
    ).order_by(models.User.full_name, models.User.user_id).all()
    eligible = []
    for person in candidates:
        designation = personnel_designation(
            person.role.role_name if person.role else None,
            is_admin(person),
        )
        is_self = person.user_id == user.user_id
        if is_self or can_message_designations(sender_designation, designation):
            eligible.append((person, designation, is_self))

    peer_ids = [person.user_id for person, _, is_self in eligible if not is_self]
    unread_by_sender: dict[int, int] = {}
    if peer_ids:
        unread_rows = db.query(
            models.PrivateMessage.sender_user_id,
            func.count(models.PrivateMessage.message_id),
        ).filter(
            models.PrivateMessage.recipient_user_id == user.user_id,
            models.PrivateMessage.sender_user_id.in_(peer_ids),
            models.PrivateMessage.read_at.is_(None),
        ).group_by(models.PrivateMessage.sender_user_id).all()
        unread_by_sender = {sender_id: count for sender_id, count in unread_rows}

    return {
        "personnel": [
            {
                "user_id": person.user_id,
                "full_name": person.full_name or person.email or person.username,
                "profile_image_path": person.profile_image_path,
                "designation": designation,
                "is_self": is_self,
                "unread_count": unread_by_sender.get(person.user_id, 0),
            }
            for person, designation, is_self in eligible
        ],
        "summary": None,
    }


@app.get("/api/messages/{peer_id}")
def get_private_conversation(
    peer_id: int,
    response: Response,
    limit: int = Query(default=50, ge=1, le=100),
    before_message_id: int | None = Query(default=None, ge=1),
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "private, no-store"
    peer, _ = messaging_peer(db, user, peer_id)
    query = db.query(models.PrivateMessage).filter(
        or_(
            (models.PrivateMessage.sender_user_id == user.user_id)
            & (models.PrivateMessage.recipient_user_id == peer.user_id),
            (models.PrivateMessage.sender_user_id == peer.user_id)
            & (models.PrivateMessage.recipient_user_id == user.user_id),
        )
    )
    if before_message_id is not None:
        query = query.filter(models.PrivateMessage.message_id < before_message_id)
    rows = query.order_by(models.PrivateMessage.message_id.desc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = list(reversed(rows[:limit]))
    reactions_by_message = private_message_reaction_summary(
        db,
        [message.message_id for message in rows],
        user.user_id,
    )
    return {
        "messages": [
            private_message_payload(message, user.user_id, reactions_by_message.get(message.message_id))
            for message in rows
        ],
        "has_more": has_more,
    }


@app.post("/api/messages/{peer_id}")
def send_private_message(
    peer_id: int,
    payload: PrivateMessagePayload,
    response: Response,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "private, no-store"
    peer, _ = messaging_peer(db, user, peer_id)
    try:
        content = normalize_message_content(payload.content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    message = models.PrivateMessage(
        sender_user_id=user.user_id,
        recipient_user_id=peer.user_id,
        content=content,
    )
    db.add(message)
    db.flush()
    sender_name = user.full_name or user.email or user.username
    create_user_notification(
        db,
        peer.user_id,
        f"private-message:{message.message_id}",
        "New private message",
        f"You have a new private message from {sender_name}.",
        f"/dashboard?messageFrom={user.user_id}",
        "private_message",
        str(user.user_id),
    )
    db.commit()
    db.refresh(message)
    return private_message_payload(message, user.user_id)


@app.post("/api/messages/{peer_id}/{message_id}/reaction")
def toggle_private_message_reaction(
    peer_id: int,
    message_id: int,
    payload: PrivateMessageReactionPayload,
    response: Response,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "private, no-store"
    peer, _ = messaging_peer(db, user, peer_id)
    message = db.query(models.PrivateMessage).filter(
        models.PrivateMessage.message_id == message_id,
        or_(
            (models.PrivateMessage.sender_user_id == user.user_id)
            & (models.PrivateMessage.recipient_user_id == peer.user_id),
            (models.PrivateMessage.sender_user_id == peer.user_id)
            & (models.PrivateMessage.recipient_user_id == user.user_id),
        ),
    ).with_for_update().first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    reaction = db.query(models.PrivateMessageReaction).filter(
        models.PrivateMessageReaction.message_id == message.message_id,
        models.PrivateMessageReaction.user_id == user.user_id,
    ).first()
    if reaction and reaction.emoji == payload.emoji:
        db.delete(reaction)
    elif reaction:
        reaction.emoji = payload.emoji
    else:
        db.add(models.PrivateMessageReaction(
            message_id=message.message_id,
            user_id=user.user_id,
            emoji=payload.emoji,
        ))
    db.commit()

    reactions = private_message_reaction_summary(db, [message.message_id], user.user_id)
    return {"reactions": reactions.get(message.message_id, [])}


@app.post("/api/messages/{peer_id}/read")
def mark_private_conversation_read(
    peer_id: int,
    response: Response,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    response.headers["Cache-Control"] = "private, no-store"
    peer, _ = messaging_peer(db, user, peer_id)
    read_at = datetime.now(timezone.utc).replace(tzinfo=None)
    updated_count = db.query(models.PrivateMessage).filter(
        models.PrivateMessage.sender_user_id == peer.user_id,
        models.PrivateMessage.recipient_user_id == user.user_id,
        models.PrivateMessage.read_at.is_(None),
    ).update({models.PrivateMessage.read_at: read_at}, synchronize_session=False)
    db.query(models.Notification).filter(
        models.Notification.user_id == user.user_id,
        models.Notification.entity_type == "private_message",
        models.Notification.entity_id == str(peer.user_id),
        models.Notification.is_read.is_(False),
    ).update({models.Notification.is_read: True}, synchronize_session=False)
    db.commit()
    return {"updated": updated_count, "read_at": read_at.isoformat()}


@app.get("/api/case-transfers/attorneys")
def list_transfer_attorneys(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    people = db.query(models.User).join(models.Role).filter(
        models.User.is_active.is_(True),
        models.User.approval_status == "approved",
    ).order_by(models.User.full_name, models.User.user_id).all()
    return [
        {"user_id": person.user_id, "full_name": person.full_name or person.email or person.username}
        for person in people if not is_admin(person)
    ]


@app.get("/api/case-transfers/cases")
def list_transfer_cases(
    case_type: Literal["Criminal", "Civil"],
    search: str | None = None,
    source_user_id: int | None = None,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if is_admin(user):
        if source_user_id is None:
            raise HTTPException(status_code=422, detail="Select a transferring attorney before loading cases")
        source = transfer_user(db, source_user_id)
        query = db.query(models.Case).outerjoin(models.IntakeRecord).filter(models.IntakeRecord.interviewer_id == source.user_id)
    else:
        if source_user_id is not None and source_user_id != user.user_id:
            raise HTTPException(status_code=403, detail="Staff may only list their own assigned cases")
        query = scoped_case_query(db, user).filter(models.IntakeRecord.interviewer_id == user.user_id)
    query = query.filter(
        models.Case.case_type == case_type,
        func.lower(func.coalesce(models.Case.status_of_case, '')) != 'terminated',
        or_(models.Case.is_terminated.is_(False), models.Case.is_terminated.is_(None)),
    )
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(or_(
            models.Case.title_of_case.ilike(pattern),
            models.Case.case_no.ilike(pattern),
            models.IntakeRecord.control_no.ilike(pattern),
        ))
    return [transfer_case_snapshot(record) for record in query.order_by(models.Case.last_updated.desc()).limit(250).all()]


@app.get("/api/case-transfers")
def list_case_transfers(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(models.CaseTransferReport)
    if not is_admin(user):
        query = query.filter(or_(models.CaseTransferReport.from_user_id == user.user_id, models.CaseTransferReport.to_user_id == user.user_id))
    reports = query.order_by(models.CaseTransferReport.updated_at.desc(), models.CaseTransferReport.report_id.desc()).all()
    return [build_transfer_payload(report) for report in reports]


@app.post("/api/case-transfers")
def create_case_transfer(
    payload: TransferReportPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    source = transfer_user(db, payload.from_user_id) if is_admin(user) and payload.from_user_id else user
    if is_admin(user) and payload.from_user_id is None:
        raise HTTPException(status_code=422, detail="Select a transferring attorney")
    recipient = transfer_user(db, payload.to_user_id)
    if source.user_id == recipient.user_id:
        raise HTTPException(status_code=422, detail="The transferring and receiving attorneys must be different")
    report_date = parse_date(payload.report_date)
    if not report_date:
        raise HTTPException(status_code=422, detail="A valid report date is required")
    records = validate_transfer_case_ids(db, user, payload.case_ids, source.user_id)
    report = models.CaseTransferReport(
        from_user_id=source.user_id,
        to_user_id=recipient.user_id,
        initiated_by_user_id=user.user_id if is_admin(user) else None,
        title=payload.title.strip() or "Transfer of Cases",
        report_date=report_date,
        status="Draft",
        remarks=payload.remarks,
    )
    db.add(report)
    db.flush()
    for record in records:
        db.add(models.CaseTransferItem(
            report_id=report.report_id,
            case_id=record.case_id,
            section="Criminal" if record.case_type == "Criminal" else "Civil",
            snapshot_json=transfer_case_snapshot(record),
        ))
    for raw in payload.administrative_entries:
        section = str(raw.get("section") or "").upper()
        if section not in {"ADMIN 1", "ADMIN 2", "ADMIN 3"}:
            raise HTTPException(status_code=422, detail="Administrative section must be ADMIN 1, ADMIN 2, or ADMIN 3")
        db.add(models.CaseTransferAdministrativeEntry(
            report_id=report.report_id,
            section=section,
            row_number=int(raw.get("row_number") or 1),
            control_no=raw.get("control_no"),
            title_of_case=raw.get("title_of_case"),
            docket_no=raw.get("docket_no"),
            date_received=parse_date(raw.get("date_received")),
            status_of_case=raw.get("status_of_case"),
            cause_of_action=raw.get("cause_of_action"),
        ))
    if report.initiated_by_user_id is not None:
        recipient_name = report.to_user.full_name or report.to_user.email or report.to_user.username
        create_user_notification(
            db,
            report.from_user_id,
            f"case-transfer:{report.report_id}:draft-created",
            "Transfer Draft Ready for Review",
            f"An administrator prepared '{report.title}' for your review and submission. Receiving attorney: {recipient_name}.",
            f"/case-transfers?report={report.report_id}",
            "case_transfer",
            str(report.report_id),
        )
    write_audit(db, user.user_id, "Create Transfer Draft", "case_transfer", f"Created transfer report {report.title}", str(report.report_id), request)
    db.commit()
    db.refresh(report)
    return build_transfer_payload(report)


@app.get("/api/case-transfers/{report_id}")
def get_case_transfer(report_id: int, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    return build_transfer_payload(ensure_transfer_access(report_id, user, db))


@app.patch("/api/case-transfers/{report_id}")
def update_case_transfer(
    report_id: int,
    payload: TransferReportPayload,
    request: Request,
    user: models.User = Depends(current_user),
    db: Session = Depends(get_db),
):
    report = ensure_transfer_access(report_id, user, db)
    if not transfer_report_editor(report, user) or report.status not in {"Draft", "Returned for Correction"}:
        raise HTTPException(status_code=403, detail="Only editable transfer reports may be changed")
    source = transfer_user(db, payload.from_user_id) if is_admin(user) and payload.from_user_id else db.get(models.User, report.from_user_id)
    if not source or is_admin(source):
        raise HTTPException(status_code=422, detail="Select a valid transferring attorney")
    recipient = transfer_user(db, payload.to_user_id)
    if source.user_id == recipient.user_id:
        raise HTTPException(status_code=422, detail="The transferring and receiving attorneys must be different")
    report_date = parse_date(payload.report_date)
    if not report_date:
        raise HTTPException(status_code=422, detail="A valid report date is required")
    records = validate_transfer_case_ids(db, user, payload.case_ids, source.user_id, report.report_id)
    report.from_user_id = source.user_id
    report.to_user_id = recipient.user_id
    report.title = payload.title.strip() or "Transfer of Cases"
    report.report_date = report_date
    report.remarks = payload.remarks
    report.items.clear()
    report.administrative_entries.clear()
    db.flush()
    for record in records:
        report.items.append(models.CaseTransferItem(case_id=record.case_id, section=record.case_type, snapshot_json=transfer_case_snapshot(record)))
    for raw in payload.administrative_entries:
        report.administrative_entries.append(models.CaseTransferAdministrativeEntry(
            section=str(raw.get("section") or "").upper(), row_number=int(raw.get("row_number") or 1),
            control_no=raw.get("control_no"), title_of_case=raw.get("title_of_case"), docket_no=raw.get("docket_no"),
            date_received=parse_date(raw.get("date_received")), status_of_case=raw.get("status_of_case"), cause_of_action=raw.get("cause_of_action"),
        ))
    report.status = "Draft"
    report.updated_at = datetime.now()
    write_audit(db, user.user_id, "Update Transfer Draft", "case_transfer", f"Updated transfer report {report.title}", str(report.report_id), request)
    db.commit()
    db.refresh(report)
    return build_transfer_payload(report)


@app.post("/api/case-transfers/{report_id}/submit")
def submit_case_transfer(report_id: int, request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    report = ensure_transfer_access(report_id, user, db)
    if not can_submit_transfer_report(report, user, is_admin(user)) or report.status not in {"Draft", "Returned for Correction"}:
        raise HTTPException(status_code=403, detail="Only editable transfer reports may be submitted")
    is_resubmission = report.status == "Returned for Correction"
    if not report.items:
        raise HTTPException(status_code=422, detail="Select at least one case before submission")
    validate_transfer_case_ids(db, user, [item.case_id for item in report.items], report.from_user_id, report.report_id)
    report.status = "Pending Receipt"
    report.submitted_at = datetime.now()
    report.updated_at = datetime.now()
    source_name = report.from_user.full_name or report.from_user.email or report.from_user.username
    create_user_notification(
        db,
        report.to_user_id,
        f"case-transfer:{report.report_id}:submitted:{report.returned_at.isoformat() if report.returned_at else 'initial'}",
        "Case Transfer Awaiting Receipt",
        f"{source_name} submitted '{report.title}'. Review the report and confirm receipt.",
        f"/case-transfers?report={report.report_id}",
        "case_transfer",
        str(report.report_id),
    )
    write_audit(
        db, user.user_id,
        "Resubmit Case Transfer" if is_resubmission else "Submit Case Transfer",
        "case_transfer", f"Submitted transfer report {report.title}", str(report.report_id), request,
    )
    db.commit()
    db.refresh(report)
    return build_transfer_payload(report)


@app.post("/api/case-transfers/{report_id}/return")
def return_case_transfer(report_id: int, payload: TransferReturnPayload, request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    report = ensure_transfer_access(report_id, user, db)
    remarks = payload.remarks.strip()
    if report.to_user_id != user.user_id or report.status != "Pending Receipt":
        raise HTTPException(status_code=403, detail="Only the receiving attorney may return a pending transfer")
    if len(remarks) < 5:
        raise HTTPException(status_code=422, detail="Meaningful correction remarks are required")
    report.status = "Returned for Correction"
    report.remarks = remarks
    report.returned_at = datetime.now()
    report.updated_at = datetime.now()
    recipient_name = report.to_user.full_name or report.to_user.email or report.to_user.username
    create_user_notification(
        db,
        report.from_user_id,
        f"case-transfer:{report.report_id}:returned:{report.returned_at.isoformat()}",
        "Case Transfer Returned for Correction",
        f"{recipient_name} returned '{report.title}' for correction: {remarks}",
        f"/case-transfers?report={report.report_id}",
        "case_transfer",
        str(report.report_id),
    )
    write_audit(db, user.user_id, "Return Case Transfer", "case_transfer", remarks, str(report.report_id), request)
    db.commit()
    db.refresh(report)
    return build_transfer_payload(report)


@app.post("/api/case-transfers/{report_id}/confirm")
def confirm_case_transfer(report_id: int, request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    report = db.query(models.CaseTransferReport).filter(models.CaseTransferReport.report_id == report_id).with_for_update().first()
    if not report or report.to_user_id != user.user_id:
        raise HTTPException(status_code=404, detail="Transfer report not found")
    if report.status != "Pending Receipt":
        raise HTTPException(status_code=409, detail="Transfer is no longer pending receipt")
    case_ids = [item.case_id for item in report.items]
    if len(case_ids) != len(set(case_ids)):
        raise HTTPException(status_code=409, detail="Transfer contains duplicate case references")
    records = [db.query(models.Case).filter(models.Case.case_id == case_id).with_for_update().first() for case_id in case_ids]
    if any(
        record is None or record.is_terminated or (record.status_of_case or '').lower() == 'terminated' or not record.intake
        or record.intake.interviewer_id != report.from_user_id
        or record.case_type != item.section
        for record, item in zip(records, report.items)
    ):
        raise HTTPException(status_code=409, detail="One or more cases are no longer eligible for transfer")
    previous_names = []
    for record in records:
        previous_names.append(record.assigned_pao or (record.intake.interviewer.full_name if record.intake and getattr(record.intake, "interviewer", None) else ""))
        record.assigned_pao = user.full_name or user.email or user.username
        if record.intake:
            record.intake.interviewer_id = user.user_id
        db.add(models.CaseHistory(case_id=record.case_id, updated_by=user.user_id, previous_status=record.status_of_case, new_status=record.status_of_case or "Pending", action_taken="Case transferred", remarks=f"Transfer report #{report.report_id}; previous assignment: {previous_names[-1]}"))
    report.status = "Completed"
    report.date_received = datetime.now()
    report.confirmed_at = datetime.now()
    report.updated_at = datetime.now()
    source_name = report.from_user.full_name or report.from_user.email or report.from_user.username
    notification_event_key = f"case-transfer:{report.report_id}:confirmed"
    notification_message = f"'{report.title}' was received and confirmed by {user.full_name or user.email or user.username}. The transfer is complete."
    notification_link = f"/case-transfers?report={report.report_id}"
    create_user_notification(
        db,
        report.from_user_id,
        notification_event_key,
        "Case Transfer Completed",
        notification_message,
        notification_link,
        "case_transfer",
        str(report.report_id),
    )
    if report.initiated_by_user_id is not None and report.initiated_by_user_id != report.from_user_id:
        create_user_notification(
            db,
            report.initiated_by_user_id,
            notification_event_key,
            "Case Transfer Completed",
            f"'{report.title}' from {source_name} was received and confirmed. The transfer is complete.",
            notification_link,
            "case_transfer",
            str(report.report_id),
        )
    write_audit(
        db, user.user_id, "Confirm Case Transfer", "case_transfer",
        f"{user.full_name or user.email or user.username} confirmed receipt of transfer report {report.title} from {source_name}.",
        str(report.report_id), request,
    )
    write_audit(
        db, user.user_id, "Transfer Assignments Updated", "case_transfer",
        f"{len(case_ids)} case assignment(s) updated to {user.full_name or user.email or user.username} after receipt confirmation.",
        str(report.report_id), request,
    )
    db.commit()
    db.refresh(report)
    return build_transfer_payload(report)
