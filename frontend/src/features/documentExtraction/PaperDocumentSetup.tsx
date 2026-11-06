import { useEffect, useRef, useState } from 'react';
import { Camera, FileUp, FileText, Replace } from 'lucide-react';
import { CameraCapture } from './CameraCapture';
import { useConfirmation } from '../../components/ConfirmationProvider';

export type IntakeStage = 'select' | 'crop' | 'extract' | 'review' | 'save';
export function PaperDocumentSetup({ disabled, schemaReady, mode, onModeChange, onExtract, onPending, onStageChange, inputMethod = 'both' }: {
  disabled:boolean; schemaReady:boolean; mode:'auto'|'offline'|'cloud';
  onModeChange:(mode:'auto'|'offline'|'cloud')=>void;
  onExtract:(selected:File, original?:File)=>void;
  onPending:(dirty:boolean)=>void; onStageChange?:(stage:IntakeStage)=>void;
  inputMethod?:'both'|'scan'|'upload';
}) {
  const confirm=useConfirmation();
  const [file,setFile]=useState<File>();
  const [url,setUrl]=useState('');
  const [camera,setCamera]=useState(false);
  const [captured,setCaptured]=useState(false);
  const [error,setError]=useState('');
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    if(!file){setUrl('');return;}
    const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next);
  },[file]);
  async function mayReplace() {
    return !(file||captured)||await confirm({title:'Replace selected document?',
      message:'Discard the current document or capture and its adjustments? Cancel to keep working.',confirmLabel:'Replace document'});
  }
  async function select(next:File) {
    if(disabled)return;
    if(!/\.(jpe?g|jfif|png|webp|pdf)$/i.test(next.name)||next.size>25*1024*1024||next.size===0){setError('Choose a JPG, PNG, WEBP or PDF up to 25 MB.');return;}
    if(!await mayReplace())return;
    setFile(next);setCaptured(false);setCamera(false);setError('');onPending(true);onStageChange?.('select');
  }
  return <div className="paper-setup space-y-5">
    <div><h3 className="text-lg font-semibold text-slate-900">Select the completed PAO sheet</h3>
      <p className="mt-1 text-sm leading-6 text-slate-600">{inputMethod==='upload'?'Upload the complete sheet, extract Parts II and II-A, then review and save.':'Capture the sheet, review its crop, extract Parts II and II-A, then review and save.'}</p></div>
    <div className={`grid gap-3 ${inputMethod==='both'?'sm:grid-cols-2':''}`}>
      {inputMethod!=='scan'&&<button type="button" aria-label="Upload PAO Sheet" disabled={disabled} onClick={()=>input.current?.click()}
        onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(e.dataTransfer.files[0])void select(e.dataTransfer.files[0]);}}
        className="flex min-h-32 items-start gap-3 rounded-xl border-2 border-dashed border-[#BFA6CC] bg-[#FAF7FC] p-5 text-left hover:border-[#704389]">
        <FileUp size={24} className="shrink-0 text-[#704389]" aria-hidden="true"/><span><span className="block font-semibold text-slate-900">Upload PAO Sheet</span><span className="mt-1 block text-sm leading-6 text-slate-600">Drop a file here or browse files.<br/>JPG, PNG, WEBP or PDF · up to 25 MB</span></span>
      </button>}
      <input ref={input} type="file" accept=".jpg,.jpeg,.jfif,.png,.webp,.pdf" tabIndex={-1} aria-label="Choose PAO sheet" className="hidden" disabled={disabled}
        onChange={e=>{if(e.target.files?.[0])void select(e.target.files[0]);e.target.value='';}}/>
      {inputMethod!=='upload'&&<button type="button" aria-label="Scan with Camera" disabled={disabled} aria-expanded={camera}
        onClick={async()=>{if(!await mayReplace())return;setFile(undefined);setCaptured(false);setCamera(!camera);onPending(false);onStageChange?.('select');}}
        className="flex min-h-32 items-start gap-3 rounded-xl border border-slate-300 bg-white p-5 text-left hover:border-[#704389] hover:bg-slate-50">
        <Camera size={24} className="shrink-0 text-[#704389]" aria-hidden="true"/><span><span className="block font-semibold text-slate-900">Scan with Camera</span><span className="mt-1 block text-sm leading-6 text-slate-600">Capture the page, check the crop, then extract its information.</span></span>
      </button>}
    </div>
    <div className="grid items-center gap-3 sm:grid-cols-[180px_1fr]"><label className="text-sm font-semibold" htmlFor="intake-ocr-engine">OCR engine
      <select id="intake-ocr-engine" value={mode} disabled={disabled} onChange={e=>onModeChange(e.target.value as typeof mode)} className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3">
        <option value="auto">Auto</option><option value="offline">Offline PaddleOCR</option><option value="cloud">Cloud Vision</option>
      </select></label><p className="text-sm leading-6 text-slate-600">{mode==='offline'?'Reads locally with cached PaddleOCR models.':mode==='cloud'?'Sends the selected document to the configured cloud service.':'Uses the configured automatic routing, which may use cloud processing.'}</p>
    </div>
    {camera&&<CameraCapture isExtracting={disabled} canExtract={schemaReady} onUsePhoto={onExtract}
      onDraftChange={hasDraft=>{setCaptured(hasDraft);onPending(hasDraft);onStageChange?.(hasDraft?'crop':'select');}}/>}
    {file&&<><div className="flex items-center gap-4 rounded-lg border border-slate-200 p-3">
      {file.type==='application/pdf'?<FileText size={36} aria-hidden="true" className="text-[#704389]"/>:<img src={url} alt="Selected PAO sheet preview" className="h-24 w-20 rounded bg-slate-100 object-contain"/>}
      <div className="min-w-0 flex-1"><p className="break-all font-semibold">{file.name}</p><p className="mt-1 text-sm text-slate-600">{(file.size/1024/1024).toFixed(2)} MB · Original retained</p></div>
      <button type="button" disabled={disabled} className="intake-secondary" onClick={()=>input.current?.click()}><Replace size={16} aria-hidden="true"/>Replace file</button>
    </div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4"><p className="text-sm text-slate-600">Only Parts II and II-A are extracted. Review every value before saving.</p>
      <button type="button" disabled={disabled||!schemaReady} className="intake-primary" onClick={()=>onExtract(file)}>Extract information</button>
    </div></>}
    {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
  </div>;
}
