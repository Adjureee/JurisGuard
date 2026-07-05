import {
  Archive,
  BarChart3,
  ClipboardList,
  FileText,
  Gavel,
  LayoutDashboard,
  ShieldCheck,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { ReactNode } from "react";

interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
}

const iconClass = "h-[18px] w-[18px]";

const navigation: NavItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: <LayoutDashboard className={iconClass} /> },
  { label: "Criminal Cases", path: "/cases", icon: <Gavel className={iconClass} /> },
  { label: "Terminated Cases", path: "/terminated-cases", icon: <Archive className={iconClass} /> },
  { label: "Audit Logs", path: "/audit-logs", icon: <FileText className={iconClass} /> },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const location = useLocation();
  const { user } = useAuth();

  const primaryNavigation = user?.role === "admin"
    ? [
        navigation[0],
        { label: "Analytics", path: "/analytics", icon: <BarChart3 className={iconClass} /> },
      ]
    : [
        navigation[0],
        { label: "Analytics & Reports", path: "/staff/analytics", icon: <BarChart3 className={iconClass} /> },
      ];
  const manageNavigation = [
    navigation[1],
    navigation[2],
    {
      label: user?.role === "admin" ? "Case Review Center" : "Case Submissions",
      path: user?.role === "admin" ? "/case-review-center" : "/case-submissions",
      icon: <ClipboardList className={iconClass} />,
    },
    ...(user?.role === "admin"
      ? [{ label: "Verification", path: "/admin/verification", icon: <ShieldCheck className={iconClass} /> }]
      : []),
  ];
  const recordsNavigation = [navigation[3]];
  const navigationSections = [
    { label: "Overview", items: primaryNavigation },
    { label: "Manage", items: manageNavigation },
    { label: "Records", items: recordsNavigation },
  ].filter((section) => section.items.length > 0);

  const isActive = (path: string) =>
    location.pathname === path || (path !== "/dashboard" && location.pathname.startsWith(path));

  return (
    <>
      {isOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-gray-900/60 backdrop-blur-[2px] md:hidden"
        />
      )}
      <aside
        aria-label="Primary navigation"
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-card px-4 py-5 text-ink transition-transform duration-200 ease-out md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-center gap-3 border-b border-line px-1 pb-5">
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-line bg-card-2">
            <img
              src="/paologo.png"
              alt="PAO Panabo logo"
              className="h-full w-full object-contain p-2"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-ink">JurisGuard</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-400">PAO Panabo</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
          {navigationSections.map((section) => (
            <div key={section.label}>
              <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-faint">
                {section.label}
              </p>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const active = isActive(item.path);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={`group relative flex h-10 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                        active
                          ? "bg-brand-600 font-semibold text-white shadow-sm"
                          : "text-muted hover:bg-card-2 hover:text-ink"
                      }`}
                    >
                      <span
                        className={`shrink-0 transition-colors ${
                          active ? "text-white" : "text-faint group-hover:text-ink"
                        }`}
                      >
                        {item.icon}
                      </span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
