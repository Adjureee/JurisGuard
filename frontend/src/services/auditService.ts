import { apiClient } from "../api/client";
import type { AuditLogEntry } from "../features/auditLogs/auditLogStore";
import type { AuthUser } from "../types/auth";
import type { DateFilterValue } from "../utils/dateFilters";

export const AUDIT_LOG_PAGE_SIZE = 25;

export interface AuditLogUserOption {
  user_id: number;
  name: string;
  role?: string;
}

export interface ListAuditLogsParams {
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
  action?: string;
  dateFilter?: DateFilterValue;
  dateFrom?: string;
  dateTo?: string;
  userId?: number | string;
  userRole?: string;
  search?: string;
  currentUser?: AuthUser;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  available_actions: string[];
  available_users: AuditLogUserOption[];
  available_roles: string[];
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveAuditDateRange(
  filter: DateFilterValue = "all",
  dateFrom = "",
  dateTo = "",
  now = new Date(),
): { date_from?: string; date_to?: string } {
  let presetFrom = "";
  let presetTo = "";
  if (filter !== "all") {
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    if (filter === "today") {
      // Single-day inclusive range
    } else if (filter === "last7" || filter === "last30") {
      start.setDate(start.getDate() - (filter === "last7" ? 6 : 29));
    } else if (filter === "month") {
      start.setDate(1);
    } else if (filter === "year") {
      start.setMonth(0, 1);
    }
    presetFrom = localDateKey(start);
    presetTo = localDateKey(end);
  }
  const effectiveFrom =
    dateFrom && presetFrom
      ? dateFrom > presetFrom
        ? dateFrom
        : presetFrom
      : dateFrom || presetFrom;
  const effectiveTo =
    dateTo && presetTo
      ? dateTo < presetTo
        ? dateTo
        : presetTo
      : dateTo || presetTo;
  return {
    date_from: effectiveFrom || undefined,
    date_to: effectiveTo || undefined,
  };
}

export function buildAuditLogQueryParams(params: ListAuditLogsParams = {}) {
  const isAdmin = params.currentUser?.role === "admin";
  const { date_from, date_to } = resolveAuditDateRange(
    params.dateFilter ?? "all",
    params.dateFrom ?? "",
    params.dateTo ?? "",
  );
  const userIdParam =
    isAdmin && params.userId !== undefined && params.userId !== "all" && params.userId !== ""
      ? Number(params.userId)
      : undefined;
  const userRoleParam =
    isAdmin && params.userRole && params.userRole !== "all"
      ? params.userRole
      : undefined;
  const actionParam =
    params.action && params.action !== "all" ? params.action : undefined;
  const searchParam = params.search?.trim() ? params.search.trim() : undefined;

  return {
    limit: params.limit,
    offset: params.offset,
    page: params.page,
    page_size: params.pageSize,
    action: actionParam,
    date_from,
    date_to,
    user_id: Number.isFinite(userIdParam) ? userIdParam : undefined,
    user_role: userRoleParam,
    search: searchParam,
  };
}

export async function listAuditLogs(
  params: ListAuditLogsParams = {},
): Promise<AuditLogEntry[]> {
  const isAdmin = params.currentUser?.role === "admin";
  const response = await apiClient.get<AuditLogEntry[]>("/audit-logs/", {
    params: buildAuditLogQueryParams(params),
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

export async function listAuditLogsPage(
  params: ListAuditLogsParams = {},
): Promise<AuditLogPage> {
  const isAdmin = params.currentUser?.role === "admin";
  const queryParams = buildAuditLogQueryParams({
    ...params,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? AUDIT_LOG_PAGE_SIZE,
  });
  const response = await apiClient.get<AuditLogPage>("/audit-logs/paged", {
    params: {
      page: queryParams.page,
      page_size: queryParams.page_size,
      action: queryParams.action,
      date_from: queryParams.date_from,
      date_to: queryParams.date_to,
      user_id: queryParams.user_id,
      user_role: queryParams.user_role,
      search: queryParams.search,
    },
  });
  const data = response.data;
  if (!isAdmin && params.currentUser) {
    const filteredItems = data.items.filter(
      (log) =>
        log.userId === params.currentUser?.user_id ||
        log.user_id === params.currentUser?.user_id,
    );
    return {
      ...data,
      items: filteredItems,
    };
  }
  return data;
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
