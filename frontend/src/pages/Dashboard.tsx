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
        <div className="flex min-h-screen items-center justify-center bg-card-2 px-4">
          <div className="max-w-md rounded-xl border border-line bg-card p-6 text-center shadow-pop">
            <p className="text-base font-semibold text-ink">Dashboard temporarily unavailable</p>
            <p className="mt-2 text-sm text-muted">The rest of JurisGuard is still available from the sidebar.</p>
            <button
              type="button"
              onClick={() => setRetryKey((current) => current + 1)}
              className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              Retry dashboard
            </button>
          </div>
        </div>
      }
    >
      <Suspense
        fallback={
          <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas">
            <span
              aria-hidden="true"
              className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-200 dark:border-brand-400/30 border-t-brand-600"
            />
            <p className="text-sm font-semibold text-muted">Loading dashboard intelligence...</p>
          </div>
        }
      >
        {user?.role === "admin" ? <AdminDashboard /> : <StaffDashboard />}
      </Suspense>
    </ErrorBoundary>
  );
}

