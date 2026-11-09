import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
import MainLayout from "../layouts/MainLayout";
import PageHeader from "../components/PageHeader";
import {
  AnalyticsPanel,
  CHART_COLORS,
  EmptyState,
  getStableCategoryColorMap,
  SkeletonBlock,
} from "../components/dashboard/AnalyticsPrimitives";
import {
  formatLegalMonth,
  getStaffWorkload,
  type StaffWorkload,
} from "../services/dashboardService";
import { useDashboardAnalytics } from "./dashboard/useDashboardAnalytics";

const GeoAnalyticsMap = lazy(() => import("../components/dashboard/GeoAnalyticsMap"));

const OCR_STATUS_COLORS: Record<string, string> = {
  COMPLETED: "#15803D",
  FAILED: "#DC2626",
  PROCESSING: "#D9AD65",
  PENDING: "#729FC5",
};

function ocrStatusColor(status: string) {
  return OCR_STATUS_COLORS[status.trim().toUpperCase()] ?? "#64748B";
}

type AnalyticsPreset = "all" | "last7" | "last30" | "month" | "year" | "custom";

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function analyticsPresetRange(preset: Exclude<AnalyticsPreset, "custom">) {
  if (preset === 'all') return { dateFrom: '', dateTo: '' };
  const end = new Date();
  const start = new Date(end);
  if (preset === "last7") start.setDate(end.getDate() - 6);
  if (preset === "last30") start.setDate(end.getDate() - 29);
  if (preset === "month") start.setDate(1);
  if (preset === "year") start.setMonth(0, 1);
  return { dateFrom: isoDate(start), dateTo: isoDate(end) };
}

function formatTrendLabel(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  return formatLegalMonth(value);
}

