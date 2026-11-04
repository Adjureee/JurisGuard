import { useState } from 'react';
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
  async function leave(action: () => void) {
    if (phase === 'scan' && dirty && !await confirm({ title: 'Discard unsaved corrections?', message: 'Your reviewed draft has not been saved. Cancel to keep reviewing.', confirmLabel: 'Discard draft' })) return;
    setDirty(false); action();
  }
  const [phase, setPhase] = useState<'method' | 'manual' | 'scan' | 'saved' | 'case'>(initialMode ?? 'method');
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [viewing, setViewing] = useState<ClientRecord | null>(null);
  const [session, setSession] = useState(0);
  const upsertClient = useCriminalCasesStore(state => state.upsertClient);
  const upsertCase = useCriminalCasesStore(state => state.upsertCase);
  const setStoreClients = useCriminalCasesStore(state => state.setClients);
  return <ModalPortal><div className="jurisguard-modal-overlay bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="paper-intake-title">
    <div className={`flex ${phase === 'scan' ? 'h-[95dvh]' : ''} max-h-[95dvh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-xl`}>
      <header className="flex shrink-0 flex-wrap gap-2 items-center justify-between border-b px-5 py-4"><div><h2 id="paper-intake-title" className="text-xl font-semibold">Add client</h2>
        <p className="text-sm text-slate-600">Enter client details manually, or review Parts II and II-A from a scan.</p></div>
        <div className="flex flex-wrap gap-3">{(phase === 'scan' || phase === 'manual') && <button type="button" onClick={() => void leave(() => setPhase('method'))} className="min-h-11 rounded border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]">Discard entry / change method</button>}
        <button type="button" onClick={() => void leave(onClose)} className="min-h-11 rounded border px-4 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]">Close</button></div></header>
      <div className={`min-h-0 flex-1 ${phase === 'scan' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {phase === 'method' && <div className="space-y-4 p-5"><h3 className="text-lg font-semibold">How would you like to add this client?</h3><div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setPhase('manual')} className="rounded bg-[#704389] px-4 py-3 font-semibold text-white">Manual entry</button>
          <button type="button" onClick={() => setPhase('scan')} className="rounded border border-[#704389] px-4 py-3 font-semibold text-[#704389]">Scan or upload PAO sheet</button>
        </div><p className="text-sm text-slate-600">Manual entry requires no document. Document intake retains the original scan and requires attorney review.</p></div>}
        {phase === 'manual' && <ManualClientCreation key={session} onSaved={client => { setDirty(false); upsertClient(client); setClients(current => [...current, client]); setPhase('saved'); }} />}
        {phase === 'scan' && <PaperIntakeReview key={session} onDirtyChange={setDirty} onSaved={client => {
          setDirty(false); upsertClient(client); setClients(current => [...current, client]); setPhase('saved');
        }} />}
        {phase === 'saved' && <div className="space-y-4 p-5"><p role="status" className="font-semibold text-emerald-800">{clients.at(-1)?.paper_intake ? 'Reviewed intake saved with its original scan.' : 'Client created manually.'}</p>
          {clients.map(client => <button type="button" key={client.client_id} onClick={() => setViewing(client)} className="block w-full rounded border p-3 text-left">{client.client.name || 'Applicant name left blank'} — {client.paper_intake ? 'View reviewed record' : 'View client record'}</button>)}
          <div className="flex flex-wrap gap-3"><button type="button" onClick={() => { setSession(current => current + 1); setPhase('method'); }} className="rounded border px-4 py-2">Add another client</button>
            <button type="button" onClick={() => setPhase('case')} className="rounded bg-[#704389] px-4 py-2 text-white">Continue to Case Details</button>
            <button type="button" onClick={onClose} className="rounded border px-4 py-2">Done</button></div></div>}
        {phase === 'case' && clients.length > 0 && <CaseWorkflow clients={[]} lockedClient={clients[0]} lockedClients={clients} submitLabel="Save Case" onClientUpdated={updated => {
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
