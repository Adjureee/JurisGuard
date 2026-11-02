import { useCallback, useEffect, useState } from "react";
import { Activity, CalendarClock, Clock3, FileText, Gavel, MapPin } from "lucide-react";
import { getDashboardIntelligenceBrief, type DashboardIntelligenceBrief } from "../../services/dashboardService";
import { EmptyState, SkeletonBlock } from "./AnalyticsPrimitives";

export default function IntelligenceBrief() {
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

  if (isLoading && !brief) return <SkeletonBlock className="mt-6 h-48" />;
  if (!brief) return (
    <section className="mt-6 rounded-lg border border-[#E5E7EB] bg-white p-5">
      <h2 className="text-lg font-bold text-[#111827]">Today's Intelligence Brief</h2>
      <p className="mt-2 text-sm text-[#6B7280]">Office insights are temporarily unavailable.</p>
    </section>
  );

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
    <section className="mt-6 flex max-h-[320px] min-h-[220px] flex-col overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
      <div className="border-b border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
        <h2 className="text-xl font-bold text-[#111827]">Today's Intelligence Brief</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-sm font-semibold leading-6 text-[#2B3642]">
        {insights.length ? insights.map((insight, index) => (
          <p className="flex gap-3" key={index}>{insight.icon}{insight.text}</p>
        )) : <EmptyState message="No office insights are available yet." />}
      </div>
    </section>
  );
}
