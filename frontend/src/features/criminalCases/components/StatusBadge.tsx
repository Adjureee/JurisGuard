import type { CaseStatus } from "../../../types";

const statusClass: Record<CaseStatus, string> = {
  Pending: "bg-amber-50 dark:bg-amber-400/10 text-amber-800 dark:text-amber-300 ring-amber-200 dark:ring-amber-400/30",
  Ongoing: "bg-emerald-50 dark:bg-emerald-400/10 text-emerald-800 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-400/30",
  Active: "bg-emerald-50 dark:bg-emerald-400/10 text-emerald-800 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-400/30",
  Terminated: "bg-red-50 dark:bg-red-400/10 text-red-700 dark:text-red-300 ring-red-200 dark:ring-red-400/30",
  Archived: "bg-card-2 text-muted ring-gray-200",
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusClass[status]}`}>
      {status}
    </span>
  );
}

