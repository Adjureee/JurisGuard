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
      {
        label: "Peak Day",
        value: intakeLoad?.busiest_day ? intakeLoad.busiest_day.day : "Pending data",
        detail: intakeLoad?.busiest_day ? `${intakeLoad.busiest_day.total_cases} encoded intake record(s)` : "Weekday patterns appear after records are encoded.",
      },
      {
        label: "Peak Hour",
        value: intakeLoad?.busiest_hour ? intakeLoad.busiest_hour.hour : "No timestamped peak",
        detail: intakeLoad?.busiest_hour ? `${intakeLoad.busiest_hour.total_cases} intake record(s) in this hour` : "Hourly analysis uses actual form timestamps only.",
      },
      {
        label: "GIS Hotspot",
        value: topBarangays[0]?.barangay ?? "No barangay yet",
        detail: topBarangays[0] ? `${topBarangays[0].total_cases} case(s), most often ${topBarangays[0].most_common_category}` : "Encode incident barangays to activate hotspots.",
      },
      {
        label: "Monthly Load",
        value: busiestMonth?.month ?? "No trend yet",
        detail: busiestMonth ? `${busiestMonth.total_cases} case(s) in the busiest month` : "Monthly trend analysis is waiting for intake records.",
      },
      {
        label: "OCR Throughput",
        value: `${ocrAnalytics?.total_scans ?? 0} document(s)`,
        detail: ocrAnalytics && ocrAnalytics.total_scans > 0 ? `${ocrAnalytics.successful_extractions} successful extraction(s)` : "OCR activity appears as staff scan documents.",
      },
    ];
    return rows;
  }, [busiestMonth, intakeLoad, ocrAnalytics, topBarangays]);

  return (
    <MainLayout>
      <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="text-3xl font-semibold text-[#2B3642]">
            Operations Overview
          </h2>
          <nav className="mt-1 flex items-center gap-2 text-sm text-[#4B5563]">
            <span>Dashboard</span>
            <span>/</span>
            <span className="text-[#2B3642]">Overview</span>
          </nav>
        </div>
        <Link
          to="/analytics"
          className="inline-flex h-10 items-center justify-center rounded-md bg-[#704389] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5F3675]"
        >
          Open Analytics
        </Link>
      </div>

      {isLoading && !overview ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => <SkeletonBlock key={index} className="h-40" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <IntelligenceMetricCard label="Total Clients" value={overview?.total_clients ?? 0} detail="Registered legal aid clients" icon={<Users className="h-5 w-5" />} tone="blue" to="/cases" actionLabel="Open records" />
          <IntelligenceMetricCard label="Total Cases" value={overview?.total_cases ?? 0} detail="Criminal case records" icon={<Scale className="h-5 w-5" />} tone="dark" to="/cases" actionLabel="Review cases" />
          <IntelligenceMetricCard label="Active Cases" value={overview?.active_cases ?? 0} detail="Open operational workload" icon={<BriefcaseBusiness className="h-5 w-5" />} tone="green" to="/cases" actionLabel="View workload" />
          <IntelligenceMetricCard label="Terminated" value={overview?.terminated_cases ?? 0} detail="Closed and archived matters" icon={<Archive className="h-5 w-5" />} tone="red" positive={false} to="/terminated-cases" actionLabel="Open archive" />
          <IntelligenceMetricCard label="This Month" value={overview?.cases_this_month ?? 0} detail="Current monthly intake" icon={<CalendarClock className="h-5 w-5" />} tone="yellow" to="/analytics" actionLabel="View trend" />
          <IntelligenceMetricCard label="OCR Processed" value={overview?.ocr_scanned_documents ?? 0} detail="Digitized legal documents" icon={<FileScan className="h-5 w-5" />} tone="purple" to="/analytics" actionLabel="View OCR" />
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_320px]">
        <AnalyticsPanel title="Operational Insights" subtitle="Concise readout from live intake, GIS, and OCR records.">
          <div className="grid gap-3 md:grid-cols-2">
            {insights.map((insight, index) => (
              <div key={insight.label} className={`rounded-xl border bg-white p-4 shadow-sm ${["border-emerald-200", "border-amber-200", "border-emerald-200"][index % 3]}`}>
                <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${["bg-emerald-50 text-emerald-700", "bg-amber-50 text-amber-700", "bg-[#F7F0FA] text-[#704389]"][index % 3]}`}>
                  <Brain className="h-4 w-4" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">{insight.label}</p>
                <p className="mt-1 text-base font-bold text-[#111827]">{insight.value}</p>
                <p className="mt-2 text-sm font-medium leading-6 text-[#4B5563]">{insight.detail}</p>
              </div>
            ))}
          </div>
        </AnalyticsPanel>

        <section className="flex flex-col justify-between rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-[#704389]">Deep Analytics</p>
            <h2 className="mt-1 text-xl font-semibold text-[#2B3642]">Charts, map, OCR, audit, and export tools</h2>
            <p className="mt-3 text-sm font-medium leading-6 text-[#4B5563]">
              Open the dedicated analytics workspace when you need detailed barangay hotspots, intake trends, category distribution, staff activity, or export-ready datasets.
            </p>
          </div>
          <Link
            to="/analytics"
            className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#704389] px-4 text-sm font-bold text-white shadow-sm transition-all hover:bg-[#5F3675]"
          >
            Go to Deep Analytics & Export
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </MainLayout>
  );
}

