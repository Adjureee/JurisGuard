import { useEffect, useState, type ChangeEvent } from "react";
import toast from "react-hot-toast";
import { useLocation, useNavigate } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";
import ProtectedProfileImage from "../components/ProtectedProfileImage";
import PageHeader from "../components/PageHeader";
import { useConfirmation } from "../components/ConfirmationProvider";
import { useAuth } from "../contexts/AuthContext";
import {
  removeProfileImage,
  uploadProfileImage,
} from "../services/authService";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-[#2B3642]">
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
  const location = useLocation();
  const navigate = useNavigate();
  const confirm = useConfirmation();
  const { user, getCurrentUser } = useAuth();
  const [uploadError, setUploadError] = useState("");
  const [previewSrc, setPreviewSrc] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const profileImageSrc = previewSrc;

  useEffect(() => {
    if (location.hash === "#security") navigate("/settings", { replace: true });
  }, [location.hash, navigate]);

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
    if (!await confirm({ title: "Remove profile photo?", message: "Your current profile photo will be removed. You can upload a new one later.", confirmLabel: "Remove photo" })) return;
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

  return (
    <MainLayout>
      <PageHeader
        eyebrow="Account"
        title="My Profile"
        description="View your account details and manage your profile photo."
      />

      <section className="rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm ">
        <div className="mb-5 flex flex-col gap-4 border-b border-[#E5E7EB] pb-5 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#704389] text-xl font-semibold text-white">
            {profileImageSrc ? (
              <img
                src={profileImageSrc}
                alt="Profile"
                className="h-full w-full object-cover"
              />
            ) : (
              <ProtectedProfileImage path={user?.profile_image_path} alt="Profile" className="h-full w-full object-cover" fallback={initials(user?.full_name, user?.email)} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold text-[#2B3642]">
              {user?.full_name || "User"}
            </h3>
            <p className="truncate text-sm text-[#4B5563]">{user?.email}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <label
                className={`rounded-md bg-[#704389] px-3 py-1.5 text-xs font-semibold text-white transition duration-200 hover:bg-[#5F3675] ${isUploading ? "pointer-events-none opacity-70" : "cursor-pointer"}`}
              >
                {profileImageSrc || user?.profile_image_path
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
                  className="rounded-md bg-[#704389] px-3 py-1.5 text-xs font-semibold text-white transition duration-200 hover:bg-[#5F3675] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isUploading ? "Uploading..." : "Save Image"}
                </button>
              )}
              {user?.profile_image_path && (
                <button
                  type="button"
                  onClick={handleRemoveProfileImage}
                  disabled={isUploading}
                  className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#4B5563] transition duration-200 hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isUploading ? "Uploading..." : "Remove Profile Picture"}
                </button>
              )}
            </div>
            {uploadError && (
              <p className="mt-2 text-xs text-red-600">{uploadError}</p>
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

    </MainLayout>
  );
}
