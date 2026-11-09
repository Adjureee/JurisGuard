import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { ScanViewer } from './ScanViewer';
import { isScanBox } from './scanGeometry';
import { useConfirmation } from '../../components/ConfirmationProvider';
import { PaperDocumentSetup, type IntakeStage } from './PaperDocumentSetup';
import { useExtractionRequest } from './useExtractionRequest';
import { extractPaper, getPaperScan, getPaperSchema, rereadPaper, savePaper, type PaperExtraction,
  getPaperPage, type FieldEvidence, type PaperSchema, type PaperSection, type PaperSections, type SavedPaperIntake } from '../../services/paperIntakeService';
import type { ClientRecord } from '../../types';
import { representativeIsEmpty, expandSexAbbreviation, reviewLabels, unknownBoxes, checkboxPrefix, detainedSummary, type CheckboxStates, type CheckboxState } from './paperReviewState';

const titles: Record<PaperSection, string> = {
  applicant_personal_circumstances: 'Part II — Impormasyon Ukol sa Aplikante',
  representative_personal_circumstances: 'Part II-A — Impormasyon Ukol sa Representative',
};
const sectionOrder = Object.keys(titles) as PaperSection[];
function message(error: unknown) {
  const detail = error instanceof AxiosError ? error.response?.data?.detail : undefined;
  return typeof detail === 'string' ? detail : error instanceof Error ? error.message : 'Unable to process intake.';
}

