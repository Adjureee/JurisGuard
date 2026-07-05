import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useAuth } from "../../contexts/AuthContext";
import { useAuditLogStore } from "../../features/auditLogs/auditLogStore";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import MainLayout from "../../layouts/MainLayout";
import PageHeader from "../../components/PageHeader";
import ImagePreviewModal from "../../components/ImagePreviewModal";
import ModalPortal from "../../components/modals/ModalPortal";
import { API_ORIGIN } from "../../api/client";
import {
  listApplicants,
  updateApplicantApproval,
} from "../../services/adminService";
import type { AdminUserListItem, ApprovalStatus } from "../../types/auth";

const statusLabel: Record<ApprovalStatus, string> = {
  pending: "Pending",
  under_review: "Under Review",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
};

const statusClass: Record<ApprovalStatus, string> = {
  pending: "bg-amber-50 dark:bg-amber-400/10 text-amber-800 dark:text-amber-300 ring-amber-100",
  under_review: "bg-card-2 text-muted ring-slate-300",
  approved: "bg-green-100 dark:bg-green-400/15 text-green-700 dark:text-green-300 ring-green-700/25",
  rejected: "bg-red-100 dark:bg-red-400/15 text-red-800 dark:text-red-300 ring-red-600/20",
  suspended: "bg-line text-ink ring-gray-400/30",
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

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

function isFinalStatus(status: ApprovalStatus) {
  return status === "approved" || status === "rejected";
}

function resolveEmployeeIdEvidence(user: AdminUserListItem | null) {
  const raw =
    user?.employee_id_path || user?.profile_picture_path || "";

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

export default function VerificationPage() {
  const { user: currentUser } = useAuth();
  const addLog = useAuditLogStore((state) => state.addLog);
  const addNotification = useNotificationStore(
    (state) => state.addNotification,
  );
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserListItem | null>(
    null,
  );
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
        const rows = await listApplicants(
          filter === "all" ? undefined : filter,
        );
        if (!cancelled) setUsers(rows);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Unable to load users");
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
    if (
      selectedUser &&
      !rows.some((user) => user.user_id === selectedUser.user_id)
    ) {
      setSelectedUser(null);
    }
  };

  const changeStatus = async (
    userId: number,
    approvalStatus: ApprovalStatus,
  ) => {
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
      setSelectedUser((current) =>
        current?.user_id === userId ? updated : current,
      );
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
      const message =
        err instanceof Error ? err.message : "Unable to update user";
      setError(message);
      toast.error(message, { id: toastId });
    } finally {
      setUpdatingId(null);
    }
  };

  const employeeIdEvidence = resolveEmployeeIdEvidence(selectedUser);

  return (
    <MainLayout>
      <PageHeader
        eyebrow="Application Review"
        title="User Verification"
        description="Review registration requests, validate uploaded identification, and manage account approval decisions."
        actions={
          <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value as ApprovalStatus | "all")
            }
            className="h-10 rounded-lg border border-line2 bg-card px-3 text-sm text-ink outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="under_review">Under Review</option>
            <option value="suspended">Suspended</option>
          </select>
          <span className="rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">
            {requestCount}
          </span>
          </div>
        }
      />

      <section className="rounded-xl border border-line bg-card shadow-sm">
        <div className="border-b border-line bg-card px-5 py-4">
          <h2 className="text-base font-semibold text-ink">
            Account Requests
          </h2>
        </div>

        {error && (
          <div className="mx-5 mt-4 rounded-lg border border-red-200 dark:border-red-400/25 bg-red-50 dark:bg-red-400/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="grid gap-3 p-4 md:hidden">
          {isLoading ? (
            <div className="rounded-lg border border-line bg-card-2 px-4 py-8 text-center text-sm text-muted">
              Loading applications...
            </div>
          ) : users.length === 0 ? (
            <div className="rounded-lg border border-line bg-card-2 px-4 py-8 text-center text-sm text-muted">
              No applications found.
            </div>
          ) : (
            users.map((user) => (
              <article
                key={user.user_id}
                className="rounded-lg border border-line bg-card p-4 shadow-sm shadow-gray-900/5"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-card">
                    {initials(user.full_name, user.email)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold text-ink">
                      {user.full_name || "Name not provided"}
                    </p>
                    <p className="mt-1 break-all text-sm text-muted">
                      {user.email}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Field label="Role" value={user.role} />
                  <Field
                    label="Requested"
                    value={formatDate(user.created_at)}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusClass[user.approval_status]}`}
                  >
                    {statusLabel[user.approval_status]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedUser(user)}
                    className="rounded-lg border border-ink bg-card px-3 py-2 text-xs font-semibold text-ink transition hover:bg-ink hover:text-card"
                  >
                    View
                  </button>
                </div>

                {!isFinalStatus(user.approval_status) && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => changeStatus(user.user_id, "approved")}
                      disabled={updatingId === user.user_id}
                      className="min-h-10 rounded-lg bg-green-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => changeStatus(user.user_id, "rejected")}
                      disabled={updatingId === user.user_id}
                      className="min-h-10 rounded-lg border border-red-600 bg-card px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-300 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-10 border-b border-line bg-card-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Applicant</th>
                <th className="px-5 py-3 text-left font-semibold">Role</th>
                <th className="px-5 py-3 text-left font-semibold">
                  Date Requested
                </th>
                <th className="px-5 py-3 text-left font-semibold">Status</th>
                <th className="px-5 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-10 text-center text-muted"
                  >
                    Loading applications...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-10 text-center text-muted"
                  >
                    No applications found.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr
                    key={user.user_id}
                    className="odd:bg-card even:bg-card-2 transition duration-200 hover:bg-card-2"
                  >
                    <td className="px-5 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                          {initials(user.full_name, user.email)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">
                            {user.full_name || "Name not provided"}
                          </p>
                          <p className="mt-1 truncate text-muted">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 capitalize text-ink">
                      {user.role}
                    </td>
                    <td className="px-5 py-4 text-ink">
                      {formatDate(user.created_at)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusClass[user.approval_status]}`}
                      >
                        {statusLabel[user.approval_status]}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedUser(user)}
                          className="rounded-lg border border-brand-600 bg-card px-3 py-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 transition hover:bg-brand-50 dark:hover:bg-brand-400/10 hover:text-brand-700 dark:hover:text-brand-300"
                        >
                          {isFinalStatus(user.approval_status)
                            ? "View Details"
                            : "View"}
                        </button>
                        {!isFinalStatus(user.approval_status) && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                changeStatus(user.user_id, "approved")
                              }
                              disabled={updatingId === user.user_id}
                              className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                changeStatus(user.user_id, "rejected")
                              }
                              disabled={updatingId === user.user_id}
                              className="rounded-lg border border-red-600 bg-card px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
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
        <ModalPortal>
        <div className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="jurisguard-modal-surface max-h-[92vh] w-full max-w-5xl animate-[modalIn_200ms_ease-out] overflow-hidden rounded-2xl border border-line bg-card shadow-xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-card-2 px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                  Account Request
                </p>
                <h2 className="mt-1 text-lg font-semibold text-ink">
                  {selectedUser.full_name || "Name not provided"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-sm font-semibold text-muted transition duration-200 hover:bg-card-2 hover:text-ink"
                aria-label="Close verification details"
              >
                x
              </button>
            </div>

            <div className="max-h-[calc(92vh-74px)] overflow-y-auto bg-card">
              <div className="grid gap-6 p-6 lg:grid-cols-[1fr_340px]">
                <div className="max-h-[calc(100vh-11rem)] space-y-5 overflow-y-auto">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusClass[selectedUser.approval_status]}`}
                  >
                    {statusLabel[selectedUser.approval_status]}
                  </span>

                  <section className="rounded-xl border border-line p-4">
                    <h3 className="text-sm font-semibold text-ink">
                      Personal Information
                    </h3>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Full Name"
                        value={selectedUser.full_name || "Not provided"}
                      />
                      <Field label="Email" value={selectedUser.email} />
                    </div>
                  </section>

                  <section className="rounded-xl border border-line p-4">
                    <h3 className="text-sm font-semibold text-ink">
                      Account Information
                    </h3>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Field label="Role" value={selectedUser.role} />
                      <Field
                        label="Submitted Date"
                        value={formatDate(selectedUser.created_at)}
                      />
                      <Field
                        label="Verification Status"
                        value={statusLabel[selectedUser.approval_status]}
                      />
                      <Field
                        label="Last Login"
                        value={formatDate(selectedUser.last_login_at)}
                      />
                    </div>
                  </section>
                </div>

                <aside className="rounded-xl border border-line bg-card-2 p-4">
                  <h3 className="text-sm font-semibold text-ink">
                    Employee ID
                  </h3>
                  <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">
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
                          className="h-64 w-full object-contain"
                        />
                      </button>
                    ) : employeeIdEvidence.reference ? (
                      <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted">
                        <span className="font-semibold text-ink">
                          Employee ID was submitted
                        </span>
                        <span className="break-all text-xs">
                          This record contains only a local upload reference, not
                          a previewable image. Ask the applicant to resubmit the
                          ID image if visual review is required.
                        </span>
                      </div>
                    ) : (
                      <div className="flex h-64 items-center justify-center px-4 text-center text-sm text-muted">
                        Employee ID image is not available for preview.
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
                    className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Preview ID
                  </button>
                </aside>
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-card-2 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-muted transition duration-200 hover:bg-card-2"
                >
                  Close
                </button>
                {!isFinalStatus(selectedUser.approval_status) && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        changeStatus(selectedUser.user_id, "approved")
                      }
                      disabled={updatingId === selectedUser.user_id}
                      className="min-h-10 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        changeStatus(selectedUser.user_id, "rejected")
                      }
                      disabled={updatingId === selectedUser.user_id}
                      className="min-h-10 rounded-lg border border-red-600 bg-card px-4 py-2 text-sm font-semibold text-red-700 dark:text-red-300 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        </ModalPortal>
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
