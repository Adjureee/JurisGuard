import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  Activity,
  Archive,
  Brain,
  BriefcaseBusiness,
  CalendarClock,
  FileScan,
  FolderCheck,
  MapPinned,
  Scale,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import MainLayout from "../../layouts/MainLayout";
import ErrorBoundary from "../../components/ErrorBoundary";
import {
  getBarangayStats,
  getCaseCategories,
  getDashboardOverview,
  getHeatmap,
  getIntakeLoadAnalytics,
  getMonthlyTrends,
  getOcrAnalytics,
  getRecentActivities,
  getTerminatedCaseStats,
  type BarangayStat,
  type CaseCategoryStat,
  type DashboardOverview,
  type HeatmapResponse,
  type IntakeLoadAnalytics,
  type MonthlyTrend,
  type OcrAnalytics,
  type RecentActivity,
  type TerminatedDashboardStats,
} from "../../services/dashboardService";
import {
  AnalyticsPanel,
  EmptyState,
  IntelligenceMetricCard,
  SkeletonBlock,
  initials,
} from "../../components/dashboard/AnalyticsPrimitives";

const GeoAnalyticsMap = lazy(() => import("../../components/dashboard/GeoAnalyticsMap"));

const COLORS = ["#2F80ED", "#15803D", "#F59E0B", "#DC2626", "#7C3AED", "#0F766E"];

const emptyOverview: DashboardOverview = {
  total_clients: 0,
  total_cases: 0,
  active_cases: 0,
  terminated_cases: 0,
  cases_this_month: 0,
  ocr_scanned_documents: 0,
};

const emptyIntakeLoad: IntakeLoadAnalytics = {
  weekly: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day) => ({
    day,
    total_cases: 0,
  })),
  hourly: Array.from({ length: 10 }, (_, index) => ({
    hour: `${String(index + 8).padStart(2, "0")}:00`,
    total_cases: 0,
  })),
  busiest_day: null,
  busiest_hour: null,
};

const emptyTerminatedStats: TerminatedDashboardStats = {
  total: 0,
  by_reason: [],
  monthly: [],
};

const emptyOcrAnalytics: OcrAnalytics = {
  total_scans: 0,
  successful_extractions: 0,
  failed_scans: 0,
  document_types: [],
  trends: [],
  recent: [],
};

function getSettledValue<T>(result: PromiseSettledResult<T>, fallback: T, label: string): T {
  if (result.status === "fulfilled" && result.value !== null && result.value !== undefined) {
    return result.value;
  }
  void label;
  return fallback;
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm shadow-xl shadow-[#111827]/10">
      <p className="font-semibold text-[#111827]">{label}</p>
      {payload.map((item) => (
        <p key={item.name ?? "value"} className="text-[#374151]">
          {item.name ?? "Cases"}: <span className="font-semibold">{item.value}</span>
        </p>
      ))}
    </div>
  );
}