export function PaperIntakeReview({ onSaved, saved, clientId, onDirtyChange, onStageChange, onCancel, inputMethod = 'both', renderStageFrame }: {
  onSaved?: (client: ClientRecord) => void; saved?: SavedPaperIntake; clientId?: string; onDirtyChange?: (dirty: boolean) => void; onStageChange?: (stage: IntakeStage)=>void; onCancel?: () => void; inputMethod?: 'both'|'scan'|'upload'; renderStageFrame?: (stage: IntakeStage, content: ReactNode) => ReactNode;
}) {
  const confirm = useConfirmation();
  const [dirty, setDirty] = useState(false);
  const [activeField, setActiveField] = useState<{ path: string; label: string; selection: number }>();
  const [fieldEvidence, setFieldEvidence] = useState<Record<string, FieldEvidence>>(saved?.candidate_snapshot?.diagnostics.image_preparation?.selected_copy ? {} : saved?.candidate_snapshot?.diagnostics.field_evidence ?? {});
  const [fieldStates, setFieldStates] = useState<Record<string, string>>(saved?.candidate_snapshot?.diagnostics.field_states ?? {});
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>(saved?.candidate_snapshot?.diagnostics.warnings ?? []);
  const [unreadableFields, setUnreadableFields] = useState<string[]>(saved?.unreadable_fields ?? []);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [pageUrl, setPageUrl] = useState('');
  const [pageError, setPageError] = useState('');
  const fieldsRef = useRef<HTMLDivElement>(null);
  const rawEvidence = activeField ? fieldEvidence[activeField.path] : undefined;
  // New drafts explicitly separate answer pixels from full OCR source boxes.
  // Older label-containing boxes must not be presented as answer highlights.
  const highlightBox = rawEvidence && ('highlight_bbox' in rawEvidence ? rawEvidence.highlight_bbox
    : rawEvidence.source_text?.includes(':') && rawEvidence.location_kind !== 'label_answer_area' ? undefined : rawEvidence.bbox);
  const activeEvidence = useMemo(() => rawEvidence && isScanBox(highlightBox) ? { ...rawEvidence, bbox: highlightBox } : undefined, [rawEvidence, highlightBox]);
  const focusBox = activeEvidence?.bbox ?? rawEvidence?.bbox;
  const focusPage = rawEvidence && Number.isInteger(rawEvidence.page) && rawEvidence.page > 0 ? rawEvidence.page : undefined;
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
  const [schemaAttempt, setSchemaAttempt] = useState(0);
  const [sections, setSections] = useState<PaperSections | undefined>(saved?.sections);
  const [documentId, setDocumentId] = useState<number | undefined>(saved?.document_id);
  const [preview, setPreview] = useState<Blob>();
  const [previewUrl, setPreviewUrl] = useState('');
  const [scanError, setScanError] = useState('');
  const [retryFile, setRetryFile] = useState<File>();
  const [retryOriginal, setRetryOriginal] = useState<File>();
  const [ocrFailure, setOcrFailure] = useState('');
  const [representativeExpanded, setRepresentativeExpanded] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [setupStage, setSetupStage] = useState<IntakeStage>('select');
  const [mode, setMode] = useState<'auto' | 'offline' | 'cloud'>('auto');
  const errorRef = useRef<HTMLDivElement>(null);
  const representativeNameRef = useRef<HTMLInputElement>(null);
  const extraction = useExtractionRequest();
  const busy = saving || extraction.isExtracting;
  const stage = saving ? 'save' : sections ? 'review' : extraction.isExtracting ? 'extract' : setupStage;
  useEffect(()=>{onStageChange?.(stage);},[stage,onStageChange]);

  useEffect(() => {
    const controller = new AbortController();
    setSchemaError('');
    getPaperSchema(controller.signal).then(setSchema).catch(error => {
      if (!controller.signal.aborted) setSchemaError(error instanceof AxiosError && error.response?.status === 404
        ? 'The backend is missing the PAO intake service. Restart the updated backend, then retry. Your selected image is kept.'
        : `Could not load the intake fields: ${message(error)}. Check that the backend is running, then retry. Your selected image is kept.`);
    });
    return () => controller.abort();
  }, [schemaAttempt]);
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
    if (focusPage && isScanBox(focusBox)) setPageNumber(focusPage);
  }, [focusPage, focusBox, activeField?.selection]);
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
    setDirty(true);
    setActiveField(undefined);
    setFieldEvidence(result.extracted_data.diagnostics.image_preparation?.selected_copy ? {} : result.extracted_data.diagnostics.field_evidence ?? {});
    setFieldStates(result.extracted_data.diagnostics.field_states ?? {});
    setExtractionWarnings(result.extracted_data.diagnostics.warnings ?? []);
    setUnreadableFields([]);
    setPageCount(result.extracted_data.diagnostics.page_count ?? 1); setPageNumber(1);
    setSourceDraftId(result.source_draft_id);
    const extracted = result.extracted_data.sections;
    setCandidateSections(extracted);
    setCheckboxStates(result.extracted_data.checkbox_states ?? unknownBoxes());
    setSections({
      applicant_personal_circumstances: { ...extracted.applicant_personal_circumstances, sex: expandSexAbbreviation(extracted.applicant_personal_circumstances.sex) },
      representative_personal_circumstances: { ...extracted.representative_personal_circumstances, sex: expandSexAbbreviation(extracted.representative_personal_circumstances.sex) },
    });
    setDocumentId(result.document_id);
    setOcrFailure(['OFFLINE_OCR_FAILED', 'OFFLINE_OCR_EMPTY'].includes(result.extracted_data.extraction_mode)
      ? 'No text could be read from this scan. Enter the details from the paper or try another scan.' : '');
    setRepresentativeExpanded(false); setSaveError(''); setSuccess('');
  }
  async function scan(file: File, original?: File) {
    if (sections && !await mayReplace()) return;
    const request = extraction.startExtraction('Reading Parts II and II-A…');
    if (!request) return;
    setDirty(true); setRetryFile(file); setRetryOriginal(original);
    setSections(undefined); setDocumentId(undefined); setPreview(original ?? file); setScanError(''); setOcrFailure(''); setExtractionWarnings([]); setSaveError(''); setSuccess('');
    try {
      const result = await extractPaper(file, request.controller.signal, mode, original);
      if (extraction.isCurrentExtraction(request)) {
        applyExtraction(result);
        // Edited-image coordinates do not describe the retained original scan.
        if(original && original !== file) setFieldEvidence({});
        setRetryFile(undefined);setRetryOriginal(undefined);
      }
    } catch (error) {
      if (extraction.isCurrentExtraction(request)) {
        setDirty(true);
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
      const client = await savePaper(documentId, sections, clientId, checkboxStates, sourceDraftId, unreadableFields);
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
    const suggested = key === 'sex' && original !== undefined ? expandSexAbbreviation(original) : original;
    const change = (next: string) => {
      setDirty(true); setSaveError(''); setSuccess('');
      setUnreadableFields(current => current.filter(field => field !== path));
      if (section === 'representative_personal_circumstances') setRepresentativeExpanded(true);
      setSections(current => current && ({ ...current, [section]: { ...current[section], [key]: next } }));
    };
    const selectSource = (sourcePath = path) => setActiveField(previous => ({
      path: sourcePath,
      label: `${section === 'applicant_personal_circumstances' ? 'Part II' : 'Part II-A'} — ${label}`,
      selection: (previous?.selection ?? 0) + 1,
    }));
    return <div key={key} className="min-w-0"
      onFocus={event => selectSource((event.target as HTMLElement).dataset.sourcePath)}
      onClick={event => {
        const control = (event.target as HTMLElement).closest<HTMLElement>('input, select, label');
        if (control) selectSource(control.dataset.sourcePath);
      }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <label className="block text-xs font-semibold text-slate-700 sm:text-sm" htmlFor={checkbox ? 'paper-detained-oo' : `paper-${section}-${key}`}>{label}:</label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { selectSource(); document.getElementById('review-scan')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label^="Scan viewport"]')?.focus()); }} className="rounded px-1.5 py-0.5 text-xs font-medium text-[#704389] underline underline-offset-2 hover:text-[#542F69] lg:hidden" aria-label={`View scan for ${label}`}>View scan</button>
          {!checkbox && !readOnly && <button type="button" disabled={busy} aria-pressed={unreadableFields.includes(path)} onClick={() => {
            if (unreadableFields.includes(path)) { setUnreadableFields(current => current.filter(field => field !== path)); setDirty(true); return; }
            change(''); setUnreadableFields(current => [...current, path]);
          }} className="rounded px-1.5 py-0.5 text-xs font-medium text-[#704389] underline underline-offset-2 hover:text-[#542F69]">{unreadableFields.includes(path) ? 'Remove unreadable flag' : 'Mark unreadable'}</button>}
        </div>
      </div>
      {checkbox ? <div className="mt-1.5 space-y-1.5">
        <div className="grid grid-cols-2 gap-2.5">{(['oo', 'hindi'] as const).map(option => {
          const optionPath = checkboxPrefix + option, state = checkboxStates?.[optionPath] ?? 'unknown';
          const optionLabel = option === 'oo' ? 'Oo' : 'Hindi';
          return <label key={option} className="block text-xs font-medium text-slate-700">{optionLabel} box
            {readOnly ? <span className="mt-1 block h-9 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm">{state === 'checked' ? 'Checked' : state === 'unchecked' ? 'Unchecked' : 'Unknown'}</span> :
            <select id={`paper-detained-${option}`} data-source-path={optionPath} aria-label={`${optionLabel} box`} value={state} disabled={busy}
              className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
              onChange={event => {
                const next = { ...(checkboxStates ?? unknownBoxes()), [optionPath]: event.target.value as CheckboxState };
                setCheckboxStates(next); change(detainedSummary(next));
              }}>
              <option value="unknown">Unknown — unclear / not reviewed</option><option value="checked">Checked — visible mark</option><option value="unchecked">Unchecked — visibly empty</option>
            </select>}
          </label>;
        })}</div>
        {checkboxStates && Object.values(checkboxStates).every(state => state === 'checked') && <p role="status" className="text-xs text-amber-800">Both boxes are marked. Confirm the selections against the scan; no single answer is assumed.</p>}
        {checkboxStates && Object.values(checkboxStates).some(state => state === 'unknown') && !detainedSummary(checkboxStates) && <p className="text-xs text-amber-800">No single visible selection was identified. Inspect both boxes in the scan; unclear boxes remain unknown.</p>}
        {checkboxStates && Object.values(checkboxStates).some(state => state === 'unknown') && !!detainedSummary(checkboxStates) && <p role="status" className="text-xs text-slate-600">{detainedSummary(checkboxStates)} is selected from its visible mark. The other box remains unknown unless you verify it as visibly empty.</p>}
      </div> : <input id={`paper-${section}-${key}`} type="text" value={value} readOnly={readOnly} disabled={busy}
        ref={section === 'representative_personal_circumstances' && key === 'name' ? representativeNameRef : undefined}
        autoComplete="off" onChange={event => change(event.target.value)}
        className="mt-1 h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 disabled:bg-slate-100" />}
      {!checkbox && original !== undefined && original !== value && <p className="mt-1 text-xs text-slate-600">Original extracted reading: {original || 'No text recognized'}</p>}
      {!checkbox && suggested === value && ['ocr_failed', 'uncertain'].includes(fieldStates[path]) && <p className="mt-1 text-xs text-amber-800">{value ? 'Check this reading against the scan.' : 'No reliable reading. Check the scan for a blank or unreadable entry.'}</p>}
      {!checkbox && unreadableFields.includes(path) && <p className="mt-1 text-xs text-amber-800">Marked unreadable after review. The value will remain empty.</p>}
    </div>;
  }
  const content = <div className="flex h-full min-h-0 flex-col [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[#704389] [&_input:focus-visible]:outline [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-[#704389] [&_select:focus-visible]:outline [&_select:focus-visible]:outline-2 [&_select:focus-visible]:outline-[#704389] [&_a:focus-visible]:outline [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-[#704389]">
    {!saved && <details key={sections ? 'review-settings' : 'scan-setup'} open={!sections}
      className={sections ? 'max-h-[34dvh] shrink-0 overflow-y-auto border-b border-slate-200 bg-slate-50/75 px-4 py-1 sm:px-5' : 'min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 [&_button]:min-h-11'}>
      <summary className={sections ? 'cursor-pointer select-none py-1 text-xs font-semibold text-[#704389] hover:text-[#542F69]' : 'hidden'} tabIndex={sections ? 0 : -1} aria-hidden={!sections}>Replace scan or change OCR settings</summary>
      <div className={`space-y-4 ${sections ? 'pt-2 pb-3' : 'mx-auto w-full max-w-5xl pb-8'}`}>
      <PaperDocumentSetup inputMethod={inputMethod} disabled={busy} schemaReady={!!schema} mode={mode} onModeChange={setMode} onExtract={(file,original)=>void scan(file,original)} onPending={pending=>{if(pending||!sections)setDirty(pending);}} onStageChange={setSetupStage}/>
    </div></details>}
    {extraction.isExtracting && <div role="status" className="shrink-0 space-y-2.5 border-b bg-[#FAF7FC] px-4 py-3 text-xs text-[#542F69] sm:px-5 sm:text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">Processing captured document</p><p className="mt-0.5">Extracting Parts II and II-A and preparing the information for review… {extraction.elapsedSeconds}s</p></div>
        <button type="button" onClick={() => { extraction.cancelExtraction(); setDirty(true); setScanError('OCR stopped. Retry the same scan or choose another.'); }} className="h-9 rounded-md border border-[#704389]/40 bg-white px-3 py-1.5 text-xs font-semibold text-[#704389] sm:text-sm">Cancel extraction</button>
      </div>
      <div role="progressbar" aria-label="Document extraction progress" aria-valuetext="Processing document; progress is indeterminate" className="h-1.5 overflow-hidden rounded-full bg-[#E5D9EB]"><div className="pao-progress-indeterminate h-full w-1/3 rounded-full bg-[#704389]" /></div>
    </div>}
    {schemaError && <div role="alert" className="flex flex-wrap items-center gap-3 rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 sm:text-sm"><p>{schemaError}</p><button type="button" onClick={()=>setSchemaAttempt(value=>value+1)} className="h-9 rounded border border-rose-300 bg-white px-3 py-1.5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Retry loading intake fields</button></div>}
    {scanError && <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-rose-200 bg-rose-50 px-4 py-1.5 text-xs text-rose-800 sm:px-5"><span>{scanError}</span>{retryFile && !busy && <button type="button" onClick={() => void scan(retryFile, retryOriginal)} className="h-7 rounded border border-rose-300 bg-white px-2.5 py-0.5 text-xs font-semibold">Retry OCR</button>}</div>}
    {!sections && ocrFailure && <p role="alert" className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-1.5 text-xs text-rose-800 sm:px-5">{ocrFailure}</p>}
    {sections && <div className={`shrink-0 border-b px-4 py-1.5 text-xs sm:px-5 ${ocrFailure ? 'border-rose-200 bg-rose-50/90 text-rose-900' : extractionWarnings.length > 0 ? 'border-amber-200 bg-amber-50/80 text-slate-800' : 'border-slate-200 bg-slate-50/90 text-slate-700'}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
          {ocrFailure && <p role="alert" className="font-semibold text-rose-800">{ocrFailure}</p>}
          <p className="text-slate-700">Compare every entry, including the Oo/Hindi boxes, with the complete original scan. Correct the fields before saving.</p>
        </div>
        {extractionWarnings.length > 0 && (
          <details className="group text-xs">
            <summary className="cursor-pointer select-none font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950">
              OCR diagnostic notes ({extractionWarnings.length})
            </summary>
            <div role="status" className="mt-1.5 max-h-24 space-y-1 overflow-y-auto rounded border border-amber-200/80 bg-white/90 px-2.5 py-1.5 text-xs text-amber-950">
              {extractionWarnings.map((warning, idx) => <p key={idx}>{warning}</p>)}
            </div>
          </details>
        )}
      </div>
    </div>}
    {sections && <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(440px,48%)_minmax(480px,52%)] lg:overflow-hidden">
      <div id="review-scan" className="flex h-[380px] min-h-[320px] shrink-0 flex-col border-b border-slate-200 lg:h-full lg:min-h-0 lg:border-b-0 lg:border-r">
        {previewUrl ? <>
          {preview?.type === 'application/pdf' && <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-1 text-xs"><button type="button" className="h-7 rounded border border-slate-300 px-2 font-medium disabled:opacity-40" disabled={pageNumber <= 1} onClick={() => setPageNumber(p => p - 1)}>Previous page</button><span>Page {pageNumber} of {pageCount}</span><button type="button" className="h-7 rounded border border-slate-300 px-2 font-medium disabled:opacity-40" disabled={pageNumber >= pageCount} onClick={() => setPageNumber(p => p + 1)}>Next page</button></div>}
          {pageError && <p role="alert" className="px-3 py-1 text-xs text-amber-900">{pageError}</p>}
          <ScanViewer
            url={pageUrl || previewUrl}
            pdf={preview?.type === 'application/pdf' && !pageUrl}
            evidence={focusPage === pageNumber && (preview?.type !== 'application/pdf' || pageUrl) ? activeEvidence : undefined}
            focusBox={focusPage === pageNumber && isScanBox(focusBox) ? focusBox : undefined}
            focusSelection={activeField?.selection}
            label={activeField?.label}
          />
        </> : <p className="p-8 text-slate-500">The full scan will appear here.</p>}
      </div>
      <div id="review-fields" className="flex min-h-0 flex-1 flex-col bg-slate-50/50 lg:h-full">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-[#FAF7FC] px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#542F69]">Extracted Details</span>
          <nav aria-label="Interview sheet sections" className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200/90 bg-white p-0.5 shadow-2xs">
            {sectionOrder.map((section, index) => <button type="button" key={section} className="h-7 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-[#FAF7FC] hover:text-[#704389]" onClick={() => { const node = fieldsRef.current?.querySelector<HTMLElement>(`[data-section="${section}"]`); node?.scrollIntoView({ block: 'start' }); node?.focus({ preventScroll: true }); }}>{index === 0 ? 'Part II · Applicant' : 'Part II-A · Representative'}</button>)}
          </nav>
        </div>
        <div ref={fieldsRef} aria-label="Extracted fields" className="min-h-0 flex-1 p-3 sm:p-4 [scrollbar-gutter:stable] lg:overflow-y-auto lg:overscroll-contain">
      {sections && schema && <div className="space-y-4 pb-3">{sectionOrder.map(section => {
        const blankRepresentative = section === 'representative_personal_circumstances' && representativeIsEmpty(sections);
        return <fieldset key={section} data-section={section} tabIndex={-1} className="min-w-0 scroll-mt-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]">
          <legend className="px-1 text-sm font-semibold text-slate-800">{titles[section]}</legend>
          {blankRepresentative && <p className="my-2 text-xs text-slate-600 sm:text-sm">{saved ? 'No representative details provided' : 'No representative text was extracted. Check Part II-A in the scan before leaving it blank.'}</p>}
          {blankRepresentative && !representativeExpanded ? (!readOnly && <button type="button" onClick={() => { setRepresentativeExpanded(true); requestAnimationFrame(() => representativeNameRef.current?.focus()); }} className="mt-1 inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Review representative fields</button>) :
            <div className="mt-2 grid gap-x-4 gap-y-3 sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2">{field(section, ...schema[section][0])}</div>
              <div className="grid min-w-0 gap-3 sm:col-span-2 sm:grid-cols-3">{schema[section].slice(1, 4).map(([key, label]) => field(section, key, label))}</div>
              {schema[section].slice(4).map(([key, label]) => field(section, key, label))}
            </div>}
        </fieldset>;
      })}</div>}
    {saved?.field_reviews && <details className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"><summary className="cursor-pointer py-0.5 font-medium text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]">Previously recorded field notes</summary>
      <p className="mt-1.5 mb-1">These stored notes are retained. Editing the text does not change them.</p>
      {sectionOrder.flatMap(section => (schema?.[section] ?? []).map(([key, label]) => {
        const state = saved.field_reviews?.[`${section}.${key}`];
        return state ? <p key={`${section}.${key}`}>{section === 'applicant_personal_circumstances' ? 'Part II' : 'Part II-A'} — {label}: {reviewLabels[state]}</p> : null;
      }))}</details>}
    {!readOnly && documentId && <details className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"><summary className="cursor-pointer py-0.5 font-medium text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#704389]">Re-read the original scan</summary><p className="mt-1.5 mb-2">Replaces unsaved edits with a new draft. The original scan and saved record stay unchanged until you save.</p><button type="button" disabled={busy} onClick={() => void reread()} className="h-8 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Re-extract original scan</button></details>}
    </div></div></div>}
    {!readOnly && !sections && onCancel && <div className="flex shrink-0 items-center justify-end border-t border-slate-200 bg-[#F8FAFC] px-4 py-3 sm:px-5">
      <button type="button" onClick={onCancel} className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50">Cancel</button>
    </div>}
    {!readOnly && sections && <div className="shrink-0 space-y-1.5 border-t border-slate-200 bg-white px-4 py-2.5 sm:px-5">
      {saveError && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 focus:outline focus:outline-2 focus:outline-rose-700 sm:text-sm">{saveError}</div>}
      {success && <p role="status" className="rounded bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 sm:text-sm">{success}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-600 sm:text-sm">Compare both sections with the scan before saving.</p>
        <div className="flex flex-wrap items-center gap-2">
          {onCancel && <button type="button" disabled={saving} onClick={onCancel} className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-50">Cancel</button>}
          <button type="button" disabled={busy || !schema} onClick={() => void save()} className="inline-flex h-9 items-center justify-center rounded-lg bg-[#704389] px-4 py-1.5 text-sm font-semibold text-white shadow-xs transition hover:bg-[#5f3675] disabled:opacity-50">{saving ? 'Saving reviewed record…' : 'Save reviewed record'}</button>
        </div>
      </div>
    </div>}
  </div>;
  return renderStageFrame ? <>{renderStageFrame(stage, content)}</> : content;
}
