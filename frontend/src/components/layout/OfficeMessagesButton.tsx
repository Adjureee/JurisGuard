import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";
import toast from "react-hot-toast";
import { useLocation, useNavigate } from "react-router-dom";
import MessageWorkspace from "../../features/messaging/MessageWorkspace";
import { getMessagingPersonnel, messageErrorMessage, type MessagingPerson } from "../../features/messaging/messageService";

interface OfficeMessagesButtonProps {
  onLaunch?: () => void;
}

export default function OfficeMessagesButton({ onLaunch }: OfficeMessagesButtonProps) {
  const [people, setPeople] = useState<MessagingPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [initialPeerId, setInitialPeerId] = useState(-1);
  const location = useLocation();
  const navigate = useNavigate();
  const currentPerson = useMemo(() => people.find((person) => person.is_self), [people]);
  const messagePeers = useMemo(() => people.filter((person) => !person.is_self), [people]);
  const unreadCount = messagePeers.reduce((total, person) => total + person.unread_count, 0);

  const refresh = useCallback(async () => {
    try {
      const result = await getMessagingPersonnel();
      setPeople(result.personnel);
      setError(null);
    } catch (requestError) {
      setError(messageErrorMessage(requestError, "Office messages are temporarily unavailable."));
    }
  }, []);

  const refreshUnreadPeople = useCallback(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const firstRefresh = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    return () => {
      window.clearTimeout(firstRefresh);
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    const requestedPeer = Number(new URLSearchParams(location.search).get("messageFrom"));
    if (!requestedPeer || !messagePeers.some((person) => person.user_id === requestedPeer)) return;
    const timer = window.setTimeout(() => {
      onLaunch?.();
      setInitialPeerId(requestedPeer);
      setWorkspaceOpen(true);
      navigate({ pathname: location.pathname, search: "" }, { replace: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [location.pathname, location.search, messagePeers, navigate, onLaunch]);

  const openWorkspace = () => {
    onLaunch?.();
    if (!messagePeers.length && error) toast.error(error);
    void refresh();
    setInitialPeerId(messagePeers[0]?.user_id ?? -1);
    setWorkspaceOpen(true);
  };

  return <>
    <button
      type="button"
      onClick={openWorkspace}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#E5E7EB] bg-white text-[#2B3642] transition duration-200 hover:-translate-y-px hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#704389] focus-visible:ring-offset-2"
      aria-label={unreadCount > 0 ? `Open messages, ${unreadCount} unread` : "Open messages"}
      aria-haspopup="dialog"
      title={!messagePeers.length && error ? error : "Open messages"}
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
      {unreadCount > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[#DC2626] px-1.5 py-0.5 text-[10px] font-bold text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
    </button>
    {workspaceOpen && <MessageWorkspace
      key={`office-messages:${initialPeerId}`}
      people={messagePeers}
      peopleError={error}
      onRetryPeople={() => void refresh()}
      viewerDesignation={currentPerson?.designation}
      initialPeerId={initialPeerId}
      mode="expanded"
      onClose={() => setWorkspaceOpen(false)}
      onUnreadChange={refreshUnreadPeople}
    />}
  </>;
}
