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
  extracted_data: { intake_scope: string; sections: PaperSections; checkbox_states?: CheckboxStates | null; diagnostics: { rejected_candidates?: Record<string, string[]>; warnings: string[]; uncertain_fields?: string[]; field_states?: Record<string, string>; field_evidence?: Record<string, FieldEvidence>; page_count?: number; processing_mode?: 'section_crops' | 'whole_page'; capture_processing?: unknown; image_preparation?: {original_retained:boolean;selected_copy:boolean} }; extraction_mode: string };
};
export async function getPaperSchema(signal?: AbortSignal) {
  return (await apiClient.get<PaperSchema>('/pao-intakes/schema', { signal })).data;
}
export async function prepareCameraCapture(original: File, signal: AbortSignal) {
  const form = new FormData(); form.append('file', original);
  const {data} = await apiClient.post<{image_base64:string;boundary_confident:boolean;rotation:number;warnings:string[]}>('/pao-intakes/prepare-camera', form, {signal});
  const bytes=Uint8Array.from(atob(data.image_base64), c=>c.charCodeAt(0));
  return {...data,file:new File([bytes], 'camera-prepared.png', {type:'image/png'})};
}
export type PaperCropPlan = { corners:number[][]; rotation:number; sections:{part_ii:number[];part_iia:number[]}; document_reviewed:true;sections_reviewed:true };
export type PaperCaptureAnalysis = {document:{corners:number[][];confidence:string};rotation:number;page:{preview:string};sections:{part_ii:number[];part_iia:number[];confidence:string};warnings:string[]};
export async function analyzePaperCapture(file:File,signal:AbortSignal,corners?:number[][],rotation=0) {
  const form=new FormData();form.append('file',file);form.append('rotation',String(rotation));
  if(corners)form.append('corners_json',JSON.stringify(corners));
  return (await apiClient.post<PaperCaptureAnalysis>('/pao-intakes/capture-analyze',form,{signal,timeout:200000})).data;
}
export async function extractPaper(file: File, signal: AbortSignal, mode: 'auto' | 'offline' | 'cloud' = 'auto', selection?: File | PaperCropPlan) {
  const form = new FormData();
  const original=selection instanceof File?selection:undefined;
  form.append('file', original ?? file);
  if(original && original !== file) form.append('ocr_image', file);
  if(selection && !(selection instanceof File))form.append('crop_plan',JSON.stringify(selection));
  return withExtractionDeadline(async (deadlineSignal) => (await apiClient.post<PaperExtraction>(
    '/upload-document/', form, { params: { extraction_target: 'paper_intake', extraction_mode: mode }, signal: deadlineSignal },
  )).data, Number(import.meta.env.VITE_DOCUMENT_EXTRACTION_TIMEOUT_MS) || 200000, signal);
}
export async function savePaper(documentId: number, sections: PaperSections, clientId?: string, checkboxStates?: CheckboxStates, sourceDraftId?: string, unreadableFields?: string[]) {
  return (await apiClient.request<ClientRecord>({ method: clientId ? 'patch' : 'post', url: clientId ? `/pao-intakes/${clientId}` : '/pao-intakes/', data: {
    document_id: documentId, sections, reviewed: true, ...(sourceDraftId ? { source_draft_id: sourceDraftId } : {}), ...(checkboxStates ? { checkbox_states: checkboxStates } : {}), ...(unreadableFields ? { unreadable_fields: unreadableFields } : {}),
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
