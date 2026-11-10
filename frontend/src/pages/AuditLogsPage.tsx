import { useEffect, useMemo, useState } from "react";
import DateFilterSelect from "../components/DateFilterSelect";
import { useAuth } from "../contexts/AuthContext";
import {
  useAuditLogStore,
  type AuditLogEntry,
} from "../features/auditLogs/auditLogStore";
import MainLayout from "../layouts/MainLayout";
import {
  AUDIT_LOG_PAGE_SIZE,
  listAuditLogsPage,
  type AuditLogUserOption,
} from "../services/auditService";
import { presentActivity } from "../features/dashboard/activityPresentation";
import {
  matchesDateFilter,
  type DateFilterValue,
} from "../utils/dateFilters";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ModuleBadge({ module }: { module: AuditLogEntry["module"] }) {
  const className =
    module === "Authentication"
      ? "bg-[#F7F0FA] text-[#704389]"
      : module === "Admin"
        ? "bg-[#FFFBEB] text-[#92400E]"
        : module === "Export"
          ? "bg-[#F7F0FA] text-[#704389]"
          : "bg-[#F8FAFC] text-[#4B5563]";

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      {module}
    </span>
  );
}

function UserTypeBadge({ role }: { role?: string | null }) {
  const label = role ? role.charAt(0).toUpperCase() + role.slice(1) : "System";
  const className =
    role === "admin"
      ? "bg-[#F7F0FA] text-[#704389]"
      : role === "staff"
        ? "bg-[#F8FAFC] text-[#4B5563]"
        : "bg-[#F3F4F6] text-[#4B5563]";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

function normalizedLogRole(log: AuditLogEntry) {
  return log.userRole ?? log.user_role ?? "system";
}

function scopedRoleList(logs: AuditLogEntry[]) {
  return logs.map(normalizedLogRole).filter(Boolean);
}

export default function AuditLogsPage() {
  const { user } = useAuth();
  const cachedLogs = useAuditLogStore((state) => state.logs);
  const setLogsForViewer = useAuditLogStore((state) => state.setLogsForViewer);
  const scopeToViewer = useAuditLogStore((state) => state.scopeToViewer);
  const [selectedUserId, setSelectedUserId] = useState("all");
  const [userType, setUserType] = useState("all");
  const [actionType, setActionType] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilterValue>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageItems, setPageItems] = useState<AuditLogEntry[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [serverActions, setServerActions] = useState<string[]>([]);
  const [serverUsers, setServerUsers] = useState<AuditLogUserOption[]>([]);
  const [serverRoles, setServerRoles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [usingOfflineFallback, setUsingOfflineFallback] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch((previous) => {
        const next = search.trim();
        if (next !== previous) {
          setPage(1);
        }
        return next;
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const currentUser = user;
    scopeToViewer(currentUser);
    async function loadAuditLogsPage() {
      setIsLoading(true);
      try {
        const result = await listAuditLogsPage({
          page,
          pageSize: AUDIT_LOG_PAGE_SIZE,
          action: actionType,
          userId: selectedUserId,
          userRole: userType,
          dateFilter,
          dateFrom,
          dateTo,
          search: debouncedSearch,
          currentUser,
        });
        if (cancelled) return;
        setUsingOfflineFallback(false);
        setPageItems(result.items);
        setTotalLogs(result.total);
        setTotalPages(Math.max(1, result.total_pages));
        if (result.page !== page) {
          setPage(result.page);
        }
        setServerActions(result.available_actions ?? []);
        setServerUsers(result.available_users ?? []);
        setServerRoles(result.available_roles ?? []);
        if (
          page === 1 &&
          selectedUserId === "all" &&
          userType === "all" &&
          actionType === "all" &&
          dateFilter === "all" &&
          !dateFrom &&
          !dateTo &&
          !debouncedSearch
        ) {
          setLogsForViewer(result.items, currentUser);
        }
      } catch {
        if (!cancelled) {
          scopeToViewer(currentUser);
          setUsingOfflineFallback(true);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadAuditLogsPage();

    return () => {
      cancelled = true;
    };
  }, [
    actionType,
    dateFilter,
    dateFrom,
    dateTo,
    debouncedSearch,
    page,
    scopeToViewer,
    selectedUserId,
    setLogsForViewer,
    user,
    userType,
  ]);

  const scopedCachedLogs = useMemo(
    () =>
      user?.role === "admin"
        ? cachedLogs
        : cachedLogs.filter((log) => log.userId === user?.user_id),
    [cachedLogs, user],
  );

  const userOptions = useMemo<[string, string][]>(() => {
    if (!usingOfflineFallback && serverUsers.length > 0) {
      return serverUsers.map((entry) => [String(entry.user_id), entry.name]);
    }
    return Array.from(
      new Map(
        scopedCachedLogs
          .filter((log) => log.userId !== null)
          .map((log) => [String(log.userId), log.user]),
      ).entries(),
    );
  }, [scopedCachedLogs, serverUsers, usingOfflineFallback]);

  const userTypeOptions = useMemo(() => {
    if (!usingOfflineFallback && serverRoles.length > 0) {
      return serverRoles;
    }
    return Array.from(new Set(scopedRoleList(scopedCachedLogs))).sort();
  }, [scopedCachedLogs, serverRoles, usingOfflineFallback]);

  const actionOptions = useMemo(() => {
    if (!usingOfflineFallback && serverActions.length > 0) {
      return serverActions;
    }
    return Array.from(new Set(scopedCachedLogs.map((log) => log.action))).sort();
  }, [scopedCachedLogs, serverActions, usingOfflineFallback]);

  const filteredOfflineLogs = useMemo(() => {
    if (!usingOfflineFallback) return [];
    const term = debouncedSearch.toLowerCase();
    return scopedCachedLogs.filter((log) => {
      if (
        user?.role === "admin" &&
        selectedUserId !== "all" &&
        String(log.userId) !== selectedUserId
      ) {
        return false;
      }
      if (
        user?.role === "admin" &&
        userType !== "all" &&
        normalizedLogRole(log) !== userType
      ) {
        return false;
      }
      if (actionType !== "all" && log.action !== actionType) return false;
      if (!matchesDateFilter(log.timestamp, dateFilter)) return false;
      if (dateFrom && log.timestamp.slice(0, 10) < dateFrom) return false;
      if (dateTo && log.timestamp.slice(0, 10) > dateTo) return false;
      if (
        term &&
        !log.action.toLowerCase().includes(term) &&
        !log.description.toLowerCase().includes(term) &&
        !log.user.toLowerCase().includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [
    actionType,
    dateFilter,
    dateFrom,
    dateTo,
    debouncedSearch,
    scopedCachedLogs,
    selectedUserId,
    user,
    userType,
    usingOfflineFallback,
  ]);

  const effectiveTotalLogs = usingOfflineFallback
    ? filteredOfflineLogs.length
    : totalLogs;
  const effectiveTotalPages = usingOfflineFallback
    ? Math.max(1, Math.ceil(filteredOfflineLogs.length / AUDIT_LOG_PAGE_SIZE))
    : totalPages;
  const visibleLogs = useMemo(() => {
    if (!usingOfflineFallback) return pageItems;
    const start = (page - 1) * AUDIT_LOG_PAGE_SIZE;
    return filteredOfflineLogs.slice(start, start + AUDIT_LOG_PAGE_SIZE);
  }, [filteredOfflineLogs, page, pageItems, usingOfflineFallback]);

  const rangeStart = visibleLogs.length
    ? (page - 1) * AUDIT_LOG_PAGE_SIZE + 1
    : 0;
  const rangeEnd = visibleLogs.length
    ? Math.min(rangeStart + visibleLogs.length - 1, effectiveTotalLogs)
    : 0;

  return (
    <MainLayout>
      <div className="flex h-[calc(100vh-110px)] min-w-0 max-w-full flex-col gap-4 overflow-hidden">
        <div className="min-w-0 shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#704389]">
            System Activity
          </p>
          <h2 className="mt-1 text-xl font-bold text-[#2B3642]">Audit Logs</h2>
          <p className="mt-1 text-sm leading-snug text-[#6B7280]">
            {user?.role === "admin"
              ? "Monitor all administrator and legal staff activity."
              : "Review your own account activity and case actions."}
          </p>
        </div>

        <section className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col rounded-xl border border-[#CBD5E1] bg-white p-4 shadow-sm">
          <div className="mb-3 grid min-w-0 shrink-0 gap-2 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[repeat(7,minmax(0,1fr))_auto] xl:items-end">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Search
              </span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search action, user, details…"
                aria-label="Search audit logs"
                className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              />
            </label>
            {user?.role === "admin" && (
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                  User
                </span>
                <select
                  value={selectedUserId}
                  onChange={(event) => {
                    setSelectedUserId(event.target.value);
                    setPage(1);
                  }}
                  className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                >
                  <option value="all">All Users</option>
                  {userOptions.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {user?.role === "admin" && (
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                  User Type
                </span>
                <select
                  value={userType}
                  onChange={(event) => {
                    setUserType(event.target.value);
                    setPage(1);
                  }}
                  className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                >
                  <option value="all">All User Types</option>
                  {userTypeOptions.map((role) => (
                    <option key={role} value={role}>
                      {role === "admin"
                        ? "Administrators"
                        : role === "staff"
                          ? "Legal Staff"
                          : "System"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Action Type
              </span>
              <select
                value={actionType}
                onChange={(event) => {
                  setActionType(event.target.value);
                  setPage(1);
                }}
                className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              >
                <option value="all">All Actions</option>
                {actionOptions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>
            <DateFilterSelect
              value={dateFilter}
              onChange={(nextFilter) => {
                setDateFilter(nextFilter);
                setPage(1);
              }}
            />
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Date From
              </span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setPage(1);
                }}
                className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Date To
              </span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  setPage(1);
                }}
                className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              />
            </label>
            <div className="flex h-9 items-center gap-2 rounded-md border border-[#D1D5DB] bg-[#F8FAFC] px-3">
              <span className="font-semibold text-[#4B5563]">Total:</span>
              <span className="rounded-md bg-[#704389] px-2.5 py-1 text-base font-semibold leading-none text-white">
                {effectiveTotalLogs.toLocaleString()}
              </span>
            </div>
          </div>
          <div className="relative min-h-0 max-w-full flex-1 overflow-y-auto overflow-x-auto rounded-lg border border-[#CBD5E1]">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 z-10 border-b border-[#D1D5DB] bg-[#E5E7EB] text-xs uppercase tracking-wide text-[#374151]">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold">Timestamp</th>
                  <th className="px-3 py-3 text-left font-semibold">User</th>
                  <th className="px-3 py-3 text-left font-semibold">User Type</th>
                  <th className="px-3 py-3 text-left font-semibold">Module</th>
                  <th className="px-3 py-3 text-left font-semibold">Action</th>
                  <th className="px-3 py-3 text-left font-semibold">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {visibleLogs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-10 text-center text-[#2B3642]/50"
                    >
                      {isLoading
                        ? "Loading audit logs…"
                        : "No audit logs recorded yet."}
                    </td>
                  </tr>
                ) : (
                  visibleLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="odd:bg-white even:bg-[#F9FAFB] transition duration-200 hover:bg-[#F3F7FB]"
                    >
                      <td className="px-3 py-4 text-[#2B3642]">
                        {formatDate(log.timestamp)}
                      </td>
                      <td className="px-3 py-4 text-[#4B5563]">{log.user}</td>
                      <td className="px-3 py-4">
                        <UserTypeBadge role={log.userRole ?? log.user_role} />
                      </td>
                      <td className="px-3 py-4">
                        <ModuleBadge module={log.module} />
                      </td>
                      <td className="px-3 py-4 font-medium text-[#2B3642]">
                        {log.action}
                      </td>
                      <td className="px-3 py-4 text-[#4B5563]">
                        {presentActivity(log)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex shrink-0 flex-col gap-2 border-t border-[#E2E8F0] pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[#526174]">
              Showing{" "}
              <strong className="font-semibold tabular-nums text-[#243344]">
                {rangeStart}–{rangeEnd}
              </strong>{" "}
              of{" "}
              <strong className="font-semibold tabular-nums text-[#243344]">
                {effectiveTotalLogs.toLocaleString()}
              </strong>{" "}
              matching logs · Page {page.toLocaleString()} of{" "}
              {effectiveTotalPages.toLocaleString()} ({AUDIT_LOG_PAGE_SIZE} per
              page)
            </p>
            <nav className="flex items-center gap-2" aria-label="Audit log pages">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || isLoading}
                className="inline-flex h-9 items-center rounded-md border border-[#CBD5E1] bg-white px-3 text-sm font-medium text-[#334155] transition hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() =>
                  setPage((current) => Math.min(effectiveTotalPages, current + 1))
                }
                disabled={page >= effectiveTotalPages || isLoading}
                className="inline-flex h-9 items-center rounded-md border border-[#CBD5E1] bg-white px-3 text-sm font-medium text-[#334155] transition hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </nav>
          </div>
        </section>
      </div>
    </MainLayout>
  );
}
