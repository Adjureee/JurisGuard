import MainLayout from "../layouts/MainLayout";
import { useAuth } from "../contexts/AuthContext";
import { useAuditLogStore, type AuditLogEntry } from "../features/auditLogs/auditLogStore";
import { useEffect, useMemo, useState } from "react";
import { listAuditLogs } from "../services/auditService";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value)
  );
}

function ModuleBadge({ module }: { module: AuditLogEntry["module"] }) {
  const className =
    module === "Authentication"
      ? "bg-[#EFF6FF] text-[#1D4ED8]"
      : module === "Admin"
        ? "bg-amber-100 text-amber-800"
        : module === "Export"
          ? "bg-[#DCFCE7] text-[#166534]"
          : "bg-[#F3F4F6] text-[#374151]";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {module}
    </span>
  );
}

export default function AuditLogsPage() {
  const { user } = useAuth();
  const logs = useAuditLogStore((state) => state.logs);
  const setLogs = useAuditLogStore((state) => state.setLogs);
  const [selectedUserId, setSelectedUserId] = useState("all");
  const [actionType, setActionType] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    async function loadAuditLogs() {
      try {
        const rows = await listAuditLogs();
        if (!cancelled) setLogs(rows);
      } catch {
        // Keep locally captured logs visible if the backend is unavailable.
      }
    }

    void loadAuditLogs();

    return () => {
      cancelled = true;
    };
  }, [setLogs, user]);
  const userOptions = useMemo(
    () =>
      Array.from(
        new Map(
          logs
            .filter((log) => log.userId !== null)
            .map((log) => [String(log.userId), log.user])
        ).entries()
      ),
    [logs]
  );
  const scopedLogs = useMemo(
    () =>
      user?.role === "admin"
        ? logs
        : logs.filter((log) => log.userId === user?.user_id),
    [logs, user]
  );
  const actionOptions = useMemo(
    () => Array.from(new Set(scopedLogs.map((log) => log.action))).sort(),
    [scopedLogs]
  );
  const visibleLogs = useMemo(() => {
    return scopedLogs.filter((log) => {
      if (user?.role === "admin" && selectedUserId !== "all" && String(log.userId) !== selectedUserId) {
        return false;
      }
      if (actionType !== "all" && log.action !== actionType) return false;
      if (dateFrom && log.timestamp.slice(0, 10) < dateFrom) return false;
      if (dateTo && log.timestamp.slice(0, 10) > dateTo) return false;
      return true;
    });
  }, [actionType, dateFrom, dateTo, scopedLogs, selectedUserId, user]);

  return (
    <MainLayout>
      <div className="mb-5">
        <p className="text-sm font-semibold text-[#2F80ED]">System Activity</p>
        <h2 className="text-2xl font-bold text-[#111827]">Audit Logs</h2>
      </div>

      <section className="rounded-lg border border-[#E5E7EB] bg-white shadow-sm shadow-[#111827]/10">
        <div className="grid gap-3 border-b border-[#E5E7EB] bg-white px-5 py-4 md:grid-cols-4">
          {user?.role === "admin" && (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">User</span>
              <select
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#111827] outline-none focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/20"
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
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Action Type</span>
            <select
              value={actionType}
              onChange={(event) => setActionType(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#111827] outline-none focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/20"
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
            <span className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Date From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#111827] outline-none focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/20"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Date To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#111827] outline-none focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/20"
            />
          </label>
        </div>
        <div className="border-b border-[#E5E7EB] bg-[#F3F4F6] px-5 py-4">
          <h3 className="font-semibold text-[#111827]">Recent Activity</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-[#F3F4F6] text-[#374151]">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Timestamp</th>
                <th className="px-5 py-3 text-left font-semibold">User</th>
                <th className="px-5 py-3 text-left font-semibold">Module</th>
                <th className="px-5 py-3 text-left font-semibold">Action</th>
                <th className="px-5 py-3 text-left font-semibold">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {visibleLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-[#6B7280]">
                    No audit logs recorded yet.
                  </td>
                </tr>
              ) : (
                visibleLogs.map((log) => (
                  <tr key={log.id} className="bg-white transition duration-200 hover:bg-gray-50">
                    <td className="px-5 py-4 text-[#111827]">{formatDate(log.timestamp)}</td>
                    <td className="px-5 py-4 text-[#111827]/80">{log.user}</td>
                    <td className="px-5 py-4">
                      <ModuleBadge module={log.module} />
                    </td>
                    <td className="px-5 py-4 font-medium text-[#111827]">{log.action}</td>
                    <td className="px-5 py-4 text-[#111827]/80">{log.description}</td>
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
