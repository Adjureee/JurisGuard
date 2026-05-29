import CountUp from "react-countup";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

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
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`rounded-xl border border-[#E5E7EB] bg-white shadow-sm shadow-[#111827]/10 ${className}`}
    >
      <div className="border-b border-[#E5E7EB] px-5 py-4">
        <h3 className="text-base font-semibold text-[#111827]">{title}</h3>
        {subtitle && <p className="mt-1 text-sm leading-6 text-[#6B7280]">{subtitle}</p>}
      </div>
      <div className="p-5">{children}</div>
    </motion.section>
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
  const tones = {
    blue: "from-[#1D4ED8] to-[#60A5FA]",
    green: "from-[#047857] to-[#34D399]",
    red: "from-[#B91C1C] to-[#F87171]",
    yellow: "from-[#B45309] to-[#FBBF24]",
    purple: "from-[#6D28D9] to-[#A78BFA]",
    dark: "from-[#111827] to-[#4B5563]",
  };
  return (
    <motion.div
      whileHover={{ y: -3 }}
      className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${tones[tone]} p-5 text-white shadow-lg shadow-[#111827]/15`}
    >
      <div className="absolute right-0 top-0 h-24 w-24 rounded-bl-[80px] bg-white/10" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-white/75">{label}</p>
          <h3 className="mt-2 text-3xl font-bold">
            <CountUp end={value} duration={1.2} separator="," preserveValue />
          </h3>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/15 text-white shadow-inner">
          {icon}
        </div>
      </div>
      <div className="relative mt-5 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-white/80">{detail}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 font-semibold">
          {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {trend}
        </span>
      </div>
    </motion.div>
  );
}

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-[#E5E7EB] ${className}`} />;
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-4 text-center text-sm text-[#6B7280]">
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
