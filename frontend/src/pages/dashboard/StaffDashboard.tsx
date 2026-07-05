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
import { EmptyState, SkeletonBlock, AnimatedNumber } from "../../components/dashboard/AnalyticsPrimitives";
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
    <div className="jg-lift jg-hairline rounded-2xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
          <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-ink">{typeof value === "number" ? <AnimatedNumber value={value} /> : value}</p>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}>
          {icon}
        </div>
      </div>
      <p className="mt-4 text-sm font-medium leading-6 text-muted">{detail}</p>
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
      className="jg-lift rounded-2xl border border-line bg-card p-4 shadow-card hover:border-brand-200"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-ink">{label}</p>
          <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
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
            className="inline-flex h-10 items-center justify-center rounded-lg border border-line2 bg-card px-4 text-sm font-semibold text-ink transition hover:bg-card-2"
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
          <StaffMetricCard label="My Cases" value={workload?.assigned_cases ?? 0} detail="Assigned case records" icon={<BriefcaseBusiness className="h-5 w-5" />} tone="bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400" />
          <StaffMetricCard label="Pending Work" value={pendingCount} detail="Awaiting follow-up" icon={<FolderOpen className="h-5 w-5" />} tone="bg-amber-50 dark:bg-amber-400/10 text-amber-800 dark:text-amber-300" />
          <StaffMetricCard label="Today's Intake" value={workload?.cases_created_today ?? 0} detail="Cases encoded today" icon={<ClipboardList className="h-5 w-5" />} tone="bg-emerald-50 dark:bg-emerald-400/10 text-emerald-800 dark:text-emerald-300" />
          <StaffMetricCard label="OCR Usage" value={workload?.my_ocr_usage ?? 0} detail="Personal document scans" icon={<FileScan className="h-5 w-5" />} tone="bg-brand-50 dark:bg-brand-400/10 text-brand-800 dark:text-brand-200" />
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.38fr_0.62fr]">
        <section className="rounded-2xl border border-line bg-card shadow-card">
          <div className="border-b border-line bg-card-2 px-5 py-4">
            <h2 className="text-xl font-bold text-ink">Quick Actions</h2>
          </div>
          <div className="grid gap-3 p-5">
            <ActionCard to="/cases" label="Add Client" description="Create a client intake record." icon={<UserPlus className="h-5 w-5" />} />
            <ActionCard to="/cases" label="Add Case" description="Attach a case to an existing client." icon={<Plus className="h-5 w-5" />} />
            <ActionCard to="/cases" label="Search Records" description="Find clients and criminal case records." icon={<Search className="h-5 w-5" />} />
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-card shadow-card">
          <div className="border-b border-line bg-card-2 px-5 py-4">
            <h2 className="text-xl font-bold text-ink">My Recent Assigned Cases</h2>
          </div>
          <div className="max-h-[360px] overflow-auto">
            {recentCases.length === 0 ? (
              <div className="p-5"><EmptyState message="No assigned cases are available yet." /></div>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-line2 bg-card-2 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Client Name</th>
                    <th className="px-4 py-3 text-left font-semibold">Control Number</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-left font-semibold">Last Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {recentCases.map((record) => (
                    <tr key={record.case_id} className="bg-card hover:bg-card-2">
                      <td className="px-4 py-4 font-semibold text-ink">
                        {clientById.get(record.client_id) ?? "Assigned client"}
                      </td>
                      <td className="px-4 py-4 text-muted">{record.intake_record.control_no || "-"}</td>
                      <td className="px-4 py-4">
                        <StatusBadge status={record.cases.status_of_case} />
                      </td>
                      <td className="px-4 py-4 text-muted">{formatDate(record.last_updated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-card shadow-card">
        <div className="border-b border-line bg-card-2 px-5 py-4">
          <h2 className="text-xl font-bold text-ink">Recent Clients</h2>
        </div>
        <div className="grid max-h-[290px] gap-3 overflow-y-auto p-5 sm:grid-cols-2 xl:grid-cols-3">
          {recentClients.length === 0 ? (
            <div className="sm:col-span-2 xl:col-span-3"><EmptyState message="No recent clients are available yet." /></div>
          ) : (
            recentClients.map((client) => (
              <Link
                key={client.client_id}
                to="/cases"
                className="flex items-center gap-3 rounded-xl border border-line bg-card px-3 py-3 transition hover:bg-card-2"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400">
                  <UserRound className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{client.client.name}</p>
                  <p className="truncate text-xs text-muted">{client.client_details.contact_no || client.client_details.address || "No contact encoded"}</p>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </MainLayout>
  );
}
