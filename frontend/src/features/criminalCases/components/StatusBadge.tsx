import type { CaseStatus } from "../../../types";

const statusClass: Record<CaseStatus, string> = {
  Pending: "bg-[#FFFBEB] text-[#92400E]",
  Ongoing: "bg-[#ECFDF5] text-[#065F46]",
  Active: "bg-[#ECFDF5] text-[#065F46]",
  Terminated: "bg-[#DC2626] text-white",
  Archived: "bg-[#F8FAFC] text-[#4B5563]",
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass[status]}`}>
      {status}
    </span>
  );
}

