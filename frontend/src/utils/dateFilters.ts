export type DateFilterValue =
  | "all"
  | "today"
  | "last7"
  | "last30"
  | "month"
  | "year";

export const DATE_FILTER_OPTIONS: Array<{
  value: DateFilterValue;
  label: string;
}> = [
  { value: "all", label: "All Dates" },
  { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 Days" },
  { value: "last30", label: "Last 30 Days" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
];

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function parseRecordDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function matchesDateFilter(
  value: string | null | undefined,
  filter: DateFilterValue,
  now = new Date(),
) {
  if (filter === "all") return true;

  const date = parseRecordDate(value);
  if (!date) return false;

  const recordDay = startOfDay(date);
  const today = startOfDay(now);

  if (filter === "today") {
    return recordDay.getTime() === today.getTime();
  }

  if (filter === "last7" || filter === "last30") {
    const days = filter === "last7" ? 7 : 30;
    const start = new Date(today);
    start.setDate(today.getDate() - (days - 1));
    return recordDay >= start && recordDay <= today;
  }

  if (filter === "month") {
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth()
    );
  }

  return date.getFullYear() === now.getFullYear();
}
