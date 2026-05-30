import { AxiosError } from "axios";
import { apiClient } from "../api/client";
import type { ExtractionMap } from "../types";
import type { CaseFormValues, ClientFormValues } from "../features/criminalCases/schemas";

type PaoSections = Record<string, Record<string, unknown> | undefined>;

type PaoExtractedData = {
  rehiyon?: string | null;
  district_office?: string | null;
  control_no?: string | null;
  petsa?: string | null;
  action_merit_test?: boolean | null;
  action_representation?: boolean | null;
  action_legal_service_text?: string | null;
  action_other_text?: string | null;
  req_legal_doc?: boolean | null;
  req_oath?: boolean | null;
  req_court_rep?: boolean | null;
  req_inquest?: boolean | null;
  req_mediation?: boolean | null;
  req_other_text?: string | null;
  applicant_name?: string | null;
  applicant_age?: number | string | null;
  applicant_sex?: string | null;
  applicant_civil_status?: string | null;
  applicant_religion?: string | null;
  applicant_educational_attainment?: string | null;
  applicant_citizenship?: string | null;
  applicant_language_dialect?: string | null;
  applicant_address?: string | null;
  applicant_email?: string | null;
  applicant_contact?: string | null;
  spouse_name?: string | null;
  spouse_address?: string | null;
  spouse_contact?: string | null;
  individual_monthly_income?: string | null;
  is_detained?: boolean | null;
  detained_since?: string | null;
  place_of_detention?: string | null;
  rep_name?: string | null;
  rep_age?: number | string | null;
  rep_sex?: string | null;
  rep_civil_status?: string | null;
  rep_address?: string | null;
  rep_contact?: string | null;
  rep_relation?: string | null;
  rep_email?: string | null;
  case_type_criminal?: boolean | null;
  case_type_civil?: boolean | null;
  case_type_labor?: boolean | null;
  case_type_admin?: boolean | null;
  case_type_appealed?: boolean | null;
  sector_foreign_national?: boolean | string | null;
  sector_urban_poor?: boolean | string | null;
  sector_rural_poor?: boolean | string | null;
  sector_indigenous?: boolean | string | null;
  sector_pwd?: boolean | string | null;
  affidavit_income?: string | null;
  has_proof_submit_later?: boolean | string | null;
  has_proof_itr?: boolean | string | null;
  has_proof_brgy?: boolean | string | null;
  has_proof_dswd?: boolean | string | null;
  has_proof_other?: boolean | string | null;
  proof_submit_date?: string | null;
  proof_itr_date?: string | null;
  proof_brgy_date?: string | null;
  proof_dswd_date?: string | null;
  proof_other_text?: string | null;
  applicant_role?: string | null;
  adversary_role?: string | null;
  adversary_name?: string | null;
  adversary_address?: string | null;
  case_information?: string | null;
  cause_of_action?: string | null;
  is_filed_in_court?: boolean | string | null;
  case_docket_title?: string | null;
  court_body?: string | null;
  extraction_mode?: string | null;
  raw_text?: string | null;
  sections?: PaoSections | null;
};

type UploadDocumentResponse = {
  message: string;
  document_id: number;
  extracted_data: PaoExtractedData;
};

export type ClientExtractionResult = {
  documentId: number;
  extracted: {
    client: Partial<ClientFormValues["client"]>;
    client_details: Partial<ClientFormValues["client_details"]>;
    client_classification: Partial<ClientFormValues["client_classification"]>;
  };
  indicators: ExtractionMap;
};

export type CaseExtractionResult = {
  documentId: number;
  extracted: {
    intake_record: Partial<CaseFormValues["intake_record"]>;
    representative: Partial<CaseFormValues["representative"]>;
    adverse_party: Partial<CaseFormValues["adverse_party"]>;
    cases: Partial<CaseFormValues["cases"]>;
  };
  indicators: ExtractionMap;
};

type UploadOptions = {
  caseId?: number;
  userId?: number;
  extractionMode?: ExtractionEngineMode;
};

