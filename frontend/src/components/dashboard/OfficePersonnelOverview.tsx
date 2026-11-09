import { useCallback, useEffect, useMemo, useState } from "react";
import { Circle, MessageCircle, ShieldCheck, Users } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ProtectedProfileImage from "../ProtectedProfileImage";
import { EmptyState, initials, SkeletonBlock } from "./AnalyticsPrimitives";
import MessageWorkspace from "../../features/messaging/MessageWorkspace";
import {
  getMessagingPersonnel,
  messageErrorMessage,
  type MessagingPerson,
  type PersonnelPresence,
  type PersonnelSummary,
} from "../../features/messaging/messageService";

const presenceStyles = {
  Online: "bg-emerald-50 text-emerald-700",
  Away: "bg-amber-50 text-amber-700",
  Offline: "bg-gray-100 text-gray-600",
} as const;

export default function OfficePersonnelOverview({ staffLayout = false }: { staffLayout?: boolean }) {
  const [people, setPeople] = useState<MessagingPerson[]>([]);
  const [summary, setSummary] = useState<PersonnelSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<{ peerId: number; mode: "quick" | "expanded" } | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const currentPerson = useMemo(() => people.find((person) => person.is_self), [people]);
  const messagePeers = useMemo(() => people.filter((person) => !person.is_self), [people]);
  const displayPeople = useMemo(
    () => [...people].sort((first, second) => Number(second.is_self) - Number(first.is_self)),
    [people],
  );
  const effectiveSummary = useMemo<PersonnelSummary | null>(() => {
    if (summary) return summary;
    if (!people.length) return null;
    const attorneys = people.filter((person) => person.designation === "Attorney");
    const administrators = people.filter((person) => person.designation === "Administrator");
    const resolvePresence = (person: MessagingPerson): PersonnelPresence =>
      person.presence ?? (person.is_self ? "Online" : "Offline");
    return {
      attorneys: {
        active: attorneys.length,
        online: attorneys.filter((person) => resolvePresence(person) === "Online").length,
      },
      administrators: {
        active: administrators.length,
        online: administrators.filter((person) => resolvePresence(person) === "Online").length,
      },
    };
  }, [people, summary]);

  const refresh = useCallback(async () => {
    try {
      const result = await getMessagingPersonnel();
      setPeople(result.personnel);
      setSummary(result.summary);
      setPeopleError(null);
    } catch (error) {
      setPeopleError(messageErrorMessage(error, "Office personnel are temporarily unavailable."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const requestedPeer = Number(new URLSearchParams(location.search).get("messageFrom"));
    if (!requestedPeer || !people.some((person) => person.user_id === requestedPeer && !person.is_self)) return;
    setWorkspace({ peerId: requestedPeer, mode: "expanded" });
    navigate({ pathname: location.pathname, search: "" }, { replace: true });
  }, [location.pathname, location.search, navigate, people]);

  const updateUnread = useCallback(() => { void refresh(); }, [refresh]);

  if (isLoading && !people.length) return <SkeletonBlock className={staffLayout ? "h-[240px]" : "h-[360px]"} />;

  return <>
    <section className={`flex max-h-[440px] flex-col overflow-hidden rounded-lg border border-[#E5E7EB] bg-white ${staffLayout ? "min-h-0" : "min-h-[320px]"}`}>
      <div className="flex items-center justify-between gap-2 border-b border-[#E5E7EB] bg-[#604477] px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-white"><Users className="h-4 w-4" /> Office Personnel</h2>
        <div className="flex items-center gap-3">
          {messagePeers.length > 0 && <button type="button" onClick={() => setWorkspace({ peerId: messagePeers[0].user_id, mode: "expanded" })} className="text-xs font-semibold text-white underline-offset-2 hover:underline">View All</button>}
          <Link to="/admin/verification" className="flex items-center gap-1 text-xs font-semibold text-white/85 underline-offset-2 hover:text-white hover:underline" title="Open personnel verification"><ShieldCheck className="h-3.5 w-3.5" /><span className="hidden sm:inline">Verification</span></Link>
        </div>
      </div>

      {effectiveSummary && <div className={`grid shrink-0 gap-2 border-b border-[#E5E7EB] p-3 ${effectiveSummary.admin_staff ? "grid-cols-2 2xl:grid-cols-3" : "grid-cols-2"}`}>
        <SummaryCard label="Active Attorneys" value={effectiveSummary.attorneys.active} detail={`${effectiveSummary.attorneys.online} online`} tone="purple" />
        <SummaryCard label="Active Administrators" value={effectiveSummary.administrators.active} detail={`${effectiveSummary.administrators.online} online`} tone="gray" />
        {effectiveSummary.admin_staff && <SummaryCard label="Active Admin Staff" value={effectiveSummary.admin_staff.active} detail={`${effectiveSummary.admin_staff.online} online`} tone="green" />}
      </div>}

      <div className={staffLayout ? "max-h-[186px] flex-none overflow-y-auto" : "min-h-0 max-h-[186px] flex-1 overflow-y-auto"}>
        {peopleError && !people.length ? <p className="p-4 text-sm text-[#6B7280]">Office personnel are temporarily unavailable.</p>
          : displayPeople.length ? <ul className="divide-y divide-[#E5E7EB]">
            {displayPeople.map((person) => {
              const presence: PersonnelPresence | undefined = person.presence ?? (person.is_self ? "Online" : undefined);
              return <li key={person.user_id} className="flex min-h-[62px] items-center gap-3 px-4 py-2.5">
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-visible rounded-full bg-[#F3F4F6] text-xs font-bold text-[#475569]">
                  <div className="h-full w-full overflow-hidden rounded-full"><ProtectedProfileImage path={person.profile_image_path} alt={person.full_name} className="h-full w-full object-cover" fallback={initials(person.full_name)} /></div>
                  {person.unread_count > 0 && <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{person.unread_count > 99 ? "99+" : person.unread_count}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#2B3642]">{person.full_name}{person.is_self ? <span className="ml-1.5 text-xs font-medium text-[#704389]">(Me)</span> : null}</p>
                  <p className="text-xs text-[#6B7280]">{person.designation}</p>
                </div>
                {presence && <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${presenceStyles[presence]}`}><Circle className="h-1.5 w-1.5 fill-current" />{presence}</span>}
                {!person.is_self && <button type="button" onClick={() => setWorkspace({ peerId: person.user_id, mode: "quick" })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#704389] hover:bg-[#F7F0FA] focus:outline-none focus:ring-2 focus:ring-purple-300" aria-label={`Message ${person.full_name}`} title="Send a private message"><MessageCircle className="h-4 w-4" /></button>}
              </li>;
            })}
          </ul> : <div className="p-4"><EmptyState message="No eligible office personnel found." /></div>}
      </div>
    </section>
    {workspace && <MessageWorkspace people={messagePeers} peopleError={peopleError} onRetryPeople={() => void refresh()} viewerDesignation={currentPerson?.designation} initialPeerId={workspace.peerId} mode={workspace.mode} onClose={() => setWorkspace(null)} onUnreadChange={updateUnread} />}
  </>;
}

function SummaryCard({ detail, label, tone, value }: { detail: string; label: string; tone: "purple" | "gray" | "green"; value: number }) {
  const colors = {
    purple: "bg-[#F7F0FA] text-[#5F3675]",
    gray: "bg-[#F3F4F6] text-[#475569]",
    green: "bg-[#ECFDF5] text-[#065F46]",
  };
  return <div className={`rounded-md px-3 py-2 ${colors[tone]}`}><p className="text-xs font-semibold">{label}</p><p className="mt-0.5 text-lg font-bold text-[#2B3642]">{value}</p><p className="text-xs text-[#6B7280]">{detail}</p></div>;
}
