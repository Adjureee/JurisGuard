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
    <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-8 shadow-md ">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#4A7FB0]">
            JurisGuard
          </p>
          <h1 className="mt-2 text-2xl font-bold text-[#2B3642]">Sign In</h1>
          <p className="mt-2 text-sm font-medium text-[#4B5563]">
            Sign in with your approved JurisGuard account.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-[#2B3642]">Email</span>
            <input
              type="email"
              className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition placeholder-gray-400 focus:border-[#4A7FB0] focus:ring-2 focus:ring-[#4A7FB0]/20"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-[#2B3642]">Password</span>
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition placeholder-gray-400 focus:border-[#4A7FB0] focus:ring-2 focus:ring-[#4A7FB0]/20"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
              {error}
            </div>
          )}

          {notice && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
              {notice}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-[#2B3642] px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm font-medium text-[#4B5563]">
          Need an account?{" "}
          <Link to="/register" className="font-semibold text-[#2B3642] hover:text-[#4A7FB0]">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
