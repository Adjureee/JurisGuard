import { apiClient } from "../api/client";
import type { AuditLogEntry } from "../features/auditLogs/auditLogStore";

export async function listAuditLogs(): Promise<AuditLogEntry[]> {
  const response = await apiClient.get<AuditLogEntry[]>("/audit-logs/");
  return response.data;
}

export interface CreateAuditLogPayload {
  action: string;
  module?: string | null;
  description?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
}

export async function createAuditLog(payload: CreateAuditLogPayload) {
  const response = await apiClient.post<{ message: string }>("/audit-logs/", payload);
  return response.data;
}
