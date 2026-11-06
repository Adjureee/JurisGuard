import { useEffect, useRef, useState } from 'react';
import { useConfirmation } from '../../components/ConfirmationProvider';
import { prepareCameraCapture } from '../../services/paperIntakeService';
import { defaultImageAdjustments, prepareCameraImage, type ImagePoint } from './cameraImagePreparation';

type Crop = {left:number;top:number;right:number;bottom:number};
const full:Crop={left:0,top:0,right:1,bottom:1};
export function CameraImageReview({ original, disabled, canExtract=true, onExtract, onRetake }: {
  original:File; disabled:boolean; canExtract?:boolean; onExtract:(file:File)=>void; onRetake:()=>void;
}) {
  const confirm=useConfirmation();
  const [base,setBase]=useState<File>();
  const [crop,setCrop]=useState<Crop>(full);
  const [selected,setSelected]=useState<File>();
  const [originalUrl,setOriginalUrl]=useState('');
  const [baseUrl,setBaseUrl]=useState('');
  const [preview,setPreview]=useState('');
  const [warnings,setWarnings]=useState<string[]>([]);
  const [preparing,setPreparing]=useState(true);
  const [rendering,setRendering]=useState(false);
  const [error,setError]=useState('');
  const drag=useRef<{index:number;x:number;y:number;crop:Crop}|null>(null);
  const valid=crop.right-crop.left>=.05&&crop.bottom-crop.top>=.05&&Object.values(crop).every(v=>Number.isFinite(v)&&v>=0&&v<=1);
  const busy=disabled||preparing;
  useEffect(()=>{const url=URL.createObjectURL(original);setOriginalUrl(url);return()=>URL.revokeObjectURL(url);},[original]);
  useEffect(()=>{
    const controller=new AbortController();setPreparing(true);setBase(undefined);setSelected(undefined);setCrop(full);
    prepareCameraCapture(original,controller.signal).then(result=>{if(!controller.signal.aborted){setBase(result.file);setWarnings(result.warnings);}})
      .catch(()=>{if(!controller.signal.aborted){setBase(original);setWarnings(['Automatic cleanup is unavailable. The original is shown. Adjust the crop manually, or retake if it is unclear or not upright.']);}})
      .finally(()=>{if(!controller.signal.aborted)setPreparing(false);});
    return()=>controller.abort();
  },[original]);
  useEffect(()=>{if(!base)return;const url=URL.createObjectURL(base);setBaseUrl(url);return()=>URL.revokeObjectURL(url);},[base]);
  useEffect(()=>{
    let active=true;let url='';setSelected(undefined);setPreview('');setError('');
    if(!base||!valid){setRendering(false);return;}
    setRendering(true);
    const timer=setTimeout(()=>{
      const unchanged=Object.keys(full).every(key=>crop[key as keyof Crop]===full[key as keyof Crop]);
      const corners:ImagePoint[]=[[crop.left,crop.top],[crop.right,crop.top],[crop.right,crop.bottom],[crop.left,crop.bottom]];
      const work=unchanged?Promise.resolve(base):prepareCameraImage(base,{...defaultImageAdjustments(),corners},4096,true);
      void work.then(file=>{if(!active)return;url=URL.createObjectURL(file);setSelected(file);setPreview(url);})
        .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Could not update the crop. Reset or retake the photo.');})
        .finally(()=>{if(active)setRendering(false);});
    },150);
    return()=>{active=false;clearTimeout(timer);if(url)URL.revokeObjectURL(url);};
  },[base,crop,valid]);
  return <section aria-label="Review captured image" className="mt-4 space-y-4">
    <div><h3 className="text-lg font-semibold text-slate-900">Review crop</h3><p className="mt-1 text-sm leading-6 text-slate-600">Keep all Part II and Part II-A fields and checkbox marks visible, including a blank representative section. Drag a corner to resize, or drag inside the crop to move it.</p></div>
    {preparing&&<p role="status" className="rounded bg-purple-50 p-4">Checking the page and improving readability locally…</p>}
    {!!warnings.length&&<div role="status" className="rounded border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">{warnings.map(w=><p key={w}>{w}</p>)}</div>}
    {baseUrl&&<div className="grid items-start gap-5 lg:grid-cols-2">
      <div><p className="mb-2 text-sm font-semibold">Crop</p><div className="relative overflow-hidden rounded-lg border border-slate-300 bg-slate-100">
        <img src={baseUrl} alt="Automatically prepared camera image with adjustable crop" className="block w-full"/>
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full touch-none" aria-label="Crop boundaries"
          onPointerMove={event=>{const d=drag.current;if(!d||busy)return;const box=event.currentTarget.getBoundingClientRect();const x=Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)),y=Math.max(0,Math.min(1,(event.clientY-box.top)/box.height));
            if(d.index===4){const dx=Math.max(-d.crop.left,Math.min(1-d.crop.right,x-d.x)),dy=Math.max(-d.crop.top,Math.min(1-d.crop.bottom,y-d.y));setCrop({left:d.crop.left+dx,right:d.crop.right+dx,top:d.crop.top+dy,bottom:d.crop.bottom+dy});}
            else setCrop({left:d.index===0||d.index===3?Math.min(x,d.crop.right-.05):d.crop.left,right:d.index===1||d.index===2?Math.max(x,d.crop.left+.05):d.crop.right,top:d.index<2?Math.min(y,d.crop.bottom-.05):d.crop.top,bottom:d.index>=2?Math.max(y,d.crop.top+.05):d.crop.bottom});}}
          onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
          onPointerDown={event=>{if(busy)return;const box=event.currentTarget.getBoundingClientRect();const index=Number((event.target as SVGElement).getAttribute('data-handle')??4);drag.current={index,x:(event.clientX-box.left)/box.width,y:(event.clientY-box.top)/box.height,crop};event.currentTarget.setPointerCapture(event.pointerId);}}>
          <path d={`M0 0H1000V1000H0Z M${crop.left*1000} ${crop.top*1000}V${crop.bottom*1000}H${crop.right*1000}V${crop.top*1000}Z`} fill="rgba(15,23,42,.35)" fillRule="evenodd" pointerEvents="none"/>
          <rect x={crop.left*1000} y={crop.top*1000} width={(crop.right-crop.left)*1000} height={(crop.bottom-crop.top)*1000} fill="transparent" stroke="#704389" strokeWidth="3" vectorEffect="non-scaling-stroke" className="cursor-move"/>
          {[[crop.left,crop.top],[crop.right,crop.top],[crop.right,crop.bottom],[crop.left,crop.bottom]].map((p,i)=><circle data-handle={i} key={i} cx={p[0]*1000} cy={p[1]*1000} r="25" fill="white" stroke="#704389" strokeWidth="4" className="cursor-nwse-resize"/>)}
        </svg>
      </div>
      <fieldset disabled={busy} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"><legend className="sr-only">Crop boundaries in percent</legend>{(['left','top','right','bottom'] as const).map(key=><label key={key} className="text-sm capitalize">{key} (%)<input aria-label={`${key} crop (%)`} type="number" min="0" max="100" step="1" value={Math.round(crop[key]*1000)/10} onChange={e=>setCrop(previous=>({...previous,[key]:Number(e.target.value)/100}))} className="mt-1 min-h-11 w-full rounded border border-slate-300 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-800"/></label>)}</fieldset></div>
      <div><p className="mb-2 text-sm font-semibold">Image sent to OCR</p>{rendering?<p role="status" className="rounded bg-purple-50 p-4">Updating crop preview…</p>:preview?<img src={preview} alt="Selected image sent to OCR" className="w-full rounded-lg border border-slate-300"/>:null}<p className="mt-2 text-sm leading-6 text-slate-600">Check handwriting, punctuation and Oo/Hindi marks. Retake if glare, blur or a cut-off field hides any content.</p></div>
    </div>}
    <details className="text-sm"><summary className="cursor-pointer rounded py-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-800">View original capture</summary>{originalUrl&&<img src={originalUrl} alt="Complete original camera capture" className="mt-2 max-h-96 w-full object-contain"/>}</details>
    {!valid&&<p role="alert" className="text-sm text-rose-800">Keep the crop inside the photo and include a visible area. Reset crop to restore the full prepared image.</p>}
    {error&&<p role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
      <button type="button" disabled={busy} className="intake-secondary" onClick={async()=>{if(await confirm({title:'Retake this photo?',message:'Discard this capture and crop, then reopen the camera. Cancel to keep reviewing.',confirmLabel:'Retake photo'}))onRetake();}}>Retake photo</button>
      <button type="button" disabled={busy} className="intake-secondary" onClick={()=>setCrop(full)}>Reset crop</button>
      <button type="button" disabled={busy||!canExtract||rendering||!selected||!valid||!!error} className="intake-primary sm:ml-auto" onClick={()=>{if(selected&&!rendering)onExtract(selected);}}>Extract information</button>
    </div>
    {!canExtract&&<p role="status" className="text-sm text-slate-600">Waiting for intake fields. Your image is kept.</p>}
  </section>;
}
