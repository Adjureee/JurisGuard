import type { CheckboxStates } from '../features/documentExtraction/paperReviewState';
import { apiClient } from '../api/client';
import { withExtractionDeadline } from '../features/documentExtraction/requestDeadline';
import type { ClientRecord } from '../types';

export type PaperSection = 'applicant_personal_circumstances' | 'representative_personal_circumstances';
export type PaperSections = Record<PaperSection, Record<string, string>>;
export type PaperSchema = Record<PaperSection, [string, string][]>;
export type FieldEvidence = { page: number; bbox: [number, number, number, number]; source_text?: string };
export type SavedPaperIntake = { source_draft_id?: string | null; candidate_snapshot?: PaperExtraction['extracted_data'] | null; document_id: number; sections: PaperSections; checkbox_states?: CheckboxStates | null; unreadable_fields: string[]; field_reviews?: import('../features/documentExtraction/paperReviewState').FieldReviews | null };
export type PaperExtraction = {
  document_id: number;
  source_draft_id?: string;
  extracted_data: { intake_scope: string; sections: PaperSections; checkbox_states?: CheckboxStates | null; diagnostics: { rejected_candidates?: Record<string, string[]>; warnings: string[]; uncertain_fields?: string[]; field_states?: Record<string, string>; field_evidence?: Record<string, FieldEvidence>; page_count?: number; processing_mode?: 'section_crops' | 'whole_page'; capture_processing?: unknown }; extraction_mode: string };
};
export async function getPaperSchema(signal?: AbortSignal) {
  return (await apiClient.get<PaperSchema>('/pao-intakes/schema', { signal })).data;
}
export async function extractPaper(file: File, signal: AbortSignal, mode: 'auto' | 'offline' | 'cloud' = 'auto') {
  const form = new FormData();
  form.append('file', file);
  return withExtractionDeadline(async (deadlineSignal) => (await apiClient.post<PaperExtraction>(
    '/upload-document/', form, { params: { extraction_target: 'paper_intake', extraction_mode: mode }, signal: deadlineSignal },
  )).data, Number(import.meta.env.VITE_DOCUMENT_EXTRACTION_TIMEOUT_MS) || 200000, signal);
}
export async function savePaper(documentId: number, sections: PaperSections, clientId?: string, checkboxStates?: CheckboxStates, sourceDraftId?: string) {
  return (await apiClient.request<ClientRecord>({ method: clientId ? 'patch' : 'post', url: clientId ? `/pao-intakes/${clientId}` : '/pao-intakes/', data: {
    document_id: documentId, sections, reviewed: true, ...(sourceDraftId ? { source_draft_id: sourceDraftId } : {}), ...(checkboxStates ? { checkbox_states: checkboxStates } : {}),
  } })).data;
}
export async function getPaperScan(documentId: number, signal: AbortSignal) {
  return (await apiClient.get<Blob>(`/pao-intakes/documents/${documentId}`, { responseType: 'blob', signal })).data;
}
export async function getPaperPage(documentId: number, page: number, signal: AbortSignal) {
  const response = await apiClient.get<Blob>(`/pao-intakes/documents/${documentId}/pages/${page}`, { responseType: 'blob', signal });
  return { blob: response.data, pageCount: Number(response.headers['x-page-count']) || 1 };
}
export async function rereadPaper(documentId: number, signal: AbortSignal, mode: 'auto' | 'offline' | 'cloud') {
  return withExtractionDeadline(async deadlineSignal => (await apiClient.post<PaperExtraction>(
    `/pao-intakes/documents/${documentId}/extract`, undefined, { signal: deadlineSignal, params: { extraction_mode: mode } },
  )).data, Number(import.meta.env.VITE_DOCUMENT_EXTRACTION_TIMEOUT_MS) || 200000, signal);
}
