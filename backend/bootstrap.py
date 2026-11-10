import os
from datetime import date
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert

import models
from calendar_holiday_data import CALENDAR_HOLIDAY_SEED
from database import SessionLocal, engine

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


def seed_calendar_holidays() -> None:
    with SessionLocal() as db:
        for (
            source_key,
            name,
            holiday_date,
            classification,
            coverage,
            scope,
            reference,
            source_url,
        ) in CALENDAR_HOLIDAY_SEED:
            parsed_date = date.fromisoformat(holiday_date)
            db.execute(
                pg_insert(models.CalendarHoliday)
                .values(
                    source_key=source_key,
                    name=name,
                    holiday_date=parsed_date,
                    classification=classification,
                    coverage=coverage,
                    geographic_scope=scope,
                    reference=reference,
                    source_url=source_url,
                    year=parsed_date.year,
                )
                .on_conflict_do_nothing(index_elements=[models.CalendarHoliday.source_key])
            )
        db.commit()


def ensure_schema_compatibility() -> None:
    statements = [
        "ALTER TABLE reviewed_paper_intake ADD COLUMN IF NOT EXISTS field_reviews JSONB",
        "ALTER TABLE reviewed_paper_intake ADD COLUMN IF NOT EXISTS checkbox_states JSONB",
        "ALTER TABLE reviewed_paper_intake ADD COLUMN IF NOT EXISTS source_draft_id VARCHAR(64)",
        "ALTER TABLE reviewed_paper_intake ADD COLUMN IF NOT EXISTS candidate_snapshot JSONB",
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
        "CREATE INDEX IF NOT EXISTS ix_audit_log_user_id ON audit_log (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_audit_log_action ON audit_log (action)",
        "CREATE INDEX IF NOT EXISTS ix_audit_log_timestamp ON audit_log (timestamp)",
        "CREATE INDEX IF NOT EXISTS ix_audit_log_timestamp_log_id ON audit_log (timestamp, log_id)",
        "CREATE INDEX IF NOT EXISTS ix_audit_log_user_timestamp_log_id ON audit_log (user_id, timestamp, log_id)",
        "CREATE INDEX IF NOT EXISTS ix_audit_log_action_timestamp_log_id ON audit_log (action, timestamp, log_id)",
        "CREATE INDEX IF NOT EXISTS ix_audit_log_target_entity_id ON audit_log (target_entity, entity_id)",
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
