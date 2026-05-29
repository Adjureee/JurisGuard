import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function DashboardIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path fill="currentColor" d="M3 3h6v6H3V3Zm8 0h6v6h-6V3ZM3 11h6v6H3v-6Zm8 0h6v6h-6v-6Z" />
    </svg>
  );
}

function GavelIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path fill="currentColor" d="m7.4 2 4.6 4.6-1.4 1.4L9.4 6.8 6.8 9.4 8 10.6 6.6 12 2 7.4 3.4 6l1.2 1.2 2.6-2.6L6 3.4 7.4 2Zm5.2 7.4 5 5-1.4 1.4-5-5 1.4-1.4ZM4 16h8v2H4v-2Z" />
    </svg>
  );
}

function AnalyticsIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path fill="currentColor" d="M3 16.5h14V18H3v-1.5ZM5 9h2.5v6H5V9Zm4 3h2.5v3H9v-3Zm4-7h2.5v10H13V5Zm-8.5-.5h5v1.8h-5V4.5Zm7 0h4v1.8h-4V4.5Z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path fill="currentColor" d="M10 2 3.5 4.3v5.2c0 4.1 2.7 7 6.5 8.5 3.8-1.5 6.5-4.4 6.5-8.5V4.3L10 2Zm2.9 6.7-3.4 3.4-1.6-1.6 1.1-1.1.5.5 2.3-2.3 1.1 1.1Z" />
    </svg>
  );
}

function AuditIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path fill="currentColor" d="M4 2h9l3 3v13H4V2Zm8 1.5V6h2.5L12 3.5ZM7 8h6v1.5H7V8Zm0 3h6v1.5H7V11Zm0 3h4v1.5H7V14Z" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path fill="currentColor" d="M3 4h14v4H3V4Zm1.5 5h11v7.5A1.5 1.5 0 0 1 14 18H6a1.5 1.5 0 0 1-1.5-1.5V9ZM8 11v2h4v-2H8Z" />
    </svg>
  );
}

const navigation = [
  { label: "Dashboard", path: "/dashboard", icon: <DashboardIcon /> },
  { label: "Criminal Cases", path: "/cases", icon: <GavelIcon /> },
  { label: "Terminated Cases", path: "/terminated-cases", icon: <ArchiveIcon /> },
  { label: "Audit Logs", path: "/audit-logs", icon: <AuditIcon /> },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const location = useLocation();
  const { user } = useAuth();

  const visibleNavigation = user?.role === "admin"
    ? [
        navigation[0],
        { label: "Analytics", path: "/analytics", icon: <AnalyticsIcon /> },
        ...navigation.slice(1),
        { label: "Verification", path: "/admin/verification", icon: <ShieldIcon /> },
      ]
    : navigation;

  const itemClass = (path: string) =>
    location.pathname === path || (path !== "/dashboard" && location.pathname.startsWith(path))
      ? "bg-[#2f80ed] text-white shadow-sm"
      : "text-[#6b7280] hover:-translate-y-px hover:bg-[#2f80ed] hover:text-white hover:shadow-sm";

  return (
    <>
      {isOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-[#111827]/25 md:hidden"
        />
      )}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-[#e5e7eb] bg-[#f5f5f5] px-5 py-5 transition duration-200 md:translate-x-0 ${
        isOpen ? "translate-x-0" : "-translate-x-full"
      }`}>
      <div className="mb-5 flex justify-center">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white shadow-sm shadow-[#111827]/5">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7 text-[#2F80ED]">
            <path fill="currentColor" d="M12 3 4 6v5c0 5 3.4 8.3 8 10 4.6-1.7 8-5 8-10V6l-8-3Zm0 3.2 5 1.9V11c0 3.4-2 5.8-5 7.2-3-1.4-5-3.8-5-7.2V8.1l5-1.9ZM9 10h6v2H9v-2Zm1 3h4v2h-4v-2Z" />
          </svg>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0 overflow-y-auto">
        {visibleNavigation.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            onClick={onClose}
            className={`mb-1.5 flex h-[42px] items-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 text-sm font-medium transition duration-200 ${itemClass(item.path)}`}
          >
            <span className="shrink-0">
              {item.icon}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
    </>
  );
}
