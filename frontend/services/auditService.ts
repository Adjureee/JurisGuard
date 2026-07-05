import { apiClient } from "../api/client";
import type { AuditLogEntry } from "../features/auditLogs/auditLogStore";
import type { AuthUser } from "../types/auth";

export interface ListAuditLogsParams {
  limit?: number;
  offset?: number;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  userId?: number | string;
  search?: string;
  currentUser?: AuthUser;
}

export async function listAuditLogs(params: ListAuditLogsParams = {}): Promise<AuditLogEntry[]> {
  const isAdmin = params.currentUser?.role === "admin";
  const response = await apiClient.get<AuditLogEntry[]>("/audit-logs/", {
    params: {
      limit: params.limit,
      offset: params.offset,
      action: params.action,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      user_id: isAdmin ? params.userId : undefined,
      search: params.search,
    },
  });
  if (!isAdmin && params.currentUser) {
    return response.data.filter(
      (log) =>
        log.userId === params.currentUser?.user_id ||
        log.user_id === params.currentUser?.user_id,
    );
  }
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

