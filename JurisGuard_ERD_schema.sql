-- JurisGuard ERD Schema
-- Generated from the updated ERD and aligned 1:1 with backend/models.py (31 tables).
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
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    email VARCHAR(255),
    full_name VARCHAR(255) DEFAULT '',
    approval_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP,
    profile_image_path TEXT,
    profile_picture_path TEXT,
    profile_completed BOOLEAN NOT NULL DEFAULT FALSE,
    first_name VARCHAR(100),
    middle_name VARCHAR(100),
    last_name VARCHAR(100),
    suffix VARCHAR(30),
    mobile_number VARCHAR(30),
    address TEXT,
    sex VARCHAR(20),
    birth_date VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS revoked_access_token (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "user"(user_id),
    expires_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS user_presence (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "user"(user_id),
    last_seen_at TIMESTAMP NOT NULL,
    last_interaction_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS client (
    client_id SERIAL PRIMARY KEY,
    created_by_user_id INTEGER REFERENCES "user"(user_id),
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
    class_cicl BOOLEAN,
    class_woman BOOLEAN DEFAULT FALSE,
    class_law_enforcer BOOLEAN DEFAULT FALSE,
    class_tenant_agrarian BOOLEAN DEFAULT FALSE,
    class_ofw_land BOOLEAN DEFAULT FALSE,
    class_ofw_sea BOOLEAN DEFAULT FALSE,
    class_former_rebel BOOLEAN DEFAULT FALSE,
    class_trafficking_victim BOOLEAN DEFAULT FALSE,
    class_senior_citizen BOOLEAN,
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
    class_female BOOLEAN,
    flags_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
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
    proof_submission_satisfied BOOLEAN DEFAULT FALSE,
    proof_itr_satisfied BOOLEAN DEFAULT FALSE,
    proof_itr_date TIMESTAMP,
    proof_brgy_satisfied BOOLEAN DEFAULT FALSE,
    proof_brgy_date TIMESTAMP,
    proof_dswd_satisfied BOOLEAN DEFAULT FALSE,
    proof_dswd_date TIMESTAMP,
    proof_others_satisfied BOOLEAN DEFAULT FALSE,
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
    case_type VARCHAR(30) NOT NULL DEFAULT 'Criminal',
    title_of_case VARCHAR(255) NOT NULL,
    case_no VARCHAR(20),
    court_body VARCHAR(255),
    status_of_case VARCHAR(20) NOT NULL,
    case_status VARCHAR(30),
    incident_barangay VARCHAR(120),
    incident_city VARCHAR(120),
    incident_address TEXT,
    latitude VARCHAR(50),
    longitude VARCHAR(50),
    last_action_taken TEXT,
    detained BOOLEAN DEFAULT FALSE,
    date_of_confinement TIMESTAMP,
    place_of_detention VARCHAR(255),
    location_type VARCHAR(20),
    cause_of_action TEXT,
    facts_of_case TEXT,
    pending_in_court BOOLEAN DEFAULT FALSE,
    date_of_termination TIMESTAMP,
    cause_of_termination TEXT,
    assigned_pao VARCHAR(255),
    hearing_schedule VARCHAR(255),
    remarks TEXT,
    terminated_at TIMESTAMP,
    termination_reason TEXT,
    termination_remarks TEXT,
    resolution_type VARCHAR(100),
    terminated_by INTEGER REFERENCES "user"(user_id),
    handled_by VARCHAR(255),
    supporting_document_path TEXT,
    is_terminated BOOLEAN DEFAULT FALSE,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
    ocr_status VARCHAR(20) DEFAULT 'PENDING',
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS extracted_metadata (
    meta_id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES document(document_id),
    verified_by INTEGER REFERENCES "user"(user_id),
    extracted_json JSONB NOT NULL,
    verification_status VARCHAR(20) DEFAULT 'PENDING',
    verified_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS paper_extraction_draft (
    draft_id VARCHAR(64) PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES document(document_id),
    extraction_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS reviewed_paper_intake (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL UNIQUE REFERENCES client(client_id),
    document_id INTEGER NOT NULL UNIQUE REFERENCES document(document_id),
    reviewed_by INTEGER NOT NULL REFERENCES "user"(user_id),
    reviewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sections JSONB NOT NULL,
    unreadable_fields JSONB NOT NULL,
    field_reviews JSONB,
    checkbox_states JSONB,
    source_draft_id VARCHAR(64),
    candidate_snapshot JSONB
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
);

CREATE TABLE IF NOT EXISTS case_submission_item (
    submission_item_id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES case_submission(submission_id),
    case_id INTEGER NOT NULL REFERENCES "case"(case_id),
    snapshot_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS submission_feedback (
    feedback_id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES case_submission(submission_id),
    reviewer_id INTEGER NOT NULL REFERENCES "user"(user_id),
    comments TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS case_transfer_report (
    report_id SERIAL PRIMARY KEY,
    parent_report_id INTEGER REFERENCES case_transfer_report(report_id),
    from_user_id INTEGER NOT NULL REFERENCES "user"(user_id),
    to_user_id INTEGER NOT NULL REFERENCES "user"(user_id),
    initiated_by_user_id INTEGER REFERENCES "user"(user_id),
    title TEXT NOT NULL,
    report_date TIMESTAMP NOT NULL,
    date_received TIMESTAMP,
    status VARCHAR(30) NOT NULL DEFAULT 'Draft',
    remarks TEXT,
    submitted_at TIMESTAMP,
    returned_at TIMESTAMP,
    confirmed_at TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS case_transfer_item (
    item_id SERIAL PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES case_transfer_report(report_id),
    case_id INTEGER NOT NULL REFERENCES "case"(case_id),
    section VARCHAR(20) NOT NULL,
    snapshot_json JSONB NOT NULL,
    CONSTRAINT uq_case_transfer_report_case UNIQUE (report_id, case_id)
);

CREATE TABLE IF NOT EXISTS case_transfer_administrative_entry (
    entry_id SERIAL PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES case_transfer_report(report_id),
    section VARCHAR(10) NOT NULL,
    row_number INTEGER NOT NULL,
    control_no VARCHAR(100),
    title_of_case TEXT,
    docket_no VARCHAR(100),
    date_received TIMESTAMP,
    status_of_case VARCHAR(100),
    cause_of_action TEXT
);

CREATE TABLE IF NOT EXISTS notification (
    notification_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES "user"(user_id),
    event_key VARCHAR(200) NOT NULL,
    notification_type VARCHAR(50) NOT NULL DEFAULT 'workflow',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    redirect_to TEXT NOT NULL,
    entity_type VARCHAR(50),
    entity_id VARCHAR(100),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_notification_user_event UNIQUE (user_id, event_key)
);

CREATE TABLE IF NOT EXISTS private_message (
    message_id SERIAL PRIMARY KEY,
    sender_user_id INTEGER NOT NULL REFERENCES "user"(user_id),
    recipient_user_id INTEGER NOT NULL REFERENCES "user"(user_id),
    content TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS private_message_reaction (
    reaction_id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES private_message(message_id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
    emoji VARCHAR(16) NOT NULL,
    CONSTRAINT uq_private_message_reaction_user UNIQUE (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS reminder (
    reminder_id SERIAL PRIMARY KEY,
    created_by_user_id INTEGER NOT NULL REFERENCES "user"(user_id),
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    reminder_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    category VARCHAR(40) NOT NULL DEFAULT 'Other',
    priority VARCHAR(20) NOT NULL DEFAULT 'Normal',
    visibility VARCHAR(20) NOT NULL DEFAULT 'personal',
    notification_minutes_before INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'Upcoming',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calendar_holiday (
    holiday_id SERIAL PRIMARY KEY,
    source_key VARCHAR(120) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    holiday_date DATE NOT NULL,
    classification VARCHAR(80) NOT NULL,
    coverage VARCHAR(20) NOT NULL,
    geographic_scope VARCHAR(160) NOT NULL,
    reference VARCHAR(255) NOT NULL,
    source_url TEXT NOT NULL,
    year INTEGER NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_role_id ON "user"(role_id);
CREATE INDEX IF NOT EXISTS idx_user_email ON "user"(email);
CREATE INDEX IF NOT EXISTS idx_revoked_access_token_user_id ON revoked_access_token(user_id);
CREATE INDEX IF NOT EXISTS idx_revoked_access_token_expires_at ON revoked_access_token(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_presence_user_id ON user_presence(user_id);
CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen_at ON user_presence(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_user_presence_expires_at ON user_presence(expires_at);
CREATE INDEX IF NOT EXISTS idx_client_created_by_user_id ON client(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_client_details_client_id ON client_details(client_id);
CREATE INDEX IF NOT EXISTS idx_client_classification_client_id ON client_classification(client_id);
CREATE INDEX IF NOT EXISTS idx_intake_record_client_id ON intake_record(client_id);
CREATE INDEX IF NOT EXISTS idx_intake_record_interviewer_id ON intake_record(interviewer_id);
CREATE INDEX IF NOT EXISTS ix_intake_interviewer_form_date ON intake_record(interviewer_id, form_date);
CREATE INDEX IF NOT EXISTS ix_case_type_status_updated_id ON "case"(case_type, status_of_case, last_updated, case_id);
CREATE INDEX IF NOT EXISTS idx_case_intake_id ON "case"(intake_id);
CREATE INDEX IF NOT EXISTS idx_case_client_id ON "case"(client_id);
CREATE INDEX IF NOT EXISTS idx_case_client_case_id ON case_client(case_id);
CREATE INDEX IF NOT EXISTS idx_case_client_client_id ON case_client(client_id);
CREATE INDEX IF NOT EXISTS idx_case_history_case_id ON case_history(case_id);
CREATE INDEX IF NOT EXISTS idx_case_history_updated_by ON case_history(updated_by);
CREATE INDEX IF NOT EXISTS idx_document_case_id ON document(case_id);
CREATE INDEX IF NOT EXISTS idx_document_intake_id ON document(intake_id);
CREATE INDEX IF NOT EXISTS idx_extracted_metadata_document_id ON extracted_metadata(document_id);
CREATE INDEX IF NOT EXISTS idx_paper_extraction_draft_document_id ON paper_extraction_draft(document_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_case_submission_staff_id ON case_submission(staff_id);
CREATE INDEX IF NOT EXISTS idx_case_submission_status ON case_submission(status);
CREATE INDEX IF NOT EXISTS idx_case_submission_item_submission_id ON case_submission_item(submission_id);
CREATE INDEX IF NOT EXISTS idx_case_submission_item_case_id ON case_submission_item(case_id);
CREATE INDEX IF NOT EXISTS idx_submission_feedback_submission_id ON submission_feedback(submission_id);
CREATE INDEX IF NOT EXISTS idx_case_transfer_report_from_user_id ON case_transfer_report(from_user_id);
CREATE INDEX IF NOT EXISTS idx_case_transfer_report_to_user_id ON case_transfer_report(to_user_id);
CREATE INDEX IF NOT EXISTS idx_case_transfer_report_initiated_by ON case_transfer_report(initiated_by_user_id);
CREATE INDEX IF NOT EXISTS idx_case_transfer_report_status ON case_transfer_report(status);
CREATE INDEX IF NOT EXISTS idx_case_transfer_item_report_id ON case_transfer_item(report_id);
CREATE INDEX IF NOT EXISTS idx_case_transfer_item_case_id ON case_transfer_item(case_id);
CREATE INDEX IF NOT EXISTS idx_case_transfer_admin_entry_report_id ON case_transfer_administrative_entry(report_id);
CREATE INDEX IF NOT EXISTS idx_notification_user_id ON notification(user_id);
CREATE INDEX IF NOT EXISTS ix_private_message_conversation ON private_message(sender_user_id, recipient_user_id, message_id);
CREATE INDEX IF NOT EXISTS ix_private_message_unread ON private_message(recipient_user_id, sender_user_id, read_at);
CREATE INDEX IF NOT EXISTS ix_private_message_reaction_message ON private_message_reaction(message_id);
CREATE INDEX IF NOT EXISTS idx_reminder_created_by ON reminder(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_reminder_date ON reminder(reminder_date);
CREATE INDEX IF NOT EXISTS idx_reminder_visibility ON reminder(visibility);
CREATE INDEX IF NOT EXISTS idx_reminder_status ON reminder(status);
CREATE INDEX IF NOT EXISTS idx_calendar_holiday_date ON calendar_holiday(holiday_date);
CREATE INDEX IF NOT EXISTS idx_calendar_holiday_coverage ON calendar_holiday(coverage);
CREATE INDEX IF NOT EXISTS idx_calendar_holiday_year ON calendar_holiday(year);

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
