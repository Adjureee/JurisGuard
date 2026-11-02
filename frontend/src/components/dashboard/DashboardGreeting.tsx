import { useEffect, useState, type ReactNode } from "react";

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

  const hour = now.getHours();
  const greeting = hour >= 17 || hour < 5
    ? "Good Evening"
    : hour >= 12
      ? "Good Afternoon"
      : "Good Morning";
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);

  return (
    <section className="mb-6 rounded-2xl border border-[#E7D7EE] bg-gradient-to-br from-[#F7F0FA] via-white to-white px-6 py-6 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          {context && <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-[#704389]">{context}</p>}
          <h1 className="text-4xl font-bold text-[#111827]">{greeting}, {name}</h1>
          <p className="mt-3 text-base font-medium text-[#6B7280]">
            {date} - Here's today's operational summary for PAO Panabo.
          </p>
        </div>
        {actions}
      </div>
    </section>
  );
}
