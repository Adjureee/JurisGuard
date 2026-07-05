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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-canvas via-card to-canvas px-4 py-5">
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -12, scale: 0.985 }}
        transition={{ duration: 0.32, ease: "easeOut" }}
        className="grid w-full max-w-6xl overflow-hidden rounded-2xl border border-line bg-card shadow-[0_24px_80px_rgba(15,23,42,0.12)] lg:grid-cols-[0.9fr_1.25fr]"
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
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400">
                JurisGuard
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink">
                Welcome back
              </h1>
              <p className="mt-3 text-sm font-medium leading-6 text-muted">
                Sign in with your approved PAO Panabo account.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-ink">
                  Email
                </span>
                <input
                  type="email"
                    className="mt-1.5 h-11 w-full rounded-lg border border-line2 bg-card px-3 text-sm text-ink outline-none transition-all duration-200 ease-in-out placeholder:text-faint hover:border-line2 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-ink">
                  Password
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                    className="mt-1.5 h-11 w-full rounded-lg border border-line2 bg-card px-3 text-sm text-ink outline-none transition-all duration-200 ease-in-out placeholder:text-faint hover:border-line2 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>

              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(event) => setShowPassword(event.target.checked)}
                  className="h-4 w-4 rounded border-line2 text-brand-600 dark:text-brand-400 focus:ring-brand-600"
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
                    className="rounded-xl border border-line bg-card-2/80 p-4 shadow-sm"
                  >
                    <div className="mb-3 flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400">
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold tracking-tight text-ink">
                          Two-step verification
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted">
                          Open your authenticator app and enter the 6-digit
                          code.
                        </p>
                      </div>
                    </div>
                    <label className="block">
                      <span className="text-sm font-medium text-ink">
                        Authenticator code
                      </span>
                      <input
                        ref={otpInputRef}
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        className="mt-1.5 h-12 w-full rounded-lg border border-line2 bg-card px-4 text-center font-mono text-lg font-semibold tracking-[0.35em] text-ink outline-none transition-all duration-200 ease-in-out placeholder:tracking-normal placeholder:text-faint focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
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
                    <label className="mt-3 flex items-start gap-2 text-sm font-medium text-ink">
                      <input
                        type="checkbox"
                        checked={rememberDevice}
                        onChange={(event) =>
                          setRememberDevice(event.target.checked)
                        }
                        className="mt-0.5 h-4 w-4 rounded border-line2 text-brand-600 dark:text-brand-400 focus:ring-brand-600"
                      />
                      <span>
                        Remember this device for 14 days
                        <span className="block text-xs font-normal leading-5 text-muted">
                          Use only on trusted PAO workstations.
                        </span>
                      </span>
                    </label>
                  </motion.div>
                )}
              </AnimatePresence>

              {error && (
                <div role="alert" className="rounded-lg border border-rose-200 dark:border-rose-400/25 bg-rose-50 dark:bg-rose-400/10 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-300">
                  {error}
                </div>
              )}

              {notice && (
                <div className="rounded-lg border border-line bg-card-2 px-3 py-2 text-sm font-medium text-ink shadow-sm">
                  {notice}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="h-11 w-full rounded-lg bg-brand-600 px-4 text-sm font-bold text-white shadow-sm transition-all duration-200 ease-in-out hover:bg-brand-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100"
              >
                {isSubmitting
                  ? "Signing in..."
                  : showMfaCode
                    ? "Verify and Sign In"
                    : "Sign In"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm font-medium text-muted">
              Need an account?{" "}
              <Link
                to="/register"
                className="font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
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
