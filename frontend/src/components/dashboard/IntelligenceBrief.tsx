import { useCallback, useEffect, useState } from "react";
import { Activity, CalendarClock, Clock3, FileText, Gavel, MapPin } from "lucide-react";
import { getDashboardIntelligenceBrief, type DashboardIntelligenceBrief } from "../../services/dashboardService";
import { EmptyState, SkeletonBlock } from "./AnalyticsPrimitives";

export default function IntelligenceBrief({ compact = false }: { compact?: boolean }) {
  const [brief, setBrief] = useState<DashboardIntelligenceBrief | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      setBrief(await getDashboardIntelligenceBrief());
    } catch {
      setBrief(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5 * 60_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [load]);

  if (isLoading && !brief) return <SkeletonBlock className={`${compact ? "h-[360px]" : "mt-6 h-48"}`} />;
  if (!brief) return (
    <section className={`${compact ? "min-h-[360px] p-4" : "mt-6 p-5"} rounded-lg border border-[#E5E7EB] bg-white`}>
      <h2 className="text-lg font-bold text-[#111827]">Today's Intelligence Brief</h2>
      <p className="mt-2 text-sm text-[#6B7280]">Office insights are temporarily unavailable.</p>
    </section>
  );

  const compactInsights = [
    {
      icon: <Activity className="mt-0.5 h-4 w-4 shrink-0 text-[#704389]" />,
      label: "Cases this month",
      value: `${brief.cases_this_month} total · ${brief.criminal_cases} criminal · ${brief.civil_cases} civil`,
    },
    {
      icon: <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#704389]" />,
      label: "Peak intake",
      value: brief.busiest_day && brief.busiest_hour ? `${brief.busiest_day} · ${brief.busiest_hour}` : "Not enough history",
    },
    {
      icon: <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#704389]" />,
      label: "Top barangay",
      value: brief.top_barangay || "Not available",
    },
    {
      icon: <Gavel className="mt-0.5 h-4 w-4 shrink-0 text-[#704389]" />,
      label: "Leading category",
      value: brief.leading_category || "Not available",
    },
    {
      icon: <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[#704389]" />,
      label: "Pending reviews",
      value: `${brief.pending_reviews} awaiting review`,
    },
    {
      icon: <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-[#704389]" />,
      label: "Active cases",
      value: `${brief.active_cases}`,
    },
  ];
  const insights = [
    {
      icon: <Activity className="mt-0.5 h-5 w-5 shrink-0 text-[#704389]" />,
      text: `${brief.cases_this_month} cases have been recorded this month; office caseload includes ${brief.criminal_cases} criminal and ${brief.civil_cases} civil cases.`,
    },
    {
      icon: <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-[#704389]" />,
      text: brief.busiest_day && brief.busiest_hour
        ? `Intake most often occurs on ${brief.busiest_day} around ${brief.busiest_hour}.`
        : "There is not enough intake history to identify a peak time.",
    },
    {
      icon: <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#704389]" />,
      text: brief.top_barangay ? `${brief.top_barangay} has the highest recorded case volume.` : "No barangay trend is available yet.",
    },
    {
      icon: <Gavel className="mt-0.5 h-5 w-5 shrink-0 text-[#704389]" />,
      text: brief.leading_category ? `${brief.leading_category} is the most common recorded case category.` : "No case-category trend is available yet.",
    },
    {
      icon: <FileText className="mt-0.5 h-5 w-5 shrink-0 text-[#704389]" />,
      text: `${brief.pending_reviews} staff submissions are awaiting review.`,
    },
    {
      icon: <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-[#704389]" />,
      text: `${brief.active_cases} cases are currently active across the office.`,
    },
  ];

  return (
    <section className={`${compact ? "" : "mt-6"} flex flex-col overflow-hidden rounded-lg border border-[#E5E7EB] bg-white ${compact ? "max-h-[460px] min-h-[360px]" : "max-h-[320px] min-h-[220px]"}`}>
      <div className={`border-b border-[#E5E7EB] bg-[#604477] ${compact ? "px-4 py-3" : "px-5 py-4"}`}>
        <h2 className={`${compact ? "text-base" : "text-xl"} font-bold text-white`}>Today's Intelligence Brief</h2>
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto text-sm font-semibold text-[#2B3642] ${compact ? "p-4" : "space-y-4 p-5 leading-6"}`}>
        {compact ? (
          <div className="grid content-start grid-cols-1 gap-x-5 gap-y-3 md:grid-cols-2">
            {compactInsights.map((insight) => (
              <div className="flex min-w-0 gap-2 border-b border-[#E5E7EB] pb-3" key={insight.label}>
                {insight.icon}
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold leading-4 text-[#6B7280]">{insight.label}</p>
                  <p className="break-words text-xs font-semibold leading-5 text-[#2B3642]">{insight.value}</p>
                </div>
              </div>
            ))}
          </div>
        ) : insights.length ? insights.map((insight, index) => (
          <p className="flex gap-3" key={index}>{insight.icon}{insight.text}</p>
        )) : <EmptyState message="No office insights are available yet." />}
      </div>
    </section>
  );
}
