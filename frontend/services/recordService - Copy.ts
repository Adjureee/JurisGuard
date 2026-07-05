import { apiClient } from "../api/client";
import type { ClientRecord, CriminalCaseRecord } from "../types";
import type { CaseFormValues, ClientFormValues } from "../features/criminalCases/schemas";

export async function listClientRecords(): Promise<ClientRecord[]> {
  const response = await apiClient.get<ClientRecord[]>("/clients/");
  return response.data;
}

export async function createClientRecord(values: ClientFormValues): Promise<ClientRecord> {
  const response = await apiClient.post<ClientRecord>("/clients/", values);
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

