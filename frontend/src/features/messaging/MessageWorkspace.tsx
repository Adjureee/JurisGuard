import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowLeft, LoaderCircle, MessageCircle, Search, Send, SmilePlus, X } from "lucide-react";
import ProtectedProfileImage from "../../components/ProtectedProfileImage";
import { initials } from "../../components/dashboard/AnalyticsPrimitives";
import { useNotificationStore } from "../notifications/notificationStore";
import { listNotifications } from "../../services/notificationService";
import {
  getConversation,
  MESSAGE_REACTION_OPTIONS,
  markConversationRead,
  messageErrorMessage,
  sendPrivateMessage,
  toggleMessageReaction,
  type MessagingPerson,
  type MessageReactionEmoji,
  type PrivateMessage,
} from "./messageService";

interface MessageWorkspaceProps {
  people: MessagingPerson[];
  peopleError?: string | null;
  onRetryPeople?: () => void;
  viewerDesignation?: MessagingPerson["designation"];
  initialPeerId: number;
  mode: "quick" | "expanded";
  onClose: () => void;
  onUnreadChange: () => void;
}

function displayTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function MessageWorkspace({ people, peopleError, onRetryPeople, viewerDesignation, initialPeerId, mode, onClose, onUnreadChange }: MessageWorkspaceProps) {
  const [selectedId, setSelectedId] = useState(initialPeerId);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [conversationPeerId, setConversationPeerId] = useState<number>();
  const [conversationErrorPeerId, setConversationErrorPeerId] = useState<number>();
  const [earlierErrorPeerId, setEarlierErrorPeerId] = useState<number>();
  const [sendErrorPeerId, setSendErrorPeerId] = useState<number>();
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierLoadingPeerId, setEarlierLoadingPeerId] = useState<number>();
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [earlierError, setEarlierError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<number | null>(null);
  const [reactingMessageId, setReactingMessageId] = useState<number>();
  const [reactionError, setReactionError] = useState<{ peerId: number; messageId: number; text: string } | null>(null);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestMessageId = useRef<number | undefined>(undefined);
  const refreshSession = useRef(0);
  const requestInFlight = useRef<{ peerId: number; sessionId: number } | null>(null);
  const conversationPeerIdRef = useRef<number | undefined>(undefined);
  const earlierRequest = useRef(0);
  const selectedPerson = useMemo(() => people.find((person) => person.user_id === selectedId && !person.is_self), [people, selectedId]);
  const selectedPeerId = selectedPerson?.user_id;
  const conversationMessages = useMemo(
    () => conversationPeerId === selectedPeerId ? messages : [],
    [conversationPeerId, messages, selectedPeerId],
  );
  const conversationHasMore = conversationPeerId === selectedPeerId && hasMore;
  const visibleConversationError = conversationErrorPeerId === selectedPeerId ? conversationError : null;
  const visibleEarlierError = earlierErrorPeerId === selectedPeerId ? earlierError : null;
  const visibleSendError = sendErrorPeerId === selectedPeerId ? sendError : null;
  const isLoadingEarlier = loadingEarlier && earlierLoadingPeerId === selectedPeerId;
  const isConversationLoading = loading || (conversationPeerId !== selectedPeerId && conversationErrorPeerId !== selectedPeerId);
  const filteredPeople = useMemo(() => {
    const query = peopleSearch.trim().toLocaleLowerCase();
    return people.filter((person) => !person.is_self && (!query || person.full_name.toLocaleLowerCase().includes(query)));
  }, [people, peopleSearch]);
  const replaceServerNotifications = useNotificationStore((state) => state.replaceServerNotifications);

  const refreshConversation = useCallback(async (initial: boolean, sessionId: number) => {
    if (!selectedPeerId) return;
    const activeRequest = requestInFlight.current;
    if (activeRequest?.peerId === selectedPeerId && activeRequest.sessionId === sessionId) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOnline(false);
      setConversationError("You’re offline. Reconnect, then retry to load messages.");
      setConversationErrorPeerId(selectedPeerId);
      if (initial) setLoading(false);
      return;
    }

    const requestKey = { peerId: selectedPeerId, sessionId };
    requestInFlight.current = requestKey;
    if (initial) {
      setLoading(true);
      setConversationError(null);
      setConversationErrorPeerId(selectedPeerId);
    }
    try {
      const result = await getConversation(selectedPeerId);
      if (sessionId !== refreshSession.current) return;
      setMessages((current) => {
        if (initial || conversationPeerIdRef.current !== selectedPeerId || !current.length) return result.messages;
        const merged = new Map(current.map((message) => [message.message_id, message]));
        result.messages.forEach((message) => merged.set(message.message_id, message));
        return [...merged.values()].sort((first, second) => first.message_id - second.message_id);
      });
      conversationPeerIdRef.current = selectedPeerId;
      setConversationPeerId(selectedPeerId);
      setHasMore(result.has_more);

      const unreadIncoming = result.messages.some((message) => !message.is_mine && !message.read_at);
      if (initial || unreadIncoming) {
        const readResult = await markConversationRead(selectedPeerId);
        if (sessionId !== refreshSession.current) return;
        setMessages((current) => current.map((message) =>
          !message.is_mine && !message.read_at
            ? { ...message, read_at: readResult.read_at }
            : message,
        ));
        try {
          replaceServerNotifications(await listNotifications());
        } catch {
          // Message read state is already saved; notification refresh is best effort.
        }
        onUnreadChange();
      }
      setConversationError(null);
      setConversationErrorPeerId(selectedPeerId);
    } catch (error) {
      if (sessionId === refreshSession.current) {
        setConversationError(messageErrorMessage(error, "Unable to load this conversation. Retry in a moment."));
        setConversationErrorPeerId(selectedPeerId);
      }
    } finally {
      if (requestInFlight.current === requestKey) requestInFlight.current = null;
      if (initial && sessionId === refreshSession.current) setLoading(false);
    }
  }, [onUnreadChange, replaceServerNotifications, selectedPeerId]);

  useEffect(() => {
    const sessionId = ++refreshSession.current;
    let active = true;
    let timer = 0;
    latestMessageId.current = undefined;

    const poll = async (initial = false) => {
      if (!active) return;
      if (initial || document.visibilityState === "visible") {
        await refreshConversation(initial, sessionId);
      }
      if (active) {
        timer = window.setTimeout(() => void poll(), 5000);
      }
    };
    timer = window.setTimeout(() => void poll(true), 0);

    const handleOnline = () => {
      setIsOnline(true);
      void refreshConversation(false, sessionId);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setConversationError("You’re offline. Messages will refresh when your connection returns.");
      setConversationErrorPeerId(selectedPeerId);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      refreshSession.current += 1;
    };
  }, [refreshConversation, selectedPeerId]);

  useEffect(() => {
    if (!conversationMessages.length) return;
    const lastId = conversationMessages[conversationMessages.length - 1].message_id;
    if (lastId !== latestMessageId.current) {
      latestMessageId.current = lastId;
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [conversationMessages]);

  async function loadEarlier() {
    if (!selectedPeerId || !conversationMessages.length || isLoadingEarlier) return;
    const sessionId = refreshSession.current;
    const requestId = ++earlierRequest.current;
    setLoadingEarlier(true);
    setEarlierLoadingPeerId(selectedPeerId);
    setEarlierError(null);
    setEarlierErrorPeerId(selectedPeerId);
    const previousHeight = scrollRef.current?.scrollHeight ?? 0;
    try {
      const result = await getConversation(selectedPeerId, conversationMessages[0].message_id);
      if (sessionId !== refreshSession.current) return;
      setMessages((current) => [...result.messages, ...current]);
      setHasMore(result.has_more);
      requestAnimationFrame(() => {
        const element = scrollRef.current;
        if (element) element.scrollTop += element.scrollHeight - previousHeight;
      });
    } catch (error) {
      if (sessionId === refreshSession.current) setEarlierError(messageErrorMessage(error, "Unable to load earlier messages."));
    } finally {
      if (requestId === earlierRequest.current) setLoadingEarlier(false);
    }
  }

  async function submitMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!selectedPeerId || !content || sending || !isOnline) return;
    const peerId = selectedPeerId;
    const sessionId = refreshSession.current;
    setSending(true);
    setSendError(null);
    setSendErrorPeerId(peerId);
    try {
      const message = await sendPrivateMessage(peerId, content);
      if (sessionId === refreshSession.current) {
        setMessages((current) => current.some((item) => item.message_id === message.message_id) ? current : [...current, message]);
        setDraft("");
      }
      onUnreadChange();
    } catch (error) {
      if (sessionId === refreshSession.current) {
        setSendError(messageErrorMessage(error, "Unable to send message. Your draft is still here; retry when ready."));
      }
    } finally {
      setSending(false);
    }
  }

  function selectPeer(peerId: number) {
    setSelectedId(peerId);
    setDraft("");
    setReactionPickerMessageId(null);
    setReactingMessageId(undefined);
    setReactionError(null);
    setEarlierError(null);
    setEarlierErrorPeerId(undefined);
    setSendError(null);
    setSendErrorPeerId(undefined);
  }

  async function reactToMessage(messageId: number, emoji: MessageReactionEmoji) {
    if (!selectedPeerId || !isOnline || reactingMessageId !== undefined) return;
    const peerId = selectedPeerId;
    const sessionId = refreshSession.current;
    setReactingMessageId(messageId);
    setReactionError(null);
    try {
      const result = await toggleMessageReaction(peerId, messageId, emoji);
      if (sessionId === refreshSession.current && selectedPeerId === peerId) {
        setMessages((current) => current.map((message) =>
          message.message_id === messageId ? { ...message, reactions: result.reactions } : message,
        ));
        setReactionPickerMessageId(null);
      }
    } catch (error) {
      if (sessionId === refreshSession.current && selectedPeerId === peerId) {
        setReactionError({
          peerId,
          messageId,
          text: messageErrorMessage(error, "Unable to update this reaction. Retry in a moment."),
        });
      }
    } finally {
      if (sessionId === refreshSession.current) setReactingMessageId(undefined);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`flex w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${mode === "quick" ? "max-h-[90vh] max-w-xl" : "h-[min(780px,92vh)] max-w-5xl"}`} role="dialog" aria-modal="true" aria-label="Private messages">
        <header className="flex items-center justify-between bg-[#604477] px-4 py-3 text-white sm:px-5">
          <div className="flex items-center gap-2"><MessageCircle className="h-5 w-5" /><h2 className="font-bold">{mode === "quick" ? "Quick Message" : "Office Messages"}</h2></div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 hover:bg-white/15" aria-label="Close messages"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex min-h-0 flex-1">
          {mode === "expanded" && <aside className={`${selectedPerson ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-gray-200 md:w-72`} aria-label="Personnel">
            <label className="flex items-center gap-2 border-b border-gray-200 px-3 py-2.5 text-gray-500">
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <input type="search" value={peopleSearch} onChange={(event) => setPeopleSearch(event.target.value)} aria-label="Search colleagues" placeholder="Search colleagues" className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400" />
            </label>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {peopleError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><span>{peopleError}</span>{onRetryPeople && peopleError !== "Private messaging is not available for this designation" && <button type="button" onClick={onRetryPeople} className="min-h-9 shrink-0 rounded-md border border-amber-400 px-2 font-semibold">Retry</button>}</div>}
              {filteredPeople.length ? filteredPeople.map((person) => (
                <button type="button" key={person.user_id} onClick={() => selectPeer(person.user_id)} aria-current={selectedId === person.user_id ? "true" : undefined} className={`flex w-full items-center gap-3 border-b border-gray-100 px-3 py-3 text-left hover:bg-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-400 ${selectedId === person.user_id ? "bg-purple-50" : ""}`}>
                  <Avatar person={person} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-gray-800">{person.full_name}</span><span className="block text-xs text-gray-500">{person.designation}</span></span>
                  {person.unread_count > 0 && <UnreadBadge count={person.unread_count} />}
                </button>
              )) : <p className="p-4 text-sm text-gray-500">{people.length ? "No colleagues match this search." : "No colleagues are available for private messaging."}</p>}
            </div>
          </aside>}
          <main className={`${mode === "expanded" && !selectedPerson ? "hidden md:flex" : "flex"} min-w-0 flex-1 flex-col`}>
            {selectedPerson ? <>
              <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
                {mode === "expanded" && <button type="button" onClick={() => selectPeer(-1)} className="rounded-md p-1 text-gray-600 hover:bg-gray-100 md:hidden" aria-label="Back to personnel"><ArrowLeft className="h-5 w-5" /></button>}
                <Avatar person={selectedPerson} />
                <div className="min-w-0"><p className="truncate text-sm font-bold text-gray-900">{selectedPerson.full_name}</p><p className="text-xs text-gray-500">{selectedPerson.designation}{selectedPerson.presence ? ` · ${selectedPerson.presence}` : ""}</p>{viewerDesignation === "Attorney" && selectedPerson.designation === "Attorney" && <p className="mt-0.5 text-[11px] font-medium text-[#704389]">Private attorney chat · administrators cannot view this conversation</p>}</div>
              </div>
              {!isOnline && <p role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">You’re offline. New messages will appear after you reconnect.</p>}
              <div ref={scrollRef} aria-live="polite" aria-relevant="additions" aria-busy={isConversationLoading} className="max-h-[55vh] min-h-[230px] flex-1 space-y-3 overflow-y-auto bg-gray-50 px-4 py-4 sm:px-5">
                {visibleConversationError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span>{visibleConversationError}</span><button type="button" onClick={() => void refreshConversation(true, refreshSession.current)} disabled={!isOnline} className="min-h-9 rounded-md border border-amber-400 px-3 font-semibold disabled:opacity-50">Retry</button></div>}
                {conversationHasMore && <div className="text-center"><button type="button" onClick={() => void loadEarlier()} disabled={isLoadingEarlier || !isOnline} className="text-xs font-semibold text-[#604477] hover:underline disabled:opacity-50">{isLoadingEarlier ? "Loading…" : "Load earlier messages"}</button></div>}
                {visibleEarlierError && <p role="alert" className="text-center text-xs text-red-700">{visibleEarlierError} <button type="button" onClick={() => void loadEarlier()} className="font-semibold underline">Retry</button></p>}
                {isConversationLoading ? <div className="flex h-36 items-center justify-center text-sm text-gray-500"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Loading conversation</div> : conversationMessages.length ? conversationMessages.map((message) => (
                  <div key={message.message_id} className={`flex ${message.is_mine ? "justify-end" : "justify-start"}`}>
                    <div className={`flex max-w-[85%] flex-col ${message.is_mine ? "items-end" : "items-start"}`}>
                      <div className={`rounded-2xl px-3.5 py-2.5 ${message.is_mine ? "rounded-br-sm bg-[#604477] text-white" : "rounded-bl-sm border border-gray-200 bg-white text-gray-800"}`}>
                        <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p><p className={`mt-1 text-right text-[10px] ${message.is_mine ? "text-white/70" : "text-gray-400"}`}>{displayTime(message.created_at)}</p>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1" role="group" aria-label="Message reactions">
                        {(message.reactions ?? []).map((reaction) => {
                          const option = MESSAGE_REACTION_OPTIONS.find((item) => item.emoji === reaction.emoji);
                          return <button key={reaction.emoji} type="button" onClick={() => void reactToMessage(message.message_id, reaction.emoji)} disabled={!isOnline || reactingMessageId !== undefined} aria-label={`${option?.label ?? "Reaction"}: ${reaction.count}`} aria-pressed={reaction.reacted_by_me} title={option?.label} className={`flex min-h-7 items-center gap-1 rounded-full border px-2 text-xs disabled:cursor-not-allowed disabled:opacity-60 ${reaction.reacted_by_me ? "border-purple-300 bg-purple-100 text-purple-900" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-100"}`}>
                            <span aria-hidden="true">{reaction.emoji}</span><span>{reaction.count}</span>
                          </button>;
                        })}
                        <button type="button" onClick={() => { setReactionError(null); setReactionPickerMessageId((current) => current === message.message_id ? null : message.message_id); }} disabled={!isOnline || reactingMessageId !== undefined} aria-label={`Add a reaction to message ${message.message_id}`} aria-expanded={reactionPickerMessageId === message.message_id} className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60">
                          {reactingMessageId === message.message_id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />}
                        </button>
                      </div>
                      {reactionPickerMessageId === message.message_id && <div className="mt-1 flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm" role="group" aria-label="Choose a reaction">
                        {MESSAGE_REACTION_OPTIONS.map((option) => <button key={option.emoji} type="button" onClick={() => void reactToMessage(message.message_id, option.emoji)} disabled={!isOnline || reactingMessageId !== undefined} aria-label={`React with ${option.label}`} title={option.label} className="flex h-9 w-9 items-center justify-center rounded-lg text-xl hover:bg-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 disabled:opacity-50">{option.emoji}</button>)}
                      </div>}
                      {reactionError?.peerId === selectedPeerId && reactionError?.messageId === message.message_id && <p role="alert" className="mt-1 text-xs text-red-700">{reactionError?.text}</p>}
                    </div>
                  </div>
                )) : !visibleConversationError && <div className="flex h-full min-h-40 flex-col items-center justify-center text-center text-sm text-gray-500"><MessageCircle className="mb-2 h-7 w-7 text-gray-300" aria-hidden="true" />No messages yet. Send a message to start.</div>}
              </div>
              <form onSubmit={submitMessage} className="border-t border-gray-200 bg-white p-3 sm:p-4">
                {visibleSendError && <p role="alert" className="mb-2 text-sm text-red-700">{visibleSendError}</p>}
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label className="sr-only" htmlFor="private-message-draft">Write a message</label>
                    <textarea id="private-message-draft" value={draft} onChange={(event) => { setDraft(event.target.value.slice(0, 2000)); setSendError(null); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} rows={2} maxLength={2000} placeholder="Write a message…" className="max-h-32 min-h-12 w-full resize-y rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#80589A] focus:ring-2 focus:ring-purple-100" />
                    <p className="mt-1 text-right text-[11px] text-gray-500">{draft.length}/2000</p>
                  </div>
                  <button type="submit" disabled={!draft.trim() || sending || !isOnline} className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#604477] px-4 text-sm font-semibold text-white hover:bg-[#704F89] disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{sending ? "Sending…" : "Send"}</span></button>
                </div>
              </form>
            </> : <div className="hidden flex-1 items-center justify-center text-sm text-gray-500 md:flex"><ArrowDown className="mr-2 h-4 w-4" aria-hidden="true" />Select a colleague to view messages</div>}
          </main>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function Avatar({ person }: { person: MessagingPerson }) {
  return <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-visible rounded-full bg-gray-100 text-xs font-bold text-gray-600">
    <span className="h-full w-full overflow-hidden rounded-full"><ProtectedProfileImage path={person.profile_image_path} alt={person.full_name} className="h-full w-full object-cover" fallback={<span className="flex h-full w-full items-center justify-center">{initials(person.full_name)}</span>} /></span>
    {person.unread_count > 0 && <span className="absolute -right-1 -top-1"><UnreadBadge count={person.unread_count} /></span>}
  </span>;
}

function UnreadBadge({ count }: { count: number }) {
  return <span aria-label={`${count} unread messages`} className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">{count > 99 ? "99+" : count}</span>;
}