const DEFAULT_BACKEND_USER_ID = 1;
export type ExtractionEngineMode = "auto" | "offline" | "cloud";

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function sectionValue(
  extractedData: PaoExtractedData,
  sectionName: string,
  fieldName: string,
  fallback?: unknown
) {
  const value = extractedData.sections?.[sectionName]?.[fieldName];
  return value === undefined || value === null || value === "" ? fallback : value;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;

  const parsed = Number.parseInt(value.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isTrue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["true", "yes", "oo", "checked", "1"].includes(value.trim().toLowerCase());
  }
  return false;
}

function normalizeSex(value: unknown): string | undefined {
  const text = cleanText(value)?.toLowerCase();
  if (!text) return undefined;
  if (["m", "male", "lalaki"].includes(text)) return "Male";
  if (["f", "female", "babae"].includes(text)) return "Female";
  return cleanText(value);
}

const MONTH_ALIASES: Record<string, number> = {
  january: 1,
  jan: 1,
  enero: 1,
  february: 2,
  feb: 2,
  pebrero: 2,
  march: 3,
  mar: 3,
  marso: 3,
  april: 4,
  apr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  june: 6,
  jun: 6,
  hunyo: 6,
  july: 7,
  jul: 7,
  hulyo: 7,
  august: 8,
  aug: 8,
  agosto: 8,
  september: 9,
  sept: 9,
  sep: 9,
  setyembre: 9,
  septiyembre: 9,
  october: 10,
  oct: 10,
  oktubre: 10,
  november: 11,
  nov: 11,
  nobyembre: 11,
  december: 12,
  dec: 12,
  disyembre: 12,
};

