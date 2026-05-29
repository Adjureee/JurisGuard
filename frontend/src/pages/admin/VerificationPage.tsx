import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useAuth } from "../../contexts/AuthContext";
import { useAuditLogStore } from "../../features/auditLogs/auditLogStore";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import MainLayout from "../../layouts/MainLayout";
import ImagePreviewModal from "../../components/ImagePreviewModal";
import { API_ORIGIN } from "../../api/client";
import { listApplicants, updateApplicantApproval } from "../../services/adminService";
import type { AdminUserListItem, ApprovalStatus } from "../../types/auth";

const statusLabel: Record<ApprovalStatus, string> = {
  pending: "Pending",
  under_review: "Under Review",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
};

const statusClass: Record<ApprovalStatus, string> = {
  pending: "bg-amber-100 text-amber-800 ring-amber-200",
  under_review: "bg-[#F3F4F6] text-[#4B5563] ring-slate-700",
  approved: "bg-[#DCFCE7] text-[#166534] ring-[#15803D]/25",
  rejected: "bg-[#FEE2E2] text-[#991B1B] ring-[#DC2626]/20",
  suspended: "bg-[#E5E7EB] text-[#111827] ring-[#9CA3AF]/30",
};

function initials(name: string, email: string) {
  const source = name.trim() || email;
  return source
    .split(/[ @.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value)
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-[#111827]">{value}</p>
    </div>
  );
}

function isFinalStatus(status: ApprovalStatus) {
  return status === "approved" || status === "rejected";
}

export default function VerificationPage() {
  const { user: currentUser } = useAuth();
  const addLog = useAuditLogStore((state) => state.addLog);
  const addNotification = useNotificationStore((state) => state.addNotification);
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserListItem | null>(null);
  const [filter, setFilter] = useState<ApprovalStatus | "all">("pending");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      setIsLoading(true);
      setError("");
      try {
        const rows = await listApplicants(filter === "all" ? undefined : filter);
        if (!cancelled) setUsers(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load users");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, [filter]);

  const requestCount = useMemo(() => users.length, [users.length]);

  useEffect(() => {
    users
      .filter((user) => user.approval_status === "pending")
      .forEach((user) => {
        addNotification({
          type: "new_registration",
          targetRole: "admin",
          title: "New Registration",
          message: `New registration pending approval: ${user.full_name || user.email}`,
          redirectTo: "/admin/verification",
          entityType: "user",
          entityId: String(user.user_id),
        });
      });
  }, [addNotification, users]);

  const refreshUsers = async () => {
    const rows = await listApplicants(filter === "all" ? undefined : filter);
    setUsers(rows);
    if (selectedUser && !rows.some((user) => user.user_id === selectedUser.user_id)) {
      setSelectedUser(null);
    }
  };

  const changeStatus = async (userId: number, approvalStatus: ApprovalStatus) => {
    const targetUser =
      selectedUser?.user_id === userId
        ? selectedUser
        : users.find((user) => user.user_id === userId);

    if (targetUser && isFinalStatus(targetUser.approval_status)) {
      toast.error("Approved or rejected applications are view-only.");
      return;
    }

    setUpdatingId(userId);
    setError("");
    const toastId = toast.loading("Processing approval update...");
    try {
      const updated = await updateApplicantApproval(userId, approvalStatus);
      setSelectedUser((current) => (current?.user_id === userId ? updated : current));
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
      await refreshUsers();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update user";
      setError(message);
      toast.error(message, { id: toastId });
    } finally {
      setUpdatingId(null);
    }
  };

  const employerIdImage = selectedUser?.profile_picture_path
    ? selectedUser.profile_picture_path.startsWith("/uploads")
      ? `${API_ORIGIN}${selectedUser.profile_picture_path}`
      : selectedUser.profile_picture_path.startsWith("data:")
        ? selectedUser.profile_picture_path
        : ""
    : "";

  return (
    <MainLayout>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#1D4ED8]">Application Review</p>
          <h1 className="text-2xl font-semibold text-[#111827]">User Verification</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as ApprovalStatus | "all")}
            className="h-10 rounded-md border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <span className="rounded-full bg-[#1D4ED8] px-3 py-1 text-xs font-semibold text-white">
            {requestCount}
          </span>
        </div>
      </div>

      <section className="rounded-lg border border-[#E5E7EB] bg-white shadow-sm shadow-gray-200/60">
        <div className="border-b border-[#E5E7EB] bg-white px-5 py-4">
          <h2 className="text-base font-semibold text-[#111827]">Account Requests</h2>
        </div>

        {error && (
          <div className="mx-5 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-[#F3F4F6] text-xs uppercase tracking-wide text-[#4B5563]">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Applicant</th>
                <th className="px-5 py-3 text-left font-semibold">Role</th>
                <th className="px-5 py-3 text-left font-semibold">Date Requested</th>
                <th className="px-5 py-3 text-left font-semibold">Status</th>
                <th className="px-5 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-[#4B5563]">
                    Loading applications...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-[#4B5563]">
                    No applications found.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.user_id} className="bg-white transition duration-200 hover:bg-[#F3F4F6]">
                    <td className="px-5 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1D4ED8] text-sm font-semibold text-white">
                          {initials(user.full_name, user.email)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[#111827]">
                            {user.full_name || "Name not provided"}
                          </p>
                          <p className="mt-1 truncate text-[#4B5563]">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 capitalize text-[#111827]">{user.role}</td>
                    <td className="px-5 py-4 text-[#111827]">{formatDate(user.created_at)}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusClass[user.approval_status]}`}>
                        {statusLabel[user.approval_status]}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedUser(user)}
                          className="rounded-md border border-[#1D4ED8] bg-white px-3 py-1.5 text-xs font-semibold text-[#1D4ED8] transition hover:bg-[#1D4ED8] hover:text-white"
                        >
                          {isFinalStatus(user.approval_status) ? "View Details" : "View"}
                        </button>
                        {!isFinalStatus(user.approval_status) && (
                          <>
                            <button
                              type="button"
                              onClick={() => changeStatus(user.user_id, "approved")}
                              disabled={updatingId === user.user_id}
                              className="rounded-md bg-[#15803D] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#166534] disabled:opacity-60"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => changeStatus(user.user_id, "rejected")}
                              disabled={updatingId === user.user_id}
                              className="rounded-md border border-[#DC2626] bg-white px-3 py-1.5 text-xs font-semibold text-[#B91C1C] transition hover:bg-[#DC2626] hover:text-white disabled:opacity-60"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-5xl animate-[modalIn_200ms_ease-out] overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-2xl shadow-gray-200/70">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#E5E7EB] bg-white/95 px-6 py-4 backdrop-blur">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#1D4ED8]">
                  Account Request
                </p>
                <h2 className="mt-1 text-lg font-semibold text-[#111827]">
                  {selectedUser.full_name || "Name not provided"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E5E7EB] bg-white text-sm font-semibold text-[#4B5563] transition duration-200 hover:bg-[#F3F4F6] hover:text-[#111827]"
                aria-label="Close verification details"
              >
                x
              </button>
            </div>

            <div className="max-h-[calc(92vh-74px)] overflow-y-auto bg-white">
              <div className="grid gap-6 p-6 lg:grid-cols-[1fr_340px]">
                <div className="space-y-5">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusClass[selectedUser.approval_status]}`}>
                    {statusLabel[selectedUser.approval_status]}
                  </span>

                  <section className="rounded-xl border border-[#E5E7EB] p-4">
                    <h3 className="text-sm font-semibold text-[#111827]">Personal Information</h3>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Field label="Full Name" value={selectedUser.full_name || "Not provided"} />
                      <Field label="Email" value={selectedUser.email} />
                    </div>
                  </section>

                  <section className="rounded-xl border border-[#E5E7EB] p-4">
                    <h3 className="text-sm font-semibold text-[#111827]">Account Information</h3>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Field label="Role" value={selectedUser.role} />
                      <Field label="Submitted Date" value={formatDate(selectedUser.created_at)} />
                      <Field label="Verification Status" value={statusLabel[selectedUser.approval_status]} />
                      <Field label="Last Login" value={formatDate(selectedUser.last_login_at)} />
                    </div>
                  </section>
                </div>

                <aside className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                  <h3 className="text-sm font-semibold text-[#111827]">Employer ID</h3>
                  <div className="mt-4 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
                    {employerIdImage ? (
                      <button
                        type="button"
                        onClick={() => setPreviewImage(employerIdImage)}
                        className="block w-full"
                        aria-label="Preview employer ID"
                      >
                        <img
                          src={employerIdImage}
                          alt="Employer ID"
                          className="h-64 w-full object-contain"
                        />
                      </button>
                    ) : (
                      <div className="flex h-64 items-center justify-center px-4 text-center text-sm text-[#4B5563]">
                        Employer ID image is not available for preview.
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => employerIdImage && setPreviewImage(employerIdImage)}
                    disabled={!employerIdImage}
                    className="mt-4 w-full rounded-md bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1E40AF] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Preview ID
                  </button>
                </aside>
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-[#E5E7EB] bg-[#F3F4F6] px-6 py-4">
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-[#4B5563] transition duration-200 hover:bg-[#F3F4F6]"
                >
                  Close
                </button>
                {!isFinalStatus(selectedUser.approval_status) && (
                  <>
                    <button
                      type="button"
                      onClick={() => changeStatus(selectedUser.user_id, "approved")}
                      disabled={updatingId === selectedUser.user_id}
                      className="rounded-md bg-[#15803D] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#166534] disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => changeStatus(selectedUser.user_id, "rejected")}
                      disabled={updatingId === selectedUser.user_id}
                      className="rounded-md border border-[#DC2626] bg-white px-4 py-2 text-sm font-semibold text-[#B91C1C] transition hover:bg-[#DC2626] hover:text-white disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <ImagePreviewModal
        image={previewImage}
        alt="Employer ID enlarged preview"
        title="Employer ID Preview"
        onClose={() => setPreviewImage(null)}
      />
    </MainLayout>
  );
}
