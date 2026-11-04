import { useCallback, useEffect, useRef, useState } from "react";
import { CameraStartTimeout, encodeJpegFrame, requestCameraStream } from "./cameraAccess";

type Props = {
  isExtracting: boolean;
  onUsePhoto: (file: File) => void;
};
type DraftPhoto = { file: File; url: string };
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function cameraError(error: unknown): string {
  if (error instanceof CameraStartTimeout) return error.message;
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "Camera access was denied. Allow it in your browser and try again.";
    if (error.name === "NotFoundError") return "No camera was found. Check its USB connection and power.";
    if (error.name === "NotReadableError") return "The camera could not start. Close other camera apps and try again.";
    if (error.name === "OverconstrainedError") return "The selected camera is unavailable. Choose another camera.";
  }
  return "Could not start the camera. Check its connection and browser permissions.";
}

/** Preview a connected camera and submit only a reviewed still image for OCR. */
export function CameraCapture({ isExtracting, onUsePhoto }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
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
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const cameras = all.filter((device) => device.kind === "videoinput");
    setDevices(cameras);
    return cameras;
  }, []);

  useEffect(() => {
    const media = navigator.mediaDevices;
    const onDeviceChange = () => { void refreshDevices().catch(() => {}); };
    if (media) {
      void media.enumerateDevices()
        .then((all) => setDevices(all.filter((device) => device.kind === "videoinput")))
        .catch(() => { /* Device labels may require camera permission. */ });
      media.addEventListener?.("devicechange", onDeviceChange);
    }
    return () => {
      media?.removeEventListener?.("devicechange", onDeviceChange);
      stopCamera();
    };
  }, [refreshDevices, stopCamera]);

  useEffect(() => () => {
    if (draft) URL.revokeObjectURL(draft.url);
  }, [draft]);

  const detectCameras = async () => {
    if (starting || capturing || isExtracting) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera capture requires localhost or a secure connection in a supported browser.");
      return;
    }
    stopCamera();
    setActive(false);
    setCameraDetails(null);
    setStarting(true);
    setError(null);
    const requestId = requestRef.current;
    let probe: MediaStream | null = null;
    try {
      probe = await requestCameraStream(navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices), { video: true, audio: false });
      if (requestId !== requestRef.current) return;
      const found = await refreshDevices();
      if (requestId !== requestRef.current) return;
      if (found.length === 1) setDeviceId(found[0].deviceId);
      else if (!found.some((device) => device.deviceId === deviceId)) setDeviceId("");
      if (!found.length) setError("No camera was listed. Check its USB connection and browser permission.");
    } catch (cause) {
      if (requestId === requestRef.current) setError(cameraError(cause));
    } finally {
      probe?.getTracks().forEach((track) => track.stop());
      if (requestId === requestRef.current) setStarting(false);
    }
  };

  const startCamera = async () => {
    if (starting || capturing || isExtracting) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera capture requires a supported browser on localhost or a secure connection. You can upload a saved image instead.");
      return;
    }
    stopCamera();
    setActive(false);
    setCameraDetails(null);
    setStarting(true);
    setError(null);
    const requestId = requestRef.current;
    let stream: MediaStream | null = null;
    try {
      stream = await requestCameraStream(navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices), {
        audio: false,
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
      });
      if (requestId !== requestRef.current || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      let playbackTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          videoRef.current.play(),
          new Promise<never>((_, reject) => {
            playbackTimer = setTimeout(() => reject(new CameraStartTimeout()), 10000);
          }),
        ]);
      } finally {
        clearTimeout(playbackTimer);
      }
      if (requestId !== requestRef.current) return;
      setActive(true);
      const track = stream.getVideoTracks()[0];
      const chosen = track?.getSettings().deviceId;
      if (chosen) setDeviceId(chosen);
      setCameraDetails(`${track?.label || "Camera"} · ${videoRef.current.videoWidth} × ${videoRef.current.videoHeight}`);
      try {
        await refreshDevices();
      } catch {
        // The active camera still works if device enumeration fails.
      }
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      stream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === stream) streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraDetails(null);
      setError(cameraError(cause));
    } finally {
      if (requestId === requestRef.current) setStarting(false);
    }
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!active || !video || capturing || isExtracting) return;
    const { videoWidth: width, videoHeight: height } = video;
    if (!width || !height) {
      setError("The camera image is not ready yet. Wait for the page to appear.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Could not capture this image. Try again or upload a saved image.");
      return;
    }
    setCapturing(true);
    setError(null);
    const requestId = requestRef.current;
    try {
      context.drawImage(video, 0, 0, width, height);
      const blob = await encodeJpegFrame(canvas);
      if (requestId !== requestRef.current) return;
      if (blob.size > MAX_IMAGE_BYTES) throw new Error("The photo exceeds 25 MB. Retake it or upload a saved image.");
      const file = new File([blob], `document-camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      const url = URL.createObjectURL(file);
      stopCamera();
      setActive(false);
      setCameraDetails(null);
      setImageReady(false);
      setZoomed(false);
      setDraft({ file, url });
    } catch (cause) {
      if (requestId === requestRef.current) {
        setError(cause instanceof Error ? cause.message : "Could not capture this photo. Try again or upload a saved image.");
      }
    } finally {
      setCapturing(false);
    }
  };

  const retake = () => {
    if (isExtracting) return;
    setDraft(null);
    setImageReady(false);
    setZoomed(false);
    setError(null);
    void startCamera();
  };

  return (
    <section aria-label="Document camera capture" className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
      <p className="text-sm font-semibold text-[#2B3642]">Capture with a document camera</p>
      <p className="mt-1 text-sm text-[#4B5563]">
        Place the page flat under the camera. Let focus settle, capture a still photo, and check the text before OCR.
      </p>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label="Document camera preview"
        className={`${(active || starting) && !draft ? "block" : "hidden"} mt-3 max-h-[55vh] w-full rounded-md border border-[#E5E7EB] bg-black object-contain`}
      />
      {cameraDetails && active && <p className="mt-2 text-xs text-[#4B5563]" aria-live="polite">Using {cameraDetails}</p>}
      {!draft && (
        <div className="mt-3 space-y-3">
          {devices.length > 0 && (
            <label className="block text-sm font-medium text-[#2B3642]">
              Camera
              <select
                value={deviceId}
                onChange={(event) => {
                  stopCamera();
                  setActive(false);
                  setStarting(false);
                  setCameraDetails(null);
                  setDeviceId(event.target.value);
                  setError(null);
                }}
                disabled={isExtracting || capturing}
                className="mt-1 block w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2"
              >
                <option value="">Default camera</option>
                {devices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {!active && <button type="button" onClick={() => void detectCameras()} disabled={starting || capturing || isExtracting}
              className="rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] disabled:opacity-50">
              {starting ? "Waiting for camera..." : "Detect cameras"}
            </button>}
            {!active ? (
              <button type="button" onClick={() => void startCamera()} disabled={starting || capturing || isExtracting}
                className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {starting ? "Waiting for camera..." : "Start document camera"}
              </button>
            ) : (
              <>
                <button type="button" onClick={() => void capturePhoto()} disabled={capturing || isExtracting}
                  className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {capturing ? "Saving photo..." : "Capture photo"}
                </button>
                <button type="button" onClick={() => { stopCamera(); setActive(false); setCameraDetails(null); }} disabled={capturing}
                  className="rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] disabled:opacity-50">
                  Stop camera
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      {draft && (
        <div className="mt-4 space-y-3">
          <div className="max-h-[55vh] overflow-auto rounded-md border border-[#E5E7EB] bg-white">
            <img src={draft.url} alt="Captured document for sharpness review"
              className={zoomed ? "max-w-none" : "max-h-[55vh] w-full object-contain"}
              onLoad={() => setImageReady(true)}
              onError={() => { setImageReady(false); setError("This photo cannot be previewed. Retake it or upload a saved image."); }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={zoomed} onClick={() => setZoomed((current) => !current)}
              className="rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389]">
              {zoomed ? "Fit photo to window" : "Zoom in to check text"}
            </button>
            <button type="button" onClick={retake} disabled={isExtracting}
              className="rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] disabled:opacity-50">
              Retake photo
            </button>
            <button type="button" disabled={!imageReady || isExtracting} onClick={() => onUsePhoto(draft.file)}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {isExtracting ? "Extracting..." : "Use photo for OCR"}
            </button>
          </div>
          <p className="text-xs text-[#4B5563]">If any line looks blurred, retake the photo before OCR.</p>
        </div>
      )}
      <p className="mt-3 text-xs text-[#4B5563]">
        If the camera is not listed, save an image with its scanning software and use Upload Document.
      </p>
    </section>
  );
}
