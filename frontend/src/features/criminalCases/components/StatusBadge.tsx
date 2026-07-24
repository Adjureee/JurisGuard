import type { CaseStatus } from "../../../types";

const statusClass: Record<CaseStatus, string> = {
  Pending: "bg-[#FFFBEB] text-[#92400E]",
  Terminated: "bg-[#DC2626] text-white",
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass[status]}`}>
      {status}
    </span>
  );
}

