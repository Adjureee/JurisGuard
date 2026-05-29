import { apiClient } from "../api/client";

export interface DashboardOverview {
  total_clients: number;
  total_cases: number;
  active_cases: number;
  terminated_cases: number;
  cases_this_month: number;
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

export async function getDashboardOverview() {
  const response = await apiClient.get<DashboardOverview>("/dashboard/overview");
  return response.data;
}

export async function getMonthlyTrends() {
  const response = await apiClient.get<MonthlyTrend[]>("/dashboard/monthly-trends");
  return response.data;
}

export async function getCaseCategories() {
  const response = await apiClient.get<CaseCategoryStat[]>("/dashboard/case-categories");
  return response.data;
}

export async function getIntakeLoadAnalytics() {
  const response = await apiClient.get<IntakeLoadAnalytics>("/dashboard/intake-load");
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

export async function getTerminatedCaseStats() {
  const response = await apiClient.get<TerminatedDashboardStats>("/dashboard/terminated-cases");
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
