import { apiClient } from "../api/client";
import {
  applicantRoleOptions,
  civilStatusOptions,
  educationalAttainmentOptions,
  languageDialectOptions,
  relationshipOptions,
  religionOptions,
  sexOptions,
} from "../features/criminalCases/clientFieldOptions";
import type { CaseType } from "../types";
import { panaboBarangays } from "../features/criminalCases/locationOptions";

export interface CaseImportClient {
  client_name: string;
  age: string | number | null;
  sex: string;
  civil_status: string;
  religion: string;
  educational_attainment: string;
  citizenship: string;
  language_dialect: string;
  address: string;
  contact_no: string;
  relationship: string;
  party_represented: string;
  urban: string | number | boolean | null;
  rural: string | number | boolean | null;
  drugs: string | number | boolean | null;
  female: string | number | boolean | null;
  senior: string | number | boolean | null;
  cicl: string | number | boolean | null;
  location_indicators_present: boolean;
  flags_reviewed?: boolean;
  source_row: number;
  possible_matches: Array<{
    client_id: number;
    name: string;
    age: number | null;
    sex: string | null;
    address: string | null;
  }>;
  existing_client_id?: number | null;
}

export interface CaseImportReviewCase {
  import_key: string;
  case_type: CaseType;
  control_no: string;
  title: string;
  court: string;
  case_no: string;
  cause_of_action: string;
  nature_of_case: string;
  status: string;
  last_action: string;
  cause_of_termination: string;
  date_of_termination: string;
  date_of_confinement: string;
  place_of_detention: string;
  case_received: string;
  location_type: string;
  incident_barangay: string;
  incident_city: string;
  clients: CaseImportClient[];
  source_rows: number[];
  conflicting_values: Record<string, string[]>;
  errors: string[];
  duplicate: boolean;
  duplicate_message: string | null;
  ready: boolean;
  conflict_reviewed?: boolean;
  has_conflicts?: boolean;
}

export interface CaseImportPreview {
  source_filename: string;
  workbook_format: string;
  case_type: CaseType;
  rows_processed: number;
  cases: CaseImportReviewCase[];
  summary: {
    unique_cases: number;
    client_records: number;
    ready_cases: number;
    correction_cases: number;
    duplicate_cases: number;
    client_matches: number;
  };
}

export interface CaseImportResult {
  case_type: CaseType | null;
  cases_imported: number;
  clients_created: number;
  existing_clients_linked: number;
  cases_held: number;
  failed_records: number;
  duplicate_cases_skipped: number;
  failures: Array<{ control_no: string; reason: string }>;
}

type ApiRecord = Record<string, unknown>;

function asRecord(value: unknown): ApiRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ApiRecord
    : {};
}

function asString(value: unknown): string {
  return value == null ? "" : typeof value === "string" ? value : String(value);
}

function asReviewValue(value: unknown): string {
  const text = asString(value);
  return text.trim() ? text : "";
}

function matchOption(value: unknown, options: string[]): string {
  const source = asString(value);
  const match = options.find((option) => option.toLocaleLowerCase() === source.trim().toLocaleLowerCase());
  return match ?? source;
}

function matchSexOption(value: unknown): string {
  const source = asString(value).trim().toLocaleLowerCase();
  if (source === "f" || source === "female") return "Female";
  if (source === "m" || source === "male") return "Male";
  return matchOption(value, sexOptions);
}

function isReviewNA(value: unknown): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === "NA";
}

const datePlaceholderFields = new Set(["date_of_termination", "date_of_confinement"]);

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function omitKeys<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const omitted = new Set<keyof T>(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key as keyof T))) as Omit<T, K>;
}

