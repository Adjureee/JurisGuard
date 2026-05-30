import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useNotificationStore } from "../../features/notifications/notificationStore";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const addNotification = useNotificationStore((state) => state.addNotification);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [employeeIdFileName, setEmployeeIdFileName] = useState("");
  const [employeeIdPreview, setEmployeeIdPreview] = useState("");
  const [employeeIdReference, setEmployeeIdReference] = useState("");
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
        employee_id_path: employeeIdReference,
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
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] px-4 py-10">
      <div className="w-full max-w-lg rounded-lg border border-[#E5E7EB] bg-white p-8 shadow-sm shadow-[#111827]/10">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#2F80ED]">
            JurisGuard
          </p>
          <h1 className="mt-2 text-2xl font-bold text-[#111827]">Create Account</h1>
          <p className="mt-2 text-sm text-[#6B7280]">
            Your account request must be approved by an admin before access is enabled.
            Rejected applications may be resubmitted with the same email.
          </p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-[#111827]">Full Name</span>
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/20"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              required
            />
          </label>

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

          <div>
            <span className="text-sm font-medium text-[#111827]">Upload Employee ID</span>
            <div className="mt-1 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
              {employeeIdPreview ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <img
                    src={employeeIdPreview}
                    alt="Employee ID preview"
                    className="h-24 w-36 rounded-md border border-[#E5E7EB] bg-white object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#111827]">
                      {employeeIdFileName}
                    </p>
                    <p className="mt-1 text-xs text-[#6B7280]">
                      Image selected for verification.
                    </p>
                    <button
                      type="button"
                      onClick={removeEmployeeId}
                      className="mt-3 rounded-md border border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B7280] transition duration-200 hover:bg-gray-50"
                    >
                      Remove / Change Image
                    </button>
                  </div>
                </div>
              ) : (
                <label className="block cursor-pointer rounded-md border border-dashed border-[#D1D5DB] bg-white px-4 py-5 text-center transition duration-200 hover:border-[#2F80ED] hover:bg-[#F9FAFB]">
                  <span className="text-sm font-semibold text-[#111827]">
                    Select employee ID image
                  </span>
                  <span className="mt-1 block text-xs text-[#6B7280]">
                    JPG, PNG, or other image file.
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleEmployeeIdUpload}
                    className="sr-only"
                    required
                  />
                </label>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-[#111827]">Password</span>
              <input
                type={showPassword ? "text" : "password"}
                className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/20"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-[#111827]">Confirm Password</span>
              <input
                type={showPassword ? "text" : "password"}
                className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/20"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-[#111827]">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(event) => setShowPassword(event.target.checked)}
              className="h-4 w-4 rounded border-[#D1D5DB] text-[#2F80ED] focus:ring-[#2F80ED]"
            />
            Show Password
          </label>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-[#2F80ED] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1f6fd6] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Submitting..." : "Register"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-[#6B7280]">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-[#111827] hover:text-[#2F80ED]">
            Login
          </Link>
        </p>
      </div>
    </div>
  );
}
