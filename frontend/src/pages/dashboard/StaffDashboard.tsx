import { useEffect, useMemo, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import {
  BriefcaseBusiness,
  ClipboardList,
  FileScan,
  FolderOpen,
  Plus,
  Search,
  UserPlus,
  UserRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import MainLayout from "../../layouts/MainLayout";
import { getStaffWorkload, type StaffWorkload } from "../../services/dashboardService";
import {
  AnalyticsPanel,
  EmptyState,
  IntelligenceMetricCard,
  SkeletonBlock,
} from "../../components/dashboard/AnalyticsPrimitives";
import { StatusBadge } from "../../features/criminalCases/components/StatusBadge";

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function ActionCard({
  to,
  label,
  description,
  icon,
}: {
  to: string;
  label: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-[#D7DEE7] bg-white p-4 transition hover:border-[#2563EB] hover:bg-[#EFF6FF] hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB]">
          {icon}
        </div>
        <div>
          <p className="font-semibold text-[#111827]">{label}</p>
          <p className="mt-1 text-sm leading-6 text-[#6B7280]">{description}</p>
        </div>
      </div>
    </Link>
  );
}

export default function StaffDashboard() {
  const [workload, setWorkload] = useState<StaffWorkload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkload() {
      setIsLoading(true);
      try {
        const data = await getStaffWorkload();
        if (!cancelled) setWorkload(data);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Unable to load staff dashboard");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadWorkload();
    return () => {
      cancelled = true;
    };
  }, []);

  const recentCases = useMemo(() => (workload?.recent_cases ?? []).slice(0, 6), [workload]);
  const recentClients = useMemo(() => (workload?.recent_clients ?? []).slice(0, 6), [workload]);
  const clientById = useMemo(
    () => new Map((workload?.recent_clients ?? []).map((client) => [client.client_id, client.client.name])),
    [workload]
  );
  const pendingCount = workload?.pending_case_work ?? 0;

  return (
    <MainLayout>
      <div className="mb-8 rounded-2xl border border-[#D7DEE7] bg-white px-6 py-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#2563EB]">Staff Workspace</p>
        <h1 className="mt-2 text-3xl font-bold text-[#111827]">My Legal Intake Dashboard</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#6B7280]">
          Personal workload, assigned cases, and intake operations.
        </p>
      </div>

      {isLoading && !workload ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <SkeletonBlock key={index} className="h-36" />)}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <IntelligenceMetricCard label="My Cases" value={workload?.assigned_cases ?? 0} detail="Assigned case records" icon={<BriefcaseBusiness className="h-5 w-5" />} tone="blue" />
          <IntelligenceMetricCard label="Pending Work" value={pendingCount} detail="Awaiting follow-up" icon={<FolderOpen className="h-5 w-5" />} tone="yellow" />
          <IntelligenceMetricCard label="Today's Intake Output" value={workload?.cases_created_today ?? 0} detail="Cases encoded today" icon={<ClipboardList className="h-5 w-5" />} tone="green" />
          <IntelligenceMetricCard label="OCR Usage" value={workload?.my_ocr_usage ?? 0} detail="Documents scanned" icon={<FileScan className="h-5 w-5" />} tone="purple" />
        </div>
      )}

      <div className="mt-8 grid gap-6 xl:grid-cols-[0.7fr_0.3fr]">
        <AnalyticsPanel title="Quick Actions" subtitle="Common intake tasks.">
          <div className="grid gap-3">
            <ActionCard to="/cases" label="Add Client" description="Create a client intake record." icon={<UserPlus className="h-5 w-5" />} />
            <ActionCard to="/cases" label="Add Case" description="Attach a case to a client." icon={<Plus className="h-5 w-5" />} />
            <ActionCard to="/cases" label="Search Records" description="Find clients and cases." icon={<Search className="h-5 w-5" />} />
          </div>
        </AnalyticsPanel>

        <AnalyticsPanel title="Recent Clients" subtitle="Clients linked to your recent work.">
          {recentClients.length === 0 ? (
            <EmptyState message="No recent clients are available yet." />
          ) : (
            <div className="space-y-3">
              {recentClients.map((client) => (
                <Link
                  key={client.client_id}
                  to="/cases"
                  className="flex items-center gap-3 rounded-lg border border-[#D7DEE7] bg-white px-3 py-3 transition hover:bg-[#F9FAFB]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB]">
                    <UserRound className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#111827]">{client.client.name}</p>
                    <p className="truncate text-xs text-[#6B7280]">{client.client_details.contact_no || client.client_details.address || "No contact encoded"}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </AnalyticsPanel>
      </div>

      <div className="mt-8">
        <AnalyticsPanel title="My Recent Assigned Cases" subtitle="Operational queue for active staff work.">
          {recentCases.length === 0 ? (
            <EmptyState message="No assigned cases are available yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="border-b border-[#D1D5DB] bg-[#E5E7EB] text-xs uppercase tracking-wide text-[#374151]">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Client Name</th>
                    <th className="px-4 py-3 text-left font-semibold">Control Number</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-left font-semibold">Last Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#D7DEE7]">
                  {recentCases.map((record) => (
                    <tr key={record.case_id} className="bg-white hover:bg-[#F9FAFB]">
                      <td className="px-4 py-4 font-medium text-[#111827]">
                        {clientById.get(record.client_id) ?? "Assigned client"}
                      </td>
                      <td className="px-4 py-4 text-[#6B7280]">{record.intake_record.control_no || "-"}</td>
                      <td className="px-4 py-4">
                        <StatusBadge status={record.cases.status_of_case} />
                      </td>
                      <td className="px-4 py-4 text-[#6B7280]">{formatDate(record.last_updated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AnalyticsPanel>
      </div>
    </MainLayout>
  );
}
