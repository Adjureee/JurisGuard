import { useEffect, useRef, useState, useCallback } from 'react';
import { FileScan, Keyboard, ArrowRight } from 'lucide-react';
import type { IntakeStage } from '../../features/documentExtraction/PaperDocumentSetup';
import '../../features/documentExtraction/intake-modal.css';
import toast from 'react-hot-toast';
import type { CaseType, ClientRecord } from '../../types';
import { PaperIntakeReview } from '../../features/documentExtraction/PaperIntakeReview';
import { ManualClientCreation } from '../../features/documentExtraction/ManualClientCreation';
import { useCriminalCasesStore } from '../../features/criminalCases/criminalCasesStore';
import { createCaseRecord, listClientRecords } from '../../services/recordService';
import { CaseWorkflow } from './CaseWorkflow';
import ClientInformationModal from './ClientInformationModal';
import { useConfirmation } from '../ConfirmationProvider';
import ModalPortal from './ModalPortal';

interface Props { isOpen: boolean; onClose: () => void; initialMode?: 'manual' | 'scan'; caseType?: CaseType }

function IntakeSession({ onClose, initialMode, caseType = 'Criminal' }: { onClose: () => void; initialMode?: 'manual' | 'scan'; caseType?: CaseType }) {
  const confirm = useConfirmation();
  const [dirty, setDirty] = useState(false);
  const [stage,setStage] = useState<IntakeStage>('select');
  const dialog = useRef<HTMLDivElement>(null);
  async function leave(action: () => void, forceConfirm = false) {
    if ((dirty || forceConfirm) && !await confirm({ title: 'Discard unsaved entry?', message: 'Your selected document or corrections have not been saved. Cancel to keep working.', confirmLabel: 'Discard entry' })) return;
    setDirty(false); action();
  }
  const [phase, setPhase] = useState<'method' | 'manual' | 'scan' | 'saved' | 'case'>(initialMode ?? 'method');
  const [, setManualReview] = useState(false);
  const [sessionClients, setSessionClients] = useState<ClientRecord[]>([]);
  const [viewing, setViewing] = useState<ClientRecord | null>(null);
  const [successKind, setSuccessKind] = useState<'manual' | 'paper'>('manual');
  const [session, setSession] = useState(0);
  const storeClients = useCriminalCasesStore(state => state.clients);
  const upsertClient = useCriminalCasesStore(state => state.upsertClient);
  const upsertCase = useCriminalCasesStore(state => state.upsertCase);
  const setStoreClients = useCriminalCasesStore(state => state.setClients);
  const latestClient = sessionClients.at(-1);

  const fetchClientDirectory = useCallback(async () => {
    try {
      const records = await listClientRecords();
      setStoreClients(records);
    } catch {
      // Offline fallback: keep existing stored clients
    }
  }, [setStoreClients]);

  useEffect(() => {
    void fetchClientDirectory();
  }, [fetchClientDirectory]);

  // Combine store clients and session clients, ensuring latest client is present and deduplicated by client_id
  const allAvailableClients = [
    ...sessionClients,
    ...storeClients.filter(
      (storeClient) => !sessionClients.some((sc) => sc.client_id === storeClient.client_id)
    ),
  ];

  const handleClientSaved = async (client: ClientRecord, kind: 'manual' | 'paper') => {
    setDirty(false);
    setManualReview(false);
    upsertClient(client);
    setSessionClients(current => {
      const filtered = current.filter(c => c.client_id !== client.client_id);
      return [...filtered, client];
    });
    setSuccessKind(kind);
    setPhase('saved');
    await fetchClientDirectory();
  };

  useEffect(()=>{
    function keyboard(event:KeyboardEvent){
      const overlays=document.querySelectorAll('.jurisguard-modal-overlay');
      if(overlays[overlays.length-1]!==dialog.current)return;
      if(event.key==='Escape'){event.preventDefault();void leave(onClose);}
      if(event.key!=='Tab')return;
      const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')??[]).filter(node=>node.getClientRects().length>0);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
    document.addEventListener('keydown',keyboard);return()=>document.removeEventListener('keydown',keyboard);
  });
  return <ModalPortal><div ref={dialog} data-intake-phase={phase} data-intake-stage={stage} className="jurisguard-modal-overlay intake-modal bg-black/60 p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="paper-intake-title">
    <div className={`intake-session-surface flex w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl ${phase === 'saved' ? 'max-h-[92vh] max-w-2xl' : phase === 'case' ? 'h-[92vh] max-h-[92vh] max-w-5xl' : 'h-[92vh] max-h-[92vh] max-w-6xl'}`}>
      <header className="flex shrink-0 items-start justify-between gap-3 rounded-t-2xl border-b border-[#5F3675] bg-[#704389] px-5 py-4 text-white"><div className="min-w-0 flex-1"><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/80">{phase === 'case' ? 'Step 2 — Case Details' : 'Step 1 — Client Details'}</p><h2 id="paper-intake-title" className="text-xl font-semibold text-white">{phase === 'case' ? 'Case Details' : 'Add client'}</h2>
        <p className="mt-1 text-sm text-white/85">{phase === 'case' ? 'Enter case information for the selected client.' : phase === 'scan' ? 'PAO Interview Sheet · Parts II and II-A' : 'Create a client record.'}</p></div></header>
      {(phase==='scan'||phase==='manual')&&<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-5 py-2"><button type="button" className="intake-secondary" onClick={()=>void leave(()=>{setManualReview(false);setPhase('method');setStage('select');setSession(s=>s+1);})}>Change Method</button>{dirty&&<button type="button" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700" onClick={()=>void leave(()=>{setManualReview(false);setSession(s=>s+1);setStage('select');})}>Discard Entry</button>}</div>}
      {phase==='scan'&&<ol aria-label="Document intake stages" className="flex shrink-0 flex-wrap gap-x-4 gap-y-2 border-b bg-slate-50 px-5 py-3 text-xs sm:text-sm">{(['Select document','Review crop','Extract','Review details','Save'] as const).map((label,i)=>{const active=['select','crop','extract','review','save'].indexOf(stage)===i;return <li key={label} aria-current={active?'step':undefined} className={`flex items-center gap-2 ${active?'font-semibold text-[#704389]':'text-slate-600'}`}><span>{label}</span>{i<4&&<ArrowRight size={12} aria-hidden="true"/>}</li>;})}</ol>}
      <div className={`min-h-0 flex-1 ${phase === 'scan' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {phase === 'method' && <div className="flex h-full flex-col justify-between"><div className="space-y-5 p-6"><h3 className="text-lg font-semibold">Choose an intake method</h3><button type="button" onClick={() => setPhase('scan')} className="group flex min-h-24 w-full items-center gap-4 rounded-xl border border-slate-300 bg-white p-5 text-left transition hover:border-[#704389] hover:bg-[#FAF7FC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] active:border-[#704389] active:bg-[#F2E9F7]"><FileScan className="shrink-0 text-slate-600 transition-colors group-hover:text-[#704389]" size={26} aria-hidden="true"/><span className="flex-1"><span className="block font-semibold text-slate-900">Use a PAO interview sheet</span><span className="mt-1 block text-sm leading-6 text-slate-600">Upload or scan the paper, then review Parts II and II-A.</span></span><ArrowRight size={18} aria-hidden="true" className="text-slate-400 transition-colors group-hover:text-[#704389]"/></button><button type="button" onClick={() => { setManualReview(false); setPhase('manual'); }} className="group flex min-h-24 w-full items-center gap-4 rounded-xl border border-slate-300 bg-white p-5 text-left transition hover:border-[#704389] hover:bg-[#FAF7FC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] active:border-[#704389] active:bg-[#F2E9F7]"><Keyboard size={26} aria-hidden="true" className="shrink-0 text-slate-600 transition-colors group-hover:text-[#704389]"/><span className="flex-1"><span className="block font-semibold text-slate-900">Manual entry</span><span className="mt-1 block text-sm leading-6 text-slate-600">Create a client record without a scanned document.</span></span><ArrowRight size={18} aria-hidden="true" className="text-slate-400 transition-colors group-hover:text-[#704389]"/></button></div><footer className="flex shrink-0 justify-end border-t border-slate-200 bg-[#F8FAFC] px-5 py-3.5"><button type="button" onClick={() => void leave(onClose)} className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50">Cancel</button></footer></div>}
        {phase === 'manual' && <ManualClientCreation key={session} onDirtyChange={setDirty} onReviewChange={setManualReview} onCancel={() => void leave(onClose, true)} onSaved={client => void handleClientSaved(client, 'manual')} />}
        {phase === 'scan' && <PaperIntakeReview key={session} onStageChange={setStage} onDirtyChange={setDirty} onCancel={() => void leave(onClose, stage === 'review' || stage === 'save')} onSaved={client => void handleClientSaved(client, 'paper')} />}
        {phase === 'saved' && <div className="flex flex-col p-5"><div className="space-y-4">
          <p role="status" className="font-semibold text-emerald-800">{successKind === 'manual' ? 'Client created manually.' : 'Reviewed intake saved with its original scan.'}</p>
          {latestClient && <button type="button" onClick={() => setViewing(latestClient)} className="block w-full rounded border p-3 text-left font-semibold text-[#704389] underline underline-offset-2">
            {latestClient.client.name} — View client record
          </button>}
        </div><div className="grid gap-2 border-t border-[#E5E7EB] pt-4 sm:grid-cols-[1fr_auto_1fr]">
          <button type="button" onClick={() => { setDirty(false); setManualReview(false); setSession(current => current + 1); setStage('select'); setPhase(successKind === 'manual' ? 'manual' : 'method'); }} className="intake-secondary whitespace-nowrap sm:justify-self-start">Add another client</button>
          <button type="button" onClick={() => setPhase('case')} className="intake-primary whitespace-nowrap sm:col-start-2 sm:row-start-1 sm:justify-self-center">Continue to Case Details</button>
          <button type="button" onClick={onClose} className="intake-secondary whitespace-nowrap sm:col-start-3 sm:row-start-1 sm:justify-self-end">Done</button>
        </div></div>}
        {phase === 'case' && latestClient && <CaseWorkflow caseType={caseType} clients={allAvailableClients} lockedClient={latestClient} lockedClients={[latestClient]} hideStepIndicator={true} stepNumberOffset={1} submitLabel="Save Case" onCancel={() => void leave(onClose, true)} onClientUpdated={updated => {
          upsertClient(updated);
          setSessionClients(current => current.map(client => client.client_id === updated.client_id ? updated : client));
        }} onSubmit={async values => {
          const record = await createCaseRecord(values, caseType); upsertCase(record);
          try { setStoreClients(await listClientRecords()); } catch { /* Saved records refresh on the next page load. */ }
          toast.success('Case saved'); onClose();
        }} />}
      </div>
    </div>
  </div><ClientInformationModal client={viewing} onClose={() => setViewing(null)} /></ModalPortal>;
}

export default function AddClientModal({ isOpen, onClose, initialMode, caseType }: Props) {
  return isOpen ? <IntakeSession onClose={onClose} initialMode={initialMode} caseType={caseType} /> : null;
}
