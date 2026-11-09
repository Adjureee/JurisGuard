import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { ArrowRight, Camera, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import '../../features/documentExtraction/intake-modal.css';
import type { CaseType, ClientRecord } from '../../types';
import { PaperIntakeReview } from '../../features/documentExtraction/PaperIntakeReview';
import type { IntakeStage } from '../../features/documentExtraction/PaperDocumentSetup';
import { useCriminalCasesStore } from '../../features/criminalCases/criminalCasesStore';
import { createCaseRecord, listClientRecords } from '../../services/recordService';
import { CaseWorkflow } from './CaseWorkflow';
import { useConfirmation } from '../ConfirmationProvider';
import ModalPortal from './ModalPortal';

const UPLOAD_STAGES = ['select', 'extract', 'review', 'save'] as const;
const UPLOAD_STAGE_LABELS = ['Select document', 'Extract', 'Review details', 'Save'] as const;

function UploadStageSteps({ stage }: { stage: IntakeStage }) {
  const activeIndex = UPLOAD_STAGES.indexOf(stage as typeof UPLOAD_STAGES[number]);
  return (
    <ol aria-label="Document intake stages" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-slate-50/90 px-4 py-1.5 text-xs sm:px-5">
      {UPLOAD_STAGE_LABELS.map((label, index) => (
        <li
          key={label}
          aria-current={activeIndex === index ? 'step' : undefined}
          className={`flex items-center gap-1.5 ${activeIndex === index ? 'font-semibold text-[#704389]' : index < activeIndex ? 'font-medium text-slate-700' : 'text-slate-500'}`}
        >
          <span>{label}</span>
          {index < UPLOAD_STAGE_LABELS.length - 1 && <ArrowRight size={11} className="text-slate-400" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function IntakeModalFrame({ title, description, icon, dialogRef, onClose, hideHeaderClose = false, children, stage, modalKind, surfaceClassName }: {
  title: string;
  description: string;
  icon: ReactNode;
  dialogRef: Ref<HTMLDivElement>;
  onClose: () => void;
  hideHeaderClose?: boolean;
  children: ReactNode;
  stage?: IntakeStage;
  modalKind?: 'upload-selection' | 'upload-review';
  surfaceClassName?: string;
}) {
  return <ModalPortal><div ref={dialogRef} data-intake-stage={stage} data-intake-modal={modalKind} className="jurisguard-modal-overlay intake-modal bg-black/60 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className={`intake-session-surface flex h-[92vh] max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl ${surfaceClassName ?? 'max-w-6xl'}`}>
      <header className="flex shrink-0 items-center justify-between gap-3 bg-[#704389] px-4 py-2.5 text-white sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon}
          <div className="min-w-0"><h2 className="text-base font-semibold leading-tight sm:text-lg">{title}</h2><p className="mt-0.5 truncate text-xs text-white/85">{description}</p></div>
        </div>
        {!hideHeaderClose && <button type="button" onClick={onClose} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-white/70 bg-white/10 px-3 py-1 text-xs font-semibold text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:text-sm"><X size={15} aria-hidden="true" />Close</button>}
      </header>
      {children}
    </div>
  </div></ModalPortal>;
}

function UploadDocumentSelectionModal({ stage, dialogRef, onClose, children }: {
  stage: IntakeStage;
  dialogRef: Ref<HTMLDivElement>;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <IntakeModalFrame
      stage={stage}
      modalKind="upload-selection"
      surfaceClassName="max-w-[880px]"
      dialogRef={dialogRef}
      icon={<Upload className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />}
      title="Upload PAO Sheet"
      description="Choose the complete paper document and review the extracted details."
      onClose={onClose}
    >
      <UploadStageSteps stage={stage} />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </IntakeModalFrame>
  );
}

function UploadReviewModal({ stage, dialogRef, onClose, children }: {
  stage: IntakeStage;
  dialogRef: Ref<HTMLDivElement>;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <IntakeModalFrame
      stage={stage}
      modalKind="upload-review"
      surfaceClassName="w-[min(96vw,1680px)] max-w-[1680px]"
      dialogRef={dialogRef}
      icon={<Upload className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />}
      title="Upload PAO Sheet"
      description="Compare the original document with the extracted details and review every entry before saving."
      onClose={onClose}
      hideHeaderClose
    >
      <UploadStageSteps stage={stage} />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </IntakeModalFrame>
  );
}

export function ScanIntakeModal({ onClose, caseType = 'Criminal' }: { onClose: () => void; caseType?: CaseType }) {
  const confirm = useConfirmation();
  const [dirty, setDirty] = useState(false);
  const [stage, setStage] = useState<IntakeStage>('select');
  const [client, setClient] = useState<ClientRecord>();
  const [addingAnother, setAddingAnother] = useState(0);
  const [viewingCase, setViewingCase] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const upsertClient = useCriminalCasesStore(state => state.upsertClient);
  const upsertCase = useCriminalCasesStore(state => state.upsertCase);
  const setStoreClients = useCriminalCasesStore(state => state.setClients);

  const close = useCallback(async () => {
    if (dirty && !await confirm({ title: 'Discard unsaved entry?', message: 'Your selected scan or corrections have not been saved. Cancel to keep working.', confirmLabel: 'Discard entry' })) return;
    setDirty(false);
    onClose();
  }, [confirm, dirty, onClose]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (!dialog.current?.contains(document.activeElement)) return;
      if (event.key === 'Escape') { event.preventDefault(); void close(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')).filter(node => node.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [close]);

  return <>
    {!client && <IntakeModalFrame stage={stage} dialogRef={dialog} icon={<Camera className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />} title="Scan PAO Sheet" description="Capture the complete paper document and review the extracted details." onClose={() => void close()}>
      <ol aria-label="Document intake stages" className="flex shrink-0 flex-wrap gap-x-4 gap-y-2 border-b bg-slate-50 px-5 py-3 text-xs sm:text-sm">{(['Select document', 'Review crop', 'Extract', 'Review details', 'Save'] as const).map((label, index) => <li key={label} aria-current={['select', 'crop', 'extract', 'review', 'save'].indexOf(stage) === index ? 'step' : undefined} className={`flex items-center gap-2 ${['select', 'crop', 'extract', 'review', 'save'].indexOf(stage) === index ? 'font-semibold text-[#704389]' : 'text-slate-600'}`}><span>{label}</span>{index < 4 && <ArrowRight size={12} aria-hidden="true" />}</li>)}</ol>
      <div className="min-h-0 flex-1 overflow-hidden"><PaperIntakeReview key={addingAnother} inputMethod="scan" onStageChange={setStage} onDirtyChange={setDirty} onSaved={saved => { setDirty(false); upsertClient(saved); setClient(saved); }} /></div>
    </IntakeModalFrame>}
    {client && !viewingCase && <IntakeModalFrame stage={stage} dialogRef={dialog} icon={<Camera className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />} title="Scan PAO Sheet" description="Reviewed intake saved with its original scan." onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col p-5"><p role="status" className="flex-1 font-semibold text-emerald-800">{client.client.name} — Reviewed intake saved successfully.</p>
        <div className="grid gap-2 border-t border-[#E5E7EB] pt-4 sm:grid-cols-[1fr_auto_1fr]">
          <button type="button" onClick={() => { setClient(undefined); setDirty(false); setStage('select'); setAddingAnother(value => value + 1); }} className="intake-secondary sm:justify-self-start">Scan another document</button>
          <button type="button" onClick={() => setViewingCase(true)} className="intake-primary sm:col-start-2 sm:row-start-1">Continue to Case Details</button>
          <button type="button" onClick={onClose} className="intake-secondary sm:col-start-3 sm:row-start-1 sm:justify-self-end">Done</button>
        </div>
      </div>
    </IntakeModalFrame>}
    {client && viewingCase && <IntakeModalFrame stage={stage} dialogRef={dialog} icon={<Camera className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />} title="Scan PAO Sheet" description="Continue with the case details." onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto"><CaseWorkflow caseType={caseType} clients={[]} lockedClient={client} lockedClients={[client]} submitLabel="Save Case" onClientUpdated={updated => { upsertClient(updated); setClient(updated); }} onSubmit={async values => {
        const record = await createCaseRecord(values, caseType); upsertCase(record);
        try { setStoreClients(await listClientRecords()); } catch { /* Refreshes on the next page load. */ }
        toast.success('Case saved'); onClose();
      }} /></div>
    </IntakeModalFrame>}
  </>;
}

export function UploadIntakeModal({ onClose, caseType = 'Criminal' }: { onClose: () => void; caseType?: CaseType }) {
  const confirm = useConfirmation();
  const [dirty, setDirty] = useState(false);
  const [stage, setStage] = useState<IntakeStage>('select');
  const [client, setClient] = useState<ClientRecord>();
  const [addingAnother, setAddingAnother] = useState(0);
  const [viewingCase, setViewingCase] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const upsertClient = useCriminalCasesStore(state => state.upsertClient);
  const upsertCase = useCriminalCasesStore(state => state.upsertCase);
  const setStoreClients = useCriminalCasesStore(state => state.setClients);

  const close = useCallback(async (forceConfirm = false) => {
    if ((dirty || forceConfirm) && !await confirm({ title: 'Discard unsaved entry?', message: 'Your selected document or corrections have not been saved. Cancel to keep working.', confirmLabel: 'Discard entry' })) return;
    setDirty(false);
    onClose();
  }, [confirm, dirty, onClose]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (!dialog.current?.contains(document.activeElement)) return;
      if (event.key === 'Escape') { event.preventDefault(); void close(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')).filter(node => node.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [close]);

  return <>
    {!client && (
      <PaperIntakeReview
        key={addingAnother}
        inputMethod="upload"
        onStageChange={setStage}
        onDirtyChange={setDirty}
        onCancel={() => void close(true)}
        onSaved={saved => { setDirty(false); upsertClient(saved); setClient(saved); }}
        renderStageFrame={(currentStage, content) =>
          currentStage === 'review' || currentStage === 'save' ? (
            <UploadReviewModal key="upload-review-modal" stage={currentStage} dialogRef={dialog} onClose={() => void close(true)}>
              {content}
            </UploadReviewModal>
          ) : (
            <UploadDocumentSelectionModal key="upload-selection-modal" stage={currentStage} dialogRef={dialog} onClose={() => void close()}>
              {content}
            </UploadDocumentSelectionModal>
          )
        }
      />
    )}
    {client && !viewingCase && <IntakeModalFrame stage={stage} modalKind="upload-selection" surfaceClassName="max-w-2xl" dialogRef={dialog} icon={<Upload className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />} title="Upload PAO Sheet" description="Reviewed intake saved with its original document." onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col p-5"><p role="status" className="flex-1 font-semibold text-emerald-800">{client.client.name} — Reviewed intake saved successfully.</p>
        <div className="grid gap-2 border-t border-[#E5E7EB] pt-4 sm:grid-cols-[1fr_auto_1fr]">
          <button type="button" onClick={() => { setClient(undefined); setDirty(false); setStage('select'); setAddingAnother(value => value + 1); }} className="intake-secondary sm:justify-self-start">Upload another document</button>
          <button type="button" onClick={() => setViewingCase(true)} className="intake-primary sm:col-start-2 sm:row-start-1">Continue to Case Details</button>
          <button type="button" onClick={onClose} className="intake-secondary sm:col-start-3 sm:row-start-1 sm:justify-self-end">Done</button>
        </div>
      </div>
    </IntakeModalFrame>}
    {client && viewingCase && <IntakeModalFrame stage={stage} dialogRef={dialog} icon={<Upload className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />} title="Upload PAO Sheet" description="Continue with the case details." onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto"><CaseWorkflow caseType={caseType} clients={[]} lockedClient={client} lockedClients={[client]} submitLabel="Save Case" onClientUpdated={updated => { upsertClient(updated); setClient(updated); }} onSubmit={async values => {
        const record = await createCaseRecord(values, caseType); upsertCase(record);
        try { setStoreClients(await listClientRecords()); } catch { /* Refreshes on the next page load. */ }
        toast.success('Case saved'); onClose();
      }} /></div>
    </IntakeModalFrame>}
  </>;
}
