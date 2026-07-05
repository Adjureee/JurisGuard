import MainLayout from "../layouts/MainLayout";
import PageHeader from "../components/PageHeader";
import { useAuth } from "../contexts/AuthContext";
import {
  useAuditLogStore,
  type AuditLogEntry,
} from "../features/auditLogs/auditLogStore";
import { useEffect, useMemo, useState } from "react";
import { listAuditLogs } from "../services/auditService";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ModuleBadge({ module }: { module: AuditLogEntry["module"] }) {
  const className =
    module === "Authentication"
      ? "bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400"
      : module === "Admin"
        ? "bg-amber-50 dark:bg-amber-400/10 text-amber-800 dark:text-amber-300"
        : module === "Export"
          ? "bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400"
          : "bg-card-2 text-muted";

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
      ? "bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400"
      : role === "staff"
        ? "bg-card-2 text-muted"
        : "bg-card-2 text-muted";
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
  const logs = useAuditLogStore((state) => state.logs);
  const setLogsForViewer = useAuditLogStore((state) => state.setLogsForViewer);
  const scopeToViewer = useAuditLogStore((state) => state.scopeToViewer);
  const [selectedUserId, setSelectedUserId] = useState("all");
  const [userType, setUserType] = useState("all");
  const [actionType, setActionType] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const currentUser = user;
    scopeToViewer(currentUser);
    async function loadAuditLogs() {
      try {
        const rows = await listAuditLogs({ currentUser });
        if (!cancelled) setLogsForViewer(rows, currentUser);
      } catch {
        if (!cancelled) scopeToViewer(currentUser);
      }
    }

    void loadAuditLogs();

    return () => {
      cancelled = true;
    };
  }, [scopeToViewer, setLogsForViewer, user]);
  const userOptions = useMemo(
    () =>
      Array.from(
        new Map(
          logs
            .filter((log) => log.userId !== null)
            .map((log) => [String(log.userId), log.user]),
        ).entries(),
      ),
    [logs],
  );
  const userTypeOptions = useMemo(
    () => Array.from(new Set(scopedRoleList(logs))).sort(),
    [logs],
  );
  const scopedLogs = useMemo(
    () =>
      user?.role === "admin"
        ? logs
        : logs.filter((log) => log.userId === user?.user_id),
    [logs, user],
  );
  const actionOptions = useMemo(
    () => Array.from(new Set(scopedLogs.map((log) => log.action))).sort(),
    [scopedLogs],
  );
  const visibleLogs = useMemo(() => {
    return scopedLogs.filter((log) => {
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
      if (dateFrom && log.timestamp.slice(0, 10) < dateFrom) return false;
      if (dateTo && log.timestamp.slice(0, 10) > dateTo) return false;
      return true;
    });
  }, [
    actionType,
    dateFrom,
    dateTo,
    scopedLogs,
    selectedUserId,
    user,
    userType,
  ]);

  return (
    <MainLayout>
      <div className="mb-5">
        <p className="text-sm font-semibold text-brand-600 dark:text-brand-400">System Activity</p>
        <h2 className="text-2xl font-bold text-ink">Audit Logs</h2>
        <p className="mt-1 text-sm text-muted">
          {user?.role === "admin"
            ? "Monitor all administrator and legal staff activity."
            : "Review your own account activity and case actions."}
        </p>
      </div>

      <section className="rounded-xl border border-line bg-card shadow-sm">
        <div className="grid gap-3 border-b border-line bg-card px-5 py-4 md:grid-cols-5">
          {user?.role === "admin" && (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                User
              </span>
              <select
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-line2 bg-card px-3 text-sm text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
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
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                User Type
              </span>
              <select
                value={userType}
                onChange={(event) => setUserType(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-line2 bg-card px-3 text-sm text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
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
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Action Type
            </span>
            <select
              value={actionType}
              onChange={(event) => setActionType(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-line2 bg-card px-3 text-sm text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
            >
              <option value="all">All Actions</option>
              {actionOptions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Date From
            </span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-line2 bg-card px-3 text-sm text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Date To
            </span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-line2 bg-card px-3 text-sm text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
            />
          </label>
        </div>
        <div className="border-b border-line bg-card-2 px-5 py-4">
          <h3 className="font-semibold text-ink">Recent Activity</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="sticky top-0 z-10 border-b border-line2 bg-card-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Timestamp</th>
                <th className="px-5 py-3 text-left font-semibold">User</th>
                <th className="px-5 py-3 text-left font-semibold">User Type</th>
                <th className="px-5 py-3 text-left font-semibold">Module</th>
                <th className="px-5 py-3 text-left font-semibold">Action</th>
                <th className="px-5 py-3 text-left font-semibold">
                  Description
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleLogs.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-muted"
                  >
                    No audit logs recorded yet.
                  </td>
                </tr>
              ) : (
                visibleLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="odd:bg-card even:bg-card-2 transition duration-200 hover:bg-card-2"
                  >
                    <td className="px-5 py-4 text-ink">
                      {formatDate(log.timestamp)}
                    </td>
                    <td className="px-5 py-4 text-muted">{log.user}</td>
                    <td className="px-5 py-4">
                      <UserTypeBadge role={log.userRole ?? log.user_role} />
                    </td>
                    <td className="px-5 py-4">
                      <ModuleBadge module={log.module} />
                    </td>
                    <td className="px-5 py-4 font-medium text-ink">
                      {log.action}
                    </td>
                    <td className="px-5 py-4 text-muted">
                      {log.description}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </MainLayout>
  );
}
