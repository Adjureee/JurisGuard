import { useEffect, useState } from "react";
import toast from "react-hot-toast";
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
  type DashboardDateRange,
  type DashboardOverview,
  type HeatmapResponse,
  type IntakeLoadAnalytics,
  type MonthlyTrend,
  type OcrAnalytics,
  type RecentActivity,
  type TerminatedDashboardStats,
} from "../../services/dashboardService";

export const emptyOverview: DashboardOverview = {
  total_clients: 0,
  total_cases: 0,
  active_cases: 0,
  terminated_cases: 0,
  cases_this_month: 0,
  ocr_scanned_documents: 0,
};

export const emptyIntakeLoad: IntakeLoadAnalytics = {
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

export const emptyTerminatedStats: TerminatedDashboardStats = {
  total: 0,
  closure_rate: 0,
  most_common_reason: null,
  by_reason: [],
  monthly: [],
};

export const emptyOcrAnalytics: OcrAnalytics = {
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
  if (result.status === "rejected") {
    console.warn(`Dashboard widget request failed: ${label}`, result.reason);
  }
  return fallback;
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function safeHeatmap(value: unknown): HeatmapResponse | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<HeatmapResponse>;
  const center = candidate.center;
  if (
    !center ||
    typeof center.lat !== "number" ||
    typeof center.lng !== "number" ||
    !Number.isFinite(center.lat) ||
    !Number.isFinite(center.lng)
  ) {
    return null;
  }
  return {
    center,
    points: safeArray<HeatmapResponse["points"][number]>(candidate.points).filter(
      (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    ),
    barangays: safeArray<BarangayStat>(candidate.barangays),
  };
}

function safeIntakeLoad(value: unknown): IntakeLoadAnalytics {
  if (!value || typeof value !== "object") return emptyIntakeLoad;
  const candidate = value as Partial<IntakeLoadAnalytics>;
  return {
    weekly: safeArray<IntakeLoadAnalytics["weekly"][number]>(candidate.weekly),
    hourly: safeArray<IntakeLoadAnalytics["hourly"][number]>(candidate.hourly),
    busiest_day: candidate.busiest_day ?? null,
    busiest_hour: candidate.busiest_hour ?? null,
    average_daily_intake:
      typeof candidate.average_daily_intake === "number" && Number.isFinite(candidate.average_daily_intake)
        ? candidate.average_daily_intake
        : 0,
    total_weekly_cases:
      typeof candidate.total_weekly_cases === "number" && Number.isFinite(candidate.total_weekly_cases)
        ? candidate.total_weekly_cases
        : safeArray<IntakeLoadAnalytics["weekly"][number]>(candidate.weekly).reduce((sum, row) => sum + row.total_cases, 0),
  };
}

function safeTerminatedStats(value: unknown): TerminatedDashboardStats {
  if (!value || typeof value !== "object") return emptyTerminatedStats;
  const candidate = value as Partial<TerminatedDashboardStats>;
  return {
    total: typeof candidate.total === "number" && Number.isFinite(candidate.total) ? candidate.total : 0,
    closure_rate:
      typeof candidate.closure_rate === "number" && Number.isFinite(candidate.closure_rate) ? candidate.closure_rate : 0,
    most_common_reason: candidate.most_common_reason ?? null,
    by_reason: safeArray<TerminatedDashboardStats["by_reason"][number]>(candidate.by_reason),
    monthly: safeArray<MonthlyTrend>(candidate.monthly),
  };
}

function safeOcrAnalytics(value: unknown): OcrAnalytics {
  if (!value || typeof value !== "object") return emptyOcrAnalytics;
  const candidate = value as Partial<OcrAnalytics>;
  return {
    total_scans: typeof candidate.total_scans === "number" && Number.isFinite(candidate.total_scans) ? candidate.total_scans : 0,
    successful_extractions:
      typeof candidate.successful_extractions === "number" && Number.isFinite(candidate.successful_extractions)
        ? candidate.successful_extractions
        : 0,
    failed_scans: typeof candidate.failed_scans === "number" && Number.isFinite(candidate.failed_scans) ? candidate.failed_scans : 0,
    document_types: safeArray<OcrAnalytics["document_types"][number]>(candidate.document_types),
    trends: safeArray<OcrAnalytics["trends"][number]>(candidate.trends),
    recent: safeArray<OcrAnalytics["recent"][number]>(candidate.recent),
  };
}

export function useDashboardAnalytics({ deep = true, dateRange }: { deep?: boolean; dateRange?: DashboardDateRange } = {}) {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [monthlyTrends, setMonthlyTrends] = useState<MonthlyTrend[]>([]);
  const [caseCategories, setCaseCategories] = useState<CaseCategoryStat[]>([]);
  const [barangays, setBarangays] = useState<BarangayStat[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [terminatedStats, setTerminatedStats] = useState<TerminatedDashboardStats | null>(null);
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [intakeLoad, setIntakeLoad] = useState<IntakeLoadAnalytics | null>(null);
  const [ocrAnalytics, setOcrAnalytics] = useState<OcrAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadDashboard() {
      setIsLoading(true);
      if (!deep) {
        const results = await Promise.allSettled([
          getDashboardOverview(),
          getMonthlyTrends(),
          getBarangayStats(),
          getIntakeLoadAnalytics(),
          getOcrAnalytics(),
        ]);
        if (cancelled) return;
        const [overviewResult, monthlyResult, barangayResult, intakeLoadResult, ocrResult] = results;
        setOverview(getSettledValue(overviewResult, emptyOverview, "overview"));
        setMonthlyTrends(safeArray<MonthlyTrend>(getSettledValue(monthlyResult, [], "monthly trends")));
        setCaseCategories([]);
        setBarangays(safeArray<BarangayStat>(getSettledValue(barangayResult, [], "barangay stats")));
        setHeatmap(null);
        setTerminatedStats(emptyTerminatedStats);
        setActivities([]);
        setIntakeLoad(safeIntakeLoad(getSettledValue(intakeLoadResult, emptyIntakeLoad, "intake load")));
        setOcrAnalytics(safeOcrAnalytics(getSettledValue(ocrResult, emptyOcrAnalytics, "OCR analytics")));
        if (results.some((result) => result.status === "rejected")) {
          toast.error("Some dashboard summary widgets could not refresh.");
        }
        setIsLoading(false);
        return;
      }

      const results = await Promise.allSettled([
        getDashboardOverview(dateRange),
        getMonthlyTrends(dateRange),
        getCaseCategories(),
        getBarangayStats(),
        getHeatmap(),
        getTerminatedCaseStats(dateRange),
        getRecentActivities(),
        getIntakeLoadAnalytics(dateRange),
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
      setMonthlyTrends(safeArray<MonthlyTrend>(getSettledValue(monthlyResult, [], "monthly trends")));
      setCaseCategories(safeArray<CaseCategoryStat>(getSettledValue(categoryResult, [], "case categories")));
      setBarangays(safeArray<BarangayStat>(getSettledValue(barangayResult, [], "barangay stats")));
      setHeatmap(safeHeatmap(getSettledValue(heatmapResult, null, "heatmap")));
      setTerminatedStats(safeTerminatedStats(getSettledValue(terminatedResult, emptyTerminatedStats, "terminated cases")));
      setActivities(safeArray<RecentActivity>(getSettledValue(activityResult, [], "recent activities")));
      setIntakeLoad(safeIntakeLoad(getSettledValue(intakeLoadResult, emptyIntakeLoad, "intake load")));
      setOcrAnalytics(safeOcrAnalytics(getSettledValue(ocrResult, emptyOcrAnalytics, "OCR analytics")));
      if (results.some((result) => result.status === "rejected")) {
        toast.error("Some dashboard widgets could not refresh.");
      }
      setIsLoading(false);
    }
    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [dateRange, deep]);

  return {
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
  };
}
