import { useEffect, useState, type ReactNode } from "react";
import DashboardClock from "./DashboardClock";

const PH_TIMEZONE = "Asia/Manila";

const hour24Formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PH_TIMEZONE,
  hour: "numeric",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PH_TIMEZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

function getPhilippineHour(date: Date): number {
  const formatted = hour24Formatter.format(date);
  const parsed = Number.parseInt(formatted, 10);
  if (Number.isNaN(parsed)) return date.getHours();
  return parsed % 24;
}

export default function DashboardGreeting({
  name,
  actions,
  context,
}: {
  name: string;
  actions?: ReactNode;
  context?: string;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const hour = getPhilippineHour(now);
  const greeting = hour >= 17 || hour < 5
    ? "Good Evening"
    : hour >= 12
      ? "Good Afternoon"
      : "Good Morning";
  const date = dateFormatter.format(now);

  return (
    <section className="mb-6 rounded-2xl border border-[#E7D7EE] bg-gradient-to-br from-[#F7F0FA] via-white to-white px-6 py-6 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          {context && <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-[#704389]">{context}</p>}
          <h1 className="text-4xl font-bold text-[#111827]">{greeting}, {name}</h1>
          <p className="mt-3 text-base font-medium text-[#6B7280]">
            {date} - Here's today's operational summary for PAO Panabo.
          </p>
        </div>
        {actions ?? <DashboardClock />}
      </div>
    </section>
  );
}
