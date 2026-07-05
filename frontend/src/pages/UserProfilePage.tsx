import { useState, type ChangeEvent } from "react";
import toast from "react-hot-toast";
import MainLayout from "../layouts/MainLayout";
import PageHeader from "../components/PageHeader";
import { useAuth } from "../contexts/AuthContext";
import {
  disableMfa,
  enableMfa,
  removeProfileImage,
  resolveProfileImageUrl,
  setupMfa,
  uploadProfileImage,
} from "../services/authService";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-ink">
        {value}
      </p>
    </div>
  );
}

function initials(name?: string, email?: string) {
  const source = (name || email || "User").trim();
  return source
    .split(/[ @.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function UserProfilePage() {
  const { user, getCurrentUser } = useAuth();
  const [uploadError, setUploadError] = useState("");
  const [previewSrc, setPreviewSrc] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaUri, setMfaUri] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [isMfaBusy, setIsMfaBusy] = useState(false);
  const profileImageSrc =
    previewSrc || resolveProfileImageUrl(user?.profile_image_path);

  const handleProfileImageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setUploadError("");
    setSelectedFile(null);
    setPreviewSrc("");

    if (!file || !user) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"];
    const fileName = file.name.toLowerCase();
    const hasAllowedExtension = allowedExtensions.some((extension) =>
      fileName.endsWith(extension),
    );
    if (!allowedTypes.includes(file.type) || !hasAllowedExtension) {
      setUploadError("Profile picture must be a JPG, JPEG, PNG, or WEBP file.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setUploadError("Profile picture must be 2MB or smaller.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPreviewSrc(String(reader.result));
      setSelectedFile(file);
    };
    reader.onerror = () => setUploadError("Unable to preview profile picture.");
    reader.readAsDataURL(file);
  };

  const handleSaveProfileImage = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setUploadError("");
    try {
      await uploadProfileImage(selectedFile);
      await getCurrentUser();
      setPreviewSrc("");
      setSelectedFile(null);
      toast.success("Profile image updated");
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Unable to upload profile image.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveProfileImage = async () => {
    if (!user) return;
    setIsUploading(true);
    setUploadError("");
    try {
      await removeProfileImage();
      await getCurrentUser();
      setPreviewSrc("");
      setSelectedFile(null);
      toast.success("Profile image removed");
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Unable to remove profile image.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleSetupMfa = async () => {
    setIsMfaBusy(true);
    try {
      const setup = await setupMfa();
      setMfaSecret(setup.secret);
      setMfaUri(setup.otpauth_uri);
      toast.success("MFA setup started");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Unable to start MFA setup",
      );
    } finally {
      setIsMfaBusy(false);
    }
  };

  const handleEnableMfa = async () => {
    setIsMfaBusy(true);
    try {
      await enableMfa(mfaCode);
      await getCurrentUser();
      setMfaCode("");
      setMfaSecret("");
      setMfaUri("");
      toast.success("MFA enabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to enable MFA");
    } finally {
      setIsMfaBusy(false);
    }
  };

  const handleDisableMfa = async () => {
    setIsMfaBusy(true);
    try {
      await disableMfa(mfaCode);
      await getCurrentUser();
      setMfaCode("");
      toast.success("MFA disabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to disable MFA");
    } finally {
      setIsMfaBusy(false);
    }
  };

  return (
    <MainLayout>
      <PageHeader
        eyebrow="Account"
        title="My Profile"
        description="Manage your JurisGuard account details, profile photo, and authentication settings."
      />

      <section className="rounded-lg border border-line bg-card p-5 shadow-sm ">
        <div className="mb-5 flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-600 text-xl font-semibold text-white">
            {profileImageSrc ? (
              <img
                src={profileImageSrc}
                alt="Profile"
                className="h-full w-full object-cover"
              />
            ) : (
              initials(user?.full_name, user?.email)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold text-ink">
              {user?.full_name || "User"}
            </h3>
            <p className="truncate text-sm text-muted">{user?.email}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <label
                className={`rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition duration-200 hover:bg-brand-700 ${isUploading ? "pointer-events-none opacity-70" : "cursor-pointer"}`}
              >
                {profileImageSrc
                  ? "Change Profile Picture"
                  : "Upload Profile Picture"}
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  onChange={handleProfileImageUpload}
                  disabled={isUploading}
                  className="sr-only"
                />
              </label>
              {selectedFile && (
                <button
                  type="button"
                  onClick={handleSaveProfileImage}
                  disabled={isUploading}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition duration-200 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isUploading ? "Uploading..." : "Save Image"}
                </button>
              )}
              {user?.profile_image_path && (
                <button
                  type="button"
                  onClick={handleRemoveProfileImage}
                  disabled={isUploading}
                  className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-muted transition duration-200 hover:bg-card-2 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isUploading ? "Uploading..." : "Remove Profile Picture"}
                </button>
              )}
            </div>
            {uploadError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{uploadError}</p>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Full Name" value={user?.full_name || "Not provided"} />
          <Field label="Email" value={user?.email || "Not provided"} />
          <Field label="Role" value={user?.role || "Not provided"} />
          <Field
            label="Account Status"
            value={user?.approval_status?.replace("_", " ") || "Not provided"}
          />
        </div>
      </section>

      <section
        id="security"
        className="mt-4 rounded-lg border border-line bg-card p-5 shadow-sm shadow-gray-900/10"
      >
        <h3 className="font-semibold text-ink">Security</h3>
        <div className="mt-4 rounded-lg border border-line p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">
                Multi-Factor Authentication
              </p>
              <p className="mt-1 text-sm text-muted">
                Status: {user?.mfa_enabled ? "Enabled" : "Disabled"}
              </p>
            </div>
            {!user?.mfa_enabled && (
              <button
                type="button"
                onClick={handleSetupMfa}
                disabled={isMfaBusy}
                className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Start Setup
              </button>
            )}
          </div>

          {mfaSecret && !user?.mfa_enabled && (
            <div className="mt-4 space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Manual Secret
                </p>
                <p className="mt-1 break-all rounded-lg bg-card-2 px-3 py-2 font-mono text-sm text-ink">
                  {mfaSecret}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Authenticator URI
                </p>
                <p className="mt-1 break-all rounded-lg bg-card-2 px-3 py-2 font-mono text-xs text-ink">
                  {mfaUri}
                </p>
              </div>
              <p className="text-sm text-muted">
                Add the secret to an authenticator app, then enter the current
                6-digit code.
              </p>
            </div>
          )}

          {(mfaSecret || user?.mfa_enabled) && (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={mfaCode}
                onChange={(event) =>
                  setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="6-digit code"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:max-w-48"
              />
              <button
                type="button"
                onClick={user?.mfa_enabled ? handleDisableMfa : handleEnableMfa}
                disabled={isMfaBusy || mfaCode.length !== 6}
                className="rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-card transition hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {user?.mfa_enabled ? "Disable MFA" : "Enable MFA"}
              </button>
            </div>
          )}
        </div>
      </section>
    </MainLayout>
  );
}
