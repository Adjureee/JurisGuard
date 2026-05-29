import type { ExtractionStatus } from "../../../types";

export function FieldStatus({ status }: { status?: ExtractionStatus }) {
  if (!status) return null;

  return (
    <span
      className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        status === "extracted"
          ? "bg-[#ECFDF5] text-[#065F46]"
          : "bg-[#FFFBEB] text-[#92400E]"
      }`}
    >
      {status === "extracted" ? "Extracted" : "Missing"}
    </span>
  );
}

