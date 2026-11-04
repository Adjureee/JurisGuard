import { useCallback, useEffect, useRef, useState } from "react";
import { CameraStartTimeout, encodeJpegFrame, requestCameraStream, waitForPreviewFrame } from "./cameraAccess";

type Props = {
  isExtracting: boolean;
  onUsePhoto: (file: File) => void;
  nextStepLabel?: string;
};
type DraftPhoto = { file: File; url: string };
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function cameraError(error: unknown): string {
  if (error instanceof CameraStartTimeout) return "Camera access or the preview timed out. Check the browser's camera prompt and Windows camera privacy settings, then try again.";
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") return "Camera access is blocked. Allow the camera for this site in your browser and in Windows privacy settings, then try again.";
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") return "No camera is available. Connect or power on a camera, then refresh the list.";
    if (error.name === "NotReadableError" || error.name === "TrackStartError" || error.name === "AbortError") return "The camera is busy or could not start. Close other camera apps, check its privacy shutter, then try again.";
    if (error.name === "OverconstrainedError") return "The selected camera is no longer available. Refresh the list or choose another camera.";
  }
  return "Could not start the camera. Check its connection and browser permissions.";
}

/** Preview a connected camera and submit only a reviewed still image for OCR. */
export function CameraCapture({ isExtracting, onUsePhoto, nextStepLabel = "Use photo for OCR" }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [activeDeviceId, setActiveDeviceId] = useState("");
  const [activeLabel, setActiveLabel] = useState("");
  const [devicesChecked, setDevicesChecked] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [permission, setPermission] = useState<PermissionState | "unavailable">("unavailable");
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
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const cameras = all.filter((device) => device.kind === "videoinput");
    setDevices(cameras);
    setDevicesChecked(true);
    return cameras;
  }, []);

  useEffect(() => {
    const media = navigator.mediaDevices;
    const onDeviceChange = () => { void refreshDevices().catch(() => setDevicesChecked(true)); };
    if (media) {
      void refreshDevices().catch(() => setDevicesChecked(true));
      media.addEventListener?.("devicechange", onDeviceChange);
    } else {
      setDevicesChecked(true);
      setError("This browser cannot access a camera here. Use localhost or a secure connection, or upload a saved image.");
    }
    let cancelled = false;
    let permissionStatus: PermissionStatus | undefined;
    if (navigator.permissions?.query) {
      void navigator.permissions.query({ name: "camera" as PermissionName }).then((status) => {
        if (cancelled) return;
        permissionStatus = status;
        setPermission(status.state);
        status.onchange = () => setPermission(status.state);
      }).catch(() => setPermission("unavailable"));
    }
    return () => {
      cancelled = true;
      media?.removeEventListener?.("devicechange", onDeviceChange);
      if (permissionStatus) permissionStatus.onchange = null;
      stopCamera();
    };
  }, [refreshDevices, stopCamera]);

  useEffect(() => () => {
    if (draft) URL.revokeObjectURL(draft.url);
  }, [draft]);

  const detectCameras = async () => {
    if (refreshing || capturing || isExtracting) return;
    if (!navigator.mediaDevices?.enumerateDevices) {
      setError("Camera capture requires localhost or a secure connection in a supported browser.");
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const found = await refreshDevices();
      if (!found.length) setError("No camera is listed. Connect a camera, check its power, then refresh again.");
    } catch (cause) {
      setError(`Could not list cameras. ${cameraError(cause)}`);
    } finally {
      setRefreshing(false);
    }
  };

  const startCamera = async (selectedDeviceId = deviceId) => {
    if (capturing || isExtracting) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera capture requires a supported browser on localhost or a secure connection. You can upload a saved image instead.");
      return;
    }
    stopCamera();
    setDeviceId(selectedDeviceId);
    setActive(false);
    setActiveDeviceId("");
    setActiveLabel("");
    setCameraDetails(null);
    setStarting(true);
    setError(null);
    const requestId = requestRef.current;
    let stream: MediaStream | null = null;
    try {
      stream = await requestCameraStream(navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices), {
        audio: false,
        video: {
          ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
          width: { ideal: 3840 },
          height: { ideal: 3840 },
          resizeMode: { ideal: "none" },
        } as MediaTrackConstraints & { resizeMode: { ideal: string } },
      });
      if (requestId !== requestRef.current || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      let playbackTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          video.play(),
          new Promise<never>((_, reject) => {
            playbackTimer = setTimeout(() => reject(new CameraStartTimeout()), 10000);
          }),
        ]);
      } finally {
        clearTimeout(playbackTimer);
      }
      await waitForPreviewFrame(video);
      if (requestId !== requestRef.current) return;
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState !== "live") throw new Error("The selected camera stopped before a preview appeared.");
      const chosen = track.getSettings().deviceId || selectedDeviceId;
      if (chosen) setDeviceId(chosen);
      setActiveDeviceId(chosen);
      setActiveLabel(track.label || devices.find((device) => device.deviceId === chosen)?.label || "Current camera");
      setCameraDetails(`${video.videoWidth} × ${video.videoHeight} preview ready`);
      setActive(true);
      track.addEventListener("ended", () => {
        if (requestId !== requestRef.current) return;
        stopCamera();
        setActive(false);
        setActiveDeviceId("");
        setActiveLabel("");
        setCameraDetails(null);
        setError("The camera disconnected or stopped. Refresh the camera list and try again.");
      }, { once: true });
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
      setActive(false);
      setActiveDeviceId("");
      setActiveLabel("");
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
      setActiveDeviceId("");
      setActiveLabel("");
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
        className={`${(active || starting) && !draft ? "block" : "hidden"} mt-3 min-h-60 max-h-[48dvh] w-full rounded-md border border-[#E5E7EB] bg-black object-contain`}
      />
      {starting && <p role="status" className="mt-2 text-sm text-[#4B5563]">Waiting for camera permission and a live preview. Check the browser address bar if prompted.</p>}
      {active && <p className="mt-2 text-sm font-semibold text-[#2B3642]" aria-live="polite">Active camera: {activeLabel}{cameraDetails ? ` · ${cameraDetails}` : ""}</p>}
      {!draft && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-[#4B5563]" aria-live="polite">
            {permission === "denied" ? "Camera permission is blocked for this site. Allow access in the browser and Windows settings, then retry." :
              !devicesChecked ? "Checking for connected cameras…" :
                !devices.length ? "No cameras detected. Check the connection and refresh the list." :
                  `${devices.length} camera${devices.length === 1 ? "" : "s"} detected${devices.some((device) => !device.label) ? ". Camera names appear after browser permission is granted." : "."}`}
          </p>
          {devices.length > 0 && (
            <label className="block text-sm font-medium text-[#2B3642]">
              Camera to preview
              <select
                value={deviceId}
                onChange={(event) => {
                  void startCamera(event.target.value);
                }}
                disabled={isExtracting || capturing || starting}
                className="mt-1 block min-h-11 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]"
              >
                <option value="">Automatic — browser chooses</option>
                {devices.map((device, index) => device.deviceId ? (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${index + 1}`}{active && device.deviceId === activeDeviceId ? " — active" : ""}
                  </option>
                ) : (
                  <option key={`unidentified-${index}`} value={`unidentified-${index}`} disabled>
                    Camera {index + 1} — allow access to identify
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void detectCameras()} disabled={refreshing || starting || capturing || isExtracting}
              className="min-h-11 rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] disabled:opacity-50">
              {refreshing ? "Refreshing cameras…" : "Refresh camera list"}
            </button>
            {!active ? (
              <button type="button" onClick={() => void startCamera()} disabled={starting || capturing || isExtracting}
                className="min-h-11 rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] disabled:opacity-50">
                {starting ? "Waiting for preview…" : "Start camera preview"}
              </button>
            ) : (
              <>
                <button type="button" onClick={() => void capturePhoto()} disabled={capturing || isExtracting}
                  className="min-h-11 rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] disabled:opacity-50">
                  {capturing ? "Saving photo..." : "Capture photo"}
                </button>
                <button type="button" onClick={() => { stopCamera(); setActive(false); setActiveDeviceId(""); setActiveLabel(""); setCameraDetails(null); }} disabled={capturing}
                  className="min-h-11 rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] disabled:opacity-50">
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
              {isExtracting ? "Extracting..." : nextStepLabel}
            </button>
          </div>
          <p className="text-xs text-[#4B5563]">If any line looks blurred, retake the photo before OCR.</p>
        </div>
      )}
      <p className="mt-3 text-xs text-[#4B5563]">
        If the camera is not listed, save an image with its scanning software and use the upload option.
      </p>
    </section>
  );
}
