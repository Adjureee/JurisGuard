import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useAuditLogStore } from "../../features/auditLogs/auditLogStore";

interface LocationState {
  from?: {
    pathname?: string;
  };
  unauthorized?: boolean;
}

export default function LoginPage() {
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const unauthorizedMessage = state?.unauthorized
    ? "Please sign in with an approved account."
    : "";
  const addLog = useAuditLogStore((store) => store.addLog);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(unauthorizedMessage);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSubmitting(true);

    try {
      const user = await login({ email, password });
      addLog({
        userId: user.user_id,
        user: user.full_name || user.email,
        action: "Login",
        module: "Authentication",
        description: `${user.full_name || user.email} signed in`,
        entityType: "user",
        entityId: String(user.user_id),
      });
      navigate(state?.from?.pathname ?? "/dashboard", { replace: true });
    } catch (err) {
      logout();
      const message = err instanceof Error ? err.message : "Login failed";
      const displayMessage =
        message === "Could not validate credentials"
          ? "Account is unavailable or credentials are invalid."
          : message;
      setError(displayMessage);
      setNotice("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-[#E5E7EB] bg-white p-8 shadow-sm shadow-[#111827]/10">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#2F80ED]">
            JurisGuard
          </p>
          <h1 className="mt-2 text-2xl font-bold text-[#111827]">Sign In</h1>
          <p className="mt-2 text-sm text-[#6B7280]">
            Sign in with your approved JurisGuard account.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-[#111827]">Email</span>
            <input
              type="email"
              className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/20"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-[#111827]">Password</span>
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/20"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {notice && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {notice}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-[#2F80ED] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1f6fd6] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-[#6B7280]">
          Need an account?{" "}
          <Link to="/register" className="font-semibold text-[#111827] hover:text-[#2F80ED]">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
