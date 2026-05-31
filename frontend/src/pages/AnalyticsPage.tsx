import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  FolderCheck,
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
} from "../components/dashboard/AnalyticsPrimitives";
import ReportExportModal, { type ReportExportRow } from "../components/modals/ReportExportModal";
import MainLayout from "../layouts/MainLayout";
import PageHeader from "../components/PageHeader";
import { formatLegalMonth } from "../services/dashboardService";
import { useDashboardAnalytics } from "./dashboard/useDashboardAnalytics";

const GeoAnalyticsMap = lazy(() => import("../components/dashboard/GeoAnalyticsMap"));

const COLORS = ["#704389", "#9F5AA6", "#F59E0B", "#DC2626", "#7C3AED", "#0F766E"];
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

export default function AnalyticsPage() {
  const [datePreset, setDatePreset] = useState<DatePreset>("last30");
  const [dateRange, setDateRange] = useState(() => presetRange("last30"));
  const {
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
  const hotspotPanelRef = useRef<HTMLDivElement>(null);
  const [hotspotPanelHeight, setHotspotPanelHeight] = useState<number | null>(null);

  const intakeTotal = useMemo(() => monthlyTrends.reduce((sum, row) => sum + row.total_cases, 0), [monthlyTrends]);
  const displayMonthlyTrends = useMemo(
    () => monthlyTrends.map((row) => ({ ...row, month: formatLegalMonth(row.month) })),
    [monthlyTrends]
  );
  const displayTerminatedMonthly = useMemo(
    () => (terminatedStats?.monthly ?? []).map((row) => ({ ...row, month: formatLegalMonth(row.month) })),
    [terminatedStats]
  );
  const intakePeak = useMemo(
    () => displayMonthlyTrends.reduce<typeof displayMonthlyTrends[number] | null>((best, row) => (!best || row.total_cases > best.total_cases ? row : best), null),
    [displayMonthlyTrends]
  );
  const mostCommonReason = terminatedStats?.most_common_reason ?? terminatedStats?.by_reason[0]?.reason ?? "No closures in range";
  const averageDailyIntake = intakeLoad?.average_daily_intake ?? 0;
  const topBarangays = useMemo(() => barangays, [barangays]);
  const categoryPie = useMemo(() => caseCategories.slice(0, 7), [caseCategories]);
  const hourlyRows = useMemo(
    () => (intakeLoad?.hourly ?? []).filter((row) => Number.isFinite(row.total_cases) && row.total_cases > 0),
    [intakeLoad]
  );
  const terminationReasons = useMemo(() => terminatedStats?.by_reason ?? [], [terminatedStats]);
  const maxTerminationReason = useMemo(
    () => Math.max(...terminationReasons.map((row) => row.total_cases), 1),
    [terminationReasons]
  );
  const busiestHour = intakeLoad?.busiest_hour;
  const leadingCategory = caseCategories[0];
  const categoryTotal = caseCategories.reduce((sum, row) => sum + row.total_cases, 0);
  const exportRows = useMemo<ReportExportRow[]>(() => {
    const monthlyRows = monthlyTrends.map((row) => ({
      dataset: "monthly_intake_trends",
      case_category: "Monthly Case Trends",
      date: formatLegalMonth(row.month),
      label: formatLegalMonth(row.month),
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
      date: formatLegalMonth(row.month),
      label: formatLegalMonth(row.month),
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
      date: formatLegalMonth(row.month),
      label: formatLegalMonth(row.month),
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

  useEffect(() => {
    const panel = hotspotPanelRef.current;
    if (!panel) return;

    const updateHeight = () => {
      setHotspotPanelHeight(Math.ceil(panel.getBoundingClientRect().height));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(panel);
    window.addEventListener("resize", updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [heatmap, selectedBarangay, topBarangays]);

  return (
    <MainLayout>
      <PageHeader
        eyebrow="Analytics Workspace"
        title="Deep Analytics & Export"
        description="Review GIS hotspots, intake trends, case categories, closure patterns, and export-ready operational datasets."
        actions={
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="inline-flex h-10 items-center justify-center rounded-md bg-[#704389] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5F3675] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={exportRows.length === 0}
          >
            Advanced Report Export
          </button>
        }
      />

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
          <div className="grid items-start gap-6 xl:grid-cols-[1.35fr_0.65fr]">
            <div ref={hotspotPanelRef}>
              <AnalyticsPanel title="Geospatial Criminal Case Hotspots" subtitle="Barangay-centered markers with case density and heatmap overlay.">
                <div className="mb-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setSelectedBarangay(null)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectedBarangay === null ? "bg-[#704389] text-white" : "border border-[#E5E7EB] text-[#4B5563]"}`}>
                    All Barangays
                  </button>
                  {topBarangays.slice(0, 8).map((barangay) => (
                    <button type="button" key={barangay.barangay} onClick={() => setSelectedBarangay(barangay.barangay)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectedBarangay === barangay.barangay ? "bg-[#704389] text-white" : "border border-[#E5E7EB] text-[#4B5563]"}`}>
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
            </div>

            <div className="min-h-0" style={hotspotPanelHeight ? { height: `${hotspotPanelHeight}px` } : undefined}>
              <AnalyticsPanel title="Top Affected Barangays" subtitle="Ranked by total criminal case records." className="h-full min-h-0">
                <div className="h-full min-h-0 space-y-3 overflow-y-auto pr-2">
                  {topBarangays.length === 0 ? <EmptyState message="No barangay analytics available yet." /> : topBarangays.map((barangay, index) => (
                    <button key={barangay.barangay} type="button" onClick={() => setSelectedBarangay(barangay.barangay)} className="flex w-full items-center gap-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-left hover:bg-[#F8FAFC]">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#704389] text-sm font-bold text-white">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#2B3642]">{barangay.barangay}</span>
                        <span className="text-xs text-[#4B5563]">{barangay.most_common_category}</span>
                      </span>
                      <span className="rounded-full bg-[#F7F0FA] px-2.5 py-1 text-xs font-bold text-[#704389]">{barangay.total_cases}</span>
                    </button>
                  ))}
                </div>
              </AnalyticsPanel>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
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
                        ? "border-[#704389] bg-[#F7F0FA] text-[#704389]"
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
                  className="mt-1 h-10 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#111827] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
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
                  className="mt-1 h-10 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#111827] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                />
              </label>
            </div>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <AnalyticsPanel title="Case Intake Trends" subtitle="Case and client movement for the selected date range.">
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
                {displayMonthlyTrends.length === 0 ? <EmptyState message="No intake records match the selected date range." /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={displayMonthlyTrends}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="month" stroke="#6B7280" fontSize={12} />
                      <YAxis stroke="#6B7280" fontSize={12} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="total_cases" name="Cases" stroke="#704389" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 7 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </AnalyticsPanel>

            <AnalyticsPanel title="Weekly Volume Distribution" subtitle="Busiest intake days from encoded form dates.">
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-[#F7F0FA] p-3 text-[#704389]">
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
                    <Bar dataKey="total_cases" name="Cases" radius={[8, 8, 0, 0]} fill="#704389" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </AnalyticsPanel>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <AnalyticsPanel title="Hourly Intake Heat Analytics" subtitle="Actual encoded intake hours only.">
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[#FEF3C7] bg-[#FFFBEB] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#92400E]">Peak Intake Window</p>
                  <p className="mt-1 text-lg font-bold text-[#111827]">{busiestHour ? busiestHour.hour : "-"}</p>
                </div>
                <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Recorded Time Blocks</p>
                  <p className="mt-1 text-lg font-bold text-[#111827]">{hourlyRows.length}</p>
                </div>
              </div>
              {hourlyRows.length === 0 ? (
                <EmptyState message="No timestamped intake hours are available in the selected date range." />
              ) : (
                <div className="grid gap-2">
                  {hourlyRows.map((item) => {
                  const max = Math.max(...hourlyRows.map((row) => row.total_cases), 1);
                  return (
                    <div key={item.hour} className="grid grid-cols-[64px_1fr_42px] items-center gap-3 text-sm">
                      <span className="font-semibold text-[#4B5563]">{item.hour}</span>
                      <div className="h-3 overflow-hidden rounded-full bg-[#E5E7EB]">
                        <div className="h-full rounded-full bg-[#F59E0B]" style={{ width: `${Math.max((item.total_cases / max) * 100, 8)}%` }} />
                      </div>
                      <span className="text-right font-bold text-[#2B3642]">{item.total_cases}</span>
                    </div>
                  );
                  })}
                </div>
              )}
            </AnalyticsPanel>

            <AnalyticsPanel title="Legal Service Demand" subtitle="Most common encoded case types.">
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[#E7D7EE] bg-[#F7F0FA] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#704389]">Leading Demand</p>
                  <p className="mt-1 truncate text-lg font-bold text-[#111827]">{leadingCategory?.category ?? "-"}</p>
                </div>
                <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Categorized Cases</p>
                  <p className="mt-1 text-lg font-bold text-[#111827]">{categoryTotal}</p>
                </div>
              </div>
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
              <div className="mb-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Distribution Base</p>
                <p className="mt-1 text-sm font-bold text-[#111827]">{categoryTotal} categorized case record(s)</p>
              </div>
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

            <AnalyticsPanel title="Terminated Case Analytics" subtitle="Closure volume, archive movement, and reason patterns." className="border-[#FECACA] xl:col-span-2">
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
              <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="rounded-xl border border-[#FECACA] bg-[#FFF7F7] p-3">
                  {displayTerminatedMonthly.length === 0 ? (
                    <EmptyState message="No terminated case records match the selected date range." />
                  ) : (
                    <ResponsiveContainer width="100%" height={240}>
                      <AreaChart data={displayTerminatedMonthly}>
                        <defs>
                          <linearGradient id="terminatedGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#DC2626" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#FECACA" />
                        <XAxis dataKey="month" stroke="#6B7280" fontSize={11} />
                        <YAxis allowDecimals={false} stroke="#6B7280" fontSize={12} />
                        <Tooltip content={<ChartTooltip />} />
                        <Area type="monotone" dataKey="total_cases" name="Terminated" stroke="#DC2626" strokeWidth={2.5} fill="url(#terminatedGradient)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="rounded-xl border border-[#FECACA] bg-white p-4">
                  <p className="text-sm font-bold text-[#111827]">Closure Reasons</p>
                  <p className="mt-1 text-xs font-medium text-[#6B7280]">Ranked from the selected date range.</p>
                  <div className="mt-4 max-h-[220px] space-y-3 overflow-y-auto pr-2">
                    {terminationReasons.length === 0 ? (
                      <EmptyState message="No closure reasons available." />
                    ) : (
                      terminationReasons.map((row) => (
                        <div key={row.reason}>
                          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate font-semibold text-[#2B3642]">{row.reason}</span>
                            <span className="shrink-0 rounded-full bg-[#FEE2E2] px-2.5 py-1 text-xs font-bold text-[#991B1B]">{row.total_cases}</span>
                          </div>
                          <div className="h-2 rounded-full bg-[#FEE2E2]">
                            <div className="h-2 rounded-full bg-[#DC2626]" style={{ width: `${Math.max((row.total_cases / maxTerminationReason) * 100, 8)}%` }} />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </AnalyticsPanel>

          </div>
        </>
      )}

      <div className="mt-6 rounded-xl border border-[#E5E7EB] bg-white p-5 text-sm text-[#4B5563] shadow-sm ">
        <div className="flex items-start gap-3">
          <BarChart3 className="mt-0.5 h-5 w-5 shrink-0 text-[#704389]" />
          <p>
            Export includes monthly trends, weekly volume, category distribution, barangay density, and terminated case movement from the live database.
          </p>
        </div>
      </div>

      <ReportExportModal
        isOpen={exportOpen}
        title="Advanced Analytics Report Export"
        description="Filter and export GIS, workload, category, OCR, and termination intelligence as CSV or Excel."
        fileName="jurisguard_analytics_report"
        rows={exportRows}
        scope="admin"
        redirectTo="/analytics"
        onClose={() => setExportOpen(false)}
      />
    </MainLayout>
  );
}

