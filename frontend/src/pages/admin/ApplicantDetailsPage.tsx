import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import ImagePreviewModal from "../../components/ImagePreviewModal";
import { API_ORIGIN } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { useAuditLogStore } from "../../features/auditLogs/auditLogStore";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import MainLayout from "../../layouts/MainLayout";
import { getApplicant, updateApplicantApproval } from "../../services/adminService";
import type { AdminUserDetails, ApprovalStatus } from "../../types/auth";

const statusClass: Record<ApprovalStatus, string> = {
  pending: "bg-[#FFF7D6] text-[#92400E]",
  under_review: "bg-[#FEF3C7] text-[#B45309]",
  approved: "bg-[#DCFCE7] text-[#15803D]",
  rejected: "bg-[#FEE2E2] text-[#B91C1C]",
  suspended: "bg-[#FEE2E2] text-[#B91C1C]",
};

function formatDate(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value)
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">{label}</p>
      <p className="mt-1 text-sm font-medium text-[#2B3642]">{value || "Not provided"}</p>
    </div>
  );
}

function isFinalStatus(status: ApprovalStatus) {
  return status === "approved" || status === "rejected";
}

function resolveEmployeeIdEvidence(user: AdminUserDetails | null) {
  const raw =
    user?.employee_id_path ||
    user?.profile?.employee_id_path ||
    user?.profile_picture_path ||
    user?.profile?.profile_picture_path ||
    "";

  if (!raw) {
    return { imageSrc: "", reference: "" };
  }

  if (raw.startsWith("/uploads")) {
    return { imageSrc: `${API_ORIGIN}${raw}`, reference: raw };
  }

  if (raw.startsWith("data:image/") || raw.startsWith("http")) {
    return { imageSrc: raw, reference: raw };
  }

  return { imageSrc: "", reference: raw };
}

