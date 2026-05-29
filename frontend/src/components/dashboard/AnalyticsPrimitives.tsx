import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import ErrorBoundary from "../ErrorBoundary";

export function AnalyticsPanel({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-[#E5E7EB] bg-white shadow-sm  ${className}`}
    >
      <div className="border-b border-[#E5E7EB] px-5 py-4">
        <h3 className="text-base font-bold text-[#2B3642]">{title}</h3>
        {subtitle && <p className="mt-1 text-sm font-medium leading-6 text-[#4B5563]">{subtitle}</p>}
      </div>
      <div className="p-5">
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
}: {
  label: string;
  value: number;
  detail: string;
  icon: ReactNode;
  tone: "blue" | "green" | "red" | "yellow" | "purple" | "dark";
  trend?: string;
  positive?: boolean;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const formattedValue = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(safeValue);
  const tones = {
    blue: "border-[#BFDBFE] text-[#1D4ED8]",
    green: "border-[#A7F3D0] text-[#065F46]",
    red: "border-[#FECACA] text-[#9F1239]",
    yellow: "border-[#FEF3C7] text-[#92400E]",
    purple: "border-[#DDD6FE] text-[#5B21B6]",
    dark: "border-[#D1D5DB] text-[#2B3642]",
  };
  const iconTones = {
    blue: "bg-[#EFF6FF] text-[#1D4ED8]",
    green: "bg-[#ECFDF5] text-[#065F46]",
    red: "bg-[#FFF1F2] text-[#9F1239]",
    yellow: "bg-[#FFFBEB] text-[#92400E]",
    purple: "bg-[#F5F3FF] text-[#5B21B6]",
    dark: "bg-[#F8FAFC] text-[#2B3642]",
  };
  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-white ${tones[tone]} p-5 shadow-sm  transition duration-200 hover:-translate-y-0.5`}
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
