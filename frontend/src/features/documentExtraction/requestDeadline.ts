export class ExtractionRequestStopped extends Error {
  constructor(public readonly reason: "timeout" | "cancelled") {
    super(reason === "timeout"
      ? "Extraction took too long. Try one clear page at a time or enter the fields manually."
      : "Extraction cancelled.");
    this.name = "ExtractionRequestStopped";
  }
}

/** A wall-clock deadline also covers a connection that never returns a response. */
export async function withExtractionDeadline<T>(
  perform: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new ExtractionRequestStopped("cancelled");
  const controller = new AbortController();
  let rejectStop!: (reason: ExtractionRequestStopped) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = (reason: "timeout" | "cancelled") => {
    rejectStop(new ExtractionRequestStopped(reason));
    controller.abort();
  };
  const cancel = () => stop("cancelled");
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  try {
    return await Promise.race([perform(controller.signal), stopped]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
