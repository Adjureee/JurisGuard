import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";

interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel: string;
}

const ConfirmationContext = createContext<((options: ConfirmationOptions) => Promise<boolean>) | null>(null);

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmationOptions | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  const confirm = useCallback((options: ConfirmationOptions) => {
    // Ignore a second trigger while the first decision is still pending.
    if (resolveRef.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setPending(options);
    });
  }, []);

  const finish = useCallback((confirmed: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    dialogRef.current?.close();
    setPending(null);
    resolve?.(confirmed);
  }, []);

  useEffect(() => {
    if (pending) {
      dialogRef.current?.showModal();
      cancelRef.current?.focus();
    }
  }, [pending]);

  useEffect(() => () => {
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  return (
    <ConfirmationContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-black/40"
        onCancel={(event) => { event.preventDefault(); finish(false); }}
        onClose={() => { if (resolveRef.current) finish(false); }}
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">{pending?.title}</h2>
        <p id={messageId} className="mt-3 text-sm text-slate-600">{pending?.message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button ref={cancelRef} type="button" onClick={() => finish(false)} className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-800 focus-visible:outline focus-visible:outline-2">Cancel</button>
          <button type="button" onClick={() => finish(true)} className="rounded-lg bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-800 focus-visible:outline focus-visible:outline-2">{pending?.confirmLabel}</button>
        </div>
      </dialog>
    </ConfirmationContext.Provider>
  );
}

export function useConfirmation() {
  const confirm = useContext(ConfirmationContext);
  if (!confirm) throw new Error("useConfirmation requires ConfirmationProvider");
  return confirm;
}
