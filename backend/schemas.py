from datetime import date, time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr

MESSAGE_REACTION_EMOJIS = ("👍", "❤️", "😂", "😮", "😢", "😡")


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
    model_config = ConfigDict(extra="forbid")
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
    limit = getattr(model.__table__.c[key].type, "length", None)
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
        "Client Meeting",
        "Court Hearing",
        "Document Deadline",
        "Follow-up",
        "Office Meeting",
        "Personal",
        "Other",
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
