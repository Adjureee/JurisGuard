import { useEffect, useRef, useState } from 'react';
import { FileScan, Keyboard, ArrowRight, X } from 'lucide-react';
import type { IntakeStage } from '../../features/documentExtraction/PaperDocumentSetup';
import '../../features/documentExtraction/intake-modal.css';
import toast from 'react-hot-toast';
import type { ClientRecord } from '../../types';
import { PaperIntakeReview } from '../../features/documentExtraction/PaperIntakeReview';
import { ManualClientCreation } from '../../features/documentExtraction/ManualClientCreation';
import { useCriminalCasesStore } from '../../features/criminalCases/criminalCasesStore';
import { createCaseRecord, listClientRecords } from '../../services/recordService';
import { CaseWorkflow } from './CaseWorkflow';
import ClientInformationModal from './ClientInformationModal';
import { useConfirmation } from '../ConfirmationProvider';
import ModalPortal from './ModalPortal';

interface Props { isOpen: boolean; onClose: () => void; initialMode?: 'manual' | 'scan' }

function IntakeSession({ onClose, initialMode }: { onClose: () => void; initialMode?: 'manual' | 'scan' }) {
  const confirm = useConfirmation();
  const [dirty, setDirty] = useState(false);
  const [stage,setStage] = useState<IntakeStage>('select');
  const dialog = useRef<HTMLDivElement>(null);
  async function leave(action: () => void) {
    if (dirty && !await confirm({ title: 'Discard unsaved entry?', message: 'Your selected document or corrections have not been saved. Cancel to keep working.', confirmLabel: 'Discard entry' })) return;
    setDirty(false); action();
  }
  const [phase, setPhase] = useState<'method' | 'manual' | 'scan' | 'saved' | 'case'>(initialMode ?? 'method');
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [viewing, setViewing] = useState<ClientRecord | null>(null);
  const [successKind, setSuccessKind] = useState<'manual' | 'paper'>('manual');
  const [session, setSession] = useState(0);
  const upsertClient = useCriminalCasesStore(state => state.upsertClient);
  const upsertCase = useCriminalCasesStore(state => state.upsertCase);
  const setStoreClients = useCriminalCasesStore(state => state.setClients);
  const latestClient = clients.at(-1);
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
  const expanded=phase==='case'||(phase==='scan'&&stage!=='select');
  return <ModalPortal><div ref={dialog} className="jurisguard-modal-overlay intake-modal bg-black/60 p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="paper-intake-title">
    <div className={`flex ${expanded?'h-[95dvh] max-w-[1600px]':'max-w-3xl'} max-h-[95dvh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-xl`}>
      <header className="flex shrink-0 gap-3 items-start justify-between border-b px-5 py-4"><div className="min-w-0 flex-1"><h2 id="paper-intake-title" className="text-xl font-semibold">Add client</h2>
        <p className="mt-1 text-sm text-slate-600">{phase==='scan'?'PAO Interview Sheet · Parts II and II-A':'Create a client record.'}</p></div>
        <button type="button" onClick={() => void leave(onClose)} className="intake-secondary"><X size={16} aria-hidden="true"/>Close</button></header>
      {(phase==='scan'||phase==='manual')&&<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-5 py-2"><button type="button" className="intake-link" onClick={()=>void leave(()=>{setPhase('method');setStage('select');setSession(s=>s+1);})}>Change method</button>{dirty&&<button type="button" className="intake-link text-rose-800" onClick={()=>void leave(()=>{setSession(s=>s+1);setStage('select');})}>Discard entry</button>}</div>}
      {phase==='scan'&&<ol aria-label="Document intake stages" className="flex shrink-0 flex-wrap gap-x-4 gap-y-2 border-b bg-slate-50 px-5 py-3 text-xs sm:text-sm">{(['Select document','Review crop (optional)','Extract','Review details','Save'] as const).map((label,i)=>{const active=['select','crop','extract','review','save'].indexOf(stage)===i;return <li key={label} aria-current={active?'step':undefined} className={`flex items-center gap-2 ${active?'font-semibold text-[#704389]':'text-slate-600'}`}><span>{label}</span>{i<4&&<ArrowRight size={12} aria-hidden="true"/>}</li>;})}</ol>}
      <div className={`min-h-0 flex-1 ${phase === 'scan' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {phase === 'method' && <div className="space-y-5 p-6"><h3 className="text-lg font-semibold">Choose an intake method</h3><button type="button" onClick={() => setPhase('scan')} className="flex min-h-24 w-full items-center gap-4 rounded-xl border border-[#704389] bg-[#FAF7FC] p-5 text-left hover:bg-[#F2E9F7]"><FileScan className="shrink-0 text-[#704389]" size={26} aria-hidden="true"/><span className="flex-1"><span className="block font-semibold text-slate-900">Use a PAO interview sheet</span><span className="mt-1 block text-sm leading-6 text-slate-600">Upload or scan the paper, then review Parts II and II-A.</span></span><ArrowRight size={18} aria-hidden="true"/></button><button type="button" onClick={() => setPhase('manual')} className="flex min-h-24 w-full items-center gap-4 rounded-xl border border-slate-300 p-5 text-left hover:bg-slate-50"><Keyboard size={26} aria-hidden="true" className="shrink-0 text-slate-600"/><span className="flex-1"><span className="block font-semibold text-slate-900">Manual entry</span><span className="mt-1 block text-sm leading-6 text-slate-600">Create a client record without a scanned document.</span></span><ArrowRight size={18} aria-hidden="true"/></button></div>}
        {phase === 'manual' && <ManualClientCreation key={session} onDirtyChange={setDirty} onSaved={client => { setDirty(false); upsertClient(client); setClients(current => [...current, client]); setSuccessKind('manual'); setPhase('saved'); }} />}
        {phase === 'scan' && <PaperIntakeReview key={session} onStageChange={setStage} onDirtyChange={setDirty} onSaved={client => {
          setDirty(false); upsertClient(client); setClients(current => [...current, client]); setSuccessKind('paper'); setPhase('saved');
        }} />}
        {phase === 'saved' && <div className="flex h-full flex-col p-5"><div className="flex-1 space-y-4">
          <p role="status" className="font-semibold text-emerald-800">{successKind === 'manual' ? 'Client created manually.' : 'Reviewed intake saved with its original scan.'}</p>
          {latestClient && <button type="button" onClick={() => setViewing(latestClient)} className="block w-full rounded border p-3 text-left font-semibold text-[#704389] underline underline-offset-2">
            {latestClient.client.name} — View client record
          </button>}
        </div><div className="grid gap-2 border-t border-[#E5E7EB] pt-4 sm:grid-cols-[1fr_auto_1fr]">
          <button type="button" onClick={() => { setDirty(false); setSession(current => current + 1); setStage('select'); setPhase(successKind === 'manual' ? 'manual' : 'method'); }} className="intake-secondary sm:justify-self-start">Add another client</button>
          <button type="button" onClick={() => setPhase('case')} className="intake-primary sm:col-start-2 sm:row-start-1">Continue to Case Details</button>
          <button type="button" onClick={onClose} className="intake-secondary sm:col-start-3 sm:row-start-1 sm:justify-self-end">Done</button>
        </div></div>}
        {phase === 'case' && latestClient && <CaseWorkflow clients={[]} lockedClient={latestClient} lockedClients={[latestClient]} submitLabel="Save Case" onClientUpdated={updated => {
          upsertClient(updated);
          setClients(current => current.map(client => client.client_id === updated.client_id ? updated : client));
        }} onSubmit={async values => {
          const record = await createCaseRecord(values); upsertCase(record);
          try { setStoreClients(await listClientRecords()); } catch { /* Saved records refresh on the next page load. */ }
          toast.success('Case saved'); onClose();
        }} />}
      </div>
    </div>
  </div><ClientInformationModal client={viewing} onClose={() => setViewing(null)} /></ModalPortal>;
}

export default function AddClientModal({ isOpen, onClose, initialMode }: Props) {
  return isOpen ? <IntakeSession onClose={onClose} initialMode={initialMode} /> : null;
}
