import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Inbox } from "lucide-react";
import { Link } from "react-router-dom";
import ErrorBoundary from "../ErrorBoundary";

export function useCountUp(target: number, durationMs = 900) {
  const [display, setDisplay] = useState(target);
  const previous = useRef(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = previous.current;
    previous.current = target;
    if (reduceMotion || !Number.isFinite(target) || from === target) {
      setDisplay(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (target - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return display;
}

export function AnimatedNumber({ value }: { value: number }) {
  const display = useCountUp(Number.isFinite(value) ? value : 0);
  return <>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(display))}</>;
}

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
      className={`jg-lift flex flex-col rounded-2xl border border-line bg-card shadow-card ${className}`}
    >
      <div className="border-b border-gray-100 px-5 py-4">
        <h3 className="flex items-center gap-2 text-base font-bold text-gray-900">
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-gradient-to-b from-brand-600 to-gold-500" />
          {title}
        </h3>
        {subtitle && <p className="mt-1 text-sm font-medium leading-6 text-gray-600">{subtitle}</p>}
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
  const tones = {
    blue: "border-brand-200 text-brand-700",
    green: "border-emerald-200 text-emerald-800",
    red: "border-red-200 text-rose-800",
    yellow: "border-amber-100 text-amber-800",
    purple: "border-brand-200 text-brand-800",
    dark: "border-parchment-300 text-gray-800",
  };
  const iconTones = {
    blue: "bg-brand-50 text-brand-700",
    green: "bg-emerald-50 text-emerald-800",
    red: "bg-rose-50 text-rose-800",
    yellow: "bg-amber-50 text-amber-800",
    purple: "bg-brand-50 text-brand-800",
    dark: "bg-parchment-100 text-gray-800",
  };
  return (
    <div
      className={`jg-lift jg-hairline relative overflow-hidden rounded-2xl border bg-card ${tones[tone]} p-5 shadow-card`}
    >
      <div aria-hidden="true" className="absolute right-0 top-0 h-24 w-24 rounded-bl-[80px] bg-gradient-to-bl from-brand-50 to-transparent" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
          <h3 className="mt-2 text-3xl font-bold tabular-nums tracking-tight">
            <AnimatedNumber value={safeValue} />
          </h3>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${iconTones[tone]} shadow-inner`}>
          {icon}
        </div>
      </div>
      <div className="relative mt-5 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-gray-600">{detail}</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold ${iconTones[tone]}`}>
          {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {trend}
        </span>
      </div>
      {to && (
        <Link
          to={to}
          className="relative mt-4 inline-flex text-xs font-bold text-brand-600 hover:text-brand-700"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`jg-shimmer rounded-xl ${className}`} />;
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-parchment-300 bg-parchment-100/70 px-4 py-6 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-gray-400 shadow-card">
        <Inbox className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-gray-600">{message}</p>
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

