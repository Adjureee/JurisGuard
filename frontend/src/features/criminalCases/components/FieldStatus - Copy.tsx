import type { ExtractionStatus } from "../../../types";

export function FieldStatus({ status }: { status?: ExtractionStatus }) {
  if (!status) return null;

  return (
    <span
      className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        status === "extracted"
          ? "bg-emerald-50 text-emerald-700"
          : "bg-amber-50 text-amber-700"
      }`}
    >
      {status === "extracted" ? "Extracted" : "Missing"}
    </span>
  );
}

