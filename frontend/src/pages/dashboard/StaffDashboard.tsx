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
import PageHeader from "../../components/PageHeader";
import { EmptyState, SkeletonBlock } from "../../components/dashboard/AnalyticsPrimitives";
import { StatusBadge } from "../../features/criminalCases/components/StatusBadge";
import { useAuth } from "../../contexts/AuthContext";
import { getStaffWorkload, type StaffWorkload } from "../../services/dashboardService";

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function StaffMetricCard({
  detail,
  icon,
  label,
  tone,
  value,
}: {
  detail: string;
  icon: ReactNode;
  label: string;
  tone: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(17,24,39,0.07)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6B7280]">{label}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-[#111827]">{value}</p>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}>
          {icon}
        </div>
      </div>
      <p className="mt-4 text-sm font-medium leading-6 text-[#6B7280]">{detail}</p>
    </div>
  );
}

function ActionCard({
  description,
  icon,
  label,
  to,
}: {
  description: string;
  icon: ReactNode;
  label: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-[#C7D2FE] hover:bg-[#F9FAFB]"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFF6FF] text-[#2563EB]">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-[#111827]">{label}</p>
          <p className="mt-1 text-sm leading-6 text-[#6B7280]">{description}</p>
        </div>
      </div>
    </Link>
  );
}

export default function StaffDashboard() {
  const { user } = useAuth();
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

  const recentCases = useMemo(() => (workload?.recent_cases ?? []).slice(0, 5), [workload]);
  const recentClients = useMemo(() => (workload?.recent_clients ?? []).slice(0, 5), [workload]);
  const clientById = useMemo(
    () => new Map((workload?.recent_clients ?? []).map((client) => [client.client_id, client.client.name])),
    [workload]
  );
  const pendingCount = workload?.pending_case_work ?? 0;

  return (
    <MainLayout>
      <PageHeader
        eyebrow="Staff Workspace"
        title="My Legal Intake Dashboard"
        description={`Personal workload, assigned cases, and intake operations for ${user?.full_name || user?.email || "staff"}.`}
        actions={
          <Link
            to="/case-submissions"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-[#D1D5DB] bg-white px-4 text-sm font-semibold text-[#2B3642] transition hover:bg-[#F3F4F6]"
          >
            Report Management
          </Link>
        }
      />

      {isLoading && !workload ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <SkeletonBlock key={index} className="h-36" />)}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <StaffMetricCard label="My Cases" value={workload?.assigned_cases ?? 0} detail="Assigned case records" icon={<BriefcaseBusiness className="h-5 w-5" />} tone="bg-[#EFF6FF] text-[#2563EB]" />
          <StaffMetricCard label="Pending Work" value={pendingCount} detail="Awaiting follow-up" icon={<FolderOpen className="h-5 w-5" />} tone="bg-[#FFFBEB] text-[#92400E]" />
          <StaffMetricCard label="Today's Intake" value={workload?.cases_created_today ?? 0} detail="Cases encoded today" icon={<ClipboardList className="h-5 w-5" />} tone="bg-[#ECFDF5] text-[#065F46]" />
          <StaffMetricCard label="OCR Usage" value={workload?.my_ocr_usage ?? 0} detail="Personal document scans" icon={<FileScan className="h-5 w-5" />} tone="bg-[#F5F3FF] text-[#5B21B6]" />
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.38fr_0.62fr]">
        <section className="rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <div className="border-b border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
            <h2 className="text-xl font-bold text-[#111827]">Quick Actions</h2>
          </div>
          <div className="grid gap-3 p-5">
            <ActionCard to="/cases" label="Add Client" description="Create a client intake record." icon={<UserPlus className="h-5 w-5" />} />
            <ActionCard to="/cases" label="Add Case" description="Attach a case to an existing client." icon={<Plus className="h-5 w-5" />} />
            <ActionCard to="/cases" label="Search Records" description="Find clients and criminal case records." icon={<Search className="h-5 w-5" />} />
          </div>
        </section>

        <section className="rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <div className="border-b border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
            <h2 className="text-xl font-bold text-[#111827]">My Recent Assigned Cases</h2>
          </div>
          <div className="max-h-[360px] overflow-auto">
            {recentCases.length === 0 ? (
              <div className="p-5"><EmptyState message="No assigned cases are available yet." /></div>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-[#D1D5DB] bg-[#E5E7EB] text-xs uppercase tracking-wide text-[#374151]">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Client Name</th>
                    <th className="px-4 py-3 text-left font-semibold">Control Number</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-left font-semibold">Last Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {recentCases.map((record) => (
                    <tr key={record.case_id} className="bg-white hover:bg-[#F9FAFB]">
                      <td className="px-4 py-4 font-semibold text-[#111827]">
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
            )}
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
        <div className="border-b border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
          <h2 className="text-xl font-bold text-[#111827]">Recent Clients</h2>
        </div>
        <div className="grid max-h-[290px] gap-3 overflow-y-auto p-5 sm:grid-cols-2 xl:grid-cols-3">
          {recentClients.length === 0 ? (
            <div className="sm:col-span-2 xl:col-span-3"><EmptyState message="No recent clients are available yet." /></div>
          ) : (
            recentClients.map((client) => (
              <Link
                key={client.client_id}
                to="/cases"
                className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-white px-3 py-3 transition hover:bg-[#F9FAFB]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFF6FF] text-[#2563EB]">
                  <UserRound className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#111827]">{client.client.name}</p>
                  <p className="truncate text-xs text-[#6B7280]">{client.client_details.contact_no || client.client_details.address || "No contact encoded"}</p>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </MainLayout>
  );
}