function normalizePreview(value: unknown, expectedCaseType: CaseType): CaseImportPreview {
  const payload = asRecord(value);
  if (!Array.isArray(payload.cases)) {
    throw new Error("The server returned an unexpected extraction response. Please retry the file.");
  }
  if (payload.case_type !== expectedCaseType) {
    throw new Error("The server returned a different case destination than the selected page. Please retry the file.");
  }

  const cases = payload.cases.map((rawCase, index): CaseImportReviewCase => {
    const entry = asRecord(rawCase);
    if (!rawCase || typeof rawCase !== "object" || Array.isArray(rawCase)) {
      throw new Error(`The server returned an invalid record at position ${index + 1}. Please retry the file.`);
    }
    const rawConflicts = asRecord(entry.conflicting_values);
    const rawClients = Array.isArray(entry.clients) ? entry.clients : [];
    const clients: CaseImportClient[] = rawClients.map((rawClient): CaseImportClient => {
      const client = asRecord(rawClient);
      const rawMatches = Array.isArray(client.possible_matches) ? client.possible_matches : [];
      return {
        client_name: asString(client.client_name),
        age: client.age == null ? "" : typeof client.age === "number" || typeof client.age === "string" ? client.age : "",
        sex: matchSexOption(client.sex),
        civil_status: matchOption(client.civil_status, civilStatusOptions),
        religion: matchOption(client.religion, religionOptions),
        educational_attainment: matchOption(client.educational_attainment, educationalAttainmentOptions),
        citizenship: asReviewValue(client.citizenship) || "Filipino",
        language_dialect: matchOption(client.language_dialect, languageDialectOptions),
        address: asString(client.address),
        contact_no: asString(client.contact_no),
        relationship: matchOption(client.relationship, relationshipOptions),
        party_represented: matchOption(client.party_represented, applicantRoleOptions),
        urban: client.urban == null ? null : typeof client.urban === "boolean" || typeof client.urban === "number" ? client.urban : asString(client.urban),
        rural: client.rural == null ? null : typeof client.rural === "boolean" || typeof client.rural === "number" ? client.rural : asString(client.rural),
        drugs: client.drugs == null ? null : typeof client.drugs === "boolean" || typeof client.drugs === "number" ? client.drugs : asString(client.drugs),
        female: client.female == null ? null : typeof client.female === "boolean" || typeof client.female === "number" ? client.female : asString(client.female),
        senior: client.senior == null ? null : typeof client.senior === "boolean" || typeof client.senior === "number" ? client.senior : asString(client.senior),
        cicl: client.cicl == null ? null : typeof client.cicl === "boolean" || typeof client.cicl === "number" ? client.cicl : asString(client.cicl),
        location_indicators_present: Boolean(client.location_indicators_present),
        flags_reviewed: Boolean(client.flags_reviewed),
        source_row: asNumber(client.source_row),
        possible_matches: rawMatches.map((rawMatch) => {
          const match = asRecord(rawMatch);
          return {
            client_id: asNumber(match.client_id),
            name: asString(match.name),
            age: typeof match.age === "number" ? match.age : null,
            sex: match.sex == null ? null : asString(match.sex),
            address: match.address == null ? null : asString(match.address),
          };
        }),
        existing_client_id: typeof client.existing_client_id === "number" ? client.existing_client_id : null,
      };
    });

    return {
      import_key: asString(entry.import_key) || `case-${index + 1}`,
      case_type: expectedCaseType,
      control_no: asReviewValue(entry.control_no),
      title: asReviewValue(entry.title),
      court: asReviewValue(entry.court),
      case_no: asReviewValue(entry.case_no),
      cause_of_action: asReviewValue(entry.cause_of_action),
      nature_of_case: asReviewValue(entry.nature_of_case),
      status: asReviewValue(entry.status),
      last_action: asReviewValue(entry.last_action) || "NA",
      cause_of_termination: asReviewValue(entry.cause_of_termination) || "NA",
      date_of_termination: asReviewValue(entry.date_of_termination) || "NA",
      date_of_confinement: asReviewValue(entry.date_of_confinement) || "NA",
      place_of_detention: asReviewValue(entry.place_of_detention) || "NA",
      case_received: asReviewValue(entry.case_received),
      location_type: matchOption(entry.location_type, ["Urban", "Rural"]),
      incident_barangay: matchOption(entry.incident_barangay, panaboBarangays),
      incident_city: asString(entry.incident_city),
      clients,
      source_rows: Array.isArray(entry.source_rows) ? entry.source_rows.map((row) => asNumber(row)).filter(Number.isFinite) : [],
      conflicting_values: Object.fromEntries(Object.entries(rawConflicts).map(([field, values]) => [
        field,
        Array.isArray(values) ? values.map(asString) : [asString(values)],
      ])),
      errors: Array.isArray(entry.errors) ? entry.errors.map(asString) : [],
      duplicate: Boolean(entry.duplicate),
      duplicate_message: entry.duplicate_message == null ? null : asString(entry.duplicate_message),
      ready: Boolean(entry.ready),
      conflict_reviewed: Boolean(entry.conflict_reviewed),
      has_conflicts: Boolean(entry.has_conflicts),
    };
  });

  const summary = asRecord(payload.summary);
  return {
    source_filename: asString(payload.source_filename),
    workbook_format: asString(payload.workbook_format),
    case_type: expectedCaseType,
    rows_processed: asNumber(payload.rows_processed),
    cases,
    summary: {
      unique_cases: asNumber(summary.unique_cases, cases.length),
      client_records: asNumber(summary.client_records, cases.reduce((total, entry) => total + entry.clients.length, 0)),
      ready_cases: asNumber(summary.ready_cases),
      correction_cases: asNumber(summary.correction_cases),
      duplicate_cases: asNumber(summary.duplicate_cases),
      client_matches: asNumber(summary.client_matches),
    },
  };
}

