-- JurisGuard ERD Schema
-- Generated from the updated ERD and aligned with the current backend models.
-- Target DBMS: PostgreSQL

CREATE TABLE IF NOT EXISTS role (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(30) NOT NULL,
    permissions TEXT
);

CREATE TABLE IF NOT EXISTS "user" (
    user_id SERIAL PRIMARY KEY,
    role_id INTEGER REFERENCES role(role_id),
    username VARCHAR(30) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_secret VARCHAR(64),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS client (
    client_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    age INTEGER,
    sex VARCHAR(10),
    civil_status VARCHAR(50),
    religion VARCHAR(100),
    educational_attainment VARCHAR(150),
    citizenship VARCHAR(100),
    language_dialect VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS client_details (
    details_id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES client(client_id),
    address TEXT,
    contact_no TEXT,
    email TEXT,
    individual_monthly_income TEXT,
    spouse TEXT,
    address_of_spouse TEXT,
    contact_no_of_spouse TEXT,
    representative_name TEXT,
    representative_age INTEGER,
    representative_sex VARCHAR(20),
    representative_civil_status VARCHAR(50),
    representative_address TEXT,
    representative_contact_no TEXT,
    representative_relationship VARCHAR(100),
    representative_email TEXT,
    detained BOOLEAN DEFAULT FALSE,
    detained_since TIMESTAMP,
    place_of_detention VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS client_classification (
    classification_id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES client(client_id),
    class_cicl BOOLEAN DEFAULT FALSE,
    class_woman BOOLEAN DEFAULT FALSE,
    class_law_enforcer BOOLEAN DEFAULT FALSE,
    class_tenant_agrarian BOOLEAN DEFAULT FALSE,
    class_ofw_land BOOLEAN DEFAULT FALSE,
    class_ofw_sea BOOLEAN DEFAULT FALSE,
    class_former_rebel BOOLEAN DEFAULT FALSE,
    class_trafficking_victim BOOLEAN DEFAULT FALSE,
    class_senior_citizen BOOLEAN DEFAULT FALSE,
    class_vawc_victim BOOLEAN DEFAULT FALSE,
    class_drug_related BOOLEAN DEFAULT FALSE,
    class_terrorism_arrested BOOLEAN DEFAULT FALSE,
    class_torture_victim BOOLEAN DEFAULT FALSE,
    class_voluntary_rehab BOOLEAN DEFAULT FALSE,
    class_foreign_national VARCHAR(100),
    class_refugee VARCHAR(100),
    class_urban_poor VARCHAR(100),
    class_rural_poor VARCHAR(100),
    class_indigenous_people VARCHAR(100),
    class_pwd_type VARCHAR(100),
    class_urban BOOLEAN DEFAULT FALSE,
    class_rural BOOLEAN DEFAULT FALSE,
    class_9165 BOOLEAN DEFAULT FALSE,
    class_female BOOLEAN DEFAULT FALSE,
    classification_notes TEXT
);

CREATE TABLE IF NOT EXISTS intake_record (
    intake_id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES client(client_id),
    interviewer_id INTEGER REFERENCES "user"(user_id),
    control_no VARCHAR(20) UNIQUE,
    form_date TIMESTAMP NOT NULL,
    region VARCHAR(50),
    district_office VARCHAR(255),
    party_represented VARCHAR(50),
    applicant_role VARCHAR(100),
    applicant_role_other VARCHAR(255),
    nature_of_request TEXT,
    nature_of_case VARCHAR(50),
    coi_agree_different_office BOOLEAN DEFAULT FALSE,
    coi_agree_same_dept_appeal BOOLEAN DEFAULT FALSE,
    coi_waive_right_to_complain BOOLEAN DEFAULT FALSE,
    coi_trust_assigned_counsel BOOLEAN DEFAULT FALSE,
    proof_submission_deadline TIMESTAMP,
    proof_itr_date TIMESTAMP,
    proof_brgy_date TIMESTAMP,
    proof_dswd_date TIMESTAMP,
    proof_others_details TEXT,
    proof_others_date TIMESTAMP,
    inv_plaintiff BOOLEAN DEFAULT FALSE,
    inv_defendant BOOLEAN DEFAULT FALSE,
    inv_oppositor BOOLEAN DEFAULT FALSE,
    inv_petitioner BOOLEAN DEFAULT FALSE,
    inv_respondent BOOLEAN DEFAULT FALSE,
    inv_complainant BOOLEAN DEFAULT FALSE,
    inv_accused BOOLEAN DEFAULT FALSE,
    inv_others TEXT
);

CREATE TABLE IF NOT EXISTS case_nature (
    nature_id SERIAL PRIMARY KEY,
    nature_name VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS court_branch (
    branch_id SERIAL PRIMARY KEY,
    branch_name VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS "case" (
    case_id SERIAL PRIMARY KEY,
    intake_id INTEGER REFERENCES intake_record(intake_id),
    client_id INTEGER REFERENCES client(client_id),
    nature_id INTEGER REFERENCES case_nature(nature_id),
    branch_id INTEGER REFERENCES court_branch(branch_id),
    title_of_case VARCHAR(50) NOT NULL,
    case_no VARCHAR(20),
    court_body VARCHAR(255),
    status_of_case VARCHAR(20) NOT NULL,
    last_action_taken TEXT,
    date_of_confinement TIMESTAMP,
    place_of_detention VARCHAR(255),
    location_type VARCHAR(20),
    cause_of_action TEXT,
    facts_of_case TEXT,
    pending_in_court BOOLEAN DEFAULT FALSE,
    date_of_termination TIMESTAMP,
    cause_of_termination TEXT,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS case_history (
    history_id SERIAL PRIMARY KEY,
    case_id INTEGER NOT NULL REFERENCES "case"(case_id),
    updated_by INTEGER NOT NULL REFERENCES "user"(user_id),
    previous_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL,
    action_taken TEXT NOT NULL,
    remarks TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS representative (
    rep_id SERIAL PRIMARY KEY,
    intake_id INTEGER REFERENCES intake_record(intake_id),
    rep_name TEXT NOT NULL,
    rep_age INTEGER,
    rep_sex VARCHAR(20),
    civil_status VARCHAR(50),
    rep_address TEXT,
    rep_contact_no TEXT,
    relationship_to_applicant VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS adverse_party (
    adverse_id SERIAL PRIMARY KEY,
    intake_id INTEGER REFERENCES intake_record(intake_id),
    role_plaintiff_complainant BOOLEAN DEFAULT FALSE,
    role_defendant_respondent_accused BOOLEAN DEFAULT FALSE,
    role_oppositor_others BOOLEAN DEFAULT FALSE,
    name TEXT NOT NULL,
    address TEXT
);

CREATE TABLE IF NOT EXISTS document (
    document_id SERIAL PRIMARY KEY,
    case_id INTEGER REFERENCES "case"(case_id),
    intake_id INTEGER REFERENCES intake_record(intake_id),
    uploaded_by INTEGER REFERENCES "user"(user_id),
    document_type VARCHAR(50),
    encrypted_file_path TEXT NOT NULL,
    original_filename VARCHAR(255),
    file_size_bytes INTEGER,
    ocr_status VARCHAR(20) DEFAULT 'PENDING',
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS extracted_metadata (
    meta_id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES document(document_id),
    verified_by INTEGER REFERENCES "user"(user_id),
    extracted_json JSONB NOT NULL,
    verification_status VARCHAR(20) DEFAULT 'PENDING',
    verified_at TIMESTAMP,
    verification_notes TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
    log_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "user"(user_id),
    action VARCHAR(50) NOT NULL,
    target_entity VARCHAR(50),
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    description TEXT,
    entity_id VARCHAR(100),
    extraction_mode VARCHAR(30),
    fallback_reason TEXT,
    previous_hash TEXT,
    current_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_role_id ON "user"(role_id);
CREATE INDEX IF NOT EXISTS idx_client_details_client_id ON client_details(client_id);
CREATE INDEX IF NOT EXISTS idx_client_classification_client_id ON client_classification(client_id);
CREATE INDEX IF NOT EXISTS idx_intake_record_client_id ON intake_record(client_id);
CREATE INDEX IF NOT EXISTS idx_intake_record_interviewer_id ON intake_record(interviewer_id);
CREATE INDEX IF NOT EXISTS idx_case_intake_id ON "case"(intake_id);
CREATE INDEX IF NOT EXISTS idx_case_client_id ON "case"(client_id);
CREATE INDEX IF NOT EXISTS idx_case_history_case_id ON case_history(case_id);
CREATE INDEX IF NOT EXISTS idx_case_history_updated_by ON case_history(updated_by);
CREATE INDEX IF NOT EXISTS idx_document_case_id ON document(case_id);
CREATE INDEX IF NOT EXISTS idx_document_intake_id ON document(intake_id);
CREATE INDEX IF NOT EXISTS idx_extracted_metadata_document_id ON extracted_metadata(document_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_prevent_update ON audit_log;
DROP TRIGGER IF EXISTS audit_log_prevent_delete ON audit_log;

CREATE TRIGGER audit_log_prevent_update
BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER audit_log_prevent_delete
BEFORE DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
