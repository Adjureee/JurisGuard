import { AxiosError } from "axios";
import { apiClient } from "../../api/client";

export type PersonnelPresence = "Online" | "Away" | "Offline";

export const MESSAGE_REACTION_OPTIONS = [
  { emoji: "👍", label: "Like" },
  { emoji: "❤️", label: "Love" },
  { emoji: "😂", label: "Haha" },
  { emoji: "😮", label: "Wow" },
  { emoji: "😢", label: "Sad" },
  { emoji: "😡", label: "Angry" },
] as const;

export type MessageReactionEmoji = (typeof MESSAGE_REACTION_OPTIONS)[number]["emoji"];

export interface MessageReaction {
  emoji: MessageReactionEmoji;
  count: number;
  reacted_by_me: boolean;
}

export interface MessagingPerson {
  user_id: number;
  full_name: string;
  profile_image_path: string | null;
  designation: "Attorney" | "Administrator" | "Admin Staff";
  is_self: boolean;
  unread_count: number;
  presence?: PersonnelPresence;
}

export interface PersonnelSummary {
  attorneys: { active: number; online: number };
  administrators: { active: number; online: number };
  admin_staff?: { active: number; online: number };
}

export interface PrivateMessage {
  message_id: number;
  sender_user_id: number;
  recipient_user_id: number;
  content: string;
  created_at: string;
  read_at: string | null;
  is_mine: boolean;
  reactions: MessageReaction[];
}

export function messageErrorMessage(error: unknown, fallback: string) {
  if (error instanceof AxiosError) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (!error.response) return "Could not reach the messaging service. Check your connection and retry.";
  }
  return error instanceof Error ? error.message : fallback;
}

async function withMessageError<T>(request: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await request();
  } catch (error) {
    throw new Error(messageErrorMessage(error, fallback));
  }
}

export async function getMessagingPersonnel() {
  return withMessageError(async () => {
    const response = await apiClient.get<{ personnel: MessagingPerson[]; summary: PersonnelSummary | null }>("/messages/personnel");
    return response.data;
  }, "Unable to load office personnel.");
}

export async function getConversation(peerId: number, beforeMessageId?: number) {
  return withMessageError(async () => {
    const response = await apiClient.get<{ messages: PrivateMessage[]; has_more: boolean }>(`/messages/${peerId}`, {
      params: { limit: 50, ...(beforeMessageId ? { before_message_id: beforeMessageId } : {}) },
    });
    return response.data;
  }, "Unable to load messages.");
}

export async function sendPrivateMessage(peerId: number, content: string) {
  return withMessageError(async () => {
    const response = await apiClient.post<PrivateMessage>(`/messages/${peerId}`, { content });
    return response.data;
  }, "Unable to send message.");
}

export async function toggleMessageReaction(peerId: number, messageId: number, emoji: MessageReactionEmoji) {
  return withMessageError(async () => {
    const response = await apiClient.post<{ reactions: MessageReaction[] }>(
      `/messages/${peerId}/${messageId}/reaction`,
      { emoji },
    );
    return response.data;
  }, "Unable to update this message reaction.");
}

export async function markConversationRead(peerId: number) {
  return withMessageError(async () => {
    const response = await apiClient.post<{ updated: number; read_at: string }>(`/messages/${peerId}/read`);
    return response.data;
  }, "Unable to mark this conversation as read.");
}
