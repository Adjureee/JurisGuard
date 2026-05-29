import { lazy, Suspense, useState } from "react";
import ErrorBoundary from "../components/ErrorBoundary";
import { useAuth } from "../contexts/AuthContext";

const AdminDashboard = lazy(() => import("./dashboard/AdminDashboard"));
const StaffDashboard = lazy(() => import("./dashboard/StaffDashboard"));

export default function Dashboard() {
  const { user } = useAuth();
  const [retryKey, setRetryKey] = useState(0);
  return (
    <ErrorBoundary
      key={`${user?.role ?? "guest"}-${retryKey}`}
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] px-4">
          <div className="max-w-md rounded-xl border border-amber-200 bg-white p-5 text-center shadow-sm">
            <p className="text-base font-semibold text-[#111827]">Dashboard temporarily unavailable</p>
            <p className="mt-2 text-sm text-[#6B7280]">The rest of JurisGuard is still available from the sidebar.</p>
            <button
              type="button"
              onClick={() => setRetryKey((current) => current + 1)}
              className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-[#111827] px-4 text-sm font-semibold text-white hover:bg-[#374151]"
            >
              Retry dashboard
            </button>
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