function formatDateInput(year: number, month: number, day: number): string | undefined {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${mm}/${dd}/${year}`;
}

function normalizeDateOcrText(value: string) {
  return value
    .replace(/\bpetsa\b\s*:?\s*/gi, " ")
    .replace(/[|_]+/g, " ")
    .replace(/[–—−]/g, "-")
    .replace(/([0-9])\s*[,./-]\s*([0-9])/g, "$1/$2")
    .replace(/\b([0-9OIRL]{4})\b/gi, (year) =>
      year
        .toUpperCase()
        .replace(/O/g, "0")
        .replace(/[IRL]/g, "1")
    )
    .replace(/\s+/g, " ")
    .trim();
}

function parseFormDate(value: unknown): string | undefined {
  const text = cleanText(value);
  if (!text) return undefined;

  const normalized = normalizeDateOcrText(text);
  const monthNames = Object.keys(MONTH_ALIASES)
    .sort((left, right) => right.length - left.length)
    .join("|");
  const monthMatch = normalized.match(
    new RegExp(`\\b(${monthNames})\\b\\s*([0-9]{1,2})?\\s*,?\\s*(20[0-9]{2}|19[0-9]{2})\\b`, "i")
  );

  if (monthMatch) {
    const month = MONTH_ALIASES[monthMatch[1].toLowerCase()];
    const day = monthMatch[2] ? Number.parseInt(monthMatch[2], 10) : 1;
    const year = Number.parseInt(monthMatch[3], 10);
    return formatDateInput(year, month, day);
  }

  const numericMatch = normalized.match(/\b([0-9]{1,2})\/([0-9]{1,2})\/((?:19|20)[0-9]{2})\b/);
  if (numericMatch) {
    const first = Number.parseInt(numericMatch[1], 10);
    const second = Number.parseInt(numericMatch[2], 10);
    const year = Number.parseInt(numericMatch[3], 10);
    const day = first > 12 ? first : second;
    const month = first > 12 ? second : first;
    return formatDateInput(year, month, day);
  }

  return undefined;
}

function joinLabels(labels: Array<string | false | undefined>): string | undefined {
  const value = labels.filter(Boolean).join("; ");
  return value || undefined;
}

function addIndicator(indicators: ExtractionMap, path: string, value: unknown) {
  indicators[path] =
    value === undefined || value === null || value === "" || value === false
      ? "missing"
      : "extracted";
}

function getUploadError(error: unknown) {
  if (error instanceof AxiosError) {
    const detail = error.response?.data?.detail;
    return typeof detail === "string" ? detail : "Document extraction failed";
  }
  return error instanceof Error ? error.message : "Document extraction failed";
}

async function uploadDocumentForExtraction(
  file: File,
  { caseId, userId = DEFAULT_BACKEND_USER_ID, extractionMode = "auto" }: UploadOptions = {}
) {
  const formData = new FormData();
  formData.append("file", file);
  const params: Record<string, number | string> = {
    user_id: userId,
    extraction_mode: extractionMode,
  };
  if (caseId !== undefined) {
    params.case_id = caseId;
  }

  try {
    const response = await apiClient.post<UploadDocumentResponse>("/upload-document/", formData, {
      params,
    });
    return response.data;
  } catch (error) {
    throw new Error(getUploadError(error));
  }
}

export async function extractClientFromDocument(
  file: File,
  options?: UploadOptions
): Promise<ClientExtractionResult> {
  const { document_id, extracted_data } = await uploadDocumentForExtraction(file, options);
  const applicant = (fieldName: string, fallback?: unknown) =>
    sectionValue(extracted_data, "applicant_personal_circumstances", fieldName, fallback);
  const representative = (fieldName: string, fallback?: unknown) =>
    sectionValue(extracted_data, "representative_personal_circumstances", fieldName, fallback);
  const classification = (fieldName: string, fallback?: unknown) =>
    sectionValue(extracted_data, "applicant_classification", fieldName, fallback);
  const affidavit = (fieldName: string, fallback?: unknown) =>
    sectionValue(extracted_data, "affidavit_of_indigency", fieldName, fallback);

  const extracted: ClientExtractionResult["extracted"] = {
    client: {
      name: cleanText(applicant("name", extracted_data.applicant_name)),
      age: toNumber(applicant("age", extracted_data.applicant_age)),
      sex: normalizeSex(applicant("sex", extracted_data.applicant_sex)),
      civil_status: cleanText(applicant("civil_status", extracted_data.applicant_civil_status)),
      religion: cleanText(applicant("religion", extracted_data.applicant_religion)),
      educational_attainment: cleanText(applicant("educational_attainment", extracted_data.applicant_educational_attainment)),
      citizenship: cleanText(applicant("citizenship", extracted_data.applicant_citizenship)) || "Filipino",
      language_dialect: cleanText(applicant("language_dialect", extracted_data.applicant_language_dialect)),
    },
    client_details: {
      address: cleanText(applicant("address", extracted_data.applicant_address)),
      email: cleanText(applicant("email", extracted_data.applicant_email)),
      contact_no: cleanText(applicant("contact_no", extracted_data.applicant_contact)),
      individual_monthly_income: cleanText(applicant("individual_monthly_income", extracted_data.individual_monthly_income)) || cleanText(affidavit("monthly_net_salary_income", extracted_data.affidavit_income)),
      spouse: cleanText(applicant("spouse", extracted_data.spouse_name)),
      address_of_spouse: cleanText(applicant("address_of_spouse", extracted_data.spouse_address)),
      contact_no_of_spouse: cleanText(applicant("contact_no_of_spouse", extracted_data.spouse_contact)),
      representative_name: cleanText(representative("name", extracted_data.rep_name)),
      representative_age: toNumber(representative("age", extracted_data.rep_age)),
      representative_sex: normalizeSex(representative("sex", extracted_data.rep_sex)),
      representative_civil_status: cleanText(representative("civil_status", extracted_data.rep_civil_status)),
      representative_address: cleanText(representative("address", extracted_data.rep_address)),
      representative_contact_no: cleanText(representative("contact_no", extracted_data.rep_contact)),
      representative_relationship: cleanText(representative("relationship_to_applicant", extracted_data.rep_relation)),
      representative_email: cleanText(representative("email", extracted_data.rep_email)),
      detained: isTrue(applicant("detained", extracted_data.is_detained)),
      detained_since: parseFormDate(applicant("detained_since", extracted_data.detained_since)),
      place_of_detention: cleanText(applicant("place_of_detention", extracted_data.place_of_detention)),
    },
    client_classification: {
      flag_foreign_national: isTrue(classification("foreign_national", extracted_data.sector_foreign_national)),
      flag_urban: isTrue(classification("urban_poor", extracted_data.sector_urban_poor)),
      flag_rural: isTrue(classification("rural_poor", extracted_data.sector_rural_poor)),
      flag_indigenous_people: isTrue(classification("indigenous_people", extracted_data.sector_indigenous)),
      flag_pwd: isTrue(classification("pwd", extracted_data.sector_pwd)),
      classification_notes: cleanText(extracted_data.extraction_mode),
    },
  };

  const indicators: ExtractionMap = {};
  [
    ["client.name", extracted.client.name],
    ["client.age", extracted.client.age],
    ["client.sex", extracted.client.sex],
    ["client.civil_status", extracted.client.civil_status],
    ["client.religion", extracted.client.religion],
    ["client.educational_attainment", extracted.client.educational_attainment],
    ["client.citizenship", extracted.client.citizenship],
    ["client.language_dialect", extracted.client.language_dialect],
    ["client_details.address", extracted.client_details.address],
    ["client_details.email", extracted.client_details.email],
    ["client_details.contact_no", extracted.client_details.contact_no],
    ["client_details.individual_monthly_income", extracted.client_details.individual_monthly_income],
    ["client_details.spouse", extracted.client_details.spouse],
    ["client_details.address_of_spouse", extracted.client_details.address_of_spouse],
    ["client_details.contact_no_of_spouse", extracted.client_details.contact_no_of_spouse],
    ["client_details.representative_name", extracted.client_details.representative_name],
    ["client_details.representative_age", extracted.client_details.representative_age],
    ["client_details.representative_sex", extracted.client_details.representative_sex],
    ["client_details.representative_civil_status", extracted.client_details.representative_civil_status],
    ["client_details.representative_address", extracted.client_details.representative_address],
    ["client_details.representative_contact_no", extracted.client_details.representative_contact_no],
    ["client_details.representative_relationship", extracted.client_details.representative_relationship],
    ["client_details.representative_email", extracted.client_details.representative_email],
    ["client_details.detained", extracted.client_details.detained],
    ["client_details.detained_since", extracted.client_details.detained_since],
    ["client_details.place_of_detention", extracted.client_details.place_of_detention],
    ["client_classification.flag_foreign_national", extracted.client_classification.flag_foreign_national],
    ["client_classification.flag_urban", extracted.client_classification.flag_urban],
    ["client_classification.flag_rural", extracted.client_classification.flag_rural],
    ["client_classification.flag_indigenous_people", extracted.client_classification.flag_indigenous_people],
    ["client_classification.flag_pwd", extracted.client_classification.flag_pwd],
    ["client_classification.classification_notes", extracted.client_classification.classification_notes],
  ].forEach(([path, value]) => addIndicator(indicators, String(path), value));

  return { documentId: document_id, extracted, indicators };
}

export async function extractCaseFromDocument(
  file: File,
  options?: UploadOptions
): Promise<CaseExtractionResult> {
  const { document_id, extracted_data } = await uploadDocumentForExtraction(file, options);
  const header = (fieldName: string, fallback?: unknown) =>
    sectionValue(extracted_data, "header", fieldName, fallback);
  const request = (fieldName: string, fallback?: unknown) =>
    sectionValue(extracted_data, "nature_of_request", fieldName, fallback);
  const applicant = (fieldName: string, fallback?: unknown) =>
    sectionValue(extracted_data, "applicant_personal_circumstances", fieldName, fallback);
  const representative = (fieldName: string, fallback?: unknown) =>
    sectionValue(extracted_data, "representative_personal_circumstances", fieldName, fallback);
  const nature = (fieldName: string, fallback?: unknown) =>
    sectionValue(extracted_data, "nature_of_case", fieldName, fallback);
  const proof = (fieldName: string, fallback?: unknown) =>
    sectionValue(extracted_data, "proof_of_indigency", fieldName, fallback);
  const involvement = (fieldName: string, fallback?: unknown) =>
    sectionValue(extracted_data, "applicant_case_involvement", fieldName, fallback);
  const adverse = (fieldName: string, fallback?: unknown) =>
    sectionValue(extracted_data, "adverse_party", fieldName, fallback);
  const caseDetails = (fieldName: string, fallback?: unknown) =>
    sectionValue(extracted_data, "case_details", fieldName, fallback);

  const natureOfRequest = joinLabels([
    isTrue(request("legal_documentation", extracted_data.req_legal_doc)) && "Legal Documentation",
    isTrue(request("administration_of_oath", extracted_data.req_oath)) && "Administration of Oath",
    isTrue(request("representation_in_court_or_quasi_judicial_bodies", extracted_data.req_court_rep)) && "Representation in Court or Office",
    isTrue(request("inquest_legal_assistance", extracted_data.req_inquest)) && "Inquest Legal Assistance",
    isTrue(request("mediation_conciliation", extracted_data.req_mediation)) && "Mediation/Conciliation",
    cleanText(request("others_text", extracted_data.req_other_text)),
  ]);
  const natureOfCase = joinLabels([
    isTrue(nature("criminal", extracted_data.case_type_criminal)) && "Criminal",
    isTrue(nature("civil", extracted_data.case_type_civil)) && "Civil",
    isTrue(nature("labor", extracted_data.case_type_labor)) && "Labor",
    isTrue(nature("administrative", extracted_data.case_type_admin)) && "Administrative",
    isTrue(nature("appealed", extracted_data.case_type_appealed)) && "Appealed",
  ]);
  const lastActionTaken = joinLabels([
    isTrue(extracted_data.action_merit_test) && "For merit and indigency test",
    isTrue(extracted_data.action_representation) && "For representation and legal assistance",
    cleanText(extracted_data.action_legal_service_text),
    cleanText(extracted_data.action_other_text),
  ]);

  const extracted: CaseExtractionResult["extracted"] = {
    intake_record: {
      control_no: cleanText(header("control_no", extracted_data.control_no)),
      form_date: parseFormDate(header("date", extracted_data.petsa)),
      region: cleanText(header("region", extracted_data.rehiyon)),
      district_office: cleanText(header("district_office", extracted_data.district_office)),
      party_represented: cleanText(applicant("name", extracted_data.applicant_name)),
      applicant_role: cleanText(extracted_data.applicant_role),
      nature_of_request: natureOfRequest,
      nature_of_case: natureOfCase,
      proof_submission_deadline: parseFormDate(proof("submission_deadline", extracted_data.proof_submit_date)),
      proof_itr_date: parseFormDate(proof("income_tax_return_date", extracted_data.proof_itr_date)),
      proof_brgy_date: parseFormDate(proof("barangay_certification_date", extracted_data.proof_brgy_date)),
      proof_dswd_date: parseFormDate(proof("dswd_certification_date", extracted_data.proof_dswd_date)),
      proof_others_details: cleanText(proof("others_text", extracted_data.proof_other_text)),
      inv_plaintiff: isTrue(involvement("plaintiff")) || cleanText(extracted_data.applicant_role).toLowerCase() === "plaintiff",
      inv_defendant: isTrue(involvement("defendant")) || cleanText(extracted_data.applicant_role).toLowerCase() === "defendant",
      inv_oppositor: isTrue(involvement("oppositor")) || cleanText(extracted_data.applicant_role).toLowerCase() === "oppositor",
      inv_petitioner: isTrue(involvement("petitioner")) || cleanText(extracted_data.applicant_role).toLowerCase() === "petitioner",
      inv_respondent: isTrue(involvement("respondent")) || cleanText(extracted_data.applicant_role).toLowerCase() === "respondent",
      inv_complainant: isTrue(involvement("complainant")) || cleanText(extracted_data.applicant_role).toLowerCase() === "complainant",
      inv_accused: isTrue(involvement("accused")) || cleanText(extracted_data.applicant_role).toLowerCase() === "accused",
    },
    representative: {
      rep_name: cleanText(representative("name", extracted_data.rep_name)),
      rep_age: toNumber(representative("age", extracted_data.rep_age)),
      rep_sex: normalizeSex(representative("sex", extracted_data.rep_sex)),
      civil_status: cleanText(representative("civil_status", extracted_data.rep_civil_status)),
      rep_address: cleanText(representative("address", extracted_data.rep_address)),
      rep_contact_no: cleanText(representative("contact_no", extracted_data.rep_contact)),
      relationship_to_applicant: cleanText(representative("relationship_to_applicant", extracted_data.rep_relation)),
    },
    adverse_party: {
      role: cleanText(extracted_data.adversary_role),
      name: cleanText(adverse("name", extracted_data.adversary_name)),
      address: cleanText(adverse("address", extracted_data.adversary_address)),
    },
    cases: {
      title_of_case: cleanText(caseDetails("title_of_case_and_docket_no", extracted_data.case_docket_title)),
      court_body: cleanText(caseDetails("court_body_tribunal_where_pending", extracted_data.court_body)),
      status_of_case: "Pending",
      last_action_taken: lastActionTaken,
      date_of_confinement: parseFormDate(applicant("detained_since", extracted_data.detained_since)),
      place_of_detention: cleanText(applicant("place_of_detention", extracted_data.place_of_detention)),
      cause_of_action: cleanText(caseDetails("cause_of_action_nature_of_offense", extracted_data.cause_of_action)),
      facts_of_case: cleanText(caseDetails("facts_of_the_case", extracted_data.case_information)),
      pending_in_court: isTrue(caseDetails("pending_in_court", extracted_data.is_filed_in_court)),
    },
  };

  const indicators: ExtractionMap = {};
  [
    ["intake_record.control_no", extracted.intake_record.control_no],
    ["intake_record.form_date", extracted.intake_record.form_date],
    ["intake_record.region", extracted.intake_record.region],
    ["intake_record.district_office", extracted.intake_record.district_office],
    ["intake_record.party_represented", extracted.intake_record.party_represented],
    ["intake_record.applicant_role", extracted.intake_record.applicant_role],
    ["intake_record.nature_of_request", extracted.intake_record.nature_of_request],
    ["intake_record.nature_of_case", extracted.intake_record.nature_of_case],
    ["intake_record.proof_submission_deadline", extracted.intake_record.proof_submission_deadline],
    ["intake_record.proof_itr_date", extracted.intake_record.proof_itr_date],
    ["intake_record.proof_brgy_date", extracted.intake_record.proof_brgy_date],
    ["intake_record.proof_dswd_date", extracted.intake_record.proof_dswd_date],
    ["intake_record.proof_others_details", extracted.intake_record.proof_others_details],
    ["intake_record.inv_plaintiff", extracted.intake_record.inv_plaintiff],
    ["intake_record.inv_defendant", extracted.intake_record.inv_defendant],
    ["intake_record.inv_oppositor", extracted.intake_record.inv_oppositor],
    ["intake_record.inv_petitioner", extracted.intake_record.inv_petitioner],
    ["intake_record.inv_respondent", extracted.intake_record.inv_respondent],
    ["intake_record.inv_complainant", extracted.intake_record.inv_complainant],
    ["intake_record.inv_accused", extracted.intake_record.inv_accused],
    ["representative.rep_name", extracted.representative.rep_name],
    ["representative.rep_age", extracted.representative.rep_age],
    ["representative.rep_sex", extracted.representative.rep_sex],
    ["representative.civil_status", extracted.representative.civil_status],
    ["representative.rep_address", extracted.representative.rep_address],
    ["representative.rep_contact_no", extracted.representative.rep_contact_no],
    ["representative.relationship_to_applicant", extracted.representative.relationship_to_applicant],
    ["adverse_party.role", extracted.adverse_party.role],
    ["adverse_party.name", extracted.adverse_party.name],
    ["adverse_party.address", extracted.adverse_party.address],
    ["cases.title_of_case", extracted.cases.title_of_case],
    ["cases.court_body", extracted.cases.court_body],
    ["cases.last_action_taken", extracted.cases.last_action_taken],
    ["cases.date_of_confinement", extracted.cases.date_of_confinement],
    ["cases.place_of_detention", extracted.cases.place_of_detention],
    ["cases.cause_of_action", extracted.cases.cause_of_action],
    ["cases.facts_of_case", extracted.cases.facts_of_case],
    ["cases.pending_in_court", extracted.cases.pending_in_court],
  ].forEach(([path, value]) => addIndicator(indicators, String(path), value));

  return { documentId: document_id, extracted, indicators };
}

export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "image/png" });
}
