export class CameraStartTimeout extends Error {
  constructor() {
    super("Camera permission or startup did not finish. Allow camera access for this site, then try again.");
    this.name = "CameraStartTimeout";
  }
}

/** A browser may leave getUserMedia pending while a permission prompt is unanswered. */
export async function requestCameraStream(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  constraints: MediaStreamConstraints,
  timeoutMs = 15000,
): Promise<MediaStream> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const requested = getUserMedia(constraints).then((stream) => {
    if (expired) {
      stream.getTracks().forEach((track) => track.stop());
      throw new CameraStartTimeout();
    }
    return stream;
  });
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new CameraStartTimeout());
    }, timeoutMs);
  });
  try {
    return await Promise.race([requested, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Keep the live preview available until the browser has encoded the still frame. */
export function encodeJpegFrame(canvas: HTMLCanvasElement, timeoutMs = 10000): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = (message: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail("Photo capture took too long. Try again or upload a saved image."), timeoutMs);
    try {
      canvas.toBlob((blob) => {
        if (finished) return;
        if (!blob?.size || blob.type !== "image/jpeg") {
          fail("Could not encode the photo. Try again or upload a saved image.");
          return;
        }
        finished = true;
        clearTimeout(timer);
        resolve(blob);
      }, "image/jpeg", 0.95);
    } catch {
      fail("Could not encode the photo. Try again or upload a saved image.");
    }
  });
}