function StaffActivityFeed({ activities }: { activities: RecentActivity[] }) {
  if (activities.length === 0) return <EmptyState message="No staff activity has been recorded yet." />;
  return (
    <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
      {activities.map((activity) => (
        <div key={activity.id} className="rounded-lg border border-[#E5E7EB] bg-white p-4 transition hover:bg-[#F9FAFB]">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111827] text-sm font-bold text-white">
              {initials(activity.user)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-[#111827]">{activity.user}</p>
                <span className="rounded-full bg-[#EFF6FF] px-2 py-1 text-xs font-semibold text-[#1D4ED8]">
                  {activity.action}
                </span>
              </div>
              <p className="mt-1 text-sm leading-6 text-[#374151]">{activity.description || "System activity recorded"}</p>
              <p className="mt-1 text-xs font-medium text-[#6B7280]">{formatDateTime(activity.timestamp)}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminDashboard() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [monthlyTrends, setMonthlyTrends] = useState<MonthlyTrend[]>([]);
  const [caseCategories, setCaseCategories] = useState<CaseCategoryStat[]>([]);
  const [barangays, setBarangays] = useState<BarangayStat[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [terminatedStats, setTerminatedStats] = useState<TerminatedDashboardStats | null>(null);
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [intakeLoad, setIntakeLoad] = useState<IntakeLoadAnalytics | null>(null);
  const [ocrAnalytics, setOcrAnalytics] = useState<OcrAnalytics | null>(null);
  const [selectedBarangay, setSelectedBarangay] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadDashboard() {
      setIsLoading(true);
      const results = await Promise.allSettled([
          getDashboardOverview(),
          getMonthlyTrends(),
          getCaseCategories(),
          getBarangayStats(),
          getHeatmap(),
          getTerminatedCaseStats(),
          getRecentActivities(),
          getIntakeLoadAnalytics(),
          getOcrAnalytics(),
        ]);
        if (cancelled) return;
        const [
          overviewResult,
          monthlyResult,
          categoryResult,
          barangayResult,
          heatmapResult,
          terminatedResult,
          activityResult,
          intakeLoadResult,
          ocrResult,
        ] = results;
        setOverview(getSettledValue(overviewResult, emptyOverview, "overview"));
        setMonthlyTrends(getSettledValue(monthlyResult, [], "monthly trends"));
        setCaseCategories(getSettledValue(categoryResult, [], "case categories"));
        setBarangays(getSettledValue(barangayResult, [], "barangay stats"));
        setHeatmap(getSettledValue(heatmapResult, null, "heatmap"));
        setTerminatedStats(getSettledValue(terminatedResult, emptyTerminatedStats, "terminated cases"));
        setActivities(getSettledValue(activityResult, [], "recent activities"));
        setIntakeLoad(getSettledValue(intakeLoadResult, emptyIntakeLoad, "intake load"));
        setOcrAnalytics(getSettledValue(ocrResult, emptyOcrAnalytics, "OCR analytics"));
        if (results.some((result) => result.status === "rejected")) {
          toast.error("Some dashboard widgets could not refresh.");
        }
        setIsLoading(false);
    }
    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  const topBarangays = useMemo(() => barangays.slice(0, 8), [barangays]);
  const categoryPie = useMemo(() => caseCategories.slice(0, 7), [caseCategories]);
  const busiestMonth = useMemo(
    () => monthlyTrends.reduce<MonthlyTrend | null>((best, item) => (!best || item.total_cases > best.total_cases ? item : best), null),
    [monthlyTrends]
  );
  const insights = useMemo(() => {
    const rows = [
      intakeLoad?.busiest_day ? `${intakeLoad.busiest_day.day} receives the highest intake volume.` : "Weekday intake patterns will appear after more case records are encoded.",
      intakeLoad?.busiest_hour ? `Peak office load is around ${intakeLoad.busiest_hour.hour}.` : "Hourly peak analysis needs timestamped intake data.",
      topBarangays[0] ? `${topBarangays[0].barangay} is the current barangay hotspot.` : "Barangay hotspots will appear once case locations are encoded.",
      busiestMonth ? `${busiestMonth.month} has the highest monthly case intake.` : "Monthly trend analysis is waiting for intake records.",
      ocrAnalytics && ocrAnalytics.total_scans > 0 ? `OCR has processed ${ocrAnalytics.total_scans} legal documents.` : "OCR activity will appear as staff scan documents.",
    ];
    return rows;
  }, [busiestMonth, intakeLoad, ocrAnalytics, topBarangays]);

  return (
    <MainLayout>
      <div className="mb-6 overflow-hidden rounded-2xl border border-[#D1D5DB] bg-[#111827] px-6 py-6 text-white shadow-xl shadow-[#111827]/15">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-[#93C5FD]">PAO Panabo Command Center</p>
            <h1 className="mt-2 text-3xl font-bold">Legal Operations Intelligence Dashboard</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/70">
              Criminal case monitoring, intake pressure, OCR digitization, termination movement,
              staff activity, and geospatial case density from the live JurisGuard database.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-xs uppercase tracking-wide text-white/60">Operational posture</p>
            <p className="mt-1 text-lg font-bold">Live legal intelligence</p>
          </div>
        </div>
      </div>

      {isLoading && !overview ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => <SkeletonBlock key={index} className="h-40" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <IntelligenceMetricCard label="Total Clients" value={overview?.total_clients ?? 0} detail="Registered legal aid clients" icon={<Users className="h-5 w-5" />} tone="blue" />
          <IntelligenceMetricCard label="Total Cases" value={overview?.total_cases ?? 0} detail="Criminal case records" icon={<Scale className="h-5 w-5" />} tone="dark" />
          <IntelligenceMetricCard label="Active Cases" value={overview?.active_cases ?? 0} detail="Open operational workload" icon={<BriefcaseBusiness className="h-5 w-5" />} tone="green" />
          <IntelligenceMetricCard label="Terminated" value={overview?.terminated_cases ?? 0} detail="Closed and archived matters" icon={<Archive className="h-5 w-5" />} tone="red" positive={false} />
          <IntelligenceMetricCard label="This Month" value={overview?.cases_this_month ?? 0} detail="Current monthly intake" icon={<CalendarClock className="h-5 w-5" />} tone="yellow" />
          <IntelligenceMetricCard label="OCR Processed" value={overview?.ocr_scanned_documents ?? 0} detail="Digitized legal documents" icon={<FileScan className="h-5 w-5" />} tone="purple" />
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <AnalyticsPanel title="Monthly Intake Trends" subtitle="Case growth and intake spikes by month.">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyTrends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="month" stroke="#6B7280" fontSize={12} />
                <YAxis stroke="#6B7280" fontSize={12} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="total_cases" name="Cases" stroke="#2F80ED" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 7 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </AnalyticsPanel>

        <AnalyticsPanel title="Weekly Volume Distribution" subtitle="Which days carry the heaviest client/case intake.">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={intakeLoad?.weekly ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="day" stroke="#6B7280" fontSize={11} />
                <YAxis stroke="#6B7280" fontSize={12} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="total_cases" name="Cases" radius={[8, 8, 0, 0]} fill="#15803D" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </AnalyticsPanel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <AnalyticsPanel title="Hourly Intake Heat Analytics" subtitle="Operational peak windows for staffing decisions.">
          <div className="grid gap-2">
            {(intakeLoad?.hourly ?? []).map((item) => {
              const max = Math.max(...(intakeLoad?.hourly ?? []).map((row) => row.total_cases), 1);
              return (
                <div key={item.hour} className="grid grid-cols-[64px_1fr_42px] items-center gap-3 text-sm">
                  <span className="font-semibold text-[#374151]">{item.hour}</span>
                  <div className="h-3 overflow-hidden rounded-full bg-[#F3F4F6]">
                    <div className="h-full rounded-full bg-[#F59E0B]" style={{ width: `${Math.max((item.total_cases / max) * 100, 4)}%` }} />
                  </div>
                  <span className="text-right font-bold text-[#111827]">{item.total_cases}</span>
                </div>
              );
            })}
          </div>
        </AnalyticsPanel>

        <AnalyticsPanel title="System Operational Insights" subtitle="AI-style summaries generated from current analytics.">
          <div className="grid gap-3 md:grid-cols-2">
            {insights.map((insight) => (
              <div key={insight} className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-4">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[#2F80ED] text-white">
                  <Brain className="h-4 w-4" />
                </div>
                <p className="text-sm font-semibold leading-6 text-[#1E3A8A]">{insight}</p>
              </div>
            ))}
          </div>
        </AnalyticsPanel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <AnalyticsPanel title="Geospatial Criminal Case Hotspots" subtitle="OpenStreetMap heat layer with barangay clustering and density visualization.">
          <div className="mb-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedBarangay(null)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectedBarangay === null ? "bg-[#111827] text-white" : "border border-[#D1D5DB] text-[#374151]"}`}>
              All Barangays
            </button>
            {topBarangays.slice(0, 7).map((barangay) => (
              <button type="button" key={barangay.barangay} onClick={() => setSelectedBarangay(barangay.barangay)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectedBarangay === barangay.barangay ? "bg-[#2F80ED] text-white" : "border border-[#D1D5DB] text-[#374151]"}`}>
                {barangay.barangay}
              </button>
            ))}
          </div>
          {heatmap ? (
            <ErrorBoundary fallback={<EmptyState message="The geospatial map could not render, but barangay analytics remain available." />}>
              <Suspense fallback={<SkeletonBlock className="h-[460px]" />}>
                <GeoAnalyticsMap center={heatmap.center} points={heatmap.points} barangays={heatmap.barangays} selectedBarangay={selectedBarangay} onSelectBarangay={setSelectedBarangay} />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <EmptyState message="No geospatial data is available yet. Encode barangay or coordinates in case records to activate the map." />
          )}
        </AnalyticsPanel>

        <AnalyticsPanel title="Top Affected Barangays" subtitle="Operational load by barangay.">
          <div className="space-y-3">
            {topBarangays.length === 0 ? <EmptyState message="No barangay analytics available yet." /> : topBarangays.map((barangay, index) => (
              <button key={barangay.barangay} type="button" onClick={() => setSelectedBarangay(barangay.barangay)} className="flex w-full items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3 text-left hover:bg-[#F9FAFB]">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#111827] text-sm font-bold text-white">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[#111827]">{barangay.barangay}</span>
                  <span className="text-xs text-[#6B7280]">{barangay.most_common_category}</span>
                </span>
                <span className="rounded-full bg-[#EFF6FF] px-2.5 py-1 text-xs font-bold text-[#1D4ED8]">{barangay.total_cases}</span>
              </button>
            ))}
          </div>
        </AnalyticsPanel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <AnalyticsPanel title="Case Category Analytics" subtitle="Common criminal case categories and distribution.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryPie} dataKey="total_cases" nameKey="category" innerRadius={58} outerRadius={96} paddingAngle={3}>
                  {categoryPie.map((entry, index) => <Cell key={entry.category} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </AnalyticsPanel>

        <AnalyticsPanel title="Terminated Case Analytics" subtitle="Archive movement and closure reasons." className="border-[#FECACA]">
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-[#FEF2F2] p-4 text-[#991B1B]">
            <FolderCheck className="h-6 w-6" />
            <div>
              <p className="text-2xl font-bold">{terminatedStats?.total ?? 0}</p>
              <p className="text-xs font-semibold uppercase tracking-wide">Archived closures</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={terminatedStats?.monthly ?? []}>
              <defs>
                <linearGradient id="terminatedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#DC2626" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" stroke="#6B7280" fontSize={11} />
              <YAxis allowDecimals={false} stroke="#6B7280" fontSize={12} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="total_cases" name="Terminated" stroke="#DC2626" fill="url(#terminatedGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        </AnalyticsPanel>

        <AnalyticsPanel title="OCR Intelligence" subtitle="Document digitization and extraction health.">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-[#F3E8FF] p-3 text-[#6D28D9]">
              <FileScan className="h-4 w-4" />
              <p className="mt-2 text-xl font-bold">{ocrAnalytics?.total_scans ?? 0}</p>
              <p className="text-[11px] font-semibold">Scans</p>
            </div>
            <div className="rounded-lg bg-[#DCFCE7] p-3 text-[#166534]">
              <ShieldCheck className="h-4 w-4" />
              <p className="mt-2 text-xl font-bold">{ocrAnalytics?.successful_extractions ?? 0}</p>
              <p className="text-[11px] font-semibold">Success</p>
            </div>
            <div className="rounded-lg bg-[#FEE2E2] p-3 text-[#991B1B]">
              <Activity className="h-4 w-4" />
              <p className="mt-2 text-xl font-bold">{ocrAnalytics?.failed_scans ?? 0}</p>
              <p className="text-[11px] font-semibold">Failed</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {(ocrAnalytics?.recent ?? []).slice(0, 5).map((item) => (
              <div key={item.document_id} className="flex items-center justify-between rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm">
                <span className="font-semibold text-[#111827]">Document #{item.document_id}</span>
                <span className="rounded-full bg-[#F3F4F6] px-2 py-1 text-xs font-semibold text-[#374151]">{item.ocr_status}</span>
              </div>
            ))}
          </div>
        </AnalyticsPanel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <AnalyticsPanel title="Legal Service Demand" subtitle="Most common encoded case types.">
          <div className="space-y-3">
            {caseCategories.slice(0, 6).map((item, index) => (
              <div key={item.category}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-semibold text-[#111827]">{item.category}</span>
                  <span className="text-[#6B7280]">{item.total_cases}</span>
                </div>
                <div className="h-2 rounded-full bg-[#F3F4F6]">
                  <div className="h-2 rounded-full" style={{ width: `${Math.max((item.total_cases / Math.max(...caseCategories.map((row) => row.total_cases), 1)) * 100, 4)}%`, backgroundColor: COLORS[index % COLORS.length] }} />
                </div>
              </div>
            ))}
          </div>
        </AnalyticsPanel>

        <AnalyticsPanel title="Staff Activity Intelligence" subtitle="Audit-backed operational activity with user names.">
          <StaffActivityFeed activities={activities} />
        </AnalyticsPanel>
      </div>
    </MainLayout>
  );
}
