import { useEffect, useState } from 'react';

const dateFormat = new Intl.DateTimeFormat('en-PH', {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
});
const timeFormat = new Intl.DateTimeFormat('en-PH', {
  hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
});

export default function DashboardClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let interval: number | undefined;
    const firstMinuteDelay = 60_000 - (Date.now() % 60_000);
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, firstMinuteDelay);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  return (
    <div
      aria-label="Current date and time in the Philippines"
      aria-live="off"
      className="mt-2 inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1"
    >
      <time dateTime={now.toISOString()} className="text-sm font-medium leading-5 text-[#526174]">
        {dateFormat.format(now)}
      </time>
      <span aria-hidden="true" className="h-4 w-px bg-[#DCE3EA]" />
      <div className="flex min-w-0 items-baseline gap-1.5">
        <time dateTime={now.toISOString()} className="whitespace-nowrap text-lg font-bold leading-6 tabular-nums tracking-tight text-[#243344] sm:text-xl">
          {timeFormat.format(now)}
        </time>
        <span className="whitespace-nowrap text-[11px] font-medium text-[#64748B]">Manila · UTC+8</span>
      </div>
    </div>
  );
}
