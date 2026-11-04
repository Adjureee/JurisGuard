import { useEffect, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { ScanViewer } from './ScanViewer';
import { useConfirmation } from '../../components/ConfirmationProvider';
import { CameraCapture } from './CameraCapture';
import { useExtractionRequest } from './useExtractionRequest';
import { extractPaper, getPaperScan, getPaperSchema, rereadPaper, savePaper, type PaperExtraction,
  getPaperPage, type FieldEvidence, type PaperSchema, type PaperSection, type PaperSections, type SavedPaperIntake } from '../../services/paperIntakeService';
import type { ClientRecord } from '../../types';
import { representativeIsEmpty, reviewLabels, unknownBoxes, checkboxPrefix, detainedSummary, type CheckboxStates, type CheckboxState } from './paperReviewState';

const titles: Record<PaperSection, string> = {
  applicant_personal_circumstances: 'Part II — Impormasyon Ukol sa Aplikante',
  representative_personal_circumstances: 'Part II-A — Impormasyon Ukol sa Representative',
};
const sectionOrder = Object.keys(titles) as PaperSection[];
function message(error: unknown) {
  const detail = error instanceof AxiosError ? error.response?.data?.detail : undefined;
  return typeof detail === 'string' ? detail : error instanceof Error ? error.message : 'Unable to process intake.';
}

export function PaperIntakeReview({ onSaved, saved, clientId, onDirtyChange }: {
  onSaved?: (client: ClientRecord) => void; saved?: SavedPaperIntake; clientId?: string; onDirtyChange?: (dirty: boolean) => void;
}) {
  const confirm = useConfirmation();
  const [dirty, setDirty] = useState(false);
  const [activeField, setActiveField] = useState<{ path: string; label: string }>();
  const [fieldEvidence, setFieldEvidence] = useState<Record<string, FieldEvidence>>(saved?.candidate_snapshot?.diagnostics.field_evidence ?? {});
  const [mobilePane, setMobilePane] = useState<'scan' | 'fields'>('fields');
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [pageUrl, setPageUrl] = useState('');
  const [pageError, setPageError] = useState('');
  const fieldsRef = useRef<HTMLDivElement>(null);
  const rawEvidence = activeField ? fieldEvidence[activeField.path] : undefined;
  const activeEvidence = rawEvidence && Array.isArray(rawEvidence.bbox) && rawEvidence.bbox.length === 4 && rawEvidence.bbox.every(Number.isFinite) && Number.isInteger(rawEvidence.page) && rawEvidence.page > 0 ? rawEvidence : undefined;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  async function mayReplace() {
    return !dirty || await confirm({ title: 'Discard unsaved corrections?', message: 'The current draft and corrections will be replaced. The original scan is retained.', confirmLabel: 'Discard draft' });
  }
  const readOnly = !!saved && !onSaved;
  const [checkboxStates, setCheckboxStates] = useState<CheckboxStates | undefined>(saved?.checkbox_states ?? undefined);
  const [sourceDraftId, setSourceDraftId] = useState<string | undefined>(saved?.source_draft_id ?? undefined);
  const [candidateSections, setCandidateSections] = useState<PaperSections | undefined>(saved?.candidate_snapshot?.sections);
  const [schema, setSchema] = useState<PaperSchema>();
  const [schemaError, setSchemaError] = useState('');
  const [sections, setSections] = useState<PaperSections | undefined>(saved?.sections);
  const [documentId, setDocumentId] = useState<number | undefined>(saved?.document_id);
  const [preview, setPreview] = useState<Blob>();
  const [previewUrl, setPreviewUrl] = useState('');
  const [scanError, setScanError] = useState('');
  const [retryFile, setRetryFile] = useState<File>();
  const [ocrFailure, setOcrFailure] = useState('');
  const [representativeExpanded, setRepresentativeExpanded] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [camera, setCamera] = useState(false);
  const [mode, setMode] = useState<'auto' | 'offline' | 'cloud'>('auto');
  const errorRef = useRef<HTMLDivElement>(null);
  const representativeNameRef = useRef<HTMLInputElement>(null);
  const extraction = useExtractionRequest();
  const busy = saving || extraction.isExtracting;

  useEffect(() => {
    const controller = new AbortController();
    getPaperSchema(controller.signal).then(setSchema).catch(error => {
      if (!controller.signal.aborted) setSchemaError(message(error));
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!saved) return;
    const controller = new AbortController();
    getPaperScan(saved.document_id, controller.signal).then(setPreview).catch(error => {
      if (!controller.signal.aborted) setScanError(`Could not load the original scan: ${message(error)}`);
    });
    return () => controller.abort();
  }, [saved]);
  useEffect(() => {
    if (!preview) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(preview);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);
  useEffect(() => { if (saveError) errorRef.current?.focus(); }, [saveError]);

  useEffect(() => {
    if (activeEvidence) setPageNumber(activeEvidence.page);
  }, [activeEvidence]);
  useEffect(() => {
    setPageUrl(''); setPageError('');
    if (preview?.type !== 'application/pdf' || !documentId) return;
    const controller = new AbortController(); let url = '';
    getPaperPage(documentId, pageNumber, controller.signal).then(({ blob, pageCount: count }) => {
      if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setPageUrl(url); setPageCount(count); }
    }).catch(() => { if (!controller.signal.aborted) setPageError('Page preview unavailable. Open the full original to inspect this page.'); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [preview, documentId, pageNumber]);

  function applyExtraction(result: PaperExtraction) {
    setDirty(true); setMobilePane('fields');
    setFieldEvidence(result.extracted_data.diagnostics.field_evidence ?? {});
    setPageCount(result.extracted_data.diagnostics.page_count ?? 1); setPageNumber(1);
    setSourceDraftId(result.source_draft_id);
    setCandidateSections(result.extracted_data.sections);
    setCheckboxStates(result.extracted_data.checkbox_states ?? unknownBoxes());
    setSections(result.extracted_data.sections); setDocumentId(result.document_id);
    setOcrFailure(['OFFLINE_OCR_FAILED', 'OFFLINE_OCR_EMPTY'].includes(result.extracted_data.extraction_mode)
      ? 'No text could be read from this scan. Enter the details from the paper or try another scan.' : '');
    setRepresentativeExpanded(false); setSaveError(''); setSuccess('');
  }
  async function scan(file: File) {
    if (!await mayReplace()) return;
    const request = extraction.startExtraction('Reading Parts II and II-A…');
    if (!request) return;
    setCamera(false); setDirty(true); setRetryFile(file);
    setSections(undefined); setDocumentId(undefined); setPreview(file); setScanError(''); setOcrFailure(''); setSaveError(''); setSuccess('');
    try {
      const result = await extractPaper(file, request.controller.signal, mode);
      if (extraction.isCurrentExtraction(request)) { applyExtraction(result); setRetryFile(undefined); }
    } catch (error) {
      if (extraction.isCurrentExtraction(request)) {
        setDirty(false);
        setScanError(`Could not extract the sheet: ${message(error)}. Retry OCR or choose another scan.`);
      }
    } finally { toast.dismiss(request.toastId); extraction.finishExtraction(request); }
  }
  async function reread() {
    if (!documentId || !await mayReplace()) return;
    const request = extraction.startExtraction('Re-reading the original scan…');
    if (!request) return;
    try {
      const result = await rereadPaper(documentId, request.controller.signal, mode);
      if (extraction.isCurrentExtraction(request)) applyExtraction(result);
    } catch (error) {
      if (extraction.isCurrentExtraction(request)) toast.error(message(error));
    } finally { toast.dismiss(request.toastId); extraction.finishExtraction(request); }
  }
  async function save() {
    if (!sections || !documentId || !schema || busy) return;
    setSaving(true); setSaveError(''); setSuccess('');
    try {
      const client = await savePaper(documentId, sections, clientId, checkboxStates, sourceDraftId);
      setDirty(false);
      setSuccess('Reviewed record saved successfully.');
      toast.success('Reviewed record saved successfully.', { position: 'top-center', duration: 3000 });
      onSaved?.(client);
    } catch (error) {
      setSaveError(`${message(error)} Your edits are kept. Check the connection and select Save reviewed record to retry.`);
    } finally { setSaving(false); }
  }
  function field(section: PaperSection, key: string, label: string) {
    const path = `${section}.${key}`;
    const value = sections?.[section][key] ?? '';
    const checkbox = key === 'detained';
    const original = candidateSections?.[section][key];
    const change = (next: string) => {
      setDirty(true); setSaveError(''); setSuccess('');
      if (section === 'representative_personal_circumstances') setRepresentativeExpanded(true);
      setSections(current => current && ({ ...current, [section]: { ...current[section], [key]: next } }));
    };
    return <div key={key} className="min-w-0" onFocus={event => setActiveField({ path: (event.target as HTMLElement).dataset.sourcePath || path, label: `${section === 'applicant_personal_circumstances' ? 'Part II' : 'Part II-A'} — ${label}` })}>
      <button type="button" onClick={() => { setActiveField({ path, label: `${section === 'applicant_personal_circumstances' ? 'Part II' : 'Part II-A'} — ${label}` }); setMobilePane('scan'); requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label^="Scan viewport"]')?.focus()); }} className="float-right rounded px-2 text-xs font-medium text-purple-800 underline lg:hidden" aria-label={`View scan for ${label}`}>View scan</button>
      <label className="block text-sm font-medium text-slate-700" htmlFor={checkbox ? 'paper-detained-oo' : `paper-${section}-${key}`}>{label}:</label>
      {!checkbox && original !== undefined && original !== value && <p className="mt-1 text-sm text-slate-600">Original extracted reading: {original || 'No text recognized'}</p>}
      {checkbox ? <div className="mt-2 space-y-2">
        <div className="grid grid-cols-2 gap-3">{(['oo', 'hindi'] as const).map(option => {
          const optionPath = checkboxPrefix + option, state = checkboxStates?.[optionPath] ?? 'unknown';
          const optionLabel = option === 'oo' ? 'Oo' : 'Hindi';
          return <label key={option} className="block text-sm font-medium">{optionLabel} box
            {readOnly ? <span className="mt-2 block min-h-11 rounded border bg-slate-50 px-3 py-2">{state === 'checked' ? 'Checked' : state === 'unchecked' ? 'Unchecked' : 'Unknown'}</span> :
            <select id={`paper-detained-${option}`} data-source-path={optionPath} aria-label={`${optionLabel} box`} value={state} disabled={busy}
              className="mt-2 min-h-11 w-full rounded border border-slate-300 bg-white px-3 py-2 text-base"
              onChange={event => {
                const next = { ...(checkboxStates ?? unknownBoxes()), [optionPath]: event.target.value as CheckboxState };
                setCheckboxStates(next); change(detainedSummary(next));
              }}>
              <option value="unknown">Unknown — unclear / not reviewed</option><option value="checked">Checked — visible mark</option><option value="unchecked">Unchecked — visibly empty</option>
            </select>}
          </label>;
        })}</div>
      </div> : <input id={`paper-${section}-${key}`} type="text" value={value} readOnly={readOnly} disabled={busy}
        ref={section === 'representative_personal_circumstances' && key === 'name' ? representativeNameRef : undefined}
        autoComplete="off" onChange={event => change(event.target.value)}
        className="mt-2 min-h-11 w-full rounded border border-slate-300 bg-white px-3 py-2 text-base disabled:bg-slate-100" />}
    </div>;
  }
  return <div className="flex h-full min-h-0 flex-col [&_button]:min-h-11 [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[#704389] [&_input:focus-visible]:outline [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-[#704389] [&_select:focus-visible]:outline [&_select:focus-visible]:outline-2 [&_select:focus-visible]:outline-[#704389] [&_a:focus-visible]:outline [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-[#704389]">
    {!saved && <details key={sections ? 'review-settings' : 'scan-setup'} open={!sections}
      className={sections ? 'max-h-[36dvh] shrink-0 overflow-y-auto border-b px-4 py-2' : 'min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8'}>
      <summary className={sections ? 'cursor-pointer py-2 text-sm font-semibold' : 'hidden'} tabIndex={sections ? 0 : -1} aria-hidden={!sections}>Replace scan or change OCR settings</summary>
      <div className={`space-y-5 ${sections ? 'pb-3' : 'mx-auto w-full max-w-5xl pb-8'}`}>
      {!sections && <div className="space-y-2"><h3 className="text-xl font-semibold text-slate-900">Scan or upload the completed PAO sheet</h3><p className="max-w-3xl text-sm leading-6 text-slate-600">Upload the sheet or capture a clear photo. JurisGuard reads Parts II and II-A, then you compare the results with the complete original scan before saving.</p></div>}
      <div className="flex flex-wrap items-center gap-4"><label className="block min-w-0 rounded border border-purple-300 bg-purple-50 px-4 py-3 text-sm font-semibold">Upload PAO sheet
        <input type="file" accept=".jpg,.jpeg,.jfif,.png,.webp,.pdf" disabled={busy || !schema} className="mt-2 block max-w-full text-base"
          onChange={event => { const file = event.target.files?.[0]; if (file) void scan(file); event.target.value = ''; }} /></label>
        <button type="button" disabled={busy || !schema} onClick={() => setCamera(current => !current)} className="rounded border border-slate-300 px-5 py-3 text-sm font-semibold">{camera ? 'Hide camera' : 'Scan with camera'}</button></div>
      <label className="block text-sm font-medium">OCR engine <select value={mode} disabled={busy} onChange={event => setMode(event.target.value as typeof mode)} className="ml-3 min-h-11 rounded border border-slate-300 px-3 py-2"><option value="auto">Auto</option><option value="offline">Offline PaddleOCR</option><option value="cloud">Cloud Vision</option></select></label>
      {camera && <CameraCapture isExtracting={busy} nextStepLabel="Extract Parts II and II-A" onUsePhoto={file => { void scan(file); }} />}
    </div></details>}
    {extraction.isExtracting && <div role="status" className="flex flex-wrap items-center gap-4 rounded bg-blue-50 p-4 text-sm">Reading the scan… {extraction.elapsedSeconds}s<button type="button" onClick={() => { extraction.cancelExtraction(); setDirty(false); setScanError('OCR stopped. Retry the same scan or choose another.'); }} className="rounded border border-blue-300 bg-white px-4 py-2 font-semibold">Cancel extraction</button></div>}
    {schemaError && <p role="alert" className="text-rose-700">{schemaError}</p>}
    {scanError && <div role="alert" className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-rose-50 px-4 py-2 text-sm text-rose-800"><span>{scanError}</span>{retryFile && !busy && <button type="button" onClick={() => void scan(retryFile)} className="rounded border border-rose-300 bg-white px-3 py-2 font-semibold">Retry OCR</button>}</div>}
    {ocrFailure && <p role="alert" className="shrink-0 border-b bg-rose-50 px-4 py-2 text-sm text-rose-800">{ocrFailure}</p>}
    {sections && <p className="shrink-0 border-b bg-slate-50 px-4 py-2 text-sm text-slate-700">Compare every entry, including the Oo/Hindi boxes, with the complete original scan. Correct the fields before saving.</p>}
    {sections && <div className="flex shrink-0 gap-2 border-b px-4 lg:hidden" role="group" aria-label="Review view">
      {(['scan', 'fields'] as const).map(pane => <button type="button" key={pane} aria-pressed={mobilePane === pane} aria-controls={`review-${pane}`} onClick={() => setMobilePane(pane)} className={`px-4 py-2 font-medium ${mobilePane === pane ? 'border-b-2 border-purple-700 text-purple-900' : 'text-slate-600'}`}>{pane === 'scan' ? 'Original scan' : 'Extracted fields'}</button>)}
    </div>}
    {sections && <div className="grid min-h-0 flex-1 lg:grid-cols-[48%_52%]">
      <div id="review-scan" className={`${mobilePane === 'scan' ? 'flex' : 'hidden'} min-h-0 flex-col border-r lg:flex`}>
        {previewUrl ? <>
          {preview?.type === 'application/pdf' && <div className="flex shrink-0 items-center gap-3 px-3 py-1"><button type="button" disabled={pageNumber <= 1} onClick={() => setPageNumber(p => p - 1)}>Previous page</button><span>Page {pageNumber} of {pageCount}</span><button type="button" disabled={pageNumber >= pageCount} onClick={() => setPageNumber(p => p + 1)}>Next page</button></div>}
          {pageError && <p role="alert" className="px-3 text-sm text-amber-900">{pageError}</p>}
          <ScanViewer url={pageUrl || previewUrl} pdf={preview?.type === 'application/pdf' && !pageUrl} evidence={preview?.type !== 'application/pdf' || pageUrl ? (activeEvidence?.page === pageNumber ? activeEvidence : undefined) : undefined} label={activeField?.label} />
        </> : <p className="p-8 text-slate-500">The full scan will appear here.</p>}
      </div>
      <div id="review-fields" className={`${mobilePane === 'fields' ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>
        <nav aria-label="Interview sheet sections" className="flex shrink-0 flex-wrap gap-2 border-b bg-white px-4 py-2">
          {sectionOrder.map((section, index) => <button type="button" key={section} className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={() => { const node = fieldsRef.current?.querySelector<HTMLElement>(`[data-section="${section}"]`); node?.scrollIntoView({ block: 'start' }); node?.focus({ preventScroll: true }); }}>{index === 0 ? 'Part II · Applicant' : 'Part II-A · Representative'}</button>)}
        </nav>
        <div ref={fieldsRef} aria-label="Extracted fields" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable]">
      {sections && schema && <div className="space-y-6 pb-4">{sectionOrder.map(section => {
        const blankRepresentative = section === 'representative_personal_circumstances' && representativeIsEmpty(sections);
        return <fieldset key={section} data-section={section} tabIndex={-1} className="min-w-0 scroll-mt-2 border-b border-slate-200 pb-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]">
          <legend className="px-1 font-semibold">{titles[section]}</legend>
          {blankRepresentative && <p className="my-3 text-sm text-slate-700">No representative details provided</p>}
          {blankRepresentative && !representativeExpanded ? (!readOnly && <button type="button" onClick={() => { setRepresentativeExpanded(true); requestAnimationFrame(() => representativeNameRef.current?.focus()); }} className="rounded border border-slate-300 bg-white px-4 py-3 text-sm font-semibold">Add representative details</button>) :
            <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
              <div className="sm:col-span-2">{field(section, ...schema[section][0])}</div>
              <div className="grid gap-4 sm:col-span-2 sm:grid-cols-3">{schema[section].slice(1, 4).map(([key, label]) => field(section, key, label))}</div>
              {schema[section].slice(4).map(([key, label]) => field(section, key, label))}
            </div>}
        </fieldset>;
      })}</div>}
    {saved?.field_reviews && <details className="text-sm text-slate-600"><summary className="min-h-11 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]">Previously recorded field notes</summary>
      <p className="mb-2">These stored notes are retained. Editing the text does not change them.</p>
      {sectionOrder.flatMap(section => (schema?.[section] ?? []).map(([key, label]) => {
        const state = saved.field_reviews?.[`${section}.${key}`];
        return state ? <p key={`${section}.${key}`}>{section === 'applicant_personal_circumstances' ? 'Part II' : 'Part II-A'} — {label}: {reviewLabels[state]}</p> : null;
      }))}</details>}
    {!readOnly && documentId && <details className="text-sm text-slate-600"><summary className="min-h-11 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]">Re-read the original scan</summary><p className="mb-3">Replaces unsaved edits with a new draft. The original scan and saved record stay unchanged until you save.</p><button type="button" disabled={busy} onClick={() => void reread()} className="rounded border border-slate-300 px-5 py-3 font-semibold">Re-extract original scan</button></details>}
    </div></div></div>}
    {!readOnly && sections && <div className="shrink-0 space-y-2 border-t bg-white px-4 py-3">
      {saveError && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 focus:outline focus:outline-2 focus:outline-rose-700">{saveError}</div>}
      {success && <p role="status" className="rounded bg-emerald-50 p-3 font-medium text-emerald-800">{success}</p>}
      <div className="flex flex-wrap items-center justify-between gap-4"><p className="text-sm text-slate-600">Compare both sections with the scan before saving.</p>
        <button type="button" disabled={busy || !schema} onClick={() => void save()} className="rounded bg-[#704389] px-6 py-3 font-semibold text-white hover:bg-[#5f3675] disabled:opacity-50">{saving ? 'Saving reviewed record…' : 'Save reviewed record'}</button>
      </div>
    </div>}
  </div>;
}
