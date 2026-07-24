from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class Role(Base):
    __tablename__ = "role"

    role_id = Column(Integer, primary_key=True, index=True)
    role_name = Column(String(30), nullable=False)
    permissions = Column(Text)

    users = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "user"

    user_id = Column(Integer, primary_key=True, index=True)
    role_id = Column(Integer, ForeignKey("role.role_id"))
    username = Column(String(30), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    mfa_enabled = Column(Boolean, default=False)
    mfa_secret = Column(String(64))
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    # Practical UI/account fields used by the current React application.
    email = Column(String(255), index=True)
    full_name = Column(String(255), default="")
    approval_status = Column(String(30), nullable=False, default="pending")
    is_active = Column(Boolean, nullable=False, default=True)
    last_login_at = Column(DateTime)
    profile_image_path = Column(Text)
    profile_picture_path = Column(Text)
    profile_completed = Column(Boolean, nullable=False, default=False)
    first_name = Column(String(100))
    middle_name = Column(String(100))
    last_name = Column(String(100))
    suffix = Column(String(30))
    mobile_number = Column(String(30))
    address = Column(Text)
    sex = Column(String(20))
    birth_date = Column(String(30))

    role = relationship("Role", back_populates="users")


class Client(Base):
    __tablename__ = "client"

    client_id = Column(Integer, primary_key=True, index=True)
    name = Column(Text, nullable=False)
    age = Column(Integer)
    sex = Column(String(10))
    civil_status = Column(String(50))
    religion = Column(String(100))
    educational_attainment = Column(String(150))
    citizenship = Column(String(100))
    language_dialect = Column(String(100))
    created_at = Column(DateTime, server_default=func.now())
    deleted_at = Column(DateTime)

    details = relationship("ClientDetails", back_populates="client", uselist=False)
    classification = relationship("ClientClassification", back_populates="client", uselist=False)
    intakes = relationship("IntakeRecord", back_populates="client")
    cases = relationship("Case", back_populates="client")
    case_participations = relationship("CaseClient", back_populates="client")


class ClientClassification(Base):
    __tablename__ = "client_classification"

    classification_id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("client.client_id"), nullable=False)
    class_cicl = Column(Boolean, default=False)
    class_woman = Column(Boolean, default=False)
    class_law_enforcer = Column(Boolean, default=False)
    class_tenant_agrarian = Column(Boolean, default=False)
    class_ofw_land = Column(Boolean, default=False)
    class_ofw_sea = Column(Boolean, default=False)
    class_former_rebel = Column(Boolean, default=False)
    class_trafficking_victim = Column(Boolean, default=False)
    class_senior_citizen = Column(Boolean, default=False)
    class_vawc_victim = Column(Boolean, default=False)
    class_drug_related = Column(Boolean, default=False)
    class_terrorism_arrested = Column(Boolean, default=False)
    class_torture_victim = Column(Boolean, default=False)
    class_voluntary_rehab = Column(Boolean, default=False)
    class_foreign_national = Column(String(100))
    class_refugee = Column(String(100))
    class_urban_poor = Column(String(100))
    class_rural_poor = Column(String(100))
    class_indigenous_people = Column(String(100))
    class_pwd_type = Column(String(100))
    class_urban = Column(Boolean, default=False)
    class_rural = Column(Boolean, default=False)
    class_9165 = Column(Boolean, default=False)
    class_female = Column(Boolean, default=False)
    classification_notes = Column(Text)

    client = relationship("Client", back_populates="classification")


class ClientDetails(Base):
    __tablename__ = "client_details"

    details_id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("client.client_id"), nullable=False)
    address = Column(Text)
    contact_no = Column(Text)
    email = Column(Text)
    individual_monthly_income = Column(Text)
    spouse = Column(Text)
    address_of_spouse = Column(Text)
    contact_no_of_spouse = Column(Text)
    representative_name = Column(Text)
    representative_age = Column(Integer)
    representative_sex = Column(String(20))
    representative_civil_status = Column(String(50))
    representative_address = Column(Text)
    representative_contact_no = Column(Text)
    representative_relationship = Column(String(100))
    representative_email = Column(Text)
    detained = Column(Boolean, default=False)
    detained_since = Column(DateTime)
    place_of_detention = Column(String(255))

    client = relationship("Client", back_populates="details")


