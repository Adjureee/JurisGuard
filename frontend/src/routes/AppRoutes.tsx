import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "../components/auth/ProtectedRoute";
import ApplicantDetailsPage from "../pages/admin/ApplicantDetailsPage";
import VerificationPage from "../pages/admin/VerificationPage";
import LoginPage from "../pages/auth/LoginPage";
import RegisterPage from "../pages/auth/RegisterPage";
import AuditLogsPage from "../pages/AuditLogsPage";
import CriminalCases from "../pages/CriminalCases";
import Dashboard from "../pages/Dashboard";
import FormViewPage from "../pages/FormViewPage";
import TerminatedCasesPage from "../pages/TerminatedCases";
import UserProfilePage from "../pages/UserProfilePage";

const AnalyticsPage = lazy(() => import("../pages/AnalyticsPage"));
const StaffAnalyticsPage = lazy(() => import("../pages/StaffAnalyticsPage"));

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] text-sm font-semibold text-[#4B5563]">
      Loading analytics workspace...
    </div>
  );
}

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <ProtectedRoute requiredRole="admin">
              <Suspense fallback={<RouteLoadingFallback />}>
                <AnalyticsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff/analytics"
          element={
            <ProtectedRoute requiredRole="staff">
              <Suspense fallback={<RouteLoadingFallback />}>
                <StaffAnalyticsPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/cases"
          element={
            <ProtectedRoute>
              <CriminalCases />
            </ProtectedRoute>
          }
        />
        <Route
          path="/criminal-cases"
          element={
            <ProtectedRoute>
              <CriminalCases />
            </ProtectedRoute>
          }
        />
        <Route
          path="/criminal-cases/form-view/:caseId"
          element={
            <ProtectedRoute>
              <FormViewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/terminated-cases"
          element={
            <ProtectedRoute>
              <TerminatedCasesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/verification"
          element={
            <ProtectedRoute requiredRole="admin">
              <VerificationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/verifications"
          element={<Navigate to="/admin/verification" replace />}
        />
        <Route
          path="/admin/users/:id"
          element={
            <ProtectedRoute requiredRole="admin">
              <ApplicantDetailsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <UserProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit-logs"
          element={
            <ProtectedRoute>
              <AuditLogsPage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

