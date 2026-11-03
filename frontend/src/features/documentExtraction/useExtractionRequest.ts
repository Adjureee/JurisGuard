import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

type ActiveRequest = { controller: AbortController; toastId: string };

/** One active extraction per form; late results cannot update a closed/new form. */
export function useExtractionRequest(enabled = true) {
  const active = useRef<ActiveRequest | null>(null);
  const available = useRef(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const cancelExtraction = useCallback(() => {
    const request = active.current;
    active.current = null;
    request?.controller.abort();
    if (request) toast.dismiss(request.toastId);
    setStartedAt(null);
  }, []);

  useEffect(() => {
    available.current = enabled;
    return () => {
      available.current = false;
      cancelExtraction();
    };
  }, [enabled, cancelExtraction]);

  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const startExtraction = (message: string) => {
    // Reject work from a form that has closed or unmounted.
    if (!available.current || active.current) return null;
    const request = { controller: new AbortController(), toastId: toast.loading(message) };
    active.current = request;
    setElapsedSeconds(0);
    setStartedAt(Date.now());
    return request;
  };

  const isCurrentExtraction = (request: ActiveRequest) => active.current === request && !request.controller.signal.aborted;
  const finishExtraction = (request: ActiveRequest) => {
    if (active.current !== request) return;
    active.current = null;
    setStartedAt(null);
  };

  return { isExtracting: startedAt !== null, elapsedSeconds, startExtraction, finishExtraction, isCurrentExtraction, cancelExtraction };
}
