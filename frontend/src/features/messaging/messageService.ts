import { apiClient } from "../../api/client";

export type PersonnelPresence = "Online" | "Away" | "Offline";

export interface MessagingPerson {
  user_id: number;
  full_name: string;
  profile_image_path: string | null;
  designation: "Attorney" | "Administrator";
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
}

export async function getMessagingPersonnel() {
  const response = await apiClient.get<{ personnel: MessagingPerson[]; summary: PersonnelSummary | null }>("/messages/personnel");
  return response.data;
}

export async function getConversation(peerId: number, beforeMessageId?: number) {
  const response = await apiClient.get<{ messages: PrivateMessage[]; has_more: boolean }>(`/messages/${peerId}`, {
    params: { limit: 50, ...(beforeMessageId ? { before_message_id: beforeMessageId } : {}) },
  });
  return response.data;
}

export async function sendPrivateMessage(peerId: number, content: string) {
  const response = await apiClient.post<PrivateMessage>(`/messages/${peerId}`, { content });
  return response.data;
}

export async function markConversationRead(peerId: number) {
  await apiClient.post(`/messages/${peerId}/read`);
}
