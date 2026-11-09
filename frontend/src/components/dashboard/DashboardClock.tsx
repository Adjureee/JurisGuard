import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

const PH_TIMEZONE = "Asia/Manila";

const timePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PH_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

function formatPhilippineClock(date: Date) {
  const parts = timePartsFormatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      partMap[part.type] = part.value;
    }
  }
  const hour = partMap.hour ?? "12";
  const minute = partMap.minute ?? "00";
  const second = partMap.second ?? "00";
  const dayPeriod = (partMap.dayPeriod ?? "AM").toUpperCase();
  const fullTime = `${hour}:${minute}:${second}`;

  return {
    hour,
    minute,
    second,
    dayPeriod,
    fullTime,
  };
}

export default function DashboardClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { hour, minute, second, dayPeriod, fullTime } = formatPhilippineClock(now);

  return (
    <div
      data-testid="dashboard-live-clock"
      aria-label="Philippine local time digital clock"
      className="flex shrink-0 items-center gap-3"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F7F0FA] text-[#704389]">
        <Clock className="h-5 w-5" />
      </div>
      <div className="flex items-baseline gap-2">
        <time
          data-testid="dashboard-live-clock-time"
          dateTime={now.toISOString()}
          className="text-3xl font-extrabold tracking-tight text-[#111827] tabular-nums sm:text-4xl"
        >
          {hour}:{minute}:<span className="text-red-600">{second}</span>
        </time>
        <span
          data-testid="dashboard-live-clock-period"
          aria-label={`${fullTime} ${dayPeriod}`}
          className="rounded-md bg-[#F7F0FA] px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-[#704389]"
        >
          {dayPeriod}
        </span>
      </div>
    </div>
  );
}
