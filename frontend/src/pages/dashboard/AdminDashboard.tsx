import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  Archive,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Gavel,
  LocateFixed,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import MainLayout from "../../layouts/MainLayout";
import { EmptyState, SkeletonBlock, initials, AnimatedNumber } from "../../components/dashboard/AnalyticsPrimitives";
import {
  useDashboardReminderStore,
} from "../../features/dashboardReminders/dashboardReminderStore";
import type { ReminderPriority } from "../../features/dashboardReminders/dashboardReminderStore";
import { useAuth } from "../../contexts/AuthContext";
import { resolveProfileImageUrl } from "../../services/authService";
import { listCaseSubmissions, type CaseSubmission } from "../../services/caseSubmissionService";
import { useDashboardAnalytics } from "./useDashboardAnalytics";

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
  }).format(date);
}

function useGreetingClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const hour = now.getHours();
  const greeting =
    hour >= 21 || hour < 5
      ? "Working Late, Administrator"
      : hour >= 17
        ? "Good Evening, Administrator"
        : hour >= 12
          ? "Good Afternoon, Administrator"
          : "Good Morning, Administrator";
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);

  return { date, greeting, now };
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
    <div className="group jg-lift jg-hairline rounded-2xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
          {metricLabel && <p className="mt-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{metricLabel}</p>}
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

function priorityClass(priority: ReminderPriority) {
  if (priority === "High") return "bg-rose-50 dark:bg-rose-400/10 text-rose-800 dark:text-rose-300 border-red-200 dark:border-red-400/25";
  if (priority === "Medium") return "bg-amber-50 dark:bg-amber-400/10 text-amber-800 dark:text-amber-300 border-amber-100 dark:border-amber-400/20";
  return "bg-card-2 text-muted border-line";
}

function automaticReminderPriority(dueDate: string, status?: string): ReminderPriority {
  if (status === "Completed") return "Low";
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return "Low";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilDue = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
  if (daysUntilDue <= 1) return "High";
  if (daysUntilDue <= 7) return "Medium";
  return "Low";
}

function priorityWeight(priority: ReminderPriority) {
  if (priority === "High") return 0;
  if (priority === "Medium") return 1;
  return 2;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { date, greeting, now } = useGreetingClock();
  const { activities, barangays, caseCategories, intakeLoad, isLoading, overview } = useDashboardAnalytics({ deep: false });
  const reminders = useDashboardReminderStore((state) => state.reminders);
  const loadReminders = useDashboardReminderStore((state) => state.loadReminders);
  const addReminder = useDashboardReminderStore((state) => state.addReminder);
  const updateReminderStatus = useDashboardReminderStore((state) => state.updateReminderStatus);
  const deleteReminder = useDashboardReminderStore((state) => state.deleteReminder);
  const [submissions, setSubmissions] = useState<CaseSubmission[]>([]);
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderDate, setReminderDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (user?.user_id) loadReminders(user.user_id);
  }, [loadReminders, user?.user_id]);

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
  const orderedReminders = useMemo(
    () =>
      [...reminders].sort((left, right) => {
        const leftPriority = automaticReminderPriority(left.dueDate, left.status);
        const rightPriority = automaticReminderPriority(right.dueDate, right.status);
        if (left.status !== right.status) return left.status === "Completed" ? 1 : -1;
        const priorityDelta = priorityWeight(leftPriority) - priorityWeight(rightPriority);
        if (priorityDelta !== 0) return priorityDelta;
        return new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime();
      }),
    [reminders],
  );
  const recentCaseUpdates = useMemo(
    () =>
      activities
        .filter((activity) => {
          const text = `${activity.entity_type ?? ""} ${activity.action ?? ""} ${activity.description ?? ""}`.toLowerCase();
          return text.includes("case") || text.includes("client");
        })
        .slice(0, 5),
    [activities],
  );

  const busiestDay = intakeLoad?.busiest_day?.day ?? "No intake day";
  const busiestHour = intakeLoad?.busiest_hour?.hour ?? "No peak hour";
  const hotspot = barangays[0]?.barangay ?? "No barangay hotspot";
  const leadingCategory = caseCategories[0]?.category ?? "No category trend";
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const addDashboardReminder = () => {
    if (!user?.user_id || !reminderTitle.trim()) return;
    addReminder({
      userId: user.user_id,
      title: reminderTitle.trim(),
      dueDate: reminderDate,
      priority: automaticReminderPriority(reminderDate),
      status: "Open",
    });
    setReminderTitle("");
    setShowReminderForm(false);
  };

  return (
    <MainLayout>
      <section className="mb-6 rounded-2xl border border-line bg-card px-6 py-6 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{greeting}</h1>
            <p className="mt-3 text-base font-medium text-muted">
              {date} - Here's today's operational summary for PAO Panabo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 dark:border-emerald-400/25 bg-emerald-50 dark:bg-emerald-400/10 px-3 py-1.5 text-emerald-700 dark:text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              System Secure
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card-2 px-3 py-1.5 text-muted">
              Database Live
            </span>
          </div>
        </div>
      </section>

      {isLoading && !overview ? (
        <div className="jg-stagger grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => <SkeletonBlock key={index} className="h-40" />)}
        </div>
      ) : (
        <div className="jg-stagger grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <KpiCard label="Total Clients" value={overview?.total_clients ?? 0} detail="Registered client profiles" icon={<Users className="h-5 w-5" />} tone="bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400" />
          <KpiCard label="Total Cases" value={overview?.total_cases ?? 0} detail="Criminal case records" icon={<Gavel className="h-5 w-5" />} tone="bg-card-2 text-ink" />
          <KpiCard label="Active Cases" value={overview?.active_cases ?? 0} detail="Open operational workload" icon={<BriefcaseBusiness className="h-5 w-5" />} tone="bg-emerald-50 dark:bg-emerald-400/10 text-emerald-800 dark:text-emerald-300" />
          <KpiCard label="Terminated Cases" value={overview?.terminated_cases ?? 0} detail="Closed or archived matters" icon={<Archive className="h-5 w-5" />} tone="bg-rose-50 dark:bg-rose-400/10 text-rose-800 dark:text-rose-300" />
          <KpiCard label="This Month" metricLabel="Cases" value={overview?.cases_this_month ?? 0} detail={`Since ${formatLegalDate(monthStart)}`} icon={<CalendarDays className="h-5 w-5" />} tone="bg-amber-50 dark:bg-amber-400/10 text-amber-800 dark:text-amber-300" />
          <KpiCard label="Reports Awaiting Review" value={awaitingReview.length} detail="Staff report bundles for action" icon={<FileText className="h-5 w-5" />} tone="bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400" />
        </div>
      )}

      <div className="mt-6 grid items-stretch gap-6 xl:grid-cols-[0.6fr_0.4fr]">
        <section className="flex h-[320px] flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-card">
          <div className="border-b border-line bg-card-2 px-5 py-4">
            <h2 className="text-xl font-bold text-ink">Today's Intelligence Brief</h2>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-base font-semibold text-ink">
            <p className="flex gap-3"><TrendingUp className="mt-1 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" /> {busiestDay} remains the busiest intake day.</p>
            <p className="flex gap-3"><Clock3 className="mt-1 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" /> Most client arrivals occur around {busiestHour}.</p>
            <p className="flex gap-3"><LocateFixed className="mt-1 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" /> {hotspot} currently generates the highest case volume.</p>
            <p className="flex gap-3"><Gavel className="mt-1 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" /> {leadingCategory} remains the most common recorded offense.</p>
            <p className="flex gap-3"><FileText className="mt-1 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" /> {awaitingReview.length} staff submissions require review.</p>
          </div>
        </section>

        <section className="flex h-[320px] flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-card">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-card-2 px-5 py-4">
            <h2 className="text-xl font-bold text-ink">Administrative Reminders</h2>
            <button type="button" onClick={() => setShowReminderForm((value) => !value)} className="text-sm font-bold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300">
              + Add Reminder
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
            {showReminderForm && (
              <div className="rounded-xl border border-line bg-card-2 p-3">
                <input value={reminderTitle} onChange={(event) => setReminderTitle(event.target.value)} placeholder="Reminder title" className="h-10 w-full rounded-lg border border-line2 px-3 text-sm" />
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input type="date" value={reminderDate} onChange={(event) => setReminderDate(event.target.value)} className="h-10 rounded-lg border border-line2 px-3 text-sm" />
                  <button type="button" onClick={addDashboardReminder} className="rounded-lg border border-line2 bg-card px-3 text-sm font-semibold text-ink hover:bg-card-2">Save</button>
                </div>
                <p className="mt-2 text-xs font-medium text-muted">
                  Priority is assigned automatically from the due date.
                </p>
              </div>
            )}
            {orderedReminders.length === 0 ? (
              <EmptyState message="No administrative reminders yet." />
            ) : (
              orderedReminders.map((reminder) => {
                const priority = automaticReminderPriority(reminder.dueDate, reminder.status);
                return (
                <article key={reminder.id} className="rounded-xl border border-line bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${priorityClass(priority)}`}>{priority}</span>
                    <span className="text-sm font-semibold text-muted">{formatLegalDate(reminder.dueDate)}</span>
                  </div>
                  <p className="mt-3 font-bold text-ink">{reminder.title}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <button type="button" onClick={() => updateReminderStatus(reminder.id, reminder.status === "Completed" ? "Open" : "Completed")} className="inline-flex items-center gap-2 text-sm font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300">
                      <CheckCircle2 className="h-4 w-4" />
                      {reminder.status}
                    </button>
                    <button type="button" onClick={() => deleteReminder(reminder.id)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-400/25 bg-rose-50 dark:bg-rose-400/10 px-2.5 py-1.5 text-xs font-bold text-rose-800 dark:text-rose-300 hover:bg-rose-100">
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                </article>
              );
              })
            )}
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.42fr_0.58fr]">
        <section className="rounded-2xl border border-line bg-card shadow-card">
          <div className="border-b border-line bg-card-2 px-5 py-4">
            <h2 className="text-xl font-bold text-ink">Recent Case Updates</h2>
          </div>
          <div className="max-h-[330px] overflow-y-auto p-5">
            {recentCaseUpdates.length === 0 ? (
              <EmptyState message="No recent case updates are available." />
            ) : (
              <div className="space-y-3">
                {recentCaseUpdates.map((activity) => (
                  <div key={activity.id} className="flex gap-3 rounded-xl border border-line bg-card p-3">
                    <Activity className="mt-1 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" />
                    <div>
                      <p className="text-sm font-semibold leading-6 text-ink">{activity.description}</p>
                      <p className="mt-1 text-xs font-medium text-muted">{formatLegalDateTime(activity.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-card shadow-card">
          <div className="border-b border-line bg-card-2 px-5 py-4">
            <h2 className="text-xl font-bold text-ink">Recent Staff Submissions</h2>
          </div>
          <div className="max-h-[330px] overflow-auto">
            {recentSubmissions.length === 0 ? (
              <div className="p-5"><EmptyState message="No recent staff submissions yet." /></div>
            ) : (
              <table className="w-full min-w-[640px] text-sm">
                <tbody className="divide-y divide-line">
                  {recentSubmissions.map((submission) => {
                    const image = resolveProfileImageUrl(submission.staff_profile_image_path);
                    return (
                      <tr key={submission.submission_id} onClick={() => navigate(`/case-review-center?submission=${submission.submission_id}`)} className="cursor-pointer bg-card hover:bg-card-2">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50 dark:bg-brand-400/10 text-sm font-bold text-brand-600 dark:text-brand-400">
                              {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : initials(submission.staff_name).slice(0, 1)}
                            </div>
                            <div>
                              <p className="font-bold text-ink">{submission.staff_name}</p>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{submission.staff_role}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-semibold text-ink">{submission.title}</p>
                          <p className="mt-1 text-xs text-muted">{formatLegalDate(submission.date_from)} - {formatLegalDate(submission.date_to)}</p>
                        </td>
                        <td className="px-5 py-4">
                          <span className="rounded-full bg-brand-50 dark:bg-brand-400/10 px-2.5 py-1 text-xs font-bold text-brand-600 dark:text-brand-400">{submission.status}</span>
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
        className="mt-6 flex items-center justify-between jg-lift jg-hairline rounded-2xl border border-line bg-card px-6 py-5 text-ink shadow-card hover:text-brand-600 dark:hover:text-brand-300"
      >
        <div>
          <h2 className="text-xl font-bold">Open Analytics Workspace -&gt;</h2>
          <p className="mt-1 text-sm font-medium text-muted">Proceed to GIS hotspot analysis, category distributions, and deeper operational trends.</p>
        </div>
        <BarChart3 className="h-6 w-6" />
      </Link>
    </MainLayout>
  );
}
