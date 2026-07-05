import type { ExtractionStatus } from "../../../types";

export function FieldStatus({ status }: { status?: ExtractionStatus }) {
  if (!status) return null;

  return (
    <span
      className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        status === "extracted"
          ? "bg-emerald-50 dark:bg-emerald-400/10 text-emerald-800 dark:text-emerald-300"
          : "bg-amber-50 dark:bg-amber-400/10 text-amber-800 dark:text-amber-300"
      }`}
    >
      {status === "extracted" ? "Extracted" : "Missing"}
    </span>
  );
}


