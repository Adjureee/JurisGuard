import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import LoadingState from "../LoadingState";
import type { ReactNode } from "react";

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRole?: "admin" | "staff";
}

export default function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const location = useLocation();
  const { token, user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingState label="Checking session…" className="min-h-screen bg-[#F9FAFB]" />;
  }

  if (!token || !user || user.approval_status !== "approved") {
    return <Navigate to="/login" replace state={{ from: location, unauthorized: true }} />;
  }

  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

