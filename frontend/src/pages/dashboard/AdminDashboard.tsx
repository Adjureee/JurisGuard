import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  ArrowRight,
  Brain,
  BriefcaseBusiness,
  CalendarClock,
  FileScan,
  Scale,
  Users,
} from "lucide-react";
import MainLayout from "../../layouts/MainLayout";
import {
  AnalyticsPanel,
  IntelligenceMetricCard,
  SkeletonBlock,
} from "../../components/dashboard/AnalyticsPrimitives";
import { useDashboardAnalytics } from "./useDashboardAnalytics";
import type { MonthlyTrend } from "../../services/dashboardService";

export default function AdminDashboard() {
  const {
    barangays,
    intakeLoad,
    isLoading,
    monthlyTrends,
    ocrAnalytics,
    overview,
  } = useDashboardAnalytics({ deep: false });

  const topBarangays = useMemo(() => barangays.slice(0, 3), [barangays]);
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
      <div className="relative mb-6 overflow-hidden rounded-xl border border-[#E5E7EB] border-l-4 border-l-[#2563EB] bg-white px-6 py-6 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-[#2563EB]">PAO Panabo Command Center</p>
            <h1 className="mt-2 text-3xl font-bold text-[#111827]">Executive Operations Dashboard</h1>
            <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-[#6B7280]">
              A focused command snapshot for client volume, active workload, closures, monthly intake, and OCR digitization from the live JurisGuard database.
            </p>
          </div>
          <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Operational posture</p>
            <p className="mt-1 text-lg font-bold text-[#111827]">Live legal intelligence</p>
            <Link to="/analytics" className="mt-3 inline-flex text-sm font-semibold text-[#2563EB] underline-offset-4 hover:underline">
              Open analytics workspace
            </Link>
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

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_320px]">
        <AnalyticsPanel title="System Operational Insights" subtitle="Fast executive readout from intake, barangay, OCR, and trend data.">
          <div className="grid gap-3 md:grid-cols-2">
            {insights.map((insight) => (
              <div key={insight} className={`rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm ${["border-l-4 border-emerald-500", "border-l-4 border-amber-500", "border-l-4 border-blue-500"][insights.indexOf(insight) % 3]}`}>
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#4A7FB0]">
                  <Brain className="h-4 w-4" />
                </div>
                <p className="text-sm font-medium leading-6 text-[#4B5563]">{insight}</p>
              </div>
            ))}
          </div>
        </AnalyticsPanel>

        <section className="flex flex-col justify-between rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm ">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-[#4A7FB0]">Deep analytics</p>
            <h2 className="mt-2 text-xl font-bold text-[#2B3642]">Charts, map, OCR, audit, and export tools</h2>
            <p className="mt-3 text-sm font-medium leading-6 text-[#4B5563]">
              Open the dedicated analytics workspace when you need detailed barangay hotspots, intake trends, category distribution, staff activity, or export-ready datasets.
            </p>
          </div>
          <Link
            to="/analytics"
            className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-4 text-sm font-bold text-white shadow-sm transition-all hover:bg-[#1D4ED8]"
          >
            Go to Deep Analytics & Export
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </MainLayout>
  );
}
