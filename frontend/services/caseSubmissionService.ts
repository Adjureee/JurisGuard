import { apiClient } from "../api/client";
import type { ClientRecord, CriminalCaseRecord } from "../types";

export type CaseSubmissionStatus =
  | "Draft"
  | "Submitted"
  | "Under Review"
  | "Correction Required"
  | "Correction Requested"
  | "Resubmitted"
  | "Approved";

export interface SubmissionSnapshot {
  record: CriminalCaseRecord;
  client: ClientRecord | null;
  client_name: string;
}

export interface CaseSubmissionItem {
  submission_item_id: string;
  case_id: string;
  snapshot: SubmissionSnapshot;
}

export interface SubmissionFeedback {
  feedback_id: string;
  reviewer_id: number;
  reviewer_name: string;
  comments: string;
  created_at: string;
}

export interface CaseSubmission {
  submission_id: string;
  group_id: string;
  staff_id: number;
  staff_name: string;
  staff_role: string;
  staff_profile_image_path?: string | null;
  title: string;
  date_from: string;
  date_to: string;
  status: CaseSubmissionStatus;
  version: number;
  notes: string;
  case_count: number;
  submitted_at?: string | null;
  approved_at?: string | null;
  reviewed_by?: number | null;
  reviewer_name?: string | null;
  created_at: string;
  updated_at: string;
  items: CaseSubmissionItem[];
  feedback: SubmissionFeedback[];
}

export interface SubmissionPreview {
  date_from: string;
  date_to: string;
  case_count: number;
  items: SubmissionSnapshot[];
}

export interface CaseSubmissionPayload {
  title: string;
  date_from: string;
  date_to: string;
  notes?: string;
}

export async function previewCaseSubmission(payload: Pick<CaseSubmissionPayload, "date_from" | "date_to">) {
  const response = await apiClient.post<SubmissionPreview>("/case-submissions/preview", payload);
  return response.data;
}

export async function listCaseSubmissions() {
  const response = await apiClient.get<CaseSubmission[]>("/case-submissions");
  return response.data;
}

export async function getCaseSubmission(id: string) {
  const response = await apiClient.get<CaseSubmission>(`/case-submissions/${id}`);
  return response.data;
}

export async function getCaseSubmissionHistory(id: string) {
  const response = await apiClient.get<CaseSubmission[]>(`/case-submissions/${id}/history`);
  return response.data;
}

export async function createCaseSubmission(payload: CaseSubmissionPayload) {
  const response = await apiClient.post<CaseSubmission>("/case-submissions", payload);
  return response.data;
}

export async function updateCaseSubmission(id: string, payload: CaseSubmissionPayload) {
  const response = await apiClient.patch<CaseSubmission>(`/case-submissions/${id}`, payload);
  return response.data;
}

export async function submitCaseSubmission(id: string) {
  const response = await apiClient.post<CaseSubmission>(`/case-submissions/${id}/submit`);
  return response.data;
}

export async function startCaseSubmissionReview(id: string) {
  const response = await apiClient.post<CaseSubmission>(`/case-submissions/${id}/review`);
  return response.data;
}

export async function requestCaseSubmissionCorrection(id: string, comments: string) {
  const response = await apiClient.post<CaseSubmission>(`/case-submissions/${id}/request-correction`, { comments });
  return response.data;
}

export async function approveCaseSubmission(id: string) {
  const response = await apiClient.post<CaseSubmission>(`/case-submissions/${id}/approve`);
  return response.data;
}

export async function resubmitCaseSubmission(id: string, payload: CaseSubmissionPayload) {
  const response = await apiClient.post<CaseSubmission>(`/case-submissions/${id}/resubmit`, payload);
  return response.data;
}
