import { useEffect, useRef, useState } from 'react';
import type { FieldEvidence } from '../../services/paperIntakeService';
import { fitScan } from './scanGeometry';

type Props = {
  url: string;
  pdf?: boolean;
  evidence?: FieldEvidence;
  focusBox?: FieldEvidence['bbox'];
  focusSelection?: number;
  label?: string;
  fullSize?: boolean;
  onClose?: () => void;
};

/** The same scan controls work beside the fields and inside the full-size dialog. */
export function ScanViewer({ url, pdf, evidence, focusBox, focusSelection, label, fullSize = false, onClose }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [showHighlight, setShowHighlight] = useState(true);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setBounds({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); setRotation(0); }, [url]);
  useEffect(() => {
    if (!open || fullSize) return;
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { if (node?.open) node.close(); };
  }, [open, fullSize]);

  const fit = fitScan(size.width, size.height, bounds.width, bounds.height, rotation);
  const targetBox = pdf ? undefined : focusBox ?? evidence?.bbox;
  useEffect(() => {
    if (!targetBox) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    if (size.width <= 1 || bounds.width <= 1 || bounds.height <= 1) return;
    const [x1, y1, x2, y2] = targetBox;
    const sideways = rotation % 180 === 90;
    const targetWidth = sideways ? y2-y1 : x2-x1;
    const targetHeight = sideways ? x2-x1 : y2-y1;
    const nextZoom = Math.max(1, Math.min(8, bounds.width / (targetWidth * 1.4 * fit), bounds.height / (targetHeight * 4 * fit)));
    const radians = rotation * Math.PI / 180;
    const dx = (x1+x2)/2-size.width/2, dy = (y1+y2)/2-size.height/2;
    setZoom(nextZoom);
    setPan({ x: -(dx*Math.cos(radians)-dy*Math.sin(radians))*fit*nextZoom,
             y: -(dx*Math.sin(radians)+dy*Math.cos(radians))*fit*nextZoom });
    setShowHighlight(true);
  }, [targetBox, focusSelection, size.width, size.height, bounds.width, bounds.height, fit, rotation]);
  const scale = fit * zoom;
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const closeDialog = () => dialog.current?.close();
  const button = 'min-h-11 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700 disabled:opacity-40';

  return <>
    <section aria-label={fullSize ? 'Full-size original scan' : 'Original scan'} className="flex h-full min-h-0 flex-col bg-slate-100">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-white p-3">
        <h3 id={fullSize ? 'scan-full-title' : undefined} className="mr-auto font-semibold">{fullSize ? 'Original scan — full-size viewer' : 'Original scan'}</h3>
        {fullSize ? <button type="button" className={button} onClick={onClose}>Close viewer</button> :
          <button ref={openButton} type="button" className={`${button} border-purple-700 text-purple-900`} onClick={() => setOpen(true)}>Open full size</button>}
        {!pdf && <>
          <button type="button" className={button} onClick={reset}>Fit</button>
          {fullSize && <button type="button" className={button} onClick={() => { setZoom(Math.max(1, Math.min(16, 1 / Math.max(fit, .01)))); setPan({ x: 0, y: 0 }); }}>Actual size</button>}
          <button type="button" aria-label="Zoom out" className={button} disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value / 1.4))}>Zoom out</button>
          <button type="button" aria-label="Zoom in" className={button} disabled={zoom >= 16} onClick={() => setZoom(value => Math.min(16, value * 1.4))}>Zoom in</button>
          <button type="button" className={button} onClick={() => { setRotation(value => (value + 90) % 360); reset(); }}>Rotate 90°</button>
          {evidence && <button type="button" className={button} aria-pressed={showHighlight} onClick={() => setShowHighlight(value => !value)}>{showHighlight ? 'Hide highlight' : 'Show highlight'}</button>}
        </>}
      </div>
      <p className="shrink-0 px-3 py-2 text-sm text-slate-700" aria-live="polite">{label ? `${label} — ${evidence?.location_kind === 'label_answer_area' ? 'approximate answer area; check for blank or unreadable handwriting' : evidence ? 'source outlined below' : targetBox ? 'source row centered; compare the answer with the scan' : 'compare with the scan'}` : 'Select a field to see its source. Drag or use arrow keys to pan.'}</p>
      <div ref={viewport} tabIndex={pdf ? undefined : 0} aria-label="Scan viewport. Drag or use arrow keys to pan. Use zoom controls to enlarge."
        className="relative min-h-0 flex-1 touch-none overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-700"
        onKeyDown={event => { const moves: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }; const move = moves[event.key]; if (move) { event.preventDefault(); setPan(position => ({ x: position.x + move[0], y: position.y + move[1] })); } }}
        onPointerDown={event => { if (pdf) return; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, left: pan.x, top: pan.y }; }}
        onPointerMove={event => { const start = drag.current; if (start) setPan({ x: start.left + event.clientX - start.x, y: start.top + event.clientY - start.y }); }}
        onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { drag.current = null; }}>
        {pdf ? <iframe title="Complete original PAO Interview Sheet" src={url} className="h-full w-full" /> :
          <div className="absolute left-1/2 top-1/2 origin-center" style={{ width: size.width, height: size.height, transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${scale})` }}>
            <img src={url} draggable={false} alt="Complete original PAO Interview Sheet" className="h-full w-full select-none" onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
            {evidence && showHighlight && <div data-source-highlight aria-label={`Source of ${label}`} className="pointer-events-none absolute bg-transparent" style={{ left: evidence.bbox[0], top: evidence.bbox[1], width: evidence.bbox[2] - evidence.bbox[0], height: evidence.bbox[3] - evidence.bbox[1], outline: `${2 / Math.max(scale, .01)}px solid #b45309`, outlineOffset: `${3 / Math.max(scale, .01)}px` }} />}
          </div>}
      </div>
    </section>
    {!fullSize && <dialog ref={dialog} aria-labelledby="scan-full-title" onCancel={event => { event.preventDefault(); closeDialog(); }}
      onClose={() => { setOpen(false); requestAnimationFrame(() => openButton.current?.focus()); }}
      onClick={event => { if (event.target === event.currentTarget) closeDialog(); }}
      className="m-auto h-[calc(100dvh-1.5rem)] max-h-none w-[calc(100vw-1.5rem)] max-w-none overflow-hidden rounded-lg border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-950/85 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)]">
      {open && <ScanViewer url={url} pdf={pdf} evidence={evidence} focusBox={focusBox} focusSelection={focusSelection} label={label} fullSize onClose={closeDialog} />}
    </dialog>}
  </>;
}