export default function StaffAnalyticsPage() {
  const [workload, setWorkload] = useState<StaffWorkload | null>(null);
  const [workloadError, setWorkloadError] = useState<string | null>(null);
  const [selectedBarangay, setSelectedBarangay] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [workloadRevision, setWorkloadRevision] = useState(0);
  const [datePreset, setDatePreset] = useState<AnalyticsPreset>("all");
  const [dateRange, setDateRange] = useState(() => analyticsPresetRange("all"));
  const [dateInputs, setDateInputs] = useState(dateRange);
  const invalidRange = datePreset !== "all" && (!dateInputs.dateFrom || !dateInputs.dateTo || dateInputs.dateFrom > dateInputs.dateTo);
  const {
    monthlyTrends,
    intakeLoad,
    caseCategories,
    heatmap,
    terminatedStats,
    ocrAnalytics,
    overview,
    error: analyticsError,
    retry: retryTrends,
    isLoading: trendsLoading,
  } = useDashboardAnalytics({ dateRange });

  useEffect(() => {
    let cancelled = false;
    async function loadWorkload() {
      setIsLoading(true);
      setWorkloadError(null);
      try {
        const workloadData = await getStaffWorkload();
        if (!cancelled) {
          setWorkload(workloadData);
        }
      } catch (error) {
        if (!cancelled) setWorkloadError(error instanceof Error ? error.message : "Unable to load your personal analytics.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadWorkload();
    return () => {
      cancelled = true;
    };
  }, [workloadRevision]);

  const weeklyIntake = useMemo(
    () => intakeLoad?.weekly.map((row) => ({ week: row.day, total_cases: row.total_cases })) ?? [],
    [intakeLoad],
  );

  const caseTypes = useMemo(
    () =>
      caseCategories.map((row) => ({ label: row.category, total_cases: row.total_cases })),
    [caseCategories]
  );
  const caseTypeColors = useMemo(
    () => getStableCategoryColorMap(caseTypes.map((row) => row.label)),
    [caseTypes],
  );

  const ocrStatus = useMemo(
    () => (ocrAnalytics?.status_breakdown ?? []).map((row) => ({ label: row.status, total_cases: row.total_scans })),
    [ocrAnalytics],
  );

  const displayMonthlyTrends = useMemo(
    () => monthlyTrends.map((row) => ({ ...row, month: formatTrendLabel(row.month) })),
    [monthlyTrends],
  );

  const displayTerminatedMonthly = useMemo(
    () => (terminatedStats?.monthly ?? []).map((row) => ({ ...row, month: formatTrendLabel(row.month) })),
    [terminatedStats],
  );

  const intakeTotal = useMemo(() => monthlyTrends.reduce((total, row) => total + row.total_cases, 0), [monthlyTrends]);
  const categoryTotal = caseTypes.reduce((total, row) => total + row.total_cases, 0);

  const applyPreset = (preset: AnalyticsPreset) => {
    setSelectedBarangay(null);
    setDatePreset(preset);
    if (preset !== "custom") {
      const range = analyticsPresetRange(preset);
      setDateRange(range);
      setDateInputs(range);
    }
  };

  const changeDate = (field: "dateFrom" | "dateTo", value: string) => {
    setDatePreset("custom");
    const range = { ...dateInputs, [field]: value };
    setDateInputs(range);
    if (range.dateFrom && range.dateTo && range.dateFrom <= range.dateTo) {
      setSelectedBarangay(null);
      setDateRange(range);
    }
  };

  const retryAnalytics = () => {
    retryTrends();
    setWorkloadRevision((revision) => revision + 1);
  };

  const periodLabel = datePreset === "all"
    ? "All dates"
    : `${dateRange.dateFrom || "Start date"} – ${dateRange.dateTo || "End date"}`;

  return (
    <MainLayout>
      <PageHeader
        eyebrow="Staff Analytics & Reports"
        title="My Analytics"
        description="Case activity, client locations, outcomes, and OCR trends from records available to your account."
      />

      <section aria-label="Analytics filters" className="mt-6 rounded-xl border border-[#CBD5E1] bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Reporting period">
            {([
              ["all", "All dates"],
              ["last7", "Last 7 Days"],
              ["last30", "Last 30 Days"],
              ["month", "This Month"],
              ["year", "This Year"],
            ] as Array<[Exclude<AnalyticsPreset, "custom">, string]>).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={datePreset === value} onClick={() => applyPreset(value)}
                className={`min-h-11 rounded-md border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] ${datePreset === value ? "border-[#704389] bg-[#F7F0FA] text-[#5F3675]" : "border-[#CBD5E1] text-[#4B5563] hover:bg-[#F8FAFC]"}`}>{label}</button>
            ))}
            <button type="button" aria-pressed={datePreset === "custom"} onClick={() => applyPreset("custom")}
              className={`min-h-11 rounded-md border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389] ${datePreset === "custom" ? "border-[#704389] bg-[#F7F0FA] text-[#5F3675]" : "border-[#CBD5E1] text-[#4B5563]"}`}>Custom range</button>
          </div>
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
            <label className="text-sm font-medium text-[#334155]">Start date<input type="date" aria-label="Start date" value={dateInputs.dateFrom} max={dateInputs.dateTo || undefined} onChange={(event) => changeDate("dateFrom", event.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-[#CBD5E1] px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]" /></label>
            <label className="text-sm font-medium text-[#334155]">End date<input type="date" aria-label="End date" value={dateInputs.dateTo} min={dateInputs.dateFrom || undefined} onChange={(event) => changeDate("dateTo", event.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-[#CBD5E1] px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]" /></label>
          </div>
        </div>
        {invalidRange ? <p role="alert" className="mt-3 text-sm text-red-800">Choose both dates and make sure the start date is on or before the end date.</p>
          : <p className="mt-3 text-sm text-[#4B5563]" aria-live="polite">{periodLabel} · Analytics are limited to records available to your account.</p>}
      </section>

      {(analyticsError || workloadError) && <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E4B875] bg-[#FFFBEB] p-4 text-sm text-[#78350F]">
        <p>{analyticsError || workloadError} Some values may be unavailable.</p>
        <button type="button" onClick={retryAnalytics} disabled={isLoading || trendsLoading} className="min-h-11 rounded-md border border-[#D6A65C] bg-white px-4 font-semibold disabled:opacity-50">Retry analytics</button>
      </div>}

      {isLoading || trendsLoading ? (
        <>
          <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
            <SkeletonBlock className="h-[590px]" />
            <SkeletonBlock className="h-[590px]" />
          </div>
          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <SkeletonBlock className="h-80" />
            <SkeletonBlock className="h-80" />
          </div>
        </>
      ) : invalidRange ? null : analyticsError ? (
        <div className="mt-6"><EmptyState message="Personal analytics could not be loaded. Use Retry analytics to try again." /></div>
      ) : (
        <>
          <dl aria-label="Personal period summary" className="mt-6 grid grid-cols-2 divide-x divide-[#E5E7EB] rounded-xl border border-[#CBD5E1] bg-white lg:grid-cols-4">
            {[
              ["Cases received", overview?.cases_in_range ?? intakeTotal],
              ["Clients registered", overview?.clients_in_range ?? 0],
              ["Cases terminated", terminatedStats?.total ?? overview?.range_terminated_cases ?? 0],
              ["Documents uploaded", ocrAnalytics?.total_scans ?? 0],
            ].map(([label, value]) => <div key={label} className="min-w-0 px-5 py-4"><dt className="text-sm text-[#4B5563]">{label}</dt><dd className="mt-1 text-3xl font-semibold tabular-nums text-[#2B3642]">{Number(value).toLocaleString()}</dd></div>)}
          </dl>

          <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
            <AnalyticsPanel title="Client locations" subtitle="Unique clients grouped by recorded address in the selected registration period." headerClassName="rounded-t-xl bg-[#604477]">
              {heatmap && heatmap.barangays.length > 0 ? (
                <Suspense fallback={<SkeletonBlock className="h-[520px]" />}>
                  <GeoAnalyticsMap
                    center={heatmap.center}
                    points={heatmap.points}
                    barangays={heatmap.barangays}
                    selectedBarangay={selectedBarangay}
                    onSelectBarangay={setSelectedBarangay}
                  />
                </Suspense>
              ) : <EmptyState message="No client addresses are available for this period." />}
            </AnalyticsPanel>

            <AnalyticsPanel title="Client address groups" subtitle="Ranked by the number of unique clients." className="h-full min-h-0" headerClassName="rounded-t-xl bg-[#604477]">
              <div className="max-h-[520px] min-h-[460px] space-y-3 overflow-y-auto pr-2">
                {!heatmap || heatmap.barangays.length === 0 ? <EmptyState message="No barangay analytics available yet." /> : heatmap.barangays.map((barangay, index) => (
                  <button
                    key={barangay.barangay}
                    type="button"
                    onClick={() => setSelectedBarangay(barangay.barangay)}
                    aria-pressed={selectedBarangay === barangay.barangay}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${selectedBarangay === barangay.barangay ? "border-[#704389] bg-[#F7F0FA]" : "border-[#E5E7EB] bg-[#F9FAFB] hover:bg-[#F8FAFC]"}`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#704389] text-sm font-bold text-white">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#2B3642]">{barangay.barangay}</span>
                    <span className="rounded-full bg-[#F7F0FA] px-2.5 py-1 text-xs font-bold text-[#704389]">{barangay.total_cases}</span>
                  </button>
                ))}
              </div>
            </AnalyticsPanel>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <AnalyticsPanel title="Case Intake Trends" subtitle="Case movement from your currently assigned cases." headerClassName="rounded-t-xl bg-[#604477]">
              {displayMonthlyTrends.length === 0 ? <EmptyState message="No personal case productivity data is available yet." /> : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 288 }}>
                    <LineChart data={displayMonthlyTrends} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#475569" }} fontSize={12} minTickGap={24} />
                      <YAxis allowDecimals={false} width={38} stroke="#475569" tick={{ fill: "#475569" }} fontSize={12} />
                      <Tooltip />
                      <Line type="linear" dataKey="total_cases" name="Cases received" stroke={CHART_COLORS[0]} strokeWidth={3} dot={{ r: 4 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </AnalyticsPanel>

            <AnalyticsPanel title="Weekly Volume Distribution" subtitle="Busiest intake days from your currently assigned cases." headerClassName="rounded-t-xl bg-[#604477]">
              {weeklyIntake.length === 0 ? <EmptyState message="No weekly intake records are available yet." /> : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 288 }}>
                    <BarChart data={weeklyIntake}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="week" stroke="#475569" tick={{ fill: "#475569" }} fontSize={11} />
                      <YAxis allowDecimals={false} stroke="#475569" tick={{ fill: "#475569" }} fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="total_cases" name="Intake" radius={[8, 8, 0, 0]} fill={CHART_COLORS[0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </AnalyticsPanel>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <AnalyticsPanel title="OCR Analytics" subtitle="Your extraction volume by OCR status." headerClassName="rounded-t-xl bg-[#604477]">
              {ocrStatus.length === 0 ? <EmptyState message="No personal OCR activity is available yet." /> : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 288 }}>
                    <PieChart>
                      <Pie data={ocrStatus} dataKey="total_cases" nameKey="label" innerRadius={54} outerRadius={88} paddingAngle={3}>
                        {ocrStatus.map((item) => <Cell key={item.label} fill={ocrStatusColor(item.label)} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </AnalyticsPanel>
            <AnalyticsPanel title="Case Status Distribution" subtitle="Breakdown of your currently assigned cases." headerClassName="rounded-t-xl bg-[#604477]">
              {(workload?.status_breakdown ?? []).length === 0 ? <EmptyState message="No personal status breakdown is available yet." /> : (
                <div className="space-y-3">
                  {(workload?.status_breakdown ?? []).map((row) => (
                    <div key={row.status} className="flex items-center justify-between rounded-lg border border-[#D7DEE7] bg-white px-3 py-2">
                      <span className="text-sm font-semibold text-[#111827]">{row.status}</span>
                      <span className="rounded-full bg-[#F7F0FA] px-2.5 py-1 text-xs font-bold text-[#704389]">{row.total_cases}</span>
                    </div>
                  ))}
                </div>
              )}
            </AnalyticsPanel>
            <AnalyticsPanel title="Case Type Breakdown" subtitle="Categories from your currently assigned cases." headerClassName="rounded-t-xl bg-[#604477]">
              {caseTypes.length === 0 ? <EmptyState message="No personal case category data is available yet." /> : (
                <div className="space-y-3">
                  {caseTypes.slice(0, 6).map((row) => (
                    <div key={row.label}>
                      <div className="mb-1 flex justify-between gap-3 text-sm"><span className="break-words font-semibold text-[#111827]">{row.label}</span><span className="shrink-0 text-[#475569]">{row.total_cases} · {categoryTotal ? Math.round(row.total_cases / categoryTotal * 100) : 0}%</span></div>
                      <div className="h-2 rounded-full bg-[#E9EEF3]"><div className="h-2 rounded-full" style={{ backgroundColor: caseTypeColors.get(row.label) ?? CHART_COLORS[0], width: `${Math.max((row.total_cases / Math.max(...caseTypes.map((item) => item.total_cases), 1)) * 100, 6)}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </AnalyticsPanel>
          </div>
          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <AnalyticsPanel title="Terminations over time" subtitle="Cases closed during the selected period." headerClassName="rounded-t-xl bg-[#604477]">
              {displayTerminatedMonthly.length === 0 ? <EmptyState message="No terminations are recorded in this range." /> : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 288 }}>
                    <AreaChart data={displayTerminatedMonthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#475569" }} fontSize={11} />
                      <YAxis allowDecimals={false} stroke="#475569" tick={{ fill: "#475569" }} fontSize={12} />
                      <Tooltip />
                      <Area type="linear" dataKey="total_cases" name="Closed cases" stroke="#B91C1C" fill="#FEE2E2" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </AnalyticsPanel>
            <AnalyticsPanel title="Termination reasons" subtitle="Recorded reasons for closed cases in your permitted records." headerClassName="rounded-t-xl bg-[#604477]">
              {(terminatedStats?.by_reason ?? []).length === 0 ? <EmptyState message="No termination reasons are available in this range." /> : (
                <div className="space-y-3">
                  {terminatedStats!.by_reason.map((row) => (
                    <div key={row.reason}>
                      <div className="mb-1 flex justify-between gap-3 text-sm"><span className="break-words font-semibold text-[#111827]">{row.reason}</span><span className="shrink-0 text-[#475569]">{row.total_cases}</span></div>
                      <div className="h-2 rounded-full bg-[#E9EEF3]"><div className="h-2 rounded-full bg-[#B91C1C]" style={{ width: `${Math.max((row.total_cases / Math.max(...terminatedStats!.by_reason.map((item) => item.total_cases), 1)) * 100, 6)}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </AnalyticsPanel>
          </div>

        </>
      )}
    </MainLayout>
  );
}