class IntakeRecord(Base):
    __tablename__ = "intake_record"

    intake_id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("client.client_id"))
    interviewer_id = Column(Integer, ForeignKey("user.user_id"))
    control_no = Column(String(20), unique=True)
    form_date = Column(DateTime, nullable=False)
    region = Column(String(50))
    district_office = Column(String(255))
    party_represented = Column(String(50))
    applicant_role = Column(String(100))
    applicant_role_other = Column(String(255))
    nature_of_request = Column(Text)
    nature_of_case = Column(String(50))
    coi_agree_different_office = Column(Boolean, default=False)
    coi_agree_same_dept_appeal = Column(Boolean, default=False)
    coi_waive_right_to_complain = Column(Boolean, default=False)
    coi_trust_assigned_counsel = Column(Boolean, default=False)
    proof_submission_deadline = Column(DateTime)
    proof_submission_satisfied = Column(Boolean, default=False)
    proof_itr_satisfied = Column(Boolean, default=False)
    proof_itr_date = Column(DateTime)
    proof_brgy_satisfied = Column(Boolean, default=False)
    proof_brgy_date = Column(DateTime)
    proof_dswd_satisfied = Column(Boolean, default=False)
    proof_dswd_date = Column(DateTime)
    proof_others_satisfied = Column(Boolean, default=False)
    proof_others_details = Column(Text)
    proof_others_date = Column(DateTime)
    inv_plaintiff = Column(Boolean, default=False)
    inv_defendant = Column(Boolean, default=False)
    inv_oppositor = Column(Boolean, default=False)
    inv_petitioner = Column(Boolean, default=False)
    inv_respondent = Column(Boolean, default=False)
    inv_complainant = Column(Boolean, default=False)
    inv_accused = Column(Boolean, default=False)
    inv_others = Column(Text)

    client = relationship("Client", back_populates="intakes")
    cases = relationship("Case", back_populates="intake")
    representatives = relationship("Representative", back_populates="intake")
    adverse_parties = relationship("AdverseParty", back_populates="intake")


class CaseNature(Base):
    __tablename__ = "case_nature"

    nature_id = Column(Integer, primary_key=True, index=True)
    nature_name = Column(String(50), nullable=False)


class CourtBranch(Base):
    __tablename__ = "court_branch"

    branch_id = Column(Integer, primary_key=True, index=True)
    branch_name = Column(String(50), nullable=False)


class Case(Base):
    __tablename__ = "case"

    case_id = Column(Integer, primary_key=True, index=True)
    intake_id = Column(Integer, ForeignKey("intake_record.intake_id"))
    client_id = Column(Integer, ForeignKey("client.client_id"))
    nature_id = Column(Integer, ForeignKey("case_nature.nature_id"))
    branch_id = Column(Integer, ForeignKey("court_branch.branch_id"))
    title_of_case = Column(String(255), nullable=False)
    case_no = Column(String(20))
    court_body = Column(String(255))
    status_of_case = Column(String(20), nullable=False)
    case_status = Column(String(30))
    incident_barangay = Column(String(120))
    incident_city = Column(String(120), default="Panabo City")
    incident_address = Column(Text)
    latitude = Column(String(50))
    longitude = Column(String(50))
    last_action_taken = Column(Text)
    detained = Column(Boolean, default=False)
    date_of_confinement = Column(DateTime)
    place_of_detention = Column(String(255))
    location_type = Column(String(20))
    cause_of_action = Column(Text)
    facts_of_case = Column(Text)
    pending_in_court = Column(Boolean, default=False)
    date_of_termination = Column(DateTime)
    cause_of_termination = Column(Text)
    assigned_pao = Column(String(255))
    hearing_schedule = Column(String(255))
    remarks = Column(Text)
    terminated_at = Column(DateTime)
    termination_reason = Column(Text)
    termination_remarks = Column(Text)
    resolution_type = Column(String(100))
    terminated_by = Column(Integer, ForeignKey("user.user_id"))
    handled_by = Column(String(255))
    supporting_document_path = Column(Text)
    is_terminated = Column(Boolean, default=False)
    last_updated = Column(DateTime, server_default=func.now(), onupdate=func.now())

    intake = relationship("IntakeRecord", back_populates="cases")
    client = relationship("Client", back_populates="cases")
    participants = relationship("CaseClient", back_populates="case", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="case")
    history = relationship("CaseHistory", back_populates="case")


class CaseClient(Base):
    __tablename__ = "case_client"
    __table_args__ = (UniqueConstraint("case_id", "client_id", name="uq_case_client_case_client"),)

    case_client_id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("case.case_id"), nullable=False, index=True)
    client_id = Column(Integer, ForeignKey("client.client_id"), nullable=False, index=True)
    party_represented = Column(String(100))
    applicant_role = Column(String(100))
    applicant_role_other = Column(String(255))
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    case = relationship("Case", back_populates="participants")
    client = relationship("Client", back_populates="case_participations")


