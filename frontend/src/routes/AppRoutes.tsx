import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "../components/auth/ProtectedRoute";
const ApplicantDetailsPage = lazy(() => import("../pages/admin/ApplicantDetailsPage"));
const VerificationPage = lazy(() => import("../pages/admin/VerificationPage"));
import LoginPage from "../pages/auth/LoginPage";
import RegisterPage from "../pages/auth/RegisterPage";
const AuditLogsPage = lazy(() => import("../pages/AuditLogsPage"));
const CaseSubmissionsPage = lazy(() => import("../pages/CaseSubmissionsPage"));
const CaseTransferPage = lazy(() => import("../pages/CaseTransferPage"));
const CivilCases = lazy(() => import("../pages/CivilCases"));
const CriminalCases = lazy(() => import("../pages/CriminalCases"));
const Dashboard = lazy(() => import("../pages/Dashboard"));
const FormViewPage = lazy(() => import("../pages/FormViewPage"));
const TerminatedCasesPage = lazy(() => import("../pages/TerminatedCases"));
const UserProfilePage = lazy(() => import("../pages/UserProfilePage"));

const AnalyticsPage = lazy(() => import("../pages/AnalyticsPage"));
const StaffAnalyticsPage = lazy(() => import("../pages/StaffAnalyticsPage"));

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] text-sm font-semibold text-[#4B5563]">
      Loading workspace…
    </div>
  );
}

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteLoadingFallback />}><Routes>
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
          path="/civil-cases"
          element={
            <ProtectedRoute>
              <CivilCases />
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
          path="/civil-cases/form-view/:caseId"
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
          path="/case-submissions"
          element={
            <ProtectedRoute requiredRole="staff">
              <CaseSubmissionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/case-transfers"
          element={
            <ProtectedRoute>
              <CaseTransferPage />
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
      </Routes></Suspense>
    </BrowserRouter>
  );
}

