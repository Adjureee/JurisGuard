import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, ChevronDown, Menu } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useAuditLogStore } from "../../features/auditLogs/auditLogStore";
import { resolveProfileImageUrl } from "../../services/authService";
import {
  useNotificationStore,
  type NotificationType,
} from "../../features/notifications/notificationStore";
import { listApplicants } from "../../services/adminService";
import { listCaseSubmissions } from "../../services/caseSubmissionService";

interface TopbarProps {
  onToggleSidebar: () => void;
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
  const addNotification = useNotificationStore((state) => state.addNotification);
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

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setProfileOpen(false);
        setNotificationsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeydown);
    };
  }, []);

  useEffect(() => {
    if (user?.role !== "admin") return;
    let cancelled = false;

    async function syncPendingRegistrations() {
      try {
        const pendingUsers = await listApplicants("pending");
        if (cancelled) return;
        pendingUsers.forEach((pendingUser) => {
          addNotification({
            type: "new_registration",
            targetRole: "admin",
            title: "New Registration",
            message: `New registration pending approval: ${pendingUser.full_name || pendingUser.email}`,
            redirectTo: "/admin/verification",
            entityType: "user_registration",
            entityId: String(pendingUser.user_id),
          });
        });
      } catch {
        // Registration notifications are opportunistic; page rendering should not depend on them.
      }
    }

    void syncPendingRegistrations();
    const interval = window.setInterval(syncPendingRegistrations, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [addNotification, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const currentUser = user;

    async function syncSubmissionNotifications() {
      try {
        const submissions = await listCaseSubmissions();
        if (cancelled) return;
        submissions.forEach((submission) => {
          if (currentUser.role === "admin" && (submission.status === "Submitted" || submission.status === "Resubmitted")) {
            addNotification({
              type: "workflow",
              targetRole: "admin",
              title: submission.version > 1 ? "Submission Resubmitted" : "New Submission Received",
              message: `${submission.staff_name} submitted ${submission.title}`,
              redirectTo: "/case-review-center",
              entityType: "case_submission",
              entityId: `${submission.submission_id}-${submission.status}-v${submission.version}`,
            });
          }
          if (currentUser.role === "staff" && submission.status === "Correction Required") {
            addNotification({
              type: "workflow",
              userId: currentUser.user_id,
              title: "Submission Requires Correction",
              message: `${submission.title} needs correction.`,
              redirectTo: "/case-submissions",
              entityType: "case_submission",
              entityId: `${submission.submission_id}-${submission.status}`,
            });
          }
          if (currentUser.role === "staff" && submission.status === "Approved") {
            addNotification({
              type: "workflow",
              userId: currentUser.user_id,
              title: "Submission Approved",
              message: `${submission.title} has been approved.`,
              redirectTo: "/case-submissions",
              entityType: "case_submission",
              entityId: `${submission.submission_id}-${submission.status}`,
            });
          }
        });
      } catch {
        // Workflow notifications should not block the shell.
      }
    }

    void syncSubmissionNotifications();
    const interval = window.setInterval(syncSubmissionNotifications, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [addNotification, user]);

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
    <header className="sticky top-0 z-50 shrink-0 overflow-visible border-b border-white/10 bg-brand-900/95 px-4 py-3 shadow-card backdrop-blur-md sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-200 transition-colors duration-150 hover:border-white/25 hover:bg-white/10 hover:text-white md:hidden"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold tracking-tight text-white">JurisGuard</h1>
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.15em] text-gold-400">
              PAO Panabo
            </p>
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
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-200 transition-colors duration-150 hover:border-white/25 hover:bg-white/10 hover:text-white"
              aria-label="Open notifications"
              aria-haspopup="true"
              aria-expanded={notificationsOpen}
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-center text-[10px] font-bold leading-none text-white ring-2 ring-brand-900">
                  {unreadCount}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div className="absolute right-0 z-[9999] mt-2 w-80 animate-fade-up overflow-hidden rounded-xl border border-line bg-card shadow-pop">
                <div className="border-b border-line bg-card px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-gray-800">Notifications</p>
                    {visibleNotifications.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => markAllRead(visibleNotificationIds)}
                          className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                        >
                          Mark all read
                        </button>
                        <button
                          type="button"
                          onClick={() => clearNotifications(visibleNotificationIds)}
                          className="text-xs font-semibold text-red-600 hover:text-red-700"
                        >
                          Clear all
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="max-h-80 divide-y divide-line overflow-y-auto">
                  {recentNotifications.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-gray-600">No notifications yet.</div>
                  ) : (
                    recentNotifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={`flex gap-3 px-4 py-3 transition ${
                          notification.isRead ? "bg-card text-gray-600" : "bg-brand-50 text-gray-800"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            notification.isRead
                              ? "bg-parchment-100 text-gray-500"
                              : "bg-brand-600/10 text-brand-600"
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
                                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                              )}
                              <span className="min-w-0">
                                <span
                                  className={`block text-sm ${
                                    notification.isRead
                                      ? "font-medium text-gray-600"
                                      : "font-bold text-gray-800"
                                  }`}
                                >
                                  {notification.title}
                                </span>
                                <span className="mt-1 block text-sm text-gray-600">
                                  {notification.message}
                                </span>
                              </span>
                            </span>
                          </button>
                          <p className="mt-1 text-xs text-gray-500">
                            {relativeTime(notification.createdAt)}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {!notification.isRead && (
                              <button
                                type="button"
                                onClick={() => markRead(notification.id)}
                                className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                              >
                                Mark as Read
                              </button>
                            )}
                            {notification.isRead && (
                              <button
                                type="button"
                                onClick={() => removeNotification(notification.id)}
                                className="text-xs font-semibold text-red-600 hover:text-red-700"
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
                  className="w-full border-t border-line bg-card px-4 py-3 text-center text-sm font-semibold text-brand-600 transition duration-200 hover:bg-parchment-100"
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
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-2 text-white transition-colors duration-150 hover:border-white/25 hover:bg-white/10 sm:px-3"
              aria-haspopup="true"
              aria-expanded={profileOpen}
            >
              <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gold-500 text-xs font-bold text-brand-900 ring-1 ring-gold-300/60">
                {profileImageSrc ? (
                  <img src={profileImageSrc} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials(user?.full_name, user?.email)
                )}
              </span>
              <span className="hidden max-w-40 truncate text-sm font-semibold sm:inline">
                {user?.full_name || user?.email || "User"}
              </span>
              <ChevronDown className={`h-4 w-4 text-slate-300 transition-transform duration-150 ${profileOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>

            {profileOpen && (
              <div className="absolute right-0 z-[9999] mt-2 w-56 animate-fade-up overflow-hidden rounded-xl border border-line bg-card py-2 shadow-pop">
                <Link
                  to="/profile"
                  onClick={() => setProfileOpen(false)}
                  className="block px-4 py-2.5 text-sm font-medium text-gray-800 transition duration-200 hover:bg-parchment-100 hover:text-gray-800"
                >
                  Profile
                </Link>
                <Link
                  to="/profile#security"
                  onClick={() => setProfileOpen(false)}
                  className="block px-4 py-2.5 text-sm font-medium text-gray-800 transition duration-200 hover:bg-parchment-100 hover:text-gray-800"
                >
                  Settings
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="mt-2 block w-full border-t border-line px-4 py-2.5 text-left text-sm font-semibold text-rose-700 transition duration-200 hover:bg-rose-50"
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

