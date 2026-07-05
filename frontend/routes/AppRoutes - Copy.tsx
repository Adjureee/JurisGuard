import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "../components/auth/ProtectedRoute";
import ApplicantDetailsPage from "../pages/admin/ApplicantDetailsPage";
import VerificationPage from "../pages/admin/VerificationPage";
import LoginPage from "../pages/auth/LoginPage";
import RegisterPage from "../pages/auth/RegisterPage";
import AuditLogsPage from "../pages/AuditLogsPage";
import CriminalCases from "../pages/CriminalCases";
import Dashboard from "../pages/Dashboard";
import UserProfilePage from "../pages/UserProfilePage";

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

