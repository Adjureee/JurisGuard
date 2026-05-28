import type { CaseStatus } from "../../../types";

const statusClass: Record<CaseStatus, string> = {
  Pending: "bg-amber-100 text-amber-800",
  Ongoing: "bg-blue-100 text-blue-700",
  Active: "bg-blue-100 text-blue-700",
  Terminated: "bg-[#DC2626] text-white",
  Archived: "bg-gray-200 text-gray-700",
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass[status]}`}>
      {status}
    </span>
  );
}
