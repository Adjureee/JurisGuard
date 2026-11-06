import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Camera } from "lucide-react";
import { CameraStartTimeout, encodeJpegFrame, requestCameraStream } from "./cameraAccess";
import ModalPortal from "../../components/modals/ModalPortal";

type Props = {
  isExtracting: boolean;
  onUsePhoto: (file: File) => void;
  onClose: () => void;
};
type DraftPhoto = { file: File; url: string };
type CameraStage = "select" | "live" | "review";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function cameraError(error: unknown): string {
  if (error instanceof CameraStartTimeout) return error.message;
  const details = error && typeof error === "object"
    ? error as { name?: unknown; message?: unknown }
    : undefined;
  const name = typeof details?.name === "string" ? details.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access was blocked. Allow camera access for this site in your browser settings, then try again.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found. Check its USB connection and power.";
  if (name === "NotReadableError" || name === "TrackStartError") return "The camera is unavailable or already in use. Close other camera apps, then try again.";
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") return "The selected camera cannot use the requested settings. Choose another camera.";
  if (name === "AbortError") return "Camera startup was interrupted. Try again, or close and reopen the camera dialog.";
  if (name === "InvalidStateError") return "The browser could not start the camera from this page. Reopen the camera dialog and try again.";
  if (name === "TypeError") return "The browser rejected the camera request. Check that this page is open on localhost or a secure HTTPS connection.";
  if (typeof details?.message === "string" && details.message.trim()) return `Could not start the camera: ${details.message}`;
  return "Could not start the camera. Check browser camera permission, camera connection, and whether another app is using it.";
}

function CameraModal({ title, subtitle, onClose, children }: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  return <ModalPortal><div ref={dialogRef} className="jurisguard-modal-overlay bg-black/70 p-3 backdrop-blur-sm sm:p-5" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key !== "Tab") return;
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled]),input:not([disabled]),[tabindex="0"]') ?? []).filter(node => node.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className="mx-auto flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
      <header className="flex shrink-0 items-start justify-between gap-4 bg-[#704389] px-5 py-4 text-white">
        <div className="flex min-w-0 items-start gap-3"><Camera className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />
          <div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 text-sm leading-5 text-white/85">{subtitle}</p></div>
        </div>
        <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-md border border-white/70 bg-white/10 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Close</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
    </div>
  </div></ModalPortal>;
}

