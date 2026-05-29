import { lazy, Suspense } from "react";
import ErrorBoundary from "../components/ErrorBoundary";
import { useAuth } from "../contexts/AuthContext";

const AdminDashboard = lazy(() => import("./dashboard/AdminDashboard"));
const StaffDashboard = lazy(() => import("./dashboard/StaffDashboard"));

export default function Dashboard() {
  const { user } = useAuth();
  return (
    <ErrorBoundary
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] px-4">
          <div className="max-w-md rounded-xl border border-amber-200 bg-white p-5 text-center shadow-sm">
            <p className="text-base font-semibold text-[#111827]">Dashboard temporarily unavailable</p>
            <p className="mt-2 text-sm text-[#6B7280]">The rest of JurisGuard is still available from the sidebar.</p>
          </div>
        </div>
      }
    >
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] text-sm font-semibold text-[#6B7280]">
            Loading dashboard intelligence...
          </div>
        }
      >
        {user?.role === "admin" ? <AdminDashboard /> : <StaffDashboard />}
      </Suspense>
    </ErrorBoundary>
  );
}
