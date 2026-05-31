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
import {
  AnalyticsPanel,
  EmptyState,
  SkeletonBlock,
} from "../components/dashboard/AnalyticsPrimitives";
import ReportExportModal, { type ReportExportRow } from "../components/modals/ReportExportModal";
import {
  getHeatmap,
  getStaffWorkload,
  type HeatmapResponse,
  type StaffWorkload,
} from "../services/dashboardService";

const GeoAnalyticsMap = lazy(() => import("../components/dashboard/GeoAnalyticsMap"));

const COLORS = ["#704389", "#F59E0B", "#15803D", "#DC2626", "#7C3AED"];

function monthKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unscheduled";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function weekKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unscheduled";
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
}

function tally<T extends { label: string }>(rows: T[]) {
  const counts = new Map<string, number>();
  rows.forEach((row) => counts.set(row.label, (counts.get(row.label) ?? 0) + 1));
  return Array.from(counts.entries()).map(([label, total_cases]) => ({ label, total_cases }));
}

export default function StaffAnalyticsPage() {
  const [workload, setWorkload] = useState<StaffWorkload | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [selectedBarangay, setSelectedBarangay] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkload() {
      setIsLoading(true);
      try {
        const [workloadData, heatmapData] = await Promise.all([
          getStaffWorkload(),
          getHeatmap(),
        ]);
        if (!cancelled) {
          setWorkload(workloadData);
          setHeatmap(heatmapData);
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

  const monthlyProductivity = useMemo(() => {
    const counts = new Map<string, number>();
    (workload?.recent_cases ?? []).forEach((record) => {
      const key = monthKey(record.intake_record.form_date || record.last_updated);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, total_cases]) => ({ month, total_cases }));
  }, [workload]);

  const weeklyIntake = useMemo(() => {
    const counts = new Map<string, number>();
    (workload?.recent_cases ?? []).forEach((record) => {
      const key = weekKey(record.intake_record.form_date || record.last_updated);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-8)
      .map(([week, total_cases]) => ({ week, total_cases }));
  }, [workload]);

  const caseTypes = useMemo(
    () =>
      tally(
        (workload?.recent_cases ?? []).map((record) => ({
          label: record.cases.cause_of_action || record.intake_record.nature_of_case || "Uncategorized",
        }))
      ),
    [workload]
  );

  const ocrStatus = useMemo(
    () => tally((workload?.ocr_recent ?? []).map((row) => ({ label: row.ocr_status || "Unknown" }))),
    [workload]
  );

  const exportRows = useMemo<ReportExportRow[]>(() => {
    const caseRows = (workload?.recent_cases ?? []).map((record) => ({
      report_section: "My Cases",
      report_date: record.intake_record.form_date || record.last_updated,
      case_status: record.cases.status_of_case,
      case_category: record.cases.cause_of_action || record.intake_record.nature_of_case || "Uncategorized",
      barangay: record.cases.incident_barangay ?? "",
      staff: "Me",
      ocr_status: "",
      termination_status: record.cases.is_terminated ? "Terminated" : "Active",
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
      <div className="mb-8 flex flex-col gap-4 rounded-2xl border border-[#D7DEE7] bg-white px-6 py-6 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-[#704389]">Staff Analytics & Reports</p>
          <h1 className="mt-2 text-3xl font-bold text-[#111827]">Personal Productivity Workspace</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#6B7280]">
            Personal case trends, OCR activity, status breakdowns, and staff-only exports.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          disabled={exportRows.length === 0}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#704389] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#5F3675] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileDown className="h-4 w-4" />
          Export Center
        </button>
      </div>

      {isLoading ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <SkeletonBlock className="h-80" />
          <SkeletonBlock className="h-80" />
        </div>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <AnalyticsPanel title="Monthly Productivity" subtitle="Cases encoded by month from your own workload.">
              {monthlyProductivity.length === 0 ? <EmptyState message="No personal case productivity data is available yet." /> : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyProductivity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="month" stroke="#6B7280" fontSize={12} />
                      <YAxis allowDecimals={false} stroke="#6B7280" fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="total_cases" name="Cases" radius={[8, 8, 0, 0]} fill="#704389" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </AnalyticsPanel>

            <AnalyticsPanel title="Weekly Intake Trend" subtitle="Recent weekly movement for your own intake records.">
              {weeklyIntake.length === 0 ? <EmptyState message="No weekly intake records are available yet." /> : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyIntake}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="week" stroke="#6B7280" fontSize={11} />
                      <YAxis allowDecimals={false} stroke="#6B7280" fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="total_cases" name="Intake" radius={[8, 8, 0, 0]} fill="#704389" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </AnalyticsPanel>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <AnalyticsPanel title="OCR Analytics" subtitle="Your extraction volume by OCR status.">
              {ocrStatus.length === 0 ? <EmptyState message="No personal OCR activity is available yet." /> : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={ocrStatus} dataKey="total_cases" nameKey="label" innerRadius={54} outerRadius={88} paddingAngle={3}>
                        {ocrStatus.map((item, index) => <Cell key={item.label} fill={COLORS[index % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </AnalyticsPanel>

            <AnalyticsPanel title="Case Status Distribution" subtitle="Breakdown of your assigned cases.">
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

            <AnalyticsPanel title="Case Type Breakdown" subtitle="Personal case categories only.">
              {caseTypes.length === 0 ? <EmptyState message="No personal case type data is available yet." /> : (
                <div className="space-y-3">
                  {caseTypes.slice(0, 6).map((row, index) => (
                    <div key={row.label}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="font-semibold text-[#111827]">{row.label}</span>
                        <span className="text-[#6B7280]">{row.total_cases}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[#E9EEF3]">
                        <div
                          className="h-2 rounded-full"
                          style={{
                            backgroundColor: COLORS[index % COLORS.length],
                            width: `${Math.max((row.total_cases / Math.max(...caseTypes.map((item) => item.total_cases), 1)) * 100, 6)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </AnalyticsPanel>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <AnalyticsPanel
              title="Shared Case GIS Map"
              subtitle="Barangay-centered map for the shared PAO criminal case workspace."
            >
              {heatmap && heatmap.points.length > 0 ? (
                <Suspense fallback={<SkeletonBlock className="h-[28rem]" />}>
                  <GeoAnalyticsMap
                    center={heatmap.center}
                    points={heatmap.points}
                    barangays={heatmap.barangays}
                    selectedBarangay={selectedBarangay}
                    onSelectBarangay={setSelectedBarangay}
                  />
                </Suspense>
              ) : (
                <EmptyState message="No GIS data is available yet. Encode incident barangay or coordinates in case records to activate the staff map." />
              )}
            </AnalyticsPanel>

            <AnalyticsPanel
              title="Barangay Hotspots"
              subtitle="Top locations from the current shared case records."
            >
              {!heatmap || heatmap.barangays.length === 0 ? (
                <EmptyState message="No barangay hotspot data is available yet." />
              ) : (
                <div className="space-y-3">
                  {heatmap.barangays.slice(0, 8).map((barangay, index) => (
                    <button
                      key={barangay.barangay}
                      type="button"
                      onClick={() => setSelectedBarangay(barangay.barangay)}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${
                        selectedBarangay === barangay.barangay
                          ? "border-[#704389] bg-[#F7F0FA]"
                          : "border-[#E5E7EB] bg-[#F9FAFB] hover:bg-white"
                      }`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#704389] text-sm font-bold text-white">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#2B3642]">
                          {barangay.barangay}
                        </span>
                        <span className="text-xs text-[#4B5563]">
                          {barangay.most_common_category}
                        </span>
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-[#704389]">
                        {barangay.total_cases}
                      </span>
                    </button>
                  ))}
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

