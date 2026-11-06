import { useState } from 'react';
import type { ClientRecord } from '../../types';
import ModalPortal from '../../components/modals/ModalPortal';
import { useConfirmation } from '../../components/ConfirmationProvider';
import { PaperIntakeReview } from './PaperIntakeReview';

/** Shared editor for the reviewed scan, including the save callback and discard guard. */
export function ScannedIntakeEditModal({client,onClose,onSaved}: {
  client:ClientRecord;onClose:()=>void;onSaved:(client:ClientRecord)=>void;
}) {
  const confirm=useConfirmation();
  const [dirty,setDirty]=useState(false);
  async function closeReview() {
    if(dirty&&!await confirm({title:'Discard unsaved corrections?',message:'Cancel to keep reviewing your corrections.',confirmLabel:'Discard corrections'}))return;
    onClose();
  }
  if(!client.paper_intake)return null;
  return <ModalPortal><div className="jurisguard-modal-overlay bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Review PAO intake">
    <div className="flex h-[95dvh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white"><div className="flex shrink-0 items-center justify-between border-b p-4">
      <h2 className="font-semibold">Review PAO Parts II and II-A</h2><button type="button" onClick={()=>void closeReview()} className="min-h-11 rounded border px-3 py-2">Close</button></div>
      <PaperIntakeReview key={client.client_id} onDirtyChange={setDirty} saved={client.paper_intake} clientId={client.client_id} onSaved={updated=>{onSaved(updated);onClose();}}/>
    </div></div></ModalPortal>;
}
