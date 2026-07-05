import type { CaseStatus } from "../../../types";

const statusClass: Record<CaseStatus, string> = {
  Pending: "bg-amber-50 text-amber-800 ring-amber-200",
  Ongoing: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  Active: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  Terminated: "bg-red-50 text-red-700 ring-red-200",
  Archived: "bg-gray-100 text-gray-600 ring-gray-200",
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusClass[status]}`}>
      {status}
    </span>
  );
}

