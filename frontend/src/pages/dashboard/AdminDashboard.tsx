import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  Archive,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  FileText,
  Gavel,
  PlusCircle,
  RotateCcw,
  Send,
  Users,
} from "lucide-react";
import MainLayout from "../../layouts/MainLayout";
import { EmptyState, SkeletonBlock, initials } from "../../components/dashboard/AnalyticsPrimitives";
import DashboardGreeting from "../../components/dashboard/DashboardGreeting";
import IntelligenceBrief from "../../components/dashboard/IntelligenceBrief";
import CalendarReminders from "../../features/dashboardReminders/CalendarReminders";
import ProtectedProfileImage from "../../components/ProtectedProfileImage";
import { listCaseSubmissions, type CaseSubmission } from "../../services/caseSubmissionService";
import { useDashboardAnalytics } from "./useDashboardAnalytics";
import { useAuth } from "../../contexts/AuthContext";

const REVIEW_STATUSES = new Set(["Submitted", "Under Review", "Resubmitted"]);

function formatLegalDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatLegalDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function KpiCard({
  detail,
  icon,
  label,
  metricLabel,
  tone,
  value,
}: {
  detail: string;
  icon: ReactNode;
  label: string;
  metricLabel?: string;
  tone: string;
  value: string | number;
}) {
  return (
    <div className="group rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(17,24,39,0.07)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6B7280]">{label}</p>
          {metricLabel && <p className="mt-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6B7280]">{metricLabel}</p>}
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

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activities, isLoading, overview } = useDashboardAnalytics({ deep: false });
  const [submissions, setSubmissions] = useState<CaseSubmission[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadSubmissions() {
      try {
        const rows = await listCaseSubmissions();
        if (!cancelled) setSubmissions(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setSubmissions([]);
      }
    }
    void loadSubmissions();
    return () => {
      cancelled = true;
    };
  }, []);

  const awaitingReview = useMemo(
    () => submissions.filter((submission) => REVIEW_STATUSES.has(submission.status)),
    [submissions],
  );
  const recentSubmissions = useMemo(() => submissions.slice(0, 5), [submissions]);
  const recentCaseUpdates = useMemo(
    () =>
      activities
        .filter((activity) => {
          const text = `${activity.entity_type ?? ""} ${activity.action ?? ""} ${activity.description ?? ""}`.toLowerCase();
          return text.includes("case") || text.includes("client");
        }),
    [activities],
  );

  const monthStart = new Date();
  monthStart.setDate(1);

  return (
    <MainLayout>
      <DashboardGreeting
        name={user?.full_name || "Administrator"}
        actions={
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              System Secure
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-1.5 text-[#4B5563]">
              Database Live
            </span>
          </div>
        }
      />

      {isLoading && !overview ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => <SkeletonBlock key={index} className="h-40" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <KpiCard label="Total Clients" value={overview?.total_clients ?? 0} detail="Registered client profiles" icon={<Users className="h-5 w-5" />} tone="bg-[#F7F0FA] text-[#704389]" />
          <KpiCard label="Total Cases" value={overview?.total_cases ?? 0} detail="Criminal case records" icon={<Gavel className="h-5 w-5" />} tone="bg-[#F3F4F6] text-[#111827]" />
          <KpiCard label="Active Cases" value={overview?.active_cases ?? 0} detail="Open operational workload" icon={<BriefcaseBusiness className="h-5 w-5" />} tone="bg-[#ECFDF5] text-[#065F46]" />
          <KpiCard label="Terminated Cases" value={overview?.terminated_cases ?? 0} detail="Closed or archived matters" icon={<Archive className="h-5 w-5" />} tone="bg-[#FFF1F2] text-[#9F1239]" />
          <KpiCard label="This Month" metricLabel="Cases" value={overview?.cases_this_month ?? 0} detail={`Since ${formatLegalDate(monthStart)}`} icon={<CalendarDays className="h-5 w-5" />} tone="bg-[#FFFBEB] text-[#92400E]" />
          <KpiCard label="Reports Awaiting Review" value={awaitingReview.length} detail="Staff report bundles for action" icon={<FileText className="h-5 w-5" />} tone="bg-[#F7F0FA] text-[#704389]" />
        </div>
      )}

      <CalendarReminders />
      <IntelligenceBrief />
      <div className="mt-6 grid gap-6 xl:grid-cols-[0.42fr_0.58fr]">
        <section className="rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <div className="border-b border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
            <h2 className="text-xl font-bold text-[#111827]">Recent Case Updates</h2>
          </div>
          <div className="max-h-[330px] overflow-y-auto p-5">
            {recentCaseUpdates.length === 0 ? (
              <EmptyState message="No recent case updates are available." />
            ) : (
              <div className="space-y-3">
                {recentCaseUpdates.map((activity) => {
                  const Icon = activity.action === "Create Transfer Draft" ? PlusCircle
                    : activity.action === "Submit Case Transfer" || activity.action === "Resubmit Case Transfer" ? Send
                      : activity.action === "Return Case Transfer" ? RotateCcw
                        : activity.action === "Transfer Assignments Updated" ? Users
                        : activity.action === "Confirm Case Transfer" ? CheckCircle2 : Activity;
                  const content = (
                    <div className="flex gap-3">
                      <Icon className="mt-1 h-5 w-5 shrink-0 text-[#704389]" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold leading-5 text-[#111827]">{activity.title || activity.action}</p>
                          {activity.status && <span className="rounded-full bg-[#F7F0FA] px-2 py-0.5 text-[11px] font-semibold text-[#704389]">{activity.status}</span>}
                        </div>
                        <p className="mt-1 text-sm leading-5 text-[#2B3642]">{activity.description}</p>
                        <p className="mt-2 text-xs font-medium text-[#6B7280]">{activity.user} · {activity.role || "User"} · {formatLegalDateTime(activity.timestamp)}</p>
                      </div>
                    </div>
                  );
                  return activity.href ? (
                    <Link key={activity.id} to={activity.href} className="block rounded-xl border border-[#E5E7EB] bg-white p-3 hover:border-[#D8C2E2] hover:bg-[#FCFAFD]">
                      {content}
                    </Link>
                  ) : (
                    <div key={activity.id} className="rounded-xl border border-[#E5E7EB] bg-white p-3">{content}</div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <div className="border-b border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
            <h2 className="text-xl font-bold text-[#111827]">Recent Staff Submissions</h2>
          </div>
          <div className="max-h-[330px] overflow-auto">
            {recentSubmissions.length === 0 ? (
              <div className="p-5"><EmptyState message="No recent staff submissions yet." /></div>
            ) : (
              <table className="w-full min-w-[640px] text-sm">
                <tbody className="divide-y divide-[#E5E7EB]">
                  {recentSubmissions.map((submission) => {
                    return (
                      <tr key={submission.submission_id} onClick={() => navigate(`/case-review-center?submission=${submission.submission_id}`)} className="cursor-pointer bg-white hover:bg-[#F9FAFB]">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#F7F0FA] text-sm font-bold text-[#704389]">
                              <ProtectedProfileImage path={submission.staff_profile_image_path} className="h-full w-full object-cover" fallback={initials(submission.staff_name).slice(0, 1)} />
                            </div>
                            <div>
                              <p className="font-bold text-[#111827]">{submission.staff_name}</p>
                              <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">{submission.staff_role}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-semibold text-[#2B3642]">{submission.title}</p>
                          <p className="mt-1 text-xs text-[#6B7280]">{formatLegalDate(submission.date_from)} - {formatLegalDate(submission.date_to)}</p>
                        </td>
                        <td className="px-5 py-4">
                          <span className="rounded-full bg-[#F7F0FA] px-2.5 py-1 text-xs font-bold text-[#704389]">{submission.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <Link
        to="/analytics"
        className="mt-6 flex items-center justify-between rounded-2xl border border-[#E7D7EE] bg-white px-6 py-5 text-[#111827] shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:text-[#704389] hover:shadow-[0_12px_28px_rgba(17,24,39,0.07)]"
      >
        <div>
          <h2 className="text-xl font-bold">Open Analytics Workspace -&gt;</h2>
          <p className="mt-1 text-sm font-medium text-[#6B7280]">Proceed to GIS hotspot analysis, category distributions, and deeper operational trends.</p>
        </div>
        <BarChart3 className="h-6 w-6" />
      </Link>
    </MainLayout>
  );
}
