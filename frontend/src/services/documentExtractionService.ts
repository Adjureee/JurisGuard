import { AxiosError } from "axios";
import { apiClient } from "../api/client";
import type { ExtractionMap } from "../types";
import type { CaseFormValues, ClientFormValues } from "../features/criminalCases/schemas";

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
  applicant_contact?: string | null;
  is_detained?: boolean | null;
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
};

const DEFAULT_BACKEND_USER_ID = 1;

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
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
  { caseId, userId = DEFAULT_BACKEND_USER_ID }: UploadOptions = {}
) {
  const formData = new FormData();
  formData.append("file", file);
  const params: Record<string, number> = {
    user_id: userId,
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

  const extracted: ClientExtractionResult["extracted"] = {
    client: {
      name: cleanText(extracted_data.applicant_name),
      age: toNumber(extracted_data.applicant_age),
      sex: normalizeSex(extracted_data.applicant_sex),
      civil_status: cleanText(extracted_data.applicant_civil_status),
      citizenship: "Filipino",
    },
    client_details: {
      contact_no: cleanText(extracted_data.applicant_contact),
      individual_monthly_income: cleanText(extracted_data.affidavit_income),
      representative_name: cleanText(extracted_data.rep_name),
      representative_age: toNumber(extracted_data.rep_age),
      representative_sex: normalizeSex(extracted_data.rep_sex),
      representative_civil_status: cleanText(extracted_data.rep_civil_status),
      representative_address: cleanText(extracted_data.rep_address),
      representative_contact_no: cleanText(extracted_data.rep_contact),
      representative_relationship: cleanText(extracted_data.rep_relation),
      representative_email: cleanText(extracted_data.rep_email),
      detained: isTrue(extracted_data.is_detained),
    },
    client_classification: {
      flag_foreign_national: isTrue(extracted_data.sector_foreign_national),
      flag_urban: isTrue(extracted_data.sector_urban_poor),
      flag_rural: isTrue(extracted_data.sector_rural_poor),
      flag_indigenous_people: isTrue(extracted_data.sector_indigenous),
      flag_pwd: isTrue(extracted_data.sector_pwd),
      classification_notes: cleanText(extracted_data.extraction_mode),
    },
  };

  const indicators: ExtractionMap = {};
  [
    ["client.name", extracted.client.name],
    ["client.age", extracted.client.age],
    ["client.sex", extracted.client.sex],
    ["client.civil_status", extracted.client.civil_status],
    ["client_details.contact_no", extracted.client_details.contact_no],
    ["client_details.individual_monthly_income", extracted.client_details.individual_monthly_income],
    ["client_details.representative_name", extracted.client_details.representative_name],
    ["client_details.representative_age", extracted.client_details.representative_age],
    ["client_details.representative_sex", extracted.client_details.representative_sex],
    ["client_details.representative_civil_status", extracted.client_details.representative_civil_status],
    ["client_details.representative_address", extracted.client_details.representative_address],
    ["client_details.representative_contact_no", extracted.client_details.representative_contact_no],
    ["client_details.representative_relationship", extracted.client_details.representative_relationship],
    ["client_details.representative_email", extracted.client_details.representative_email],
    ["client_details.detained", extracted.client_details.detained],
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

  const natureOfRequest = joinLabels([
    isTrue(extracted_data.req_legal_doc) && "Legal Documentation",
    isTrue(extracted_data.req_oath) && "Administration of Oath",
    isTrue(extracted_data.req_court_rep) && "Representation in Court or Office",
    isTrue(extracted_data.req_inquest) && "Inquest Legal Assistance",
    isTrue(extracted_data.req_mediation) && "Mediation/Conciliation",
    cleanText(extracted_data.req_other_text),
  ]);
  const natureOfCase = joinLabels([
    isTrue(extracted_data.case_type_criminal) && "Criminal",
    isTrue(extracted_data.case_type_civil) && "Civil",
    isTrue(extracted_data.case_type_labor) && "Labor",
    isTrue(extracted_data.case_type_admin) && "Administrative",
    isTrue(extracted_data.case_type_appealed) && "Appealed",
  ]);
  const lastActionTaken = joinLabels([
    isTrue(extracted_data.action_merit_test) && "For merit and indigency test",
    isTrue(extracted_data.action_representation) && "For representation and legal assistance",
    cleanText(extracted_data.action_legal_service_text),
    cleanText(extracted_data.action_other_text),
  ]);

  const extracted: CaseExtractionResult["extracted"] = {
    intake_record: {
      control_no: cleanText(extracted_data.control_no),
      form_date: parseFormDate(extracted_data.petsa),
      region: cleanText(extracted_data.rehiyon),
      district_office: cleanText(extracted_data.district_office),
      party_represented: cleanText(extracted_data.applicant_name),
      applicant_role: cleanText(extracted_data.applicant_role),
      nature_of_request: natureOfRequest,
      nature_of_case: natureOfCase,
    },
    representative: {
      rep_name: cleanText(extracted_data.rep_name),
      rep_age: toNumber(extracted_data.rep_age),
      rep_sex: normalizeSex(extracted_data.rep_sex),
      civil_status: cleanText(extracted_data.rep_civil_status),
      rep_address: cleanText(extracted_data.rep_address),
      rep_contact_no: cleanText(extracted_data.rep_contact),
      relationship_to_applicant: cleanText(extracted_data.rep_relation),
    },
    adverse_party: {
      role: cleanText(extracted_data.adversary_role),
      name: cleanText(extracted_data.adversary_name),
      address: cleanText(extracted_data.adversary_address),
    },
    cases: {
      title_of_case: cleanText(extracted_data.case_docket_title),
      court_body: cleanText(extracted_data.court_body),
      status_of_case: "Pending",
      last_action_taken: lastActionTaken,
      cause_of_action: cleanText(extracted_data.cause_of_action),
      facts_of_case: cleanText(extracted_data.case_information),
      pending_in_court: isTrue(extracted_data.is_filed_in_court),
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
