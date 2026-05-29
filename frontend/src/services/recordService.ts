import { apiClient } from "../api/client";
import type { ClientRecord, CriminalCaseRecord } from "../types";
import type { CaseFormValues, ClientFormValues } from "../features/criminalCases/schemas";

export async function listClientRecords(): Promise<ClientRecord[]> {
  const response = await apiClient.get<ClientRecord[]>("/clients/");
  return response.data;
}

export async function getClientRecord(clientId: string): Promise<ClientRecord> {
  const response = await apiClient.get<ClientRecord>(`/clients/${clientId}`);
  return response.data;
}

export async function getClientCases(clientId: string): Promise<CriminalCaseRecord[]> {
  const response = await apiClient.get<CriminalCaseRecord[]>(`/clients/${clientId}/cases`);
  return response.data;
}

export async function createClientRecord(values: ClientFormValues): Promise<ClientRecord> {
  const response = await apiClient.post<ClientRecord>("/clients/", values);
  return response.data;
}

export async function updateClientRecord(
  clientId: string,
  values: ClientFormValues
): Promise<ClientRecord> {
  const response = await apiClient.patch<ClientRecord>(`/clients/${clientId}`, values);
  return response.data;
}

export async function listCaseRecords(): Promise<CriminalCaseRecord[]> {
  const response = await apiClient.get<CriminalCaseRecord[]>("/cases/");
  return response.data;
}

export async function createCaseRecord(values: CaseFormValues): Promise<CriminalCaseRecord> {
  const response = await apiClient.post<CriminalCaseRecord>("/cases/", values);
  return response.data;
}

export async function updateCaseRecord(
  caseId: string,
  values: CaseFormValues
): Promise<CriminalCaseRecord> {
  const response = await apiClient.patch<CriminalCaseRecord>(`/cases/${caseId}`, values);
  return response.data;
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

export async function getPrintableIntake(caseId: string): Promise<PrintableIntakeResponse> {
  const response = await apiClient.get<PrintableIntakeResponse>(`/printable-intake/${caseId}`);
  return response.data;
}

