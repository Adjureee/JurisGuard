import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
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
  const [rememberDevice, setRememberDevice] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showMfaCode, setShowMfaCode] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(unauthorizedMessage);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const otpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showMfaCode) {
      otpInputRef.current?.focus();
    }
  }, [showMfaCode]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSubmitting(true);

    try {
      const user = await login({
        email,
        password,
        otpCode,
        rememberDevice: showMfaCode ? rememberDevice : false,
      });
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
        setError("");
        return;
      }
      setError(displayMessage);
      setNotice("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-5">
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -12, scale: 0.985 }}
        transition={{ duration: 0.32, ease: "easeOut" }}
        className="grid w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.12)] lg:grid-cols-[0.9fr_1.25fr]"
      >
        <AuthImagePanel
          headline="Secure legal intake starts here."
          description="Access the JurisGuard workspace for PAO Panabo case records, OCR-assisted document processing, auditability, and legal operations monitoring."
        />

        <div className="flex min-h-[580px] items-center justify-center px-6 py-8 sm:px-10 lg:px-16">
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.36, delay: 0.06, ease: "easeOut" }}
            className="w-full max-w-md"
          >
            <div className="mb-6 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#704389]">
                JurisGuard
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
                Welcome back
              </h1>
              <p className="mt-3 text-sm font-medium leading-6 text-slate-600">
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
                    className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition-all duration-200 ease-in-out placeholder:text-slate-400 hover:border-slate-400 focus:border-[#704389] focus:ring-4 focus:ring-[#704389]/10"
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
                    className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition-all duration-200 ease-in-out placeholder:text-slate-400 hover:border-slate-400 focus:border-[#704389] focus:ring-4 focus:ring-[#704389]/10"
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

              <AnimatePresence initial={false}>
                {showMfaCode && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm"
                  >
                    <div className="mb-3 flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F7F0FA] text-[#704389]">
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold tracking-tight text-slate-950">
                          Two-step verification
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          Open your authenticator app and enter the 6-digit
                          code.
                        </p>
                      </div>
                    </div>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-800">
                        Authenticator code
                      </span>
                      <input
                        ref={otpInputRef}
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        className="mt-1.5 h-12 w-full rounded-lg border border-slate-300 bg-white px-4 text-center font-mono text-lg font-semibold tracking-[0.35em] text-slate-950 outline-none transition-all duration-200 ease-in-out placeholder:tracking-normal placeholder:text-slate-400 focus:border-[#704389] focus:ring-4 focus:ring-[#704389]/10"
                        value={otpCode}
                        onChange={(event) =>
                          setOtpCode(
                            event.target.value.replace(/\D/g, "").slice(0, 6),
                          )
                        }
                        autoComplete="one-time-code"
                        placeholder="000000"
                      />
                    </label>
                    <label className="mt-3 flex items-start gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={rememberDevice}
                        onChange={(event) =>
                          setRememberDevice(event.target.checked)
                        }
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#704389] focus:ring-[#704389]"
                      />
                      <span>
                        Remember this device for 14 days
                        <span className="block text-xs font-normal leading-5 text-slate-500">
                          Use only on trusted PAO workstations.
                        </span>
                      </span>
                    </label>
                  </motion.div>
                )}
              </AnimatePresence>

              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                  {error}
                </div>
              )}

              {notice && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm">
                  {notice}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="h-11 w-full rounded-lg bg-[#704389] px-4 text-sm font-bold text-white shadow-sm transition-all duration-200 ease-in-out hover:bg-[#5F3675] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100"
              >
                {isSubmitting
                  ? "Signing in..."
                  : showMfaCode
                    ? "Verify and Sign In"
                    : "Sign In"}
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
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
