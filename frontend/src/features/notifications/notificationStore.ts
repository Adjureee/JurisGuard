import { create } from "zustand";

export type NotificationType =
  | "new_registration"
  | "approval_success"
  | "rejection_notice"
  | "case_created"
  | "client_created"
  | "ocr_completed"
  | "export_completed"
  | "system"
  | "account"
  | "workflow";

export interface OperationalNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  redirectTo: string;
  isRead: boolean;
  createdAt: string;
  user_id: number | null;
  target_role?: "admin" | "staff";
  entity_type?: string;
  entity_id?: string;
}

interface AddNotificationInput {
  type: NotificationType;
  userId?: number | null;
  targetRole?: "admin" | "staff";
  title?: string;
  message: string;
  redirectTo?: string;
  entityType?: string;
  entityId?: string;
}

interface NotificationState {
  notifications: OperationalNotification[];
  addNotification: (notification: AddNotificationInput) => OperationalNotification;
  markRead: (id: string) => void;
  markAllRead: (ids?: string[]) => void;
  removeNotification: (id: string) => void;
  clearNotifications: (ids?: string[]) => void;
}

const STORAGE_KEY = "jurisguard_notifications";

function defaultTitle(type: NotificationType) {
  if (type === "new_registration") return "New Registration";
  if (type === "approval_success") return "Registration Approved";
  if (type === "rejection_notice") return "Registration Rejected";
  if (type === "case_created") return "Case Update";
  if (type === "client_created") return "Client Record";
  if (type === "export_completed") return "CSV Export";
  return "Notification";
}

function defaultRedirect(type: NotificationType, entityId?: string) {
  if (type === "new_registration") return "/admin/verification";
  if (type === "export_completed") return "/criminal-cases";
  if (type === "case_created" && entityId) return `/criminal-cases?case=${encodeURIComponent(entityId)}`;
  if (type === "client_created") return "/criminal-cases";
  return "/dashboard";
}

function normalizeNotification(raw: OperationalNotification & { read?: boolean }) {
  return {
    ...raw,
    title: raw.title || defaultTitle(raw.type),
    redirectTo: raw.redirectTo || defaultRedirect(raw.type, raw.entity_id),
    isRead: typeof raw.isRead === "boolean" ? raw.isRead : Boolean(raw.read),
  };
}

function readStoredNotifications() {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored
      ? (JSON.parse(stored) as Array<OperationalNotification & { read?: boolean }>).map(
          normalizeNotification
        )
      : [];
  } catch {
    return [];
  }
}

function persistNotifications(notifications: OperationalNotification[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, 50)));
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: readStoredNotifications(),
  addNotification: (notification) => {
    const duplicate = get().notifications.find(
      (item) =>
        item.type === notification.type &&
        item.entity_id &&
        item.entity_id === notification.entityId &&
        item.target_role === notification.targetRole
    );

    if (duplicate) return duplicate;

    const entry: OperationalNotification = {
      id: `notice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: notification.type,
      title: notification.title || defaultTitle(notification.type),
      message: notification.message,
      redirectTo: notification.redirectTo || defaultRedirect(notification.type, notification.entityId),
      isRead: false,
      createdAt: new Date().toISOString(),
      user_id: notification.userId ?? null,
      target_role: notification.targetRole,
      entity_type: notification.entityType,
      entity_id: notification.entityId,
    };
    const notifications = [entry, ...get().notifications].slice(0, 50);
    persistNotifications(notifications);
    set({ notifications });
    return entry;
  },
  markRead: (id) => {
    const notifications = get().notifications.map((notification) =>
      notification.id === id ? { ...notification, isRead: true } : notification
    );
    persistNotifications(notifications);
    set({ notifications });
  },
  markAllRead: (ids) => {
    const allowed = ids ? new Set(ids) : null;
    const notifications = get().notifications.map((notification) =>
      !allowed || allowed.has(notification.id) ? { ...notification, isRead: true } : notification
    );
    persistNotifications(notifications);
    set({ notifications });
  },
  removeNotification: (id) => {
    const notifications = get().notifications.filter(
      (notification) => notification.id !== id || !notification.isRead
    );
    persistNotifications(notifications);
    set({ notifications });
  },
  clearNotifications: (ids) => {
    const allowed = ids ? new Set(ids) : null;
    const notifications = allowed
      ? get().notifications.filter(
          (notification) => !allowed.has(notification.id) || !notification.isRead
        )
      : get().notifications.filter((notification) => !notification.isRead);
    persistNotifications(notifications);
    set({ notifications });
  },
}));

