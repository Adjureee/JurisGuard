import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { ArrowRight, Camera, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ClientRecord } from '../../types';
import { PaperIntakeReview } from '../../features/documentExtraction/PaperIntakeReview';
import type { IntakeStage } from '../../features/documentExtraction/PaperDocumentSetup';
import { useCriminalCasesStore } from '../../features/criminalCases/criminalCasesStore';
import { createCaseRecord, listClientRecords } from '../../services/recordService';
import { CaseWorkflow } from './CaseWorkflow';
import { useConfirmation } from '../ConfirmationProvider';
import ModalPortal from './ModalPortal';

function IntakeModalFrame({ title, description, icon, dialogRef, onClose, children }: {
  title: string;
  description: string;
  icon: ReactNode;
  dialogRef: Ref<HTMLDivElement>;
  onClose: () => void;
  children: ReactNode;
}) {
  return <ModalPortal><div ref={dialogRef} className="jurisguard-modal-overlay intake-modal bg-black/60 p-3 sm:p-5" role="dialog" aria-modal="true" aria-label={title}>
    <div className="flex h-[92vh] max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
      <header className="flex shrink-0 items-start justify-between gap-3 bg-[#704389] px-5 py-4 text-white">
        <div className="flex min-w-0 items-start gap-3">
          {icon}
          <div><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-white/85">{description}</p></div>
        </div>
        <button type="button" onClick={onClose} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-white/70 bg-white/10 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"><X size={16} aria-hidden="true" />Close</button>
      </header>
      {children}
    </div>
  </div></ModalPortal>;
}

export function ScanIntakeModal({ onClose }: { onClose: () => void }) {
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
    {!client && <IntakeModalFrame dialogRef={dialog} icon={<Camera className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />} title="Scan PAO Sheet" description="Capture the complete paper document and review the extracted details." onClose={() => void close()}>
      <ol aria-label="Document intake stages" className="flex shrink-0 flex-wrap gap-x-4 gap-y-2 border-b bg-slate-50 px-5 py-3 text-xs sm:text-sm">{(['Select document', 'Review crop (optional)', 'Extract', 'Review details', 'Save'] as const).map((label, index) => <li key={label} aria-current={['select', 'crop', 'extract', 'review', 'save'].indexOf(stage) === index ? 'step' : undefined} className={`flex items-center gap-2 ${['select', 'crop', 'extract', 'review', 'save'].indexOf(stage) === index ? 'font-semibold text-[#704389]' : 'text-slate-600'}`}><span>{label}</span>{index < 4 && <ArrowRight size={12} aria-hidden="true" />}</li>)}</ol>
      <div className="min-h-0 flex-1 overflow-hidden"><PaperIntakeReview key={addingAnother} inputMethod="scan" onStageChange={setStage} onDirtyChange={setDirty} onSaved={saved => { setDirty(false); upsertClient(saved); setClient(saved); }} /></div>
    </IntakeModalFrame>}
    {client && !viewingCase && <IntakeModalFrame dialogRef={dialog} icon={<Camera className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />} title="Scan PAO Sheet" description="Reviewed intake saved with its original scan." onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col p-5"><p role="status" className="flex-1 font-semibold text-emerald-800">{client.client.name} — Reviewed intake saved successfully.</p>
        <div className="grid gap-2 border-t border-[#E5E7EB] pt-4 sm:grid-cols-[1fr_auto_1fr]">
          <button type="button" onClick={() => { setClient(undefined); setDirty(false); setStage('select'); setAddingAnother(value => value + 1); }} className="intake-secondary sm:justify-self-start">Scan another document</button>
          <button type="button" onClick={() => setViewingCase(true)} className="intake-primary sm:col-start-2 sm:row-start-1">Continue to Case Details</button>
          <button type="button" onClick={onClose} className="intake-secondary sm:col-start-3 sm:row-start-1 sm:justify-self-end">Done</button>
        </div>
      </div>
    </IntakeModalFrame>}
    {client && viewingCase && <IntakeModalFrame dialogRef={dialog} icon={<Camera className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />} title="Scan PAO Sheet" description="Continue with the case details." onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto"><CaseWorkflow clients={[]} lockedClient={client} lockedClients={[client]} submitLabel="Save Case" onClientUpdated={updated => { upsertClient(updated); setClient(updated); }} onSubmit={async values => {
        const record = await createCaseRecord(values); upsertCase(record);
        try { setStoreClients(await listClientRecords()); } catch { /* Refreshes on the next page load. */ }
        toast.success('Case saved'); onClose();
      }} /></div>
    </IntakeModalFrame>}
  </>;
}

