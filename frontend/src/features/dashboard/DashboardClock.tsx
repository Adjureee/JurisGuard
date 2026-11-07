import { useEffect, useState } from 'react';

const dateFormat = new Intl.DateTimeFormat('en-PH', {
  weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
});
const timeFormat = new Intl.DateTimeFormat('en-PH', {
  hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Manila',
});

export default function DashboardClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-[#526174]">
    <time dateTime={now.toISOString()} aria-label="Current date and time in the Philippines">
      {dateFormat.format(now)} <span className="ml-2 whitespace-nowrap font-semibold tabular-nums text-[#243344]">{timeFormat.format(now)}</span>
    </time>
    <span className="text-xs">Philippine time (UTC+8)</span>
  </div>;
}
