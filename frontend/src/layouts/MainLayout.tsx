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
    <div className="h-screen overflow-hidden bg-[#EEF2F6] text-[#2B3642] md:flex">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex h-screen min-w-0 flex-1 flex-col md:pl-60">
        <Topbar onToggleSidebar={() => setIsSidebarOpen((current) => !current)} />
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-6 lg:px-6 lg:py-5">
          {children}
        </main>
      </div>
    </div>
  );
}