/** Camera selection, live preview, and still review use separate modal stages. */
export function CameraCapture({ isExtracting, onUsePhoto, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [stage, setStage] = useState<CameraStage>("select");
  const [starting, setStarting] = useState(false);
  const [active, setActive] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [draft, setDraft] = useState<DraftPhoto | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraDetails, setCameraDetails] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    requestRef.current += 1;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const cameras = all.filter(device => device.kind === "videoinput");
    setDevices(cameras);
    return cameras;
  }, []);

  useEffect(() => {
    const media = navigator.mediaDevices;
    const onDeviceChange = () => { void refreshDevices().catch(() => {}); };
    if (media) {
      void media.enumerateDevices().then(all => setDevices(all.filter(device => device.kind === "videoinput"))).catch(() => {});
      media.addEventListener?.("devicechange", onDeviceChange);
    }
    return () => {
      media?.removeEventListener?.("devicechange", onDeviceChange);
      stopCamera();
    };
  }, [refreshDevices, stopCamera]);

  useEffect(() => () => { if (draft) URL.revokeObjectURL(draft.url); }, [draft]);

  const closeStage = useCallback(() => {
    stopCamera();
    setActive(false);
    setStarting(false);
    setCameraDetails(null);
    setError(null);
    if (stage === "select") onClose();
    else {
      setStage("select");
      if (stage === "review") { setDraft(null); setImageReady(false); setZoomed(false); }
    }
  }, [onClose, stage, stopCamera]);

  const detectCameras = async () => {
    if (starting || capturing || isExtracting) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera capture requires localhost or a secure connection in a supported browser.");
      return;
    }
    stopCamera(); setActive(false); setCameraDetails(null); setStarting(true); setError(null);
    const requestId = requestRef.current;
    let probe: MediaStream | null = null;
    try {
      // Request access before enumerating. Browsers may hide local cameras
      // until a camera stream has been granted.
      probe = await requestCameraStream(navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices), { video: true, audio: false });
      if (requestId !== requestRef.current) return;
      const found = await refreshDevices();
      if (requestId !== requestRef.current) return;
      if (found.length === 1) setDeviceId(found[0].deviceId);
      else if (!found.some(device => device.deviceId === deviceId)) setDeviceId("");
      if (!found.length) setError("No camera was listed. Check its USB connection and browser permission.");
    } catch (cause) {
      if (requestId === requestRef.current) setError(cameraError(cause));
    } finally {
      probe?.getTracks().forEach(track => track.stop());
      if (requestId === requestRef.current) setStarting(false);
    }
  };

  const startCamera = useCallback(async () => {
    if (starting || capturing || isExtracting) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera capture requires a supported browser on localhost or a secure connection. You can upload a saved image instead.");
      setStage("select");
      return;
    }
    setStarting(true); setError(null);
    const requestId = requestRef.current;
    let stream: MediaStream | null = null;
    try {
      // Let the browser choose this camera's supported default resolution. High
      // ideal dimensions can make some drivers fail with NotReadableError.
      stream = await requestCameraStream(navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices), {
        audio: false,
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      if (requestId !== requestRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      // The live-preview modal is mounted by the same click that requested the
      // stream. Wait one paint if React has not attached its video element yet.
      if (!videoRef.current) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (requestId !== requestRef.current) return;
      const video = videoRef.current;
      if (!video) throw new Error("The camera preview could not be opened. Close this dialog and try again.");
      video.srcObject = stream;
      let playbackTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([video.play(), new Promise<never>((_, reject) => { playbackTimer = setTimeout(() => reject(new CameraStartTimeout()), 10000); })]);
      } finally { clearTimeout(playbackTimer); }
      if (requestId !== requestRef.current) return;
      setActive(true);
      const track = stream.getVideoTracks()[0];
      const chosen = track?.getSettings().deviceId;
      if (chosen) setDeviceId(chosen);
      setCameraDetails(`${track?.label || "Camera"} · ${video.videoWidth} × ${video.videoHeight}`);
      try { await refreshDevices(); } catch { /* Active capture remains usable if device enumeration fails. */ }
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      stream?.getTracks().forEach(track => track.stop());
      if (streamRef.current === stream) streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraDetails(null); setError(cameraError(cause)); setStage("select");
    } finally {
      if (requestId === requestRef.current) setStarting(false);
    }
  }, [capturing, deviceId, isExtracting, refreshDevices, starting]);

  const beginCamera = () => {
    if (starting || capturing || isExtracting) return;
    setError(null); setActive(false); setCameraDetails(null); setStage("live");
    // Call getUserMedia in the click handler to preserve the browser's user activation.
    void startCamera();
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!active || !video || capturing || isExtracting) return;
    const { videoWidth: width, videoHeight: height } = video;
    if (!width || !height) { setError("The camera image is not ready yet. Wait for the page to appear."); return; }
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) { setError("Could not capture this image. Try again or upload a saved image."); return; }
    setCapturing(true); setError(null);
    const requestId = requestRef.current;
    try {
      context.drawImage(video, 0, 0, width, height);
      const blob = await encodeJpegFrame(canvas);
      if (requestId !== requestRef.current) return;
      if (blob.size > MAX_IMAGE_BYTES) throw new Error("The photo exceeds 25 MB. Retake it or upload a saved image.");
      const file = new File([blob], `document-camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      stopCamera(); setActive(false); setCameraDetails(null); setImageReady(false); setZoomed(false);
      setDraft({ file, url: URL.createObjectURL(file) }); setStage("review");
    } catch (cause) {
      if (requestId === requestRef.current) setError(cause instanceof Error ? cause.message : "Could not capture this photo. Try again or upload a saved image.");
    } finally { setCapturing(false); }
  };

  const retake = () => {
    if (isExtracting) return;
    setDraft(null); setImageReady(false); setZoomed(false); setError(null); beginCamera();
  };

  return <>
    {stage === "select" && <CameraModal title="Capture with a document camera" subtitle="Place the page flat under the camera. Let focus settle, capture a still photo, and check the text before OCR." onClose={closeStage}>
      <div className="space-y-4">
        {devices.length > 0 && <label className="block text-sm font-medium text-[#2B3642]">Camera<select value={deviceId} onChange={event => { setDeviceId(event.target.value); setError(null); }} disabled={starting || capturing || isExtracting} className="mt-1 block min-h-11 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2"><option value="">Default camera</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void detectCameras()} disabled={starting || capturing || isExtracting} className="min-h-11 rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] disabled:opacity-50">{starting ? "Waiting for camera…" : "Detect cameras"}</button>
          <button type="button" onClick={beginCamera} disabled={starting || capturing || isExtracting} className="min-h-11 rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5F3675] disabled:opacity-50">Start document camera</button>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <p className="text-sm text-[#4B5563]">If the camera is not listed, save an image with its scanning software and use Upload Document.</p>
      </div>
    </CameraModal>}

    {stage === "live" && <CameraModal title="Capture with a document camera" subtitle="Place the page flat under the camera. Let focus settle, capture a still photo, and check the text before OCR." onClose={closeStage}>
      <div className="space-y-4">
        <video ref={videoRef} autoPlay muted playsInline aria-label="Document camera preview" className="max-h-[65vh] min-h-64 w-full rounded-lg border border-[#D1D5DB] bg-black object-contain" />
        {cameraDetails && active && <p className="text-sm text-[#4B5563]" aria-live="polite">Using {cameraDetails}</p>}
        {starting && <p role="status" className="text-sm text-[#4B5563]">Connecting to the selected camera…</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void capturePhoto()} disabled={!active || capturing || isExtracting} className="min-h-11 rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5F3675] disabled:opacity-50">{capturing ? "Saving photo…" : "Capture photo"}</button>
          <button type="button" onClick={closeStage} disabled={capturing} className="min-h-11 rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] disabled:opacity-50">Stop camera</button>
        </div>
      </div>
    </CameraModal>}

    {stage === "review" && draft && <CameraModal title="Capture with a document camera" subtitle="Captured document for sharpness review" onClose={closeStage}>
      <div className="space-y-4">
        <div className="max-h-[62vh] overflow-auto rounded-lg border border-[#D1D5DB] bg-slate-100">
          <img src={draft.url} alt="Captured paper document" className={zoomed ? "max-w-none" : "max-h-[62vh] w-full object-contain"} onLoad={() => setImageReady(true)} onError={() => { setImageReady(false); setError("This photo cannot be previewed. Retake it or use another camera."); }} />
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={zoomed} onClick={() => setZoomed(current => !current)} className="min-h-11 rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389]">{zoomed ? "Fit photo to window" : "Zoom in to check text"}</button>
          <button type="button" onClick={retake} disabled={isExtracting} className="min-h-11 rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] disabled:opacity-50">Retake photo</button>
          <button type="button" disabled={!imageReady || isExtracting} onClick={() => onUsePhoto(draft.file)} className="min-h-11 rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5F3675] disabled:opacity-50">Use this photo</button>
        </div>
        <p className="text-sm text-[#4B5563]">If any line looks blurred, retake the photo before OCR.</p>
      </div>
    </CameraModal>}
  </>;
}