export default function ApplicantDetailsPage() {
  const { user: currentUser } = useAuth();
  const { id } = useParams();
  const userId = Number(id);
  const addLog = useAuditLogStore((state) => state.addLog);
  const addNotification = useNotificationStore((state) => state.addNotification);
  const [applicant, setApplicant] = useState<AdminUserDetails | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(userId)) return;
    let cancelled = false;

    async function loadApplicant() {
      try {
        const row = await getApplicant(userId);
        if (!cancelled) setApplicant(row);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load user");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadApplicant();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const changeStatus = async (approvalStatus: ApprovalStatus) => {
    if (applicant && isFinalStatus(applicant.approval_status)) {
      toast.error("Approved or rejected applications are view-only.");
      return;
    }

    setIsUpdating(true);
    setError("");
    const toastId = toast.loading("Processing approval update...");
    try {
      const updated = await updateApplicantApproval(userId, approvalStatus);
      setApplicant(updated);
      if (approvalStatus === "approved" || approvalStatus === "rejected") {
        const approved = approvalStatus === "approved";
        addLog({
          userId: currentUser?.user_id,
          user: currentUser?.full_name || currentUser?.email,
          action: approved ? "Approve User" : "Reject User",
          module: "Admin",
          description: `Admin ${approved ? "approved" : "rejected"} registration of ${updated.full_name || updated.email}`,
          entityType: "user",
          entityId: String(updated.user_id),
        });
        addNotification({
          type: approved ? "approval_success" : "rejection_notice",
          userId: updated.user_id,
          title: approved ? "Registration Approved" : "Registration Rejected",
          message: `Registration ${approved ? "approved" : "rejected"} for ${updated.full_name || updated.email}`,
          redirectTo: "/dashboard",
          entityType: "user",
          entityId: String(updated.user_id),
        });
      }
      toast.success("Approval completed", { id: toastId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update user";
      setError(message);
      toast.error(message, { id: toastId });
    } finally {
      setIsUpdating(false);
    }
  };

  const employeeIdEvidence = resolveEmployeeIdEvidence(applicant);

  return (
    <MainLayout>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#2B3642]">Applicant Details</h1>
          <nav className="mt-1 flex items-center gap-2 text-sm text-[#4B5563]">
            <Link to="/dashboard" className="hover:text-[#704389]">Dashboard</Link>
            <span>/</span>
            <Link to="/admin/verification" className="hover:text-[#704389]">Verification</Link>
            <span>/</span>
            <span className="text-[#2B3642]">{applicant?.full_name || "Applicant"}</span>
          </nav>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {isLoading || !applicant ? (
        <div className="rounded-[14px] border border-[#E5E7EB] bg-white p-10 text-center text-sm text-[#4B5563]">
          Loading applicant...
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-5 shadow-sm ">
              <div className="mb-4 flex items-center justify-between border-b border-[#E5E7EB] pb-4">
                <h2 className="text-base font-semibold text-[#2B3642]">Account Info</h2>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass[applicant.approval_status]}`}>
                  {applicant.approval_status.replace("_", " ")}
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Email" value={applicant.email} />
                <Field label="Role" value={applicant.role} />
                <Field label="Created" value={formatDate(applicant.created_at)} />
                <Field label="Last Login" value={formatDate(applicant.last_login_at)} />
              </div>
            </section>

            <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-5 shadow-sm ">
              <h2 className="mb-4 border-b border-[#E5E7EB] pb-4 text-base font-semibold text-[#2B3642]">
                Profile Info
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Full Name" value={applicant.profile.full_name} />
                <Field label="Sex" value={applicant.profile.sex} />
                <Field label="Birthdate" value={applicant.profile.birth_date} />
                <Field label="Mobile" value={applicant.profile.mobile_number} />
                <div className="md:col-span-2">
                  <Field label="Address" value={applicant.profile.address} />
                </div>
              </div>
            </section>
          </div>

          <aside className="h-fit rounded-[14px] border border-[#E5E7EB] bg-white p-5 shadow-sm ">
            <div className="mb-5 border-b border-[#E5E7EB] pb-5">
              <h2 className="text-base font-semibold text-[#2B3642]">Employee ID</h2>
              <div className="mt-3 overflow-hidden rounded-xl border border-[#E5E7EB] bg-[#F9FAFB]">
                {employeeIdEvidence.imageSrc ? (
                  <button
                    type="button"
                    onClick={() => setPreviewImage(employeeIdEvidence.imageSrc)}
                    className="block w-full"
                    aria-label="Preview employee ID"
                  >
                    <img
                      src={employeeIdEvidence.imageSrc}
                      alt="Employee ID"
                      className="h-52 w-full object-contain"
                    />
                  </button>
                ) : employeeIdEvidence.reference ? (
                  <div className="flex h-52 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-[#4B5563]">
                    <span className="font-semibold text-[#2B3642]">
                      Employee ID was submitted
                    </span>
                    <span className="break-all text-xs">
                      This record contains only a local upload reference.
                    </span>
                  </div>
                ) : (
                  <div className="flex h-52 items-center justify-center px-4 text-center text-sm text-[#4B5563]">
                    Employee ID image is not available.
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  employeeIdEvidence.imageSrc &&
                  setPreviewImage(employeeIdEvidence.imageSrc)
                }
                disabled={!employeeIdEvidence.imageSrc}
                className="mt-3 w-full rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] transition hover:bg-[#704389] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Preview ID
              </button>
            </div>
            <h2 className="text-base font-semibold text-[#2B3642]">Actions</h2>
            {isFinalStatus(applicant.approval_status) ? (
              <p className="mt-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm text-[#4B5563]">
                This application is finalized and available for viewing only.
              </p>
            ) : (
              <div className="mt-4 grid gap-2">
                <button
                  onClick={() => changeStatus("approved")}
                  disabled={isUpdating}
                  className="rounded-md bg-[#15803D] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#166534] disabled:opacity-60"
                >
                  Approve
                </button>
                <button
                  onClick={() => changeStatus("rejected")}
                  disabled={isUpdating}
                  className="rounded-md border border-[#DC2626] bg-white px-4 py-2.5 text-sm font-semibold text-[#DC2626] transition hover:bg-[#DC2626] hover:text-white disabled:opacity-60"
                >
                  Reject
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
      <ImagePreviewModal
        image={previewImage}
        alt="Employee ID"
        title="Employee ID Preview"
        onClose={() => setPreviewImage(null)}
      />
    </MainLayout>
  );
}

