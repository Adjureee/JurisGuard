import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, LoaderCircle, MessageCircle, Send, X } from "lucide-react";
import toast from "react-hot-toast";
import ProtectedProfileImage from "../../components/ProtectedProfileImage";
import { initials } from "../../components/dashboard/AnalyticsPrimitives";
import { useNotificationStore } from "../notifications/notificationStore";
import { listNotifications } from "../../services/notificationService";
import {
  getConversation,
  markConversationRead,
  sendPrivateMessage,
  type MessagingPerson,
  type PrivateMessage,
} from "./messageService";

interface MessageWorkspaceProps {
  people: MessagingPerson[];
  viewerDesignation?: MessagingPerson["designation"];
  initialPeerId: number;
  mode: "quick" | "expanded";
  onClose: () => void;
  onUnreadChange: () => void;
}

function displayTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function MessageWorkspace({ people, viewerDesignation, initialPeerId, mode, onClose, onUnreadChange }: MessageWorkspaceProps) {
  const [selectedId, setSelectedId] = useState(initialPeerId);
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestMessageId = useRef<number | undefined>(undefined);
  const selectedPerson = useMemo(() => people.find((person) => person.user_id === selectedId && !person.is_self), [people, selectedId]);
  const selectedPeerId = selectedPerson?.user_id;
  const replaceServerNotifications = useNotificationStore((state) => state.replaceServerNotifications);

  const refreshConversation = useCallback(async (initial = false) => {
    if (!selectedPeerId) return;
    try {
      const result = await getConversation(selectedPeerId);
      setMessages((current) => {
        if (initial || !current.length) return result.messages;
        const merged = new Map(current.map((message) => [message.message_id, message]));
        result.messages.forEach((message) => merged.set(message.message_id, message));
        return [...merged.values()].sort((a, b) => a.message_id - b.message_id);
      });
      setHasMore(result.has_more);
      const unreadIncoming = result.messages.some((message) => !message.is_mine && !message.read_at);
      if (unreadIncoming) {
        await markConversationRead(selectedPeerId);
        const readAt = new Date().toISOString();
        setMessages((current) => current.map((message) => !message.is_mine && !message.read_at ? { ...message, read_at: readAt } : message));
        const notifications = await listNotifications();
        replaceServerNotifications(notifications);
        onUnreadChange();
      }
    } catch (error) {
      if (initial) toast.error(error instanceof Error ? error.message : "Unable to load messages");
    } finally {
      if (initial) setLoading(false);
    }
  }, [onUnreadChange, replaceServerNotifications, selectedPeerId]);

  useEffect(() => {
    setMessages([]);
    setLoading(true);
    latestMessageId.current = undefined;
    void refreshConversation(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshConversation(false);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshConversation]);

  useEffect(() => {
    if (!messages.length) return;
    const lastId = messages[messages.length - 1].message_id;
    if (lastId !== latestMessageId.current) {
      latestMessageId.current = lastId;
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  async function loadEarlier() {
    if (!selectedPerson || !messages.length || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const result = await getConversation(selectedPerson.user_id, messages[0].message_id);
      setMessages((current) => [...result.messages, ...current]);
      setHasMore(result.has_more);
    } catch {
      toast.error("Unable to load earlier messages");
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function submitMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!selectedPerson || !content || sending) return;
    setSending(true);
    try {
      const message = await sendPrivateMessage(selectedPerson.user_id, content);
      setMessages((current) => current.some((item) => item.message_id === message.message_id) ? current : [...current, message]);
      setDraft("");
      onUnreadChange();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`flex w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${mode === "quick" ? "max-h-[90vh] max-w-xl" : "h-[min(780px,92vh)] max-w-5xl"}`} role="dialog" aria-modal="true" aria-label="Private messages">
        <header className="flex items-center justify-between bg-[#604477] px-4 py-3 text-white sm:px-5">
          <div className="flex items-center gap-2"><MessageCircle className="h-5 w-5" /><h2 className="font-bold">{mode === "quick" ? "Quick Message" : "Office Messages"}</h2></div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 hover:bg-white/15" aria-label="Close messages"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex min-h-0 flex-1">
          {mode === "expanded" && <aside className={`${selectedPerson ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-gray-200 md:w-72`}>
            <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700">Personnel</div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {people.filter((person) => !person.is_self).map((person) => (
                <button type="button" key={person.user_id} onClick={() => setSelectedId(person.user_id)} className={`flex w-full items-center gap-3 border-b border-gray-100 px-3 py-3 text-left hover:bg-purple-50 ${selectedId === person.user_id ? "bg-purple-50" : ""}`}>
                  <Avatar person={person} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-gray-800">{person.full_name}</span><span className="block text-xs text-gray-500">{person.designation}</span></span>
                  {person.unread_count > 0 && <UnreadBadge count={person.unread_count} />}
                </button>
              ))}
            </div>
          </aside>}
          <main className={`${mode === "expanded" && !selectedPerson ? "hidden md:flex" : "flex"} min-w-0 flex-1 flex-col`}>
            {selectedPerson ? <>
              <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
                {mode === "expanded" && <button type="button" onClick={() => setSelectedId(-1)} className="rounded-md p-1 text-gray-600 hover:bg-gray-100 md:hidden" aria-label="Back to personnel"><ArrowLeft className="h-5 w-5" /></button>}
                <Avatar person={selectedPerson} />
                <div className="min-w-0"><p className="truncate text-sm font-bold text-gray-900">{selectedPerson.full_name}</p><p className="text-xs text-gray-500">{selectedPerson.designation}{selectedPerson.presence ? ` · ${selectedPerson.presence}` : ""}</p>{viewerDesignation === "Attorney" && selectedPerson.designation === "Attorney" && <p className="mt-0.5 text-[11px] font-medium text-[#704389]">Private attorney chat · administrators cannot view this conversation</p>}</div>
              </div>
              <div ref={scrollRef} className="max-h-[55vh] min-h-[230px] flex-1 space-y-3 overflow-y-auto bg-gray-50 px-4 py-4 sm:px-5">
                {hasMore && <div className="text-center"><button type="button" onClick={() => void loadEarlier()} disabled={loadingEarlier} className="text-xs font-semibold text-[#604477] hover:underline">{loadingEarlier ? "Loading…" : "Load earlier messages"}</button></div>}
                {loading ? <div className="flex h-36 items-center justify-center text-sm text-gray-500"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading conversation</div> : messages.length ? messages.map((message) => (
                  <div key={message.message_id} className={`flex ${message.is_mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${message.is_mine ? "rounded-br-sm bg-[#604477] text-white" : "rounded-bl-sm border border-gray-200 bg-white text-gray-800"}`}>
                      <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p><p className={`mt-1 text-right text-[10px] ${message.is_mine ? "text-white/70" : "text-gray-400"}`}>{displayTime(message.created_at)}</p>
                    </div>
                  </div>
                )) : <div className="flex h-full min-h-40 flex-col items-center justify-center text-center text-sm text-gray-500"><MessageCircle className="mb-2 h-7 w-7 text-gray-300" />No messages yet. Send a message to start.</div>}
              </div>
              <form onSubmit={submitMessage} className="flex items-end gap-2 border-t border-gray-200 bg-white p-3 sm:p-4">
                <textarea value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 2000))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} rows={2} maxLength={2000} placeholder="Write a message…" className="max-h-32 min-h-12 flex-1 resize-y rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#80589A] focus:ring-2 focus:ring-purple-100" />
                <button type="submit" disabled={!draft.trim() || sending} className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#604477] px-4 text-sm font-semibold text-white hover:bg-[#704F89] disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" /><span className="hidden sm:inline">Send</span></button>
              </form>
            </> : <div className="hidden flex-1 items-center justify-center text-sm text-gray-500 md:flex"><ArrowDown className="mr-2 h-4 w-4" />Select a personnel member to view messages</div>}
          </main>
        </div>
      </section>
    </div>
  );
}

function Avatar({ person }: { person: MessagingPerson }) {
  return <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-visible rounded-full bg-gray-100 text-xs font-bold text-gray-600">
    <span className="h-full w-full overflow-hidden rounded-full"><ProtectedProfileImage path={person.profile_image_path} alt={person.full_name} className="h-full w-full object-cover" fallback={initials(person.full_name)} /></span>
    {person.unread_count > 0 && <span className="absolute -right-1 -top-1"><UnreadBadge count={person.unread_count} /></span>}
  </span>;
}

function UnreadBadge({ count }: { count: number }) {
  return <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">{count > 99 ? "99+" : count}</span>;
}
