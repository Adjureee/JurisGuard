import { useState } from "react";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/layout/Topbar";
import type { ReactNode } from "react";

interface MainLayoutProps {
  children: ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen overflow-visible bg-[#F9FAFB] text-[#111827] md:flex">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col md:pl-60">
        <Topbar onToggleSidebar={() => setIsSidebarOpen((current) => !current)} />
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-[30px] lg:py-[30px]">
          {children}
        </main>
      </div>
    </div>
  );
}
