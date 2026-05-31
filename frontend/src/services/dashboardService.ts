import { apiClient } from "../api/client";
import {
  getPanaboCoordinate,
  PANABO_CITY_HALL_COORDINATES,
  resolvePanaboBarangay,
} from "../utils/panaboCoordinates";

export interface RawGeoCase {
  case_id?: number | string | null;
  client_name?: string | null;
  clientName?: string | null;
  case_type?: string | null;
  caseType?: string | null;
  category?: string | null;
  nature_of_case?: string | null;
  case_status?: string | null;
  caseStatus?: string | null;
  status?: string | null;
  barangay?: string | null;
  incident_barangay?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

export interface EnrichedGeoCase extends RawGeoCase {
  case_id: number | string;
  client_name: string;
  case_type: string;
  case_status: string;
  barangay: string;
  latitude: number;
  longitude: number;
  coordinate_source: "case_coordinates" | "local_barangay_dictionary" | "panabo_city_fallback";
}

export interface DashboardOverview {
  total_clients: number;
  total_cases: number;
  active_cases: number;
  terminated_cases: number;
  cases_this_month: number;
  cases_in_range?: number;
  clients_in_range?: number;
  ocr_scanned_documents: number;
}

export interface MonthlyTrend {
  month: string;
  total_cases: number;
}

export interface CaseCategoryStat {
  category: string;
  total_cases: number;
}

export interface BarangayStat {
  barangay: string;
  city: string;
  total_cases: number;
  active_cases: number;
  terminated_cases: number;
  most_common_category: string;
  latitude: number | null;
  longitude: number | null;
}

export interface HeatmapPoint {
  case_id: number;
  barangay: string;
  latitude: number;
  longitude: number;
  weight: number;
  source: "coordinates" | "barangay";
  status: string;
  category: string;
}

export interface HeatmapResponse {
  center: { lat: number; lng: number };
  points: HeatmapPoint[];
  barangays: BarangayStat[];
}

export interface TerminatedDashboardStats {
  total: number;
  closure_rate?: number;
  most_common_reason?: string | null;
  by_reason: Array<{ reason: string; total_cases: number }>;
  monthly: MonthlyTrend[];
}

export interface RecentActivity {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  description: string;
  entity_type?: string | null;
  entity_id?: string | null;
}

export interface IntakeLoadAnalytics {
  weekly: Array<{ day: string; total_cases: number }>;
  hourly: Array<{ hour: string; total_cases: number }>;
  busiest_day: { day: string; total_cases: number } | null;
  busiest_hour: { hour: string; total_cases: number } | null;
  average_daily_intake?: number;
  total_weekly_cases?: number;
}

export interface OcrAnalytics {
  total_scans: number;
  successful_extractions: number;
  failed_scans: number;
  document_types: Array<{ document_type: string; total_scans: number }>;
  trends: Array<{ month: string; total_scans: number }>;
  recent: Array<{
    document_id: number;
    document_type: string;
    ocr_status: string;
    uploaded_at: string;
    uploaded_by: number | null;
  }>;
}

export interface StaffWorkload {
  assigned_cases: number;
  cases_created_today: number;
  pending_case_work: number;
  my_ocr_usage: number;
  status_breakdown: Array<{ status: string; total_cases: number }>;
  recent_cases: import("../types").CriminalCaseRecord[];
  recent_clients: import("../types").ClientRecord[];
  recent_actions: Array<{
    id: string;
    timestamp: string;
    action: string;
    description: string;
    entity_type?: string | null;
    entity_id?: string | null;
  }>;
  ocr_recent: Array<{
    document_id: number;
    ocr_status: string;
    document_type: string;
    uploaded_at: string;
  }>;
}

export interface DashboardDateRange {
  dateFrom?: string;
  dateTo?: string;
}

function dateRangeParams(range?: DashboardDateRange) {
  return {
    date_from: range?.dateFrom || undefined,
    date_to: range?.dateTo || undefined,
  };
}

function toFiniteNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstText(...values: Array<string | number | null | undefined>) {
  const value = values.find((item) => String(item ?? "").trim().length > 0);
  return value == null ? "" : String(value).trim();
}

export function enrichCasesWithCoordinates<T extends RawGeoCase>(
  cases: T[],
): Array<EnrichedGeoCase & T> {
  return cases.map((record, index) => {
    const rawBarangay = firstText(record.incident_barangay, record.barangay);
    const resolvedBarangay = resolvePanaboBarangay(rawBarangay);
    const explicitLat = toFiniteNumber(record.latitude);
    const explicitLng = toFiniteNumber(record.longitude);
    const hasExplicitCoordinates = explicitLat !== null && explicitLng !== null;
    const dictionaryCoordinates = getPanaboCoordinate(rawBarangay);
    const fallbackUsed = !hasExplicitCoordinates && !resolvedBarangay;

    return {
      ...record,
      case_id: record.case_id ?? `local-geo-${index + 1}`,
      client_name: firstText(record.client_name, record.clientName, "Unknown Client"),
      case_type: firstText(
        record.case_type,
        record.caseType,
        record.category,
        record.nature_of_case,
        "Unclassified",
      ),
      case_status: firstText(record.case_status, record.caseStatus, record.status, "Pending"),
      barangay: resolvedBarangay ?? (rawBarangay || "Panabo City"),
      latitude: hasExplicitCoordinates ? explicitLat : dictionaryCoordinates.lat,
      longitude: hasExplicitCoordinates ? explicitLng : dictionaryCoordinates.lng,
      coordinate_source: hasExplicitCoordinates
        ? "case_coordinates"
        : fallbackUsed
          ? "panabo_city_fallback"
          : "local_barangay_dictionary",
    };
  });
}

export function buildLocalHeatmap(cases: EnrichedGeoCase[]): HeatmapResponse {
  const barangayBuckets = new Map<string, BarangayStat & { categoryCounts: Map<string, number> }>();

  const points = cases.map<HeatmapPoint>((record) => {
    const bucket =
      barangayBuckets.get(record.barangay) ??
      {
        barangay: record.barangay,
        city: "Panabo City",
        total_cases: 0,
        active_cases: 0,
        terminated_cases: 0,
        most_common_category: record.case_type,
        latitude: record.latitude,
        longitude: record.longitude,
        categoryCounts: new Map<string, number>(),
      };

    bucket.total_cases += 1;
    if (record.case_status.toLowerCase() === "terminated") {
      bucket.terminated_cases += 1;
    } else {
      bucket.active_cases += 1;
    }
    bucket.categoryCounts.set(
      record.case_type,
      (bucket.categoryCounts.get(record.case_type) ?? 0) + 1,
    );
    bucket.most_common_category = Array.from(bucket.categoryCounts.entries()).sort(
      (left, right) => right[1] - left[1],
    )[0]?.[0] ?? record.case_type;
    barangayBuckets.set(record.barangay, bucket);

    return {
      case_id: Number(record.case_id) || pointsSafeId(record.case_id),
      barangay: record.barangay,
      latitude: record.latitude,
      longitude: record.longitude,
      weight: record.case_status.toLowerCase() === "terminated" ? 0.65 : 1,
      source:
        record.coordinate_source === "case_coordinates"
          ? "coordinates"
          : "barangay",
      status: record.case_status,
      category: record.case_type,
    };
  });

  const barangays = Array.from(barangayBuckets.values())
    .map((bucket) => ({
      barangay: bucket.barangay,
      city: bucket.city,
      total_cases: bucket.total_cases,
      active_cases: bucket.active_cases,
      terminated_cases: bucket.terminated_cases,
      most_common_category: bucket.most_common_category,
      latitude: bucket.latitude,
      longitude: bucket.longitude,
    }))
    .sort((left, right) => right.total_cases - left.total_cases);

  return {
    center: PANABO_CITY_HALL_COORDINATES,
    points,
    barangays,
  };
}

function pointsSafeId(value: number | string | null | undefined) {
  const text = String(value ?? "");
  return Array.from(text).reduce((total, char) => total + char.charCodeAt(0), 0);
}

export async function getDashboardOverview(range?: DashboardDateRange) {
  const response = await apiClient.get<DashboardOverview>("/dashboard/overview", { params: dateRangeParams(range) });
  return response.data;
}

export async function getMonthlyTrends(range?: DashboardDateRange) {
  const response = await apiClient.get<MonthlyTrend[]>("/dashboard/monthly-trends", { params: dateRangeParams(range) });
  return response.data;
}

export async function getCaseCategories() {
  const response = await apiClient.get<CaseCategoryStat[]>("/dashboard/case-categories");
  return response.data;
}

export function formatLegalMonth(value: string | number | undefined | null) {
  if (value === undefined || value === null || value === "") return "";
  const raw = String(value);
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [year, month] = raw.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
  }
  return raw;
}

export async function getIntakeLoadAnalytics(range?: DashboardDateRange) {
  const response = await apiClient.get<IntakeLoadAnalytics>("/dashboard/intake-load", { params: dateRangeParams(range) });
  return response.data;
}

export async function getBarangayStats() {
  const response = await apiClient.get<BarangayStat[]>("/dashboard/barangay-stats");
  return response.data;
}

export async function getHeatmap() {
  const response = await apiClient.get<HeatmapResponse>("/dashboard/heatmap");
  return response.data;
}

export async function getTerminatedCaseStats(range?: DashboardDateRange) {
  const response = await apiClient.get<TerminatedDashboardStats>("/dashboard/terminated-cases", { params: dateRangeParams(range) });
  return response.data;
}

export async function getRecentActivities() {
  const response = await apiClient.get<RecentActivity[]>("/dashboard/recent-activities");
  return response.data;
}

export async function getOcrAnalytics() {
  const response = await apiClient.get<OcrAnalytics>("/dashboard/ocr-analytics");
  return response.data;
}

export async function getStaffWorkload() {
  const response = await apiClient.get<StaffWorkload>("/dashboard/staff-workload");
  return response.data;
}

