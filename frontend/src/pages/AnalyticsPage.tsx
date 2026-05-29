import { lazy, Suspense, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  FileScan,
  FolderCheck,
  ShieldCheck,
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
import ErrorBoundary from "../components/ErrorBoundary";
import {
  AnalyticsPanel,
  EmptyState,
  SkeletonBlock,
  initials,
} from "../components/dashboard/AnalyticsPrimitives";
import ReportExportModal, { type ReportExportRow } from "../components/modals/ReportExportModal";
import MainLayout from "../layouts/MainLayout";
import { useDashboardAnalytics } from "./dashboard/useDashboardAnalytics";
import type { RecentActivity } from "../services/dashboardService";

const GeoAnalyticsMap = lazy(() => import("../components/dashboard/GeoAnalyticsMap"));

const COLORS = ["#4A7FB0", "#15803D", "#F59E0B", "#DC2626", "#7C3AED", "#0F766E"];
type DatePreset = "last7" | "last30" | "month" | "year" | "custom";

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function presetRange(preset: DatePreset) {
  const now = new Date();
  const start = new Date(now);
  if (preset === "last7") start.setDate(now.getDate() - 6);
  if (preset === "last30") start.setDate(now.getDate() - 29);
  if (preset === "month") start.setDate(1);
  if (preset === "year") {
    start.setMonth(0);
    start.setDate(1);
  }
  return { dateFrom: isoDate(start), dateTo: isoDate(now) };
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm shadow-xl ">
      <p className="font-semibold text-[#2B3642]">{label}</p>
      {payload.map((item) => (
        <p key={item.name ?? "value"} className="text-[#4B5563]">
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
        <div key={activity.id} className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4 transition hover:bg-[#F8FAFC]">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#4A7FB0] text-sm font-bold text-white">
              {initials(activity.user)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-[#2B3642]">{activity.user}</p>
                <span className="rounded-full bg-[#EFF6FF] px-2 py-1 text-xs font-semibold text-[#4A7FB0]">
                  {activity.action}
                </span>
              </div>
              <p className="mt-1 text-sm leading-6 text-[#4B5563]">{activity.description || "System activity recorded"}</p>
              <p className="mt-1 text-xs font-medium text-[#6B7280]">{formatDateTime(activity.timestamp)}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [datePreset, setDatePreset] = useState<DatePreset>("last30");
  const [dateRange, setDateRange] = useState(() => presetRange("last30"));
  const {
    activities,
    barangays,
    caseCategories,
    heatmap,
    intakeLoad,
    isLoading,
    monthlyTrends,
    ocrAnalytics,
    overview,
    terminatedStats,
  } = useDashboardAnalytics({ dateRange });
  const [selectedBarangay, setSelectedBarangay] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const intakeTotal = useMemo(() => monthlyTrends.reduce((sum, row) => sum + row.total_cases, 0), [monthlyTrends]);
  const intakePeak = useMemo(
    () => monthlyTrends.reduce<typeof monthlyTrends[number] | null>((best, row) => (!best || row.total_cases > best.total_cases ? row : best), null),
    [monthlyTrends]
  );
  const mostCommonReason = terminatedStats?.most_common_reason ?? terminatedStats?.by_reason[0]?.reason ?? "No closures in range";
  const averageDailyIntake = intakeLoad?.average_daily_intake ?? 0;
  const topBarangays = useMemo(() => barangays.slice(0, 10), [barangays]);
  const categoryPie = useMemo(() => caseCategories.slice(0, 7), [caseCategories]);
  const exportRows = useMemo<ReportExportRow[]>(() => {
    const monthlyRows = monthlyTrends.map((row) => ({
      dataset: "monthly_intake_trends",
      case_category: "Monthly Case Trends",
      date: row.month,
      label: row.month,
      value: row.total_cases,
      case_status: "All",
      barangay: "",
      staff: "",
      ocr_status: "",
      termination_status: "",
      secondary_label: "",
      secondary_value: "",
    }));
    const weeklyRows = (intakeLoad?.weekly ?? []).map((row) => ({
      dataset: "weekly_volume_distribution",
      case_category: "Peak Operational Days",
      date: "",
      label: row.day,
      value: row.total_cases,
      case_status: "All",
      barangay: "",
      staff: "",
      ocr_status: "",
      termination_status: "",
      secondary_label: "",
      secondary_value: "",
    }));
    const hourlyRows = (intakeLoad?.hourly ?? []).map((row) => ({
      dataset: "hourly_intake_heat",
      case_category: "Peak Operational Hours",
      date: "",
      label: row.hour,
      value: row.total_cases,
      case_status: "All",
      barangay: "",
      staff: "",
      ocr_status: "",
      termination_status: "",
      secondary_label: "",
      secondary_value: "",
    }));
    const categoryRows = caseCategories.map((row) => ({
      dataset: "case_category_analytics",
      case_category: row.category,
      date: "",
      label: row.category,
      value: row.total_cases,
      case_status: "All",
      barangay: "",
      staff: "",
      ocr_status: "",
      termination_status: "",
      secondary_label: "",
      secondary_value: "",
    }));
    const barangayRows = barangays.map((row) => ({
      dataset: "barangay_hotspots",
      case_category: row.most_common_category,
      date: "",
      label: row.barangay,
      value: row.total_cases,
      case_status: row.terminated_cases === row.total_cases ? "Terminated" : "Active",
      barangay: row.barangay,
      staff: "",
      ocr_status: "",
      termination_status: row.terminated_cases > 0 ? "Has Terminations" : "No Terminations",
      secondary_label: row.most_common_category,
      secondary_value: row.terminated_cases,
    }));
    const terminatedRows = (terminatedStats?.monthly ?? []).map((row) => ({
      dataset: "terminated_case_movement",
      case_category: "Termination Trends",
      date: row.month,
      label: row.month,
      value: row.total_cases,
      case_status: "Terminated",
      barangay: "",
      staff: "",
      ocr_status: "",
      termination_status: "Terminated",
      secondary_label: "",
      secondary_value: "",
    }));
    const ocrRows = (ocrAnalytics?.trends ?? []).map((row) => ({
      dataset: "ocr_volume_trends",
      case_category: "OCR Volume Trends",
      date: row.month,
      label: row.month,
      value: row.total_scans,
      case_status: "",
      barangay: "",
      staff: "",
      ocr_status: "Processed",
      termination_status: "",
      secondary_label: "",
      secondary_value: "",
    }));
    return [...monthlyRows, ...weeklyRows, ...hourlyRows, ...categoryRows, ...barangayRows, ...terminatedRows, ...ocrRows];
  }, [barangays, caseCategories, intakeLoad, monthlyTrends, ocrAnalytics, terminatedStats]);

  const applyPreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset !== "custom") setDateRange(presetRange(preset));
  };

  return (
    <MainLayout>
      <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-[#E5E7EB] bg-white px-6 py-5 shadow-sm  lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-[#4A7FB0]">PAO Panabo Analytics Workspace</p>
          <h1 className="mt-2 text-3xl font-bold text-[#2B3642]">Deep Analytics & Export</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#4B5563]">
            Dedicated legal operations intelligence for case trends, barangay hotspots, categories, closures, OCR usage, and staff activity.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-[#4A7FB0] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#3E6D97] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={exportRows.length === 0}
        >
          Advanced Report Export
        </button>
      </div>

      <div className="mb-6 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-sm font-bold text-[#111827]">Analytics Date Range</p>
            <p className="mt-1 text-xs font-medium text-[#6B7280]">Trends, intake load, and closure analytics refresh from this range.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              ["last7", "Last 7 Days"],
              ["last30", "Last 30 Days"],
              ["month", "This Month"],
              ["year", "This Year"],
              ["custom", "Custom Range"],
            ] as Array<[DatePreset, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => applyPreset(value)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                  datePreset === value
                    ? "border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]"
                    : "border-[#D1D5DB] bg-white text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#111827]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Start Date</span>
            <input
              type="date"
              value={dateRange.dateFrom}
              onChange={(event) => {
                setDatePreset("custom");
                setDateRange((current) => ({ ...current, dateFrom: event.target.value }));
              }}
              className="mt-1 h-10 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#111827] outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">End Date</span>
            <input
              type="date"
              value={dateRange.dateTo}
              onChange={(event) => {
                setDatePreset("custom");
                setDateRange((current) => ({ ...current, dateTo: event.target.value }));
              }}
              className="mt-1 h-10 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#111827] outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            />
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-6">
          <SkeletonBlock className="h-[520px]" />
          <div className="grid gap-6 xl:grid-cols-2">
            <SkeletonBlock className="h-80" />
            <SkeletonBlock className="h-80" />
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
            <AnalyticsPanel title="Geospatial Criminal Case Hotspots" subtitle="OpenStreetMap heat layer with barangay density and case concentration.">
              <div className="mb-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedBarangay(null)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectedBarangay === null ? "bg-[#4A7FB0] text-white" : "border border-[#E5E7EB] text-[#4B5563]"}`}>
                  All Barangays
                </button>
                {topBarangays.slice(0, 8).map((barangay) => (
                  <button type="button" key={barangay.barangay} onClick={() => setSelectedBarangay(barangay.barangay)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectedBarangay === barangay.barangay ? "bg-[#4A7FB0] text-white" : "border border-[#E5E7EB] text-[#4B5563]"}`}>
                    {barangay.barangay}
                  </button>
                ))}
              </div>
              {heatmap ? (
                <ErrorBoundary fallback={<EmptyState message="The geospatial map could not render, but barangay analytics remain available." />}>
                  <Suspense fallback={<SkeletonBlock className="h-[520px]" />}>
                    <GeoAnalyticsMap center={heatmap.center} points={heatmap.points} barangays={heatmap.barangays} selectedBarangay={selectedBarangay} onSelectBarangay={setSelectedBarangay} />
                  </Suspense>
                </ErrorBoundary>
              ) : (
                <EmptyState message="No geospatial data is available yet. Encode barangay or coordinates in case records to activate the map." />
              )}
            </AnalyticsPanel>

            <AnalyticsPanel title="Top Affected Barangays" subtitle="Case density, status movement, and common case category.">
              <div className="space-y-3">
                {topBarangays.length === 0 ? <EmptyState message="No barangay analytics available yet." /> : topBarangays.map((barangay, index) => (
                  <button key={barangay.barangay} type="button" onClick={() => setSelectedBarangay(barangay.barangay)} className="flex w-full items-center gap-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-left hover:bg-[#F8FAFC]">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#4A7FB0] text-sm font-bold text-white">{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#2B3642]">{barangay.barangay}</span>
                      <span className="text-xs text-[#4B5563]">{barangay.most_common_category}</span>
                    </span>
                    <span className="rounded-full bg-[#EFF6FF] px-2.5 py-1 text-xs font-bold text-[#4A7FB0]">{barangay.total_cases}</span>
                  </button>
                ))}
              </div>
            </AnalyticsPanel>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <AnalyticsPanel title="Monthly Intake Trends" subtitle="Case growth and intake spikes by month.">
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Intake Volume</p>
                  <p className="mt-1 text-xl font-bold text-[#111827]">{intakeTotal}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Client Growth</p>
                  <p className="mt-1 text-xl font-bold text-[#111827]">{overview?.clients_in_range ?? 0}</p>
                </div>
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Peak Spike</p>
                  <p className="mt-1 truncate text-xl font-bold text-[#111827]">{intakePeak ? `${intakePeak.month}: ${intakePeak.total_cases}` : "-"}</p>
                </div>
              </div>
              <div className="h-80">
                {monthlyTrends.length === 0 ? <EmptyState message="No intake records match the selected date range." /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyTrends}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="month" stroke="#6B7280" fontSize={12} />
                      <YAxis stroke="#6B7280" fontSize={12} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="total_cases" name="Cases" stroke="#2563EB" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 7 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </AnalyticsPanel>

            <AnalyticsPanel title="Weekly Volume Distribution" subtitle="Which days carry the heaviest client and case intake.">
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-[#EFF6FF] p-3 text-[#2563EB]">
                  <p className="text-xs font-semibold uppercase tracking-wide">Most Crowded</p>
                  <p className="mt-1 text-lg font-bold">{intakeLoad?.busiest_day?.day ?? "-"}</p>
                </div>
                <div className="rounded-lg bg-[#F9FAFB] p-3 text-[#111827]">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Average Daily</p>
                  <p className="mt-1 text-lg font-bold">{averageDailyIntake}</p>
                </div>
                <div className="rounded-lg bg-[#F9FAFB] p-3 text-[#111827]">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Range Cases</p>
                  <p className="mt-1 text-lg font-bold">{intakeLoad?.total_weekly_cases ?? 0}</p>
                </div>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={intakeLoad?.weekly ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="day" stroke="#6B7280" fontSize={11} />
                    <YAxis stroke="#6B7280" fontSize={12} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="total_cases" name="Cases" radius={[8, 8, 0, 0]} fill="#2563EB" />
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
                      <span className="font-semibold text-[#4B5563]">{item.hour}</span>
                      <div className="h-3 overflow-hidden rounded-full bg-[#E5E7EB]">
                        <div className="h-full rounded-full bg-[#F59E0B]" style={{ width: `${Math.max((item.total_cases / max) * 100, 4)}%` }} />
                      </div>
                      <span className="text-right font-bold text-[#2B3642]">{item.total_cases}</span>
                    </div>
                  );
                })}
              </div>
            </AnalyticsPanel>

            <AnalyticsPanel title="Legal Service Demand" subtitle="Most common encoded case types.">
              <div className="space-y-3">
                {caseCategories.length === 0 ? <EmptyState message="No case category data is available yet." /> : caseCategories.slice(0, 6).map((item, index) => (
                  <div key={item.category}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-semibold text-[#2B3642]">{item.category}</span>
                      <span className="text-[#4B5563]">{item.total_cases}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#E5E7EB]">
                      <div className="h-2 rounded-full" style={{ width: `${Math.max((item.total_cases / Math.max(...caseCategories.map((row) => row.total_cases), 1)) * 100, 4)}%`, backgroundColor: COLORS[index % COLORS.length] }} />
                    </div>
                  </div>
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
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <div className="flex items-center gap-3 rounded-xl bg-[#FEF2F2] p-4 text-[#991B1B] sm:col-span-1">
                <FolderCheck className="h-6 w-6" />
                <div>
                  <p className="text-2xl font-bold">{terminatedStats?.total ?? 0}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide">Archived closures</p>
                </div>
                </div>
                <div className="rounded-xl border border-[#FECACA] bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#991B1B]">Common Reason</p>
                  <p className="mt-1 truncate text-sm font-bold text-[#111827]">{mostCommonReason}</p>
                </div>
                <div className="rounded-xl border border-[#FECACA] bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#991B1B]">Closure Rate</p>
                  <p className="mt-1 text-sm font-bold text-[#111827]">{terminatedStats?.closure_rate ?? 0}%</p>
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
                {(ocrAnalytics?.recent ?? []).length === 0 ? <EmptyState message="No OCR activity has been recorded yet." /> : (ocrAnalytics?.recent ?? []).slice(0, 5).map((item) => (
                  <div key={item.document_id} className="flex items-center justify-between rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm">
                    <span className="font-semibold text-[#2B3642]">Document #{item.document_id}</span>
                    <span className="rounded-full bg-[#E5E7EB] px-2 py-1 text-xs font-semibold text-[#4B5563]">{item.ocr_status}</span>
                  </div>
                ))}
              </div>
            </AnalyticsPanel>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
            <AnalyticsPanel title="Analytics Export Summary" subtitle="Current export package composition.">
              <div className="grid gap-3">
                {[
                  { label: "Monthly trend rows", value: monthlyTrends.length },
                  { label: "Weekly volume rows", value: intakeLoad?.weekly.length ?? 0 },
                  { label: "Category rows", value: caseCategories.length },
                  { label: "Barangay rows", value: barangays.length },
                  { label: "Termination rows", value: terminatedStats?.monthly.length ?? 0 },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between rounded-lg border border-[#E5E7EB] px-3 py-2">
                    <span className="text-sm font-semibold text-[#4B5563]">{row.label}</span>
                    <span className="rounded-full bg-[#EFF6FF] px-2.5 py-1 text-xs font-bold text-[#4A7FB0]">{row.value}</span>
                  </div>
                ))}
              </div>
            </AnalyticsPanel>

            <AnalyticsPanel title="Staff Activity Intelligence" subtitle="Audit-backed operational activity with user names.">
              <StaffActivityFeed activities={activities} />
            </AnalyticsPanel>
          </div>
        </>
      )}

      <div className="mt-6 rounded-xl border border-[#E5E7EB] bg-white p-5 text-sm text-[#4B5563] shadow-sm ">
        <div className="flex items-start gap-3">
          <BarChart3 className="mt-0.5 h-5 w-5 shrink-0 text-[#4A7FB0]" />
          <p>
            Export includes monthly trends, weekly volume, category distribution, barangay density, and terminated case movement from the live database.
          </p>
        </div>
      </div>

      <ReportExportModal
        isOpen={exportOpen}
        title="Advanced Analytics Report Export"
        description="Filter and export GIS, workload, category, OCR, and termination intelligence as CSV, Excel, or print-ready PDF."
        fileName="jurisguard_analytics_report"
        rows={exportRows}
        scope="admin"
        redirectTo="/analytics"
        onClose={() => setExportOpen(false)}
      />
    </MainLayout>
  );
}