export function UploadIntakeModal({ onClose }: { onClose: () => void }) {
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
    if (dirty && !await confirm({ title: 'Discard unsaved entry?', message: 'Your selected document or corrections have not been saved. Cancel to keep working.', confirmLabel: 'Discard entry' })) return;
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
    {!client && <IntakeModalFrame dialogRef={dialog} icon={<Upload className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />} title="Upload PAO Sheet" description="Choose the complete paper document and review the extracted details." onClose={() => void close()}>
      <ol aria-label="Document intake stages" className="flex shrink-0 flex-wrap gap-x-4 gap-y-2 border-b bg-slate-50 px-5 py-3 text-xs sm:text-sm">{(['Select document', 'Review crop (optional)', 'Extract', 'Review details', 'Save'] as const).map((label, index) => <li key={label} aria-current={['select', 'crop', 'extract', 'review', 'save'].indexOf(stage) === index ? 'step' : undefined} className={`flex items-center gap-2 ${['select', 'crop', 'extract', 'review', 'save'].indexOf(stage) === index ? 'font-semibold text-[#704389]' : 'text-slate-600'}`}><span>{label}</span>{index < 4 && <ArrowRight size={12} aria-hidden="true" />}</li>)}</ol>
      <div className="min-h-0 flex-1 overflow-hidden"><PaperIntakeReview key={addingAnother} inputMethod="upload" onStageChange={setStage} onDirtyChange={setDirty} onSaved={saved => { setDirty(false); upsertClient(saved); setClient(saved); }} /></div>
    </IntakeModalFrame>}
    {client && !viewingCase && <IntakeModalFrame dialogRef={dialog} icon={<Upload className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />} title="Upload PAO Sheet" description="Reviewed intake saved with its original document." onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col p-5"><p role="status" className="flex-1 font-semibold text-emerald-800">{client.client.name} — Reviewed intake saved successfully.</p>
        <div className="grid gap-2 border-t border-[#E5E7EB] pt-4 sm:grid-cols-[1fr_auto_1fr]">
          <button type="button" onClick={() => { setClient(undefined); setDirty(false); setStage('select'); setAddingAnother(value => value + 1); }} className="intake-secondary sm:justify-self-start">Upload another document</button>
          <button type="button" onClick={() => setViewingCase(true)} className="intake-primary sm:col-start-2 sm:row-start-1">Continue to Case Details</button>
          <button type="button" onClick={onClose} className="intake-secondary sm:col-start-3 sm:row-start-1 sm:justify-self-end">Done</button>
        </div>
      </div>
    </IntakeModalFrame>}
    {client && viewingCase && <IntakeModalFrame dialogRef={dialog} icon={<Upload className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />} title="Upload PAO Sheet" description="Continue with the case details." onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto"><CaseWorkflow clients={[]} lockedClient={client} lockedClients={[client]} submitLabel="Save Case" onClientUpdated={updated => { upsertClient(updated); setClient(updated); }} onSubmit={async values => {
        const record = await createCaseRecord(values); upsertCase(record);
        try { setStoreClients(await listClientRecords()); } catch { /* Refreshes on the next page load. */ }
        toast.success('Case saved'); onClose();
      }} /></div>
    </IntakeModalFrame>}
  </>;
}
