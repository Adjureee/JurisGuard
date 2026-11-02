import { apiClient } from "../api/client";
import type {
  NotificationType,
  OperationalNotification,
} from "../features/notifications/notificationStore";

interface ApiNotification {
  notification_id: number;
  user_id: number;
  type: NotificationType;
  title: string;
  message: string;
  redirect_to: string;
  is_read: boolean;
  created_at: string;
  entity_type?: string;
  entity_id?: string;
}

function toOperationalNotification(notification: ApiNotification): OperationalNotification {
  return {
    id: `server-${notification.notification_id}`,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    redirectTo: notification.redirect_to,
    isRead: notification.is_read,
    createdAt: notification.created_at,
    user_id: notification.user_id,
    entity_type: notification.entity_type,
    entity_id: notification.entity_id,
    isServerPersisted: true,
  };
}

export async function listNotifications() {
  const response = await apiClient.get<ApiNotification[]>("/notifications");
  return response.data.map(toOperationalNotification);
}

export async function markNotificationRead(id: number) {
  await apiClient.post(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead() {
  await apiClient.post("/notifications/read-all");
}

export async function deleteReadNotification(id: number) {
  await apiClient.delete(`/notifications/${id}`);
}

export async function clearReadNotifications() {
  await apiClient.delete("/notifications/read");
}
