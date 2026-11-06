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
import { EmptyState, SkeletonBlock } from "../../components/dashboard/AnalyticsPrimitives";
import DashboardGreeting from "../../components/dashboard/DashboardGreeting";
import IntelligenceBrief from "../../components/dashboard/IntelligenceBrief";
import OfficePersonnelOverview from "../../components/dashboard/OfficePersonnelOverview";
import CalendarReminders from "../../features/dashboardReminders/CalendarReminders";
import { StatusBadge } from "../../features/criminalCases/components/StatusBadge";
import { useAuth } from "../../contexts/AuthContext";
import { getStaffWorkload, type StaffWorkload } from "../../services/dashboardService";
import { listCaseSubmissions, type CaseSubmission } from "../../services/caseSubmissionService";

const CORRECTION_STATUSES = new Set(["Correction Required", "Correction Requested"]);

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
      className="rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-[#E7D7EE] hover:bg-[#F9FAFB]"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F7F0FA] text-[#704389]">
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
  const [submissions, setSubmissions] = useState<CaseSubmission[] | null>(null);
  const [submissionsUnavailable, setSubmissionsUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setWorkload(null);
    setIsLoading(true);
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
  }, [user?.user_id]);

  useEffect(() => {
    let cancelled = false;
    setSubmissions(null);
    setSubmissionsUnavailable(false);
    listCaseSubmissions()
      .then((rows) => { if (!cancelled) setSubmissions(Array.isArray(rows) ? rows : []); })
      .catch(() => {
        if (!cancelled) {
          setSubmissions([]);
          setSubmissionsUnavailable(true);
        }
      });
    return () => { cancelled = true; };
  }, [user?.user_id]);

  const recentCases = useMemo(() => (workload?.recent_cases ?? []).slice(0, 5), [workload]);
  const recentClients = useMemo(() => (workload?.recent_clients ?? []).slice(0, 5), [workload]);
  const clientById = useMemo(
    () => new Map((workload?.recent_clients ?? []).map((client) => [client.client_id, client.client.name])),
    [workload]
  );
  const pendingCount = workload?.pending_case_work ?? 0;
  const reportsNeedingCorrection = (submissions ?? []).filter((submission) => CORRECTION_STATUSES.has(submission.status));

  return (
    <MainLayout>
      <DashboardGreeting
        name={user?.full_name || user?.email || "Attorney/Staff"}
        context="Staff Workspace · My Legal Intake Dashboard"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/staff/analytics" className="inline-flex h-10 items-center justify-center rounded-lg border border-[#D1D5DB] bg-white px-4 text-sm font-semibold text-[#2B3642] transition hover:bg-[#F3F4F6]">Analytics &amp; Reports</Link>
            <Link
              to="/case-submissions"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-[#D1D5DB] bg-white px-4 text-sm font-semibold text-[#2B3642] transition hover:bg-[#F3F4F6]"
            >
              Report Management
            </Link>
          </div>
        }
      />

      {isLoading && !workload ? (
        <div className="grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <SkeletonBlock key={index} className="h-36" />)}
        </div>
      ) : (
        <div className="grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <StaffMetricCard label="My Cases" value={workload?.assigned_cases ?? 0} detail="Assigned case records" icon={<BriefcaseBusiness className="h-5 w-5" />} tone="bg-[#F7F0FA] text-[#704389]" />
          <StaffMetricCard label="Pending Work" value={pendingCount} detail="Awaiting follow-up" icon={<FolderOpen className="h-5 w-5" />} tone="bg-[#FFFBEB] text-[#92400E]" />
          <StaffMetricCard label="Today's Intake" value={workload?.cases_created_today ?? 0} detail="Cases encoded today" icon={<ClipboardList className="h-5 w-5" />} tone="bg-[#ECFDF5] text-[#065F46]" />
          <StaffMetricCard label="OCR Usage" value={workload?.my_ocr_usage ?? 0} detail="Personal document scans" icon={<FileScan className="h-5 w-5" />} tone="bg-[#F5F3FF] text-[#5B21B6]" />
        </div>
      )}

      <CalendarReminders />
      <div className="mt-6 grid items-stretch gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <OfficePersonnelOverview staffLayout />
        <IntelligenceBrief compact emphasized fitContent />
      </div>

      <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)]">
        <section className="min-w-0 rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <div className="border-b border-[#E5E7EB] bg-[#604477] px-5 py-4">
            <h2 className="text-xl font-bold text-white">Quick Actions</h2>
          </div>
          <div className="grid gap-3 p-5">
            <ActionCard to="/cases?action=intake" label="Scan interview sheet" description="Review and extract a PAO interview sheet." icon={<FileScan className="h-5 w-5" />} />
            <ActionCard to="/cases?action=client" label="Add Client" description="Create a client intake record." icon={<UserPlus className="h-5 w-5" />} />
            <ActionCard to="/cases?action=case" label="Add Case" description="Attach a case to an existing client." icon={<Plus className="h-5 w-5" />} />
            <ActionCard to="/cases" label="Search Records" description="Find clients and criminal case records." icon={<Search className="h-5 w-5" />} />
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <div className="border-b border-[#E5E7EB] bg-[#604477] px-5 py-4">
            <h2 className="text-xl font-bold text-white">My Recent Assigned Cases</h2>
          </div>
          <div className="max-h-[360px] max-w-full overflow-auto">
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
                        {record.participants?.map((participant) => participant.name).filter(Boolean).join(", ") || clientById.get(record.client_id) || "Assigned client"}
                      </td>
                      <td className="px-4 py-4 text-[#6B7280]"><Link to={`/cases?case=${encodeURIComponent(record.case_id)}`} className="font-medium underline-offset-2 hover:text-[#704389] hover:underline">{record.intake_record.control_no || "Open case"}</Link></td>
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

      <section className="mt-6 min-w-0 rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E7EB] bg-[#604477] px-5 py-4">
          <h2 className="text-xl font-bold text-white">Reports Returned for Correction</h2>
          <Link to="/case-submissions" className="text-sm font-semibold text-white underline underline-offset-2">Open reports</Link>
        </div>
        <div className="p-5">
          {submissions === null ? (
            <div className="space-y-3"><SkeletonBlock className="h-14" /><SkeletonBlock className="h-14" /></div>
          ) : submissionsUnavailable ? (
            <p className="text-sm text-[#6B7280]">Your submissions are temporarily unavailable. Open Report Management to retry.</p>
          ) : reportsNeedingCorrection.length === 0 ? (
            <EmptyState message="No reports have been returned for correction." />
          ) : (
            <ul className="divide-y divide-[#E5E7EB]">
              {reportsNeedingCorrection.slice(0, 5).map((submission) => (
                <li key={submission.submission_id}>
                  <Link to={`/case-submissions?submission=${encodeURIComponent(submission.submission_id)}`} className="flex min-h-14 items-center justify-between gap-3 py-3 hover:text-[#704389]">
                    <span className="min-w-0"><span className="block truncate font-semibold">{submission.title}</span><span className="mt-1 block text-sm text-[#6B7280]">{submission.status} · {formatDate(submission.updated_at)}</span></span>
                    <span className="shrink-0 text-sm font-semibold">Review</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className="mt-6 min-w-0 rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
        <div className="border-b border-[#E5E7EB] bg-[#604477] px-5 py-4">
          <h2 className="text-xl font-bold text-white">Recent Clients</h2>
        </div>
        <div className="grid max-h-[290px] gap-3 overflow-y-auto p-5 sm:grid-cols-2 xl:grid-cols-3">
          {recentClients.length === 0 ? (
            <div className="sm:col-span-2 xl:col-span-3"><EmptyState message="No recent clients are available yet." /></div>
          ) : (
            recentClients.map((client) => (
              <Link
                key={client.client_id}
                to={`/cases?client=${encodeURIComponent(client.client_id)}`}
                className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-white px-3 py-3 transition hover:bg-[#F9FAFB]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F7F0FA] text-[#704389]">
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