export function caseImportErrorMessage(cause: unknown, fallback: string): string {
  const error = asRecord(cause);
  const responseData = asRecord(asRecord(error.response).data);
  const detail = responseData.detail ?? responseData.message;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => asString(asRecord(item).msg).trim())
      .filter(Boolean);
    if (messages.length) return messages.join(" ");
  }
  if (cause instanceof Error && cause.message && cause.message !== "Network Error") return cause.message;
  if (cause instanceof Error && cause.message === "Network Error") {
    return "Could not connect to JurisGuard. Check the server connection and retry.";
  }
  return fallback;
}

export async function previewCaseImport(
  file: File,
  caseType: CaseType,
  onUploadProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<CaseImportPreview> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("case_type", caseType);
  const response = await apiClient.post<unknown>("/case-imports/preview", formData, {
    signal,
    onUploadProgress: (event) => {
      if (event.total) onUploadProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    },
  });
  return normalizePreview(response.data, caseType);
}

export async function importCaseRecords(
  caseType: CaseType,
  sourceFilename: string,
  cases: CaseImportReviewCase[],
  heldCaseCount: number,
  duplicateCaseCount: number,
): Promise<CaseImportResult> {
  const response = await apiClient.post<unknown>("/case-imports", {
    case_type: caseType,
    source_filename: sourceFilename,
    held_case_count: heldCaseCount,
    duplicate_case_count: duplicateCaseCount,
    cases: cases.map((entry) => {
      const caseFieldsToOmit = [
        "import_key", "errors", "duplicate", "duplicate_message", "ready", "source_rows", "conflicting_values", "clients",
        ...(caseType === "Criminal" ? ["nature_of_case" as const] : []),
      ] as const;
      const caseData = omitKeys(entry, caseFieldsToOmit);
      const caseFields = Object.fromEntries(Object.entries(caseData).map(([key, value]) => [key, datePlaceholderFields.has(key) && isReviewNA(value) ? "" : value]));
      return {
        ...caseFields,
        case_type: caseType,
        clients: entry.clients.map((client) => {
          const clientData = omitKeys(client, ["possible_matches", "source_row", "urban", "rural", "location_indicators_present"]);
          const ordinaryFields = new Set(["client_name", "age", "sex", "civil_status", "religion", "educational_attainment", "citizenship", "language_dialect", "address", "contact_no", "relationship", "party_represented"]);
          return Object.fromEntries(Object.entries(clientData).map(([key, value]) => [key, ordinaryFields.has(key) && isReviewNA(value) ? "" : value]));
        }),
        has_conflicts: entry.errors.some((error) => error.startsWith("Conflicting")),
      };
    }),
  });
  const result = asRecord(response.data);
  if (!result || typeof response.data !== "object" || Array.isArray(response.data)) {
    throw new Error("The server returned an unexpected import response. Review the records and retry.");
  }
  return {
    case_type: result.case_type === "Criminal" || result.case_type === "Civil" ? result.case_type : null,
    cases_imported: asNumber(result.cases_imported),
    clients_created: asNumber(result.clients_created),
    existing_clients_linked: asNumber(result.existing_clients_linked),
    cases_held: asNumber(result.cases_held),
    failed_records: asNumber(result.failed_records),
    duplicate_cases_skipped: asNumber(result.duplicate_cases_skipped),
    failures: Array.isArray(result.failures) ? result.failures.map((failure) => {
      const item = asRecord(failure);
      return { control_no: asString(item.control_no), reason: asString(item.reason) };
    }) : [],
  };
}
