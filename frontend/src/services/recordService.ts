import { apiClient } from "../api/client";
import { AxiosError } from "axios";
import type { CaseListItem, CaseType, ClientRecord, CriminalCaseRecord } from "../types";
import type { AddCaseFormValues, CaseFormValues, ClientFormValues } from "../features/criminalCases/schemas";

function getRecordErrorMessage(error: unknown, fallback: string) {
  if (error instanceof AxiosError) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => item?.msg || item?.message)
        .filter(Boolean)
        .join(", ") || fallback;
    }
    if (error.message === "Network Error") {
      return "Cannot reach the backend server. Make sure FastAPI is running, then refresh and try again.";
    }
    return error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

export async function listClientRecords(): Promise<ClientRecord[]> {
  const response = await apiClient.get<ClientRecord[]>("/clients/");
  return response.data;
}

export async function getClientRecord(clientId: string): Promise<ClientRecord> {
  const response = await apiClient.get<ClientRecord>(`/clients/${clientId}`);
  return response.data;
}

export async function getClientCases(
  clientId: string,
  caseType: CaseType | "All" = "Criminal",
): Promise<CriminalCaseRecord[]> {
  const response = await apiClient.get<CriminalCaseRecord[]>(
    `/clients/${clientId}/cases`,
    { params: { case_type: caseType } },
  );
  return response.data;
}

export async function getCaseRecord(caseId: string): Promise<CriminalCaseRecord> {
  const response = await apiClient.get<CriminalCaseRecord>(`/cases/by-id/${caseId}`);
  return response.data;
}

export async function createClientRecord(values: ClientFormValues): Promise<ClientRecord> {
  try {
    const response = await apiClient.post<ClientRecord>("/clients/", values);
    return response.data;
  } catch (error) {
    throw new Error(getRecordErrorMessage(error, "Unable to create client"));
  }
}

export async function updateClientRecord(
  clientId: string,
  values: ClientFormValues
): Promise<ClientRecord> {
  try {
    const response = await apiClient.patch<ClientRecord>(`/clients/${clientId}`, values);
    return response.data;
  } catch (error) {
    throw new Error(getRecordErrorMessage(error, "Unable to update client"));
  }
}

export async function listCaseRecords(
  caseType: CaseType | "All" = "Criminal",
): Promise<CriminalCaseRecord[]> {
  const response = await apiClient.get<CriminalCaseRecord[]>("/cases/", {
    params: { case_type: caseType },
  });
  return response.data;
}

export interface CaseRecordPageFilters {
  case_type?: CaseType | "All";
  page?: number;
  page_size?: number;
  search?: string;
  gender?: "All" | "Male" | "Female";
  location?: "All" | "Urban" | "Rural";
  court?: string;
  date_from?: string;
  date_to?: string;
}

export interface CaseRecordPage {
  items: CaseListItem[];
  total: number;
  page: number;
  page_size: number;
}

export async function listCaseRecordsPage(
  filters: CaseRecordPageFilters,
): Promise<CaseRecordPage> {
  const params = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== "" && value !== undefined),
  );
  const response = await apiClient.get<CaseRecordPage>("/cases/paged", {
    params,
  });
  return response.data;
}

export async function listCaseRecordsPageForExport(
  filters: CaseRecordPageFilters,
): Promise<Omit<CaseRecordPage, "items"> & { items: CriminalCaseRecord[] }> {
  const params = Object.fromEntries(
    Object.entries({ ...filters, include_details: true }).filter(([, value]) => value !== "" && value !== undefined),
  );
  const response = await apiClient.get<Omit<CaseRecordPage, "items"> & { items: CriminalCaseRecord[] }>(
    "/cases/paged",
    { params },
  );
  return response.data;
}

export async function createCaseRecord(
  values: AddCaseFormValues,
  caseType: CaseType = "Criminal",
): Promise<CriminalCaseRecord> {
  try {
    const response = await apiClient.post<CriminalCaseRecord>("/cases/", {
      ...values,
      case_type: caseType,
    });
    return response.data;
  } catch (error) {
    throw new Error(getRecordErrorMessage(error, "Unable to create case"));
  }
}

export async function updateCaseRecord(
  caseId: string,
  values: CaseFormValues
): Promise<CriminalCaseRecord> {
  try {
    const response = await apiClient.patch<CriminalCaseRecord>(`/cases/${caseId}`, values);
    return response.data;
  } catch (error) {
    throw new Error(getRecordErrorMessage(error, "Unable to update case"));
  }
}

export interface AttachCaseClientPayload {
  client_id: string;
  applicant_role?: string;
  applicant_role_other?: string;
  party_represented?: string;
}

export async function attachClientToCase(
  caseId: string,
  values: AttachCaseClientPayload
): Promise<CriminalCaseRecord> {
  try {
    const response = await apiClient.post<CriminalCaseRecord>(
      `/cases/${caseId}/clients`,
      values
    );
    return response.data;
  } catch (error) {
    throw new Error(getRecordErrorMessage(error, "Unable to attach client to case"));
  }
}

export interface TerminationPayload {
  termination_reason: string;
  resolution_type: string;
  date_terminated: string;
  final_remarks: string;
  handled_by: string;
  supporting_document_path: string;
}

export async function terminateCaseRecord(
  caseId: string,
  values: TerminationPayload
): Promise<CriminalCaseRecord> {
  const response = await apiClient.post<CriminalCaseRecord>(`/cases/${caseId}/terminate`, values);
  return response.data;
}

export interface PrintableIntakeResponse {
  client: ClientRecord;
  selected_case: CriminalCaseRecord;
  cases: CriminalCaseRecord[];
  templates: {
    english: string;
    filipino: string;
  };
}

export async function getPrintableIntake(
  caseId: string,
  clientId?: string,
): Promise<PrintableIntakeResponse> {
  const response = await apiClient.get<PrintableIntakeResponse>(
    `/printable-intake/${caseId}`,
    { params: clientId ? { client_id: clientId } : undefined },
  );
  return response.data;
}

