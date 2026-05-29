import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  BriefcaseBusiness,
  ClipboardList,
  FileScan,
  FolderOpen,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

const COLORS = ["#2F80ED", "#15803D", "#F59E0B", "#DC2626", "#7C3AED"];

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
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

  const pendingRatio = useMemo(() => {
    if (!workload?.assigned_cases) return 0;
    return Math.round((workload.pending_case_work / workload.assigned_cases) * 100);
  }, [workload]);

  return (
    <MainLayout>
      <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-[#DBEAFE] bg-gradient-to-br from-[#EFF6FF] to-white px-6 py-6 shadow-sm shadow-[#111827]/10 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-[#2F80ED]">Staff Workspace</p>
          <h1 className="mt-2 text-3xl font-bold text-[#111827]">My Legal Intake Dashboard</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#6B7280]">
            Personal workload, OCR activity, recent clients, assigned case movement, and quick actions for daily PAO operations.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/criminal-cases" className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2F80ED] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#1f6fd6]">
            <Plus className="h-4 w-4" />
            Add Case
          </Link>
          <Link to="/cases" className="inline-flex h-10 items-center gap-2 rounded-md border border-[#D1D5DB] bg-white px-4 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB]">
            <Search className="h-4 w-4" />
            Search Records
          </Link>
        </div>
      </div>

      {isLoading && !workload ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <SkeletonBlock key={index} className="h-40" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <IntelligenceMetricCard label="My Assigned Cases" value={workload?.assigned_cases ?? 0} detail="Cases encoded by you" icon={<BriefcaseBusiness className="h-5 w-5" />} tone="blue" />
          <IntelligenceMetricCard label="Created Today" value={workload?.cases_created_today ?? 0} detail="Today’s intake output" icon={<ClipboardList className="h-5 w-5" />} tone="green" />
          <IntelligenceMetricCard label="Pending Work" value={workload?.pending_case_work ?? 0} detail={`${pendingRatio}% of your workload`} icon={<FolderOpen className="h-5 w-5" />} tone="yellow" />
          <IntelligenceMetricCard label="My OCR Usage" value={workload?.my_ocr_usage ?? 0} detail="Documents scanned by you" icon={<FileScan className="h-5 w-5" />} tone="purple" />
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <AnalyticsPanel title="Case Status Breakdown" subtitle="Your assigned workload by status.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={workload?.status_breakdown ?? []} dataKey="total_cases" nameKey="status" innerRadius={58} outerRadius={98} paddingAngle={3}>
                  {(workload?.status_breakdown ?? []).map((entry, index) => (
                    <Cell key={entry.status} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </AnalyticsPanel>

        <AnalyticsPanel title="My Recent Case Work" subtitle="Latest cases you created or handled.">
          <div className="max-h-80 overflow-y-auto">
            {(workload?.recent_cases ?? []).length === 0 ? (
              <EmptyState message="No recent case work assigned to you yet." />
            ) : (
              <div className="space-y-3">
                {(workload?.recent_cases ?? []).map((record) => (
                  <div key={record.case_id} className="rounded-lg border border-[#E5E7EB] bg-white p-4 hover:bg-[#F9FAFB]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-[#111827]">{record.cases.title_of_case || record.intake_record.control_no}</p>
                      <StatusBadge status={record.cases.status_of_case} />
                    </div>
                    <p className="mt-1 text-sm text-[#6B7280]">Control No. {record.intake_record.control_no || "-"}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </AnalyticsPanel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <AnalyticsPanel title="Pending Case Work" subtitle="Operational pressure from your open cases.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={workload?.status_breakdown ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="status" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="total_cases" radius={[8, 8, 0, 0]} fill="#2F80ED" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </AnalyticsPanel>

        <AnalyticsPanel title="Recently Accessed Clients" subtitle="Clients linked to your recent case work.">
          <div className="space-y-3">
            {(workload?.recent_clients ?? []).length === 0 ? <EmptyState message="No recent client activity yet." /> : (workload?.recent_clients ?? []).map((client) => (
              <div key={client.client_id} className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#111827] text-white">
                  <UserRound className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#111827]">{client.client.name}</p>
                  <p className="truncate text-xs text-[#6B7280]">{client.client_details.address || "No address encoded"}</p>
                </div>
              </div>
            ))}
          </div>
        </AnalyticsPanel>

        <AnalyticsPanel title="My OCR Activity" subtitle="Recent extraction and document scanning work.">
          <div className="space-y-3">
            {(workload?.ocr_recent ?? []).length === 0 ? <EmptyState message="No OCR scans recorded for your account yet." /> : (workload?.ocr_recent ?? []).map((item) => (
              <div key={item.document_id} className="rounded-lg border border-[#E5E7EB] bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#111827]">Document #{item.document_id}</p>
                  <span className="rounded-full bg-[#F3F4F6] px-2 py-1 text-xs font-semibold text-[#374151]">{item.ocr_status}</span>
                </div>
                <p className="mt-1 text-xs text-[#6B7280]">{formatDate(item.uploaded_at)}</p>
              </div>
            ))}
          </div>
        </AnalyticsPanel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
        <AnalyticsPanel title="Quick Actions" subtitle="Common staff workflows.">
          <div className="grid gap-3">
            <Link to="/cases" className="rounded-xl border border-[#E5E7EB] bg-white p-4 font-semibold text-[#111827] transition hover:-translate-y-0.5 hover:border-[#2F80ED] hover:shadow-md">
              Create or attach a criminal case
            </Link>
            <Link to="/terminated-cases" className="rounded-xl border border-[#E5E7EB] bg-white p-4 font-semibold text-[#111827] transition hover:-translate-y-0.5 hover:border-[#DC2626] hover:shadow-md">
              Review terminated cases
            </Link>
            <Link to="/audit-logs" className="rounded-xl border border-[#E5E7EB] bg-white p-4 font-semibold text-[#111827] transition hover:-translate-y-0.5 hover:border-[#111827] hover:shadow-md">
              View my audit trail
            </Link>
          </div>
        </AnalyticsPanel>

        <AnalyticsPanel title="My Recent Actions" subtitle="Audit-backed activity linked to your account.">
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {(workload?.recent_actions ?? []).length === 0 ? <EmptyState message="No recent actions recorded yet." /> : (workload?.recent_actions ?? []).map((action) => (
              <div key={action.id} className="rounded-lg border border-[#E5E7EB] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-[#111827]">{action.action}</p>
                  <span className="text-xs text-[#6B7280]">{formatDate(action.timestamp)}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#374151]">{action.description || "Action recorded"}</p>
              </div>
            ))}
          </div>
        </AnalyticsPanel>
      </div>
    </MainLayout>
  );
}
