import { useState, type ChangeEvent, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import AuthImagePanel from "../../components/auth/AuthImagePanel";
import ImagePreviewModal from "../../components/ImagePreviewModal";
import { useAuth } from "../../contexts/AuthContext";
import { useNotificationStore } from "../../features/notifications/notificationStore";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const addNotification = useNotificationStore(
    (state) => state.addNotification,
  );
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [employeeIdFileName, setEmployeeIdFileName] = useState("");
  const [employeeIdPreview, setEmployeeIdPreview] = useState("");
  const [employeeIdReference, setEmployeeIdReference] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEmployeeIdUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError("");

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Employee ID must be an image file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setEmployeeIdFileName(file.name);
      setEmployeeIdPreview(String(reader.result));
      setEmployeeIdReference(`local-employee-id://${Date.now()}-${file.name}`);
    };
    reader.onerror = () => setError("Unable to preview employee ID image.");
    reader.readAsDataURL(file);
  };

  const removeEmployeeId = () => {
    setEmployeeIdFileName("");
    setEmployeeIdPreview("");
    setEmployeeIdReference("");
  };

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!employeeIdReference) {
      setError("Employee ID upload is required.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await register({
        full_name: fullName,
        email,
        password,
        employee_id_path: employeeIdPreview || employeeIdReference,
      });
      setSuccess(response.message);
      addNotification({
        type: "new_registration",
        targetRole: "admin",
        title: "New Registration",
        message: `New registration pending approval: ${fullName || email}`,
        redirectTo: "/admin/verification",
        entityType: "user_registration",
        entityId: email,
      });
      setFullName("");
      setEmail("");
      removeEmployeeId();
      setPassword("");
      setConfirmPassword("");
      window.setTimeout(() => {
        navigate("/login", { replace: true });
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ivory via-parchment-50 to-brand-50 px-4 py-5">
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -12, scale: 0.985 }}
        transition={{ duration: 0.32, ease: "easeOut" }}
        className="grid w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-card shadow-[0_24px_80px_rgba(15,23,42,0.12)] lg:grid-cols-[0.9fr_1.25fr]"
      >
        <AuthImagePanel
          headline="Join the PAO Panabo legal records workspace."
          description="Request a JurisGuard account for approved staff access to client intake, criminal case records, OCR workflows, and secure legal archiving."
        />

        <div className="flex items-center justify-center px-6 py-7 sm:px-8 lg:px-12">
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.36, delay: 0.06, ease: "easeOut" }}
            className="w-full max-w-2xl"
          >
            <div className="mb-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">
                JurisGuard
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
                Create Account
              </h1>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                Your account request must be approved by an admin before access
                is enabled.
              </p>
            </div>

            <form onSubmit={handleRegister} className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-900">
                  Full Name
                </span>
                <input
                  type="text"
                  className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-card px-3 text-sm text-slate-950 outline-none transition-all duration-200 ease-in-out placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  autoComplete="name"
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-gray-900">
                  Email
                </span>
                <input
                  type="email"
                  className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-card px-3 text-sm text-slate-950 outline-none transition-all duration-200 ease-in-out placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              <div>
                <span className="text-sm font-medium text-gray-900">
                  Upload Employee ID
                </span>
                <div className="mt-1.5 rounded-xl border border-slate-200 bg-parchment-100/80 p-3 shadow-sm">
                  <AnimatePresence mode="wait" initial={false}>
                    {employeeIdPreview ? (
                    <motion.div
                      key="preview"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="flex flex-col gap-3 sm:flex-row sm:items-center"
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewImage(employeeIdPreview)}
                        className="group rounded-lg text-left outline-none transition-transform active:scale-[0.98] focus:ring-4 focus:ring-brand-600/10"
                        aria-label="Open employee ID preview"
                      >
                        <img
                          src={employeeIdPreview}
                          alt="Employee ID preview"
                          className="h-20 w-32 rounded-lg border border-slate-200 bg-card object-cover shadow-sm transition duration-200 group-hover:brightness-95"
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {employeeIdFileName}
                        </p>
                        <p className="mt-1 text-xs text-gray-600">
                          Image selected for verification.
                        </p>
                        <button
                          type="button"
                          onClick={removeEmployeeId}
                          className="mt-2 rounded-lg border border-slate-300 bg-card px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all duration-200 hover:bg-parchment-100 hover:text-slate-950 active:scale-[0.98]"
                        >
                          Remove / Change Image
                        </button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.label
                      key="upload"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="block cursor-pointer rounded-lg border border-dashed border-slate-300 bg-card px-4 py-4 text-center transition-all duration-200 hover:border-brand-600 hover:bg-brand-50 active:scale-[0.99]"
                    >
                      <span className="text-sm font-semibold text-slate-950">
                        Select employee ID image
                      </span>
                      <span className="mt-1 block text-xs text-slate-600">
                        JPG, PNG, or other image file.
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleEmployeeIdUpload}
                        className="sr-only"
                        required
                      />
                    </motion.label>
                  )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-gray-900">
                    Password
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-card px-3 text-sm text-slate-950 outline-none transition-all duration-200 ease-in-out placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-gray-900">
                    Confirm Password
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-card px-3 text-sm text-slate-950 outline-none transition-all duration-200 ease-in-out placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(event) => setShowPassword(event.target.checked)}
                  className="h-4 w-4 rounded border-parchment-300 text-brand-600 focus:ring-brand-600"
                />
                Show Password
              </label>

              {error && (
                <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 shadow-sm">
                  {error}
                </div>
              )}

              {success && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 shadow-sm">
                  {success}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="h-11 w-full rounded-lg bg-brand-600 px-4 text-sm font-bold text-white shadow-sm transition-all duration-200 ease-in-out hover:bg-brand-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100"
              >
                {isSubmitting ? "Submitting..." : "Register"}
              </button>
            </form>

            <p className="mt-4 text-center text-sm font-medium text-gray-500">
              Already have an account?{" "}
              <Link
                to="/login"
                className="font-semibold text-brand-600 hover:text-brand-700"
              >
                Login
              </Link>
            </p>
          </motion.div>
        </div>
      </motion.div>
      <ImagePreviewModal
        image={previewImage}
        alt="Employee ID enlarged preview"
        title="Employee ID Preview"
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
}
