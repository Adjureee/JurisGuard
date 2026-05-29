import { apiClient } from "../api/client";
import type { AuditLogEntry } from "../features/auditLogs/auditLogStore";

export async function listAuditLogs(): Promise<AuditLogEntry[]> {
  const response = await apiClient.get<AuditLogEntry[]>("/audit-logs/");
  return response.data;
}

