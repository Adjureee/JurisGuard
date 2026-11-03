import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import ErrorBoundary from "../ErrorBoundary";

export const CHART_COLORS = [
  "#66AFA5",
  "#729FC5",
  "#D8897D",
  "#D9AD65",
  "#8EAD88",
  "#A18AB9",
] as const;

const EXTENDED_CHART_COLORS = [
  "#7B8FA3",
  "#B67F79",
  "#91A17B",
  "#8979A2",
  "#C29558",
  "#5C9E92",
];
const categoryColorAssignments = new Map<string, string>();

function normalizeCategoryLabel(label: string) {
  return label.trim().toLocaleLowerCase("en");
}

export function getStableCategoryColorMap(labels: readonly string[]) {
  const palette = [...CHART_COLORS, ...EXTENDED_CHART_COLORS];
  const unassigned = [...new Set(labels.map(normalizeCategoryLabel))]
    .filter((label) => label && !categoryColorAssignments.has(label));

  for (const [label, color] of [["criminal", CHART_COLORS[0]], ["civil", CHART_COLORS[1]] ] as const) {
    if (unassigned.includes(label)) categoryColorAssignments.set(label, color);
  }

  for (const label of unassigned.filter((item) => !categoryColorAssignments.has(item)).sort((left, right) => left.localeCompare(right, "en"))) {
    const usedColors = new Set(categoryColorAssignments.values());
    const availableColor = palette.find((color) => !usedColors.has(color));
    if (availableColor) {
      categoryColorAssignments.set(label, availableColor);
      continue;
    }

    let hash = 2166136261;
    for (const character of label) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    let hue = (hash >>> 0) % 360;
    let color = `hsl(${hue} 30% 58%)`;
    while (usedColors.has(color)) {
      hue = (hue + 137) % 360;
      color = `hsl(${hue} 30% 58%)`;
    }
    categoryColorAssignments.set(label, color);
  }

  return new Map(labels.map((label) => [label, categoryColorAssignments.get(normalizeCategoryLabel(label)) ?? CHART_COLORS[0]]));
}

export function AnalyticsPanel({
  title,
  subtitle,
  children,
  className = "",
  headerClassName = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
}) {
  return (
    <section
      className={`flex flex-col rounded-xl border border-[#E5E7EB] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)] ${className}`}
    >
      <div className={`border-b border-[#E5E7EB] bg-[#604477] px-5 py-4 ${headerClassName}`}>
        <h3 className="text-base font-bold text-white">{title}</h3>
        {subtitle && <p className="mt-1 text-sm font-medium leading-6 text-[#F0EAF4]">{subtitle}</p>}
      </div>
      <div className="min-h-0 flex-1 p-5">
        <ErrorBoundary fallback={<EmptyState message="This dashboard widget could not render. Other widgets remain available." />}>
          {children}
        </ErrorBoundary>
      </div>
    </section>
  );
}

export function IntelligenceMetricCard({
  label,
  value,
  detail,
  icon,
  tone,
  trend = "Database live",
  positive = true,
  to,
  actionLabel = "View details",
}: {
  label: string;
  value: number;
  detail: string;
  icon: ReactNode;
  tone: "blue" | "green" | "red" | "yellow" | "purple" | "dark";
  trend?: string;
  positive?: boolean;
  to?: string;
  actionLabel?: string;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const formattedValue = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(safeValue);
  const tones = {
    blue: "border-[#E7D7EE] text-[#5F3675]",
    green: "border-[#A7F3D0] text-[#065F46]",
    red: "border-[#FECACA] text-[#9F1239]",
    yellow: "border-[#FEF3C7] text-[#92400E]",
    purple: "border-[#DDD6FE] text-[#5B21B6]",
    dark: "border-[#D1D5DB] text-[#2B3642]",
  };
  const iconTones = {
    blue: "bg-[#F7F0FA] text-[#5F3675]",
    green: "bg-[#ECFDF5] text-[#065F46]",
    red: "bg-[#FFF1F2] text-[#9F1239]",
    yellow: "bg-[#FFFBEB] text-[#92400E]",
    purple: "bg-[#F5F3FF] text-[#5B21B6]",
    dark: "bg-[#F8FAFC] text-[#2B3642]",
  };
  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-white ${tones[tone]} p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition duration-200 hover:-translate-y-0.5`}
    >
      <div className="absolute right-0 top-0 h-24 w-24 rounded-bl-[80px] bg-[#F9FAFB]" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">{label}</p>
          <h3 className="mt-2 text-3xl font-bold">
            {formattedValue}
          </h3>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${iconTones[tone]} shadow-inner`}>
          {icon}
        </div>
      </div>
      <div className="relative mt-5 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-[#4B5563]">{detail}</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold ${iconTones[tone]}`}>
          {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {trend}
        </span>
      </div>
      {to && (
        <Link
          to={to}
          className="relative mt-4 inline-flex text-xs font-bold text-[#704389] hover:text-[#5F3675]"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-[#E5E7EB] ${className}`} />;
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-4 text-center text-sm font-medium text-[#4B5563]">
      {message}
    </div>
  );
}

export function initials(name: string) {
  return (name || "System")
    .split(/[ @.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