class CaseHistory(Base):
    __tablename__ = "case_history"

    history_id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("case.case_id"), nullable=False)
    updated_by = Column(Integer, ForeignKey("user.user_id"), nullable=False)
    previous_status = Column(String(20))
    new_status = Column(String(20), nullable=False)
    action_taken = Column(Text, nullable=False)
    remarks = Column(Text)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    case = relationship("Case", back_populates="history")


class Representative(Base):
    __tablename__ = "representative"

    rep_id = Column(Integer, primary_key=True, index=True)
    intake_id = Column(Integer, ForeignKey("intake_record.intake_id"))
    rep_name = Column(Text, nullable=False)
    rep_age = Column(Integer)
    rep_sex = Column(String(20))
    civil_status = Column(String(50))
    rep_address = Column(Text)
    rep_contact_no = Column(Text)
    relationship_to_applicant = Column(String(50))

    intake = relationship("IntakeRecord", back_populates="representatives")


class AdverseParty(Base):
    __tablename__ = "adverse_party"

    adverse_id = Column(Integer, primary_key=True, index=True)
    intake_id = Column(Integer, ForeignKey("intake_record.intake_id"))
    role_plaintiff_complainant = Column(Boolean, default=False)
    role_defendant_respondent_accused = Column(Boolean, default=False)
    role_oppositor_others = Column(Boolean, default=False)
    name = Column(Text, nullable=False)
    address = Column(Text)

    intake = relationship("IntakeRecord", back_populates="adverse_parties")


class Document(Base):
    __tablename__ = "document"

    document_id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("case.case_id"))
    intake_id = Column(Integer, ForeignKey("intake_record.intake_id"))
    uploaded_by = Column(Integer, ForeignKey("user.user_id"))
    document_type = Column(String(50))
    encrypted_file_path = Column(Text, nullable=False)
    ocr_status = Column(String(20), default="PENDING")
    uploaded_at = Column(DateTime, nullable=False, server_default=func.now())

    case = relationship("Case", back_populates="documents")
    extracted_metadata = relationship("ExtractedMetadata", back_populates="document")


class ExtractedMetadata(Base):
    __tablename__ = "extracted_metadata"

    meta_id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("document.document_id"))
    verified_by = Column(Integer, ForeignKey("user.user_id"))
    extracted_json = Column(JSONB, nullable=False)
    verification_status = Column(String(20), default="PENDING")
    verified_at = Column(DateTime)

    document = relationship("Document", back_populates="extracted_metadata")


class AuditLog(Base):
    __tablename__ = "audit_log"

    log_id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.user_id"))
    action = Column(String(50), nullable=False)
    target_entity = Column(String(50))
    timestamp = Column(DateTime, nullable=False, server_default=func.now())
    ip_address = Column(String(45))
    description = Column(Text)
    entity_id = Column(String(100))
    extraction_mode = Column(String(30))
    fallback_reason = Column(Text)
    previous_hash = Column(Text)
    current_hash = Column(Text)

    user = relationship("User")


class CaseSubmission(Base):
    __tablename__ = "case_submission"

    submission_id = Column(Integer, primary_key=True, index=True)
    parent_submission_id = Column(Integer, ForeignKey("case_submission.submission_id"))
    staff_id = Column(Integer, ForeignKey("user.user_id"), nullable=False, index=True)
    title = Column(Text, nullable=False)
    date_from = Column(DateTime, nullable=False)
    date_to = Column(DateTime, nullable=False)
    status = Column(String(30), nullable=False, default="Draft", index=True)
    version = Column(Integer, nullable=False, default=1)
    notes = Column(Text)
    submitted_at = Column(DateTime)
    approved_at = Column(DateTime)
    reviewed_by = Column(Integer, ForeignKey("user.user_id"))
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    staff = relationship("User", foreign_keys=[staff_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    parent_submission = relationship("CaseSubmission", remote_side=[submission_id])
    items = relationship("CaseSubmissionItem", back_populates="submission", cascade="all, delete-orphan")
    feedback = relationship("SubmissionFeedback", back_populates="submission", cascade="all, delete-orphan")


class CaseSubmissionItem(Base):
    __tablename__ = "case_submission_item"

    submission_item_id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("case_submission.submission_id"), nullable=False, index=True)
    case_id = Column(Integer, ForeignKey("case.case_id"), nullable=False, index=True)
    snapshot_json = Column(JSONB, nullable=False)

    submission = relationship("CaseSubmission", back_populates="items")
    case = relationship("Case")


class SubmissionFeedback(Base):
    __tablename__ = "submission_feedback"

    feedback_id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("case_submission.submission_id"), nullable=False, index=True)
    reviewer_id = Column(Integer, ForeignKey("user.user_id"), nullable=False)
    comments = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    submission = relationship("CaseSubmission", back_populates="feedback")
    reviewer = relationship("User", foreign_keys=[reviewer_id])
