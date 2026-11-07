import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
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
import { FileDown } from "lucide-react";
import MainLayout from "../layouts/MainLayout";
import PageHeader from "../components/PageHeader";
import {
  AnalyticsPanel,
  CHART_COLORS,
  EmptyState,
  getStableCategoryColorMap,
  SkeletonBlock,
} from "../components/dashboard/AnalyticsPrimitives";
import ReportExportModal, { type ReportExportRow } from "../components/modals/ReportExportModal";
import {
  getStaffWorkload,
  type StaffWorkload,
} from "../services/dashboardService";
import { formatLegalMonth } from "../services/dashboardService";
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

type AnalyticsPreset = "all" | "last30" | "last90" | "year";

function analyticsPresetRange(preset: AnalyticsPreset) {
  if (preset === 'all') return { dateFrom: '', dateTo: '' };
  const end = new Date();
  const start = new Date(end);
  if (preset === "last30") start.setDate(end.getDate() - 29);
  if (preset === "last90") start.setDate(end.getDate() - 89);
  if (preset === "year") {
    start.setMonth(0, 1);
  }
  return { dateFrom: start.toISOString().slice(0, 10), dateTo: end.toISOString().slice(0, 10) };
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
  const [selectedBarangay, setSelectedBarangay] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [datePreset, setDatePreset] = useState<AnalyticsPreset>("all");
  const [dateRange, setDateRange] = useState(() => analyticsPresetRange("all"));
  const { monthlyTrends, intakeLoad, caseCategories, heatmap, terminatedStats, ocrAnalytics, isLoading: trendsLoading } = useDashboardAnalytics({ dateRange });

  useEffect(() => {
    let cancelled = false;
    async function loadWorkload() {
      setIsLoading(true);
      try {
        const workloadData = await getStaffWorkload();
        if (!cancelled) {
          setWorkload(workloadData);
        }
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Unable to load staff analytics");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadWorkload();
    return () => {
      cancelled = true;
    };
  }, []);

  const monthlyProductivity = useMemo(
    () => monthlyTrends.map((row) => ({ month: formatTrendLabel(row.month), total_cases: row.total_cases })),
    [monthlyTrends],
  );

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

  const exportRows = useMemo<ReportExportRow[]>(() => {
    const caseRows = (workload?.recent_cases ?? []).map((record) => ({
      report_section: "My Cases",
      report_date: record.intake_record.form_date || record.last_updated,
      case_status: record.cases.status_of_case,
      case_category: record.cases.cause_of_action || record.intake_record.nature_of_case || record.case_type || "Uncategorized",
      barangay: record.cases.incident_barangay ?? "",
      staff: "Me",
      ocr_status: "",
      termination_status: record.cases.is_terminated ? "Terminated" : "Pending",
      control_no: record.intake_record.control_no,
      case_title: record.cases.title_of_case,
      value: 1,
    }));
    const ocrRows = (workload?.ocr_recent ?? []).map((item) => ({
      report_section: "OCR Usage",
      report_date: item.uploaded_at,
      case_status: "",
      case_category: item.document_type,
      barangay: "",
      staff: "Me",
      ocr_status: item.ocr_status,
      termination_status: "",
      control_no: `Document #${item.document_id}`,
      case_title: item.document_type,
      value: 1,
    }));
    return [...caseRows, ...ocrRows];
  }, [workload]);

  return (
    <MainLayout>
      <PageHeader
        eyebrow="Staff Analytics & Reports"
        title="Personal Productivity Workspace"
        description="Personal case trends, OCR activity, status breakdowns, and staff-only exports."
        actions={
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            disabled={exportRows.length === 0}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#704389] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#5F3675] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileDown className="h-4 w-4" />
            Export Center
          </button>
        }
      />

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
      ) : (
        <>
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

          <div className="mt-6 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold text-[#111827]">Analytics Date Range</p>
                <p className="mt-1 text-xs font-medium text-[#6B7280]">Personal trends and closure analytics refresh from this range.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {([["all", "All dates"], ["last30", "Last 30 Days"], ["last90", "Last 90 Days"], ["year", "This Year"]] as Array<[AnalyticsPreset, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setSelectedBarangay(null); setDatePreset(value); setDateRange(analyticsPresetRange(value)); }}
                    aria-pressed={datePreset === value}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold ${datePreset === value ? "border-[#704389] bg-[#F7F0FA] text-[#704389]" : "border-[#D1D5DB] bg-white text-[#4B5563] hover:bg-[#F3F4F6]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <AnalyticsPanel title="Case Intake Trends" subtitle="Case movement from your currently assigned cases." headerClassName="rounded-t-xl bg-[#604477]">
              {monthlyProductivity.length === 0 ? <EmptyState message="No personal case productivity data is available yet." /> : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 288 }}>
                    <BarChart data={monthlyProductivity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#475569" }} fontSize={12} />
                      <YAxis allowDecimals={false} stroke="#475569" tick={{ fill: "#475569" }} fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="total_cases" name="Cases" radius={[8, 8, 0, 0]} fill={CHART_COLORS[0]} />
                    </BarChart>
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
                      <div className="mb-1 flex justify-between text-sm"><span className="font-semibold text-[#111827]">{row.label}</span><span className="text-[#475569]">{row.total_cases}</span></div>
                      <div className="h-2 rounded-full bg-[#E9EEF3]"><div className="h-2 rounded-full" style={{ backgroundColor: caseTypeColors.get(row.label) ?? CHART_COLORS[0], width: `${Math.max((row.total_cases / Math.max(...caseTypes.map((item) => item.total_cases), 1)) * 100, 6)}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </AnalyticsPanel>
          </div>
          <div className="mt-6 grid gap-6">
            <AnalyticsPanel title="Terminated Case Analytics" subtitle="Closure distribution for your currently assigned cases." headerClassName="rounded-t-xl bg-[#604477]">
              {(terminatedStats?.by_reason ?? []).length === 0 ? <EmptyState message="No terminated case data is available in this range." /> : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 288 }}>
                    <BarChart data={terminatedStats?.by_reason ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="reason" stroke="#475569" tick={{ fill: "#475569" }} fontSize={11} />
                      <YAxis allowDecimals={false} stroke="#475569" tick={{ fill: "#475569" }} fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="total_cases" name="Closed cases" radius={[8, 8, 0, 0]} fill="#DC2626" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </AnalyticsPanel>
          </div>

          <div className="mt-6 rounded-xl border border-[#D7DEE7] bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-[#111827]">Export Center</h2>
            <p className="mt-1 text-sm leading-6 text-[#6B7280]">
              Staff exports are restricted to your own cases, productivity rows, and OCR activity. Use the export filters before generating CSV or PDF reports.
            </p>
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              disabled={exportRows.length === 0}
              className="mt-4 rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5F3675] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open Export Filters
            </button>
          </div>
        </>
      )}

      <ReportExportModal
        isOpen={exportOpen}
        title="Personal Staff Report Export"
        description="Export only your own cases, personal productivity rows, and OCR activity. Apply filters before generating a report."
        fileName="jurisguard_staff_personal_report"
        rows={exportRows}
        scope="staff"
        redirectTo="/staff/analytics"
        onClose={() => setExportOpen(false)}
      />
    </MainLayout>
  );
}

