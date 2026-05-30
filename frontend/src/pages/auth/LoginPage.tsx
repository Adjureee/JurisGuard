import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import AuthImagePanel from "../../components/auth/AuthImagePanel";
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
  const [otpCode, setOtpCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showMfaCode, setShowMfaCode] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(unauthorizedMessage);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSubmitting(true);

    try {
      const user = await login({ email, password, otpCode });
      addLog({
        userId: user.user_id,
        user: user.full_name || user.email,
        action: "Login",
        module: "Authentication",
        description: `${user.full_name || user.email} signed in`,
        entityType: "user",
        entityId: String(user.user_id),
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      logout();
      const message = err instanceof Error ? err.message : "Login failed";
      const displayMessage =
        message === "Could not validate credentials"
          ? "Account is unavailable or credentials are invalid."
          : message;
      if (message === "MFA code required") {
        setShowMfaCode(true);
        setError("Enter your 6-digit authenticator code to continue.");
        return;
      }
      setError(displayMessage);
      setNotice("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F3F4F6] px-4 py-5">
      <div className="grid w-full max-w-6xl overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-xl lg:grid-cols-[0.9fr_1.25fr]">
        <AuthImagePanel
          headline="Secure legal intake starts here."
          description="Access the JurisGuard workspace for PAO Panabo case records, OCR-assisted document processing, auditability, and legal operations monitoring."
        />

        <div className="flex min-h-[580px] items-center justify-center px-6 py-8 sm:px-10 lg:px-16">
          <div className="w-full max-w-md">
            <div className="mb-6 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#704389]">
                JurisGuard
              </p>
              <h1 className="mt-3 text-3xl font-bold text-[#111827]">
                Welcome back
              </h1>
              <p className="mt-3 text-sm font-medium leading-6 text-[#6B7280]">
                Sign in with your approved PAO Panabo account.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-[#111827]">
                  Email
                </span>
                <input
                  type="email"
                  className="mt-1.5 h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#111827] outline-none transition placeholder-gray-400 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/15"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-[#111827]">
                  Password
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  className="mt-1.5 h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#111827] outline-none transition placeholder-gray-400 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/15"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>

              <label className="flex items-center gap-2 text-sm font-medium text-[#111827]">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(event) => setShowPassword(event.target.checked)}
                  className="h-4 w-4 rounded border-[#D1D5DB] text-[#704389] focus:ring-[#704389]"
                />
                Show Password
              </label>

              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                  {error}
                </div>
              )}

              {notice && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
                  {notice}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="h-11 w-full rounded-lg bg-[#704389] px-4 text-sm font-bold text-white transition-all hover:bg-[#5F3675] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting ? "Signing in..." : "Sign In"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm font-medium text-[#6B7280]">
              Need an account?{" "}
              <Link
                to="/register"
                className="font-semibold text-[#704389] hover:text-[#5F3675]"
              >
                Register
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
