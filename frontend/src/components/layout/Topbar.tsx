import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useAuditLogStore } from "../../features/auditLogs/auditLogStore";
import { resolveProfileImageUrl } from "../../services/authService";
import {
  useNotificationStore,
  type NotificationType,
} from "../../features/notifications/notificationStore";

interface TopbarProps {
  onToggleSidebar: () => void;
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
      <path fill="currentColor" d="M3 5h14v2H3V5Zm0 4h14v2H3V9Zm0 4h14v2H3v-2Z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
      <path fill="currentColor" d="M10 2a5 5 0 0 0-5 5v2.4L3.5 12v1h13v-1L15 9.4V7a5 5 0 0 0-5-5Zm-2 12a2 2 0 0 0 4 0H8Z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path fill="currentColor" d="m5.5 7.5 4.5 4.5 4.5-4.5-1.4-1.4-3.1 3.1-3.1-3.1-1.4 1.4Z" />
    </svg>
  );
}

function notificationSymbol(type: NotificationType) {
  if (type === "new_registration" || type === "rejection_notice") return "!";
  if (type === "case_created" || type === "client_created" || type === "workflow") return "i";
  return "OK";
}

function initials(name?: string, email?: string) {
  const source = (name || email || "User").trim();
  return source
    .split(/[ @.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function Topbar({ onToggleSidebar }: TopbarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const addLog = useAuditLogStore((state) => state.addLog);
  const notifications = useNotificationStore((state) => state.notifications);
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const removeNotification = useNotificationStore((state) => state.removeNotification);
  const clearNotifications = useNotificationStore((state) => state.clearNotifications);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);

  const visibleNotifications = useMemo(() => {
    if (!user) return [];
    if (user.role === "admin") {
      return notifications.filter(
        (notification) =>
          notification.target_role === "admin" ||
          notification.user_id === user.user_id ||
          (!notification.target_role && notification.user_id === null)
      );
    }
    return notifications.filter((notification) => notification.user_id === user.user_id);
  }, [notifications, user]);
  const unreadCount = visibleNotifications.filter((notification) => !notification.isRead).length;
  const recentNotifications = visibleNotifications.slice(0, 6);
  const visibleNotificationIds = visibleNotifications.map((notification) => notification.id);
  const profileImageSrc = resolveProfileImageUrl(user?.profile_image_path);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (profileRef.current && !profileRef.current.contains(target)) {
        setProfileOpen(false);
      }
      if (notificationRef.current && !notificationRef.current.contains(target)) {
        setNotificationsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleLogout = () => {
    addLog({
      userId: user?.user_id,
      user: user?.full_name || user?.email,
      action: "Logout",
      module: "Authentication",
      description: `${user?.full_name || user?.email || "User"} signed out`,
      entityType: "user",
      entityId: user ? String(user.user_id) : undefined,
    });
    logout();
    navigate("/login", { replace: true });
  };

  const handleNotificationClick = (id: string, redirectTo: string) => {
    markRead(id);
    setNotificationsOpen(false);
    navigate(redirectTo);
  };

  return (
    <header className="sticky top-0 z-50 shrink-0 overflow-visible border-b border-[#E5E7EB] bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-[30px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#E5E7EB] bg-white text-[#111827] transition duration-200 hover:-translate-y-px hover:bg-gray-50 md:hidden"
            aria-label="Toggle sidebar"
          >
            <MenuIcon />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-[#111827]">JurisGuard</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div ref={notificationRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setNotificationsOpen((current) => !current);
                setProfileOpen(false);
              }}
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#E5E7EB] bg-white text-[#111827] transition duration-200 hover:-translate-y-px hover:bg-gray-50"
              aria-label="Open notifications"
            >
              <BellIcon />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[#DC2626] px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div className="absolute right-0 z-[9999] mt-2 w-80 rounded-lg border border-[#E5E7EB] bg-white shadow-xl shadow-[#111827]/10">
                <div className="border-b border-[#E5E7EB] bg-[#F3F4F6] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[#111827]">Notifications</p>
                    {visibleNotifications.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => markAllRead(visibleNotificationIds)}
                          className="text-xs font-semibold text-[#2F80ED] hover:text-[#1f6fd6]"
                        >
                          Mark all read
                        </button>
                        <button
                          type="button"
                          onClick={() => clearNotifications(visibleNotificationIds)}
                          className="text-xs font-semibold text-[#DC2626] hover:text-[#B91C1C]"
                        >
                          Clear all
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="max-h-80 divide-y divide-[#E5E7EB] overflow-y-auto">
                  {recentNotifications.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-[#6B7280]">No notifications yet.</div>
                  ) : (
                    recentNotifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={`flex gap-3 px-4 py-3 transition ${
                          notification.isRead ? "bg-white text-[#6B7280]" : "bg-[#EFF6FF] text-[#111827]"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            notification.isRead
                              ? "bg-[#F3F4F6] text-[#6B7280]"
                              : "bg-[#EFF6FF] text-[#2F80ED]"
                          }`}
                        >
                          {notificationSymbol(notification.type)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => handleNotificationClick(notification.id, notification.redirectTo)}
                            className="block w-full text-left"
                          >
                            <span className="flex items-start gap-2">
                              {!notification.isRead && (
                                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#2F80ED]" />
                              )}
                              <span className="min-w-0">
                                <span
                                  className={`block text-sm ${
                                    notification.isRead
                                      ? "font-medium text-[#6B7280]"
                                      : "font-bold text-[#111827]"
                                  }`}
                                >
                                  {notification.title}
                                </span>
                                <span className="mt-1 block text-sm text-[#111827]/80">
                                  {notification.message}
                                </span>
                              </span>
                            </span>
                          </button>
                          <p className="mt-1 text-xs text-[#6B7280]">
                            {relativeTime(notification.createdAt)}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {!notification.isRead && (
                              <button
                                type="button"
                                onClick={() => markRead(notification.id)}
                                className="text-xs font-semibold text-[#2F80ED] hover:text-[#1f6fd6]"
                              >
                                Mark as Read
                              </button>
                            )}
                            {notification.isRead && (
                              <button
                                type="button"
                                onClick={() => removeNotification(notification.id)}
                                className="text-xs font-semibold text-[#DC2626] hover:text-[#B91C1C]"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  className="w-full border-t border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-center text-sm font-semibold text-[#2F80ED] transition duration-200 hover:bg-white"
                >
                  View all notifications
                </button>
              </div>
            )}
          </div>

          <div ref={profileRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setProfileOpen((current) => !current);
                setNotificationsOpen(false);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-[#E5E7EB] bg-white px-2 text-[#111827] transition duration-200 hover:-translate-y-px hover:bg-gray-50 sm:px-3"
            >
              <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[#111827] text-xs font-semibold text-white">
                {profileImageSrc ? (
                  <img src={profileImageSrc} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials(user?.full_name, user?.email)
                )}
              </span>
              <span className="hidden max-w-40 truncate text-sm font-semibold sm:inline">
                {user?.full_name || user?.email || "User"}
              </span>
              <ChevronIcon />
            </button>

            {profileOpen && (
              <div className="absolute right-0 z-[9999] mt-2 w-56 overflow-hidden rounded-lg border border-[#E5E7EB] bg-white py-2 shadow-xl shadow-[#111827]/10">
                <Link
                  to="/profile"
                  onClick={() => setProfileOpen(false)}
                  className="block px-4 py-2.5 text-sm font-medium text-[#111827] transition duration-200 hover:bg-[#F9FAFB]"
                >
                  Profile
                </Link>
                <Link
                  to="/profile#security"
                  onClick={() => setProfileOpen(false)}
                  className="block px-4 py-2.5 text-sm font-medium text-[#111827] transition duration-200 hover:bg-[#F9FAFB]"
                >
                  Settings
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="mt-2 block w-full border-t border-[#E5E7EB] px-4 py-2.5 text-left text-sm font-semibold text-[#DC2626] transition duration-200 hover:bg-red-50"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
