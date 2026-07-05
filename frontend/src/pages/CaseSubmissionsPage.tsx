import { useEffect, useMemo, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import MainLayout from "../layouts/MainLayout";
import PageHeader from "../components/PageHeader";
import ModalPortal from "../components/modals/ModalPortal";
import { useAuth } from "../contexts/AuthContext";
import { useAuditLogStore } from "../features/auditLogs/auditLogStore";
import { useNotificationStore } from "../features/notifications/notificationStore";
import { resolveProfileImageUrl } from "../services/authService";
import { createAuditLog } from "../services/auditService";
import {
  approveCaseSubmission,
  createCaseSubmission,
  getCaseSubmission,
  getCaseSubmissionHistory,
  listCaseSubmissions,
  previewCaseSubmission,
  requestCaseSubmissionCorrection,
  resubmitCaseSubmission,
  startCaseSubmissionReview,
  submitCaseSubmission,
  updateCaseSubmission,
  type CaseSubmission,
  type SubmissionSnapshot,
} from "../services/caseSubmissionService";
import {
  buildCriminalCasesCsv,
  buildCriminalCasesExcelHtml,
  downloadCsv,
  type CriminalCaseRow,
} from "../services/exportService";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    date,
  );
}

function initials(name: string) {
  return name
    .split(/[ @.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function statusClass(status: string) {
  const normalizedStatus = normalizeStatus(status);
  if (normalizedStatus === "Approved") return "bg-emerald-50 dark:bg-emerald-400/10 text-emerald-800 dark:text-emerald-300";
  if (normalizedStatus === "Correction Required")
    return "bg-amber-50 dark:bg-amber-400/10 text-amber-800 dark:text-amber-300";
  if (
    normalizedStatus === "Submitted" ||
    normalizedStatus === "Under Review" ||
    normalizedStatus === "Resubmitted"
  )
    return "bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400";
  return "bg-card-2 text-muted";
}

function normalizeStatus(status: string) {
  return status === "Correction Requested" ? "Correction Required" : status;
}

function reviewRoundFor(
  submission: CaseSubmission,
  versions: CaseSubmission[],
) {
  return versions.filter(
    (item) =>
      item.version <= submission.version &&
      normalizeStatus(item.status) === "Correction Required",
  ).length;
}

function snapshotRows(items: SubmissionSnapshot[]): CriminalCaseRow[] {
  return items.map((item) => ({
    record: item.record,
    client: item.client ?? undefined,
    clientName: item.client_name,
  }));
}

function avatarSrc(path?: string | null) {
  return resolveProfileImageUrl(path);
}

type ReportModalMode = "create" | "edit-draft" | "revise";

export default function CaseSubmissionsPage() {
  const { user } = useAuth();
  const addLog = useAuditLogStore((state) => state.addLog);
  const addNotification = useNotificationStore(
    (state) => state.addNotification,
  );
  const [submissions, setSubmissions] = useState<CaseSubmission[]>([]);
  const [selected, setSelected] = useState<CaseSubmission | null>(null);
  const [history, setHistory] = useState<CaseSubmission[]>([]);
  const [feedbackText, setFeedbackText] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingSubmissions, setLoadingSubmissions] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportModalMode, setReportModalMode] =
    useState<ReportModalMode>("create");
  const [editingSubmission, setEditingSubmission] =
    useState<CaseSubmission | null>(null);
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState(today());
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<SubmissionSnapshot[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const isAdmin = user?.role === "admin";
  const selectedStatus = selected ? normalizeStatus(selected.status) : "";
  const orderedHistory = useMemo(
    () => [...history].sort((left, right) => left.version - right.version),
    [history],
  );
  const latestVersion = orderedHistory.reduce(
    (latest, item) => Math.max(latest, item.version),
    selected?.version ?? 0,
  );
  const selectedIsLatest = selected
    ? selected.version === latestVersion
    : false;
  const selectedReviewRound = selected
    ? reviewRoundFor(selected, orderedHistory)
    : 0;
  const filteredSubmissions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return submissions.filter((submission) => {
      const status = normalizeStatus(submission.status);
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (!normalizedSearch) return true;

      const haystack = [
        submission.title,
        submission.staff_name,
        submission.staff_role,
        status,
        submission.date_from,
        submission.date_to,
        submission.submitted_at,
        submission.updated_at,
        submission.notes,
        `${submission.case_count} cases`,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [search, statusFilter, submissions]);
  const statusOptions = useMemo(
    () =>
      Array.from(
        new Set(
          submissions.map((submission) => normalizeStatus(submission.status)),
        ),
      ).sort(),
    [submissions],
  );

  const loadSubmissions = async () => {
    setLoadingSubmissions(true);
    setLoadError("");
    try {
      const rows = await listCaseSubmissions();
      setSubmissions(Array.isArray(rows) ? rows : []);
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      const message =
        status === 401
          ? "Your session expired. Please sign in again."
          : error instanceof Error
            ? error.message
            : "Unable to load submissions";
      setLoadError(message);
      setSubmissions([]);
      if (status === 401) return;
      throw error;
    } finally {
      setLoadingSubmissions(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSubmissions().catch((error) => {
        toast.error(
          error instanceof Error ? error.message : "Unable to load submissions",
        );
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const openSubmission = async (submission: CaseSubmission) => {
    const status = normalizeStatus(submission.status);
    const reviewed =
      isAdmin && (status === "Submitted" || status === "Resubmitted")
        ? await startCaseSubmissionReview(submission.submission_id)
        : submission;
    const [details, historyRows] = await Promise.all([
      getCaseSubmission(reviewed.submission_id),
      getCaseSubmissionHistory(reviewed.submission_id),
    ]);
    setSelected(details);
    setHistory(historyRows);
    if (reviewed.status !== submission.status) await loadSubmissions();
  };

  const openCreateModal = () => {
    setReportModalMode("create");
    setEditingSubmission(null);
    setTitle("");
    setNotes("");
    setDateFrom(monthStart());
    setDateTo(today());
    setPreview([]);
    setReportModalOpen(true);
  };

  const openEditModal = async (
    submission: CaseSubmission,
    mode: ReportModalMode,
  ) => {
    const details = await getCaseSubmission(submission.submission_id);
    setReportModalMode(mode);
    setEditingSubmission(details);
    setTitle(details.title);
    setNotes(details.notes);
    setDateFrom(details.date_from);
    setDateTo(details.date_to);
    setPreview(details.items.map((item) => item.snapshot));
    setReportModalOpen(true);
  };

  const runPreview = async () => {
    setLoading(true);
    try {
      const result = await previewCaseSubmission({
        date_from: dateFrom,
        date_to: dateTo,
      });
      setPreview(result.items);
      if (!title) {
        const label = new Date(`${dateFrom}T00:00:00`).toLocaleDateString(
          undefined,
          { month: "long", year: "numeric" },
        );
        setTitle(`${label} Intake Submission`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to preview submission",
      );
    } finally {
      setLoading(false);
    }
  };

  const saveReportModal = async () => {
    setLoading(true);
    try {
      const payload = { title, date_from: dateFrom, date_to: dateTo, notes };
      if (reportModalMode === "create") {
        const draft = await createCaseSubmission(payload);
        toast.success("Report draft created");
        await loadSubmissions();
        setReportModalOpen(false);
        await openSubmission(draft);
      } else if (reportModalMode === "edit-draft" && editingSubmission) {
        const draft = await updateCaseSubmission(
          editingSubmission.submission_id,
          payload,
        );
        toast.success("Draft updated");
        await loadSubmissions();
        setReportModalOpen(false);
        await openSubmission(draft);
      } else if (reportModalMode === "revise" && editingSubmission) {
        const updated = await resubmitCaseSubmission(
          editingSubmission.submission_id,
          payload,
        );
        toast.success("Report resubmitted");
        addNotification({
          type: "workflow",
          targetRole: "admin",
          title: "Report Resubmitted",
          message: `${updated.staff_name} resubmitted ${updated.title} version ${updated.version}`,
          redirectTo: "/case-review-center",
          entityType: "case_submission",
          entityId: updated.submission_id,
        });
        await loadSubmissions();
        setReportModalOpen(false);
        await openSubmission(updated);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save report",
      );
    } finally {
      setLoading(false);
    }
  };

  const submitDraft = async (submission: CaseSubmission) => {
    const updated = await submitCaseSubmission(submission.submission_id);
    toast.success("Report submitted to admin");
    addNotification({
      type: "workflow",
      targetRole: "admin",
      title: "Draft Submitted",
      message: `${updated.staff_name} submitted ${updated.title}`,
      redirectTo: "/case-review-center",
      entityType: "case_submission",
      entityId: updated.submission_id,
    });
    await loadSubmissions();
    await openSubmission(updated);
  };

  const requestCorrection = async () => {
    if (!selected || !feedbackText.trim()) return;
    const updated = await requestCaseSubmissionCorrection(
      selected.submission_id,
      feedbackText.trim(),
    );
    toast.success("Correction request sent");
    addNotification({
      type: "workflow",
      userId: updated.staff_id,
      title: "Correction Requested",
      message: `${updated.title} version ${updated.version} requires correction: ${feedbackText.trim()}`,
      redirectTo: "/case-submissions",
      entityType: "case_submission",
      entityId: updated.submission_id,
    });
    setFeedbackText("");
    await loadSubmissions();
    await openSubmission(updated);
  };

  const approveSubmission = async () => {
    if (!selected) return;
    const updated = await approveCaseSubmission(selected.submission_id);
    toast.success("Report approved");
    addNotification({
      type: "workflow",
      userId: updated.staff_id,
      title: "Report Approved",
      message: `${updated.title} version ${updated.version} has been approved.`,
      redirectTo: "/case-submissions",
      entityType: "case_submission",
      entityId: updated.submission_id,
    });
    await loadSubmissions();
    await openSubmission(updated);
  };

  const exportSubmission = async (type: "csv" | "excel") => {
    if (!selected || selected.status === "Draft") return;
    const rows = snapshotRows(selected.items.map((item) => item.snapshot));
    const filters = {
      status: "All" as const,
      date_from: "",
      date_to: "",
      location_type: "All" as const,
      barangay: "All",
      case_category: "All",
      staff: "All",
      ocr_status: "All",
      termination_status: "All",
    };
    const stamp = new Date().toISOString().slice(0, 10);
    if (type === "csv") {
      downloadCsv(
        `report-submission-${selected.submission_id}_${stamp}.csv`,
        buildCriminalCasesCsv(rows, filters),
      );
    } else {
      downloadText(
        `report-submission-${selected.submission_id}_${stamp}.xls`,
        buildCriminalCasesExcelHtml(rows, filters),
        "application/vnd.ms-excel;charset=utf-8",
      );
    }
    await createAuditLog({
      action: type === "csv" ? "Export CSV" : "Export Excel",
      module: "Export",
      description: `${user?.full_name || user?.email} exported report submission ${selected.title} version ${selected.version}`,
      entity_type: "case_submission",
      entity_id: selected.submission_id,
    });
    addLog({
      userId: user?.user_id,
      user: user?.full_name || user?.email,
      action: "Version Exported",
      module: "Export",
      description: `Exported ${selected.title} version ${selected.version} as ${type.toUpperCase()}`,
      entityType: "case_submission",
      entityId: selected.submission_id,
    });
    toast.success(`${type.toUpperCase()} exported`);
  };

  return (
    <MainLayout>
      <PageHeader
        eyebrow={isAdmin ? "Case Review Center" : "Case Submissions"}
        title={isAdmin ? "Supervisory Report Review" : "Report Management"}
        description="Internal PAO report review workflow with snapshots, correction tracking, version history, and approved export packages."
        actions={
          !isAdmin ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Create Report
            </button>
          ) : null
        }
      />

      <section className="overflow-hidden rounded-xl border border-line bg-card shadow-card">
        <div className="grid gap-3 border-b border-line bg-card px-5 py-4 md:grid-cols-[1fr_220px_auto] md:items-end">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Search
            </span>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                isAdmin
                  ? "Search staff, report, status..."
                  : "Search report, period, status..."
              }
              className="mt-1 h-10 w-full rounded-lg border border-line2 bg-card px-3 text-sm text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Status
            </span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-line2 bg-card px-3 text-sm text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
            >
              <option value="all">All Statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-lg border border-line bg-card-2 px-4 py-2 text-sm font-semibold text-muted">
            {filteredSubmissions.length} result
            {filteredSubmissions.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="overflow-x-auto">
          {isAdmin ? (
            <AdminSubmissionTable
              error={loadError}
              loading={loadingSubmissions}
              submissions={filteredSubmissions}
              onOpen={(submission) => void openSubmission(submission)}
              onRetry={() => void loadSubmissions().catch(() => undefined)}
            />
          ) : (
            <StaffSubmissionTable
              error={loadError}
              loading={loadingSubmissions}
              submissions={filteredSubmissions}
              onOpen={(submission) => void openSubmission(submission)}
              onEdit={(submission) =>
                void openEditModal(submission, "edit-draft")
              }
              onRevise={(submission) =>
                void openEditModal(submission, "revise")
              }
              onSubmit={(submission) => void submitDraft(submission)}
              onRetry={() => void loadSubmissions().catch(() => undefined)}
            />
          )}
        </div>
      </section>

      {reportModalOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
            <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
              <div className="flex items-start justify-between gap-4 border-b border-line bg-card px-5 py-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400">
                    {reportModalMode === "revise"
                      ? "Correction Workflow"
                      : "Report Snapshot"}
                  </p>
                  <h2 className="mt-1 text-lg font-bold tracking-tight text-ink">
                    {reportModalMode === "create"
                      ? "Create Report"
                      : reportModalMode === "revise"
                        ? "Revise Report"
                        : "Edit Draft"}
                  </h2>
                  <p className="mt-1 text-sm leading-5 text-muted">
                    Select a coverage period, preview included cases, then save
                    the report draft.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReportModalOpen(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-card text-lg font-semibold leading-none text-muted transition hover:bg-card-2 hover:text-ink"
                  aria-label="Close report dialog"
                >
                  x
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto bg-card-2/60 px-5 py-5">
                {reportModalMode === "revise" &&
                editingSubmission?.feedback.length ? (
                  <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-400/25 bg-amber-50 dark:bg-amber-400/10 p-4">
                    <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                      Admin Correction Notes - Version{" "}
                      {editingSubmission.version}
                    </p>
                    <div className="mt-2 space-y-2">
                      {editingSubmission.feedback.map((item) => (
                        <p
                          key={item.feedback_id}
                          className="text-sm text-ink"
                        >
                          {item.comments}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="rounded-xl border border-line bg-card p-4 shadow-sm">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_170px_170px]">
                    <label>
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Submission Title
                      </span>
                      <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="May 2026 Intake Report"
                        className="mt-1.5 h-10 w-full rounded-lg border border-line2 bg-card px-3 text-sm text-ink outline-none transition focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                      />
                    </label>
                    <label>
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Start Date
                      </span>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(event) => setDateFrom(event.target.value)}
                        className="mt-1.5 h-10 w-full rounded-lg border border-line2 bg-card px-3 text-sm text-ink outline-none transition focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                      />
                    </label>
                    <label>
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                        End Date
                      </span>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(event) => setDateTo(event.target.value)}
                        className="mt-1.5 h-10 w-full rounded-lg border border-line2 bg-card px-3 text-sm text-ink outline-none transition focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                      />
                    </label>
                  </div>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Summary notes"
                    className="mt-4 min-h-20 w-full resize-y rounded-lg border border-line2 bg-card px-3 py-2 text-sm text-ink outline-none transition placeholder:text-faint focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                  />
                </div>

                <div className="mt-4 rounded-xl border border-line bg-card shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        Case Snapshot Preview
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {preview.length} case{preview.length === 1 ? "" : "s"}{" "}
                        included in this coverage period.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={runPreview}
                      disabled={loading}
                      className="rounded-lg border border-line2 bg-card px-4 py-2 text-sm font-semibold text-ink transition hover:bg-card-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loading ? "Loading Preview..." : "Regenerate Preview"}
                    </button>
                  </div>
                  <SnapshotTable items={preview} compact />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-card px-5 py-4">
                <p className="text-xs font-medium text-muted">
                  Drafts stay editable until submitted for review.
                </p>
                <button
                  type="button"
                  onClick={saveReportModal}
                  disabled={loading || !title}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {reportModalMode === "revise"
                    ? "Resubmit Report"
                    : "Save Draft"}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {selected && (
        <ModalPortal>
          <div
            className="jurisguard-modal-overlay bg-black/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
          >
            <div className="jurisguard-modal-surface flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-xl">
              <ReportHeader submission={selected} />
              <div className="min-h-0 flex-1 overflow-y-auto p-6">
                {selected.notes && (
                  <div className="mb-5 rounded-xl border border-line bg-card-2 p-4 text-sm text-muted">
                    {selected.notes}
                  </div>
                )}
                <VersionSelector
                  selected={selected}
                  versions={orderedHistory}
                  onOpen={(submission) => void openSubmission(submission)}
                />
                <VersionDetailPanel
                  submission={selected}
                  reviewRound={selectedReviewRound}
                  isLatest={selectedIsLatest}
                />
                <SnapshotTable
                  items={selected.items.map((item) => item.snapshot)}
                />
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <section className="rounded-xl border border-line bg-card p-4">
                    <h3 className="font-bold text-ink">
                      Version History
                    </h3>
                    <VersionHistoryTable
                      selected={selected}
                      versions={orderedHistory}
                      onOpen={(submission) => void openSubmission(submission)}
                    />
                  </section>
                  <section className="rounded-xl border border-line bg-card p-4">
                    <h3 className="font-bold text-ink">
                      Correction Notes
                    </h3>
                    <div className="mt-3 space-y-3">
                      {selected.feedback.length === 0 ? (
                        <p className="text-sm text-muted">
                          No correction notes yet.
                        </p>
                      ) : (
                        selected.feedback.map((item) => (
                          <div
                            key={item.feedback_id}
                            className="rounded-lg bg-card-2 p-3 text-sm"
                          >
                            <p className="font-semibold text-ink">
                              {item.reviewer_name}
                            </p>
                            <p className="mt-1 text-muted">
                              {item.comments}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                    {isAdmin &&
                      selectedIsLatest &&
                      selectedStatus !== "Approved" &&
                      selectedStatus !== "Draft" && (
                        <textarea
                          value={feedbackText}
                          onChange={(event) =>
                            setFeedbackText(event.target.value)
                          }
                          placeholder="Correction notes"
                          className="mt-4 min-h-24 w-full rounded-lg border border-line2 px-3 py-2 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
                        />
                      )}
                    {isAdmin && !selectedIsLatest && (
                      <p className="mt-4 rounded-lg bg-card-2 p-3 text-sm text-muted">
                        Historical versions are read-only for review actions.
                        Export remains available.
                      </p>
                    )}
                  </section>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-card-2 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded-lg border border-line2 bg-card px-4 py-2 text-sm font-semibold text-ink hover:bg-card-2"
                >
                  Close
                </button>
                {!isAdmin && selectedIsLatest && selectedStatus === "Draft" && (
                  <button
                    type="button"
                    onClick={() => void openEditModal(selected, "edit-draft")}
                    className="rounded-lg border border-brand-600 bg-card px-4 py-2 text-sm font-semibold text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-400/10"
                  >
                    Edit Draft
                  </button>
                )}
                {!isAdmin && selectedIsLatest && selectedStatus === "Draft" && (
                  <button
                    type="button"
                    onClick={() => void submitDraft(selected)}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    Submit Report
                  </button>
                )}
                {!isAdmin &&
                  selectedIsLatest &&
                  selectedStatus === "Correction Required" && (
                    <button
                      type="button"
                      onClick={() => void openEditModal(selected, "revise")}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                    >
                      Revise Report
                    </button>
                  )}
                {isAdmin &&
                  selectedIsLatest &&
                  selectedStatus !== "Approved" &&
                  selectedStatus !== "Draft" && (
                    <button
                      type="button"
                      onClick={() => void requestCorrection()}
                      className="rounded-lg border border-amber-500 bg-card px-4 py-2 text-sm font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-400/10"
                    >
                      Request Correction
                    </button>
                  )}
                {isAdmin &&
                  selectedIsLatest &&
                  selectedStatus !== "Approved" &&
                  selectedStatus !== "Draft" && (
                    <button
                      type="button"
                      onClick={() => void approveSubmission()}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                    >
                      Approve Report
                    </button>
                  )}
                {isAdmin && selectedStatus !== "Draft" && (
                  <button
                    type="button"
                    onClick={() => void exportSubmission("csv")}
                    className="rounded-lg border border-brand-600 bg-card px-4 py-2 text-sm font-semibold text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-400/10"
                  >
                    Export CSV
                  </button>
                )}
                {isAdmin && selectedStatus !== "Draft" && (
                  <button
                    type="button"
                    onClick={() => void exportSubmission("excel")}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    Export Excel
                  </button>
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </MainLayout>
  );
}

function StaffSubmissionTable({
  error,
  loading,
  submissions,
  onOpen,
  onEdit,
  onRevise,
  onSubmit,
  onRetry,
}: {
  error: string;
  loading: boolean;
  submissions: CaseSubmission[];
  onOpen: (submission: CaseSubmission) => void;
  onEdit: (submission: CaseSubmission) => void;
  onRevise: (submission: CaseSubmission) => void;
  onSubmit: (submission: CaseSubmission) => void;
  onRetry: () => void;
}) {
  return (
    <table className="w-full min-w-[860px] text-sm">
      <thead className="bg-card-2 text-xs uppercase tracking-wide text-muted">
        <tr>
          <th className="px-5 py-3 text-left">Report</th>
          <th className="px-5 py-3 text-left">Period</th>
          <th className="px-5 py-3 text-left">Cases</th>
          <th className="px-5 py-3 text-left">Status</th>
          <th className="px-5 py-3 text-left">Last Updated</th>
          <th className="px-5 py-3 text-right">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        <SubmissionTableRows
          colSpan={6}
          emptyMessage="No report submissions yet. Create a report to start the review workflow."
          error={error}
          loading={loading}
          onRetry={onRetry}
        >
          {submissions.map((submission) => {
            const status = normalizeStatus(submission.status);
            return (
              <tr key={submission.submission_id} className="hover:bg-card-2">
                <td className="px-5 py-4 font-semibold text-ink">
                  {submission.title}
                </td>
                <td className="px-5 py-4 text-muted">
                  {formatDate(submission.date_from)} -{" "}
                  {formatDate(submission.date_to)}
                </td>
                <td className="px-5 py-4 text-muted">
                  {submission.case_count}
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(status)}`}
                  >
                    {status}
                  </span>
                </td>
                <td className="px-5 py-4 text-muted">
                  {formatDate(submission.updated_at)}
                </td>
                <td className="px-5 py-4">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onOpen(submission)}
                      className="rounded-lg border border-line2 bg-card px-3 py-1.5 text-xs font-semibold text-ink hover:bg-card-2"
                    >
                      View
                    </button>
                    {status === "Draft" && (
                      <button
                        type="button"
                        onClick={() => onEdit(submission)}
                        className="rounded-lg border border-brand-600 bg-card px-3 py-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-400/10"
                      >
                        Edit
                      </button>
                    )}
                    {status === "Draft" && (
                      <button
                        type="button"
                        onClick={() => onSubmit(submission)}
                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                      >
                        Submit
                      </button>
                    )}
                    {status === "Correction Required" && (
                      <button
                        type="button"
                        onClick={() => onRevise(submission)}
                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                      >
                        Revise
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </SubmissionTableRows>
      </tbody>
    </table>
  );
}

function AdminSubmissionTable({
  error,
  loading,
  submissions,
  onOpen,
  onRetry,
}: {
  error: string;
  loading: boolean;
  submissions: CaseSubmission[];
  onOpen: (submission: CaseSubmission) => void;
  onRetry: () => void;
}) {
  return (
    <table className="w-full min-w-[920px] text-sm">
      <thead className="bg-card-2 text-xs uppercase tracking-wide text-muted">
        <tr>
          <th className="px-5 py-3 text-left">Submitted By</th>
          <th className="px-5 py-3 text-left">Submission</th>
          <th className="px-5 py-3 text-left">Period</th>
          <th className="px-5 py-3 text-left">Cases</th>
          <th className="px-5 py-3 text-left">Status</th>
          <th className="px-5 py-3 text-left">Submitted</th>
          <th className="px-5 py-3 text-right">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        <SubmissionTableRows
          colSpan={7}
          emptyMessage="No submitted staff reports are ready for review yet."
          error={error}
          loading={loading}
          onRetry={onRetry}
        >
          {submissions.map((submission) => {
            const status = normalizeStatus(submission.status);
            return (
              <tr key={submission.submission_id} className="hover:bg-card-2">
                <td className="px-5 py-4">
                  <StaffIdentity submission={submission} />
                </td>
                <td className="px-5 py-4 font-semibold text-ink">
                  {submission.title}
                </td>
                <td className="px-5 py-4 text-muted">
                  {formatDate(submission.date_from)} -{" "}
                  {formatDate(submission.date_to)}
                </td>
                <td className="px-5 py-4 text-muted">
                  {submission.case_count}
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(status)}`}
                  >
                    {status}
                  </span>
                </td>
                <td className="px-5 py-4 text-muted">
                  {formatDate(submission.submitted_at)}
                </td>
                <td className="px-5 py-4 text-right">
                  <button
                    type="button"
                    onClick={() => onOpen(submission)}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                  >
                    View Report
                  </button>
                </td>
              </tr>
            );
          })}
        </SubmissionTableRows>
      </tbody>
    </table>
  );
}

function SubmissionTableRows({
  children,
  colSpan,
  emptyMessage,
  error,
  loading,
  onRetry,
}: {
  children: ReactNode[];
  colSpan: number;
  emptyMessage: string;
  error: string;
  loading: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-5 py-10 text-center text-muted">
          Loading report submissions...
        </td>
      </tr>
    );
  }

  if (error) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-5 py-10 text-center">
          <p className="font-semibold text-rose-800 dark:text-rose-300">
            Unable to load report submissions.
          </p>
          <p className="mt-1 text-sm text-muted">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Retry
          </button>
        </td>
      </tr>
    );
  }

  if (children.length === 0) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-5 py-10 text-center text-muted">
          {emptyMessage}
        </td>
      </tr>
    );
  }

  return children;
}

function VersionSelector({
  selected,
  versions,
  onOpen,
}: {
  selected: CaseSubmission;
  versions: CaseSubmission[];
  onOpen: (submission: CaseSubmission) => void;
}) {
  if (versions.length <= 1) return null;

  return (
    <div className="mb-4 rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-ink">Version History</h3>
          <p className="mt-1 text-sm text-muted">
            Select a version to review or export its preserved snapshot.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {versions.map((version) => {
            const active = version.submission_id === selected.submission_id;
            return (
              <button
                key={version.submission_id}
                type="button"
                onClick={() => onOpen(version)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                  active
                    ? "border-brand-600 bg-brand-50 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400"
                    : "border-line2 bg-card text-muted hover:bg-card-2"
                }`}
              >
                V{version.version}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function VersionDetailPanel({
  isLatest,
  reviewRound,
  submission,
}: {
  isLatest: boolean;
  reviewRound: number;
  submission: CaseSubmission;
}) {
  const latestFeedback = submission.feedback[submission.feedback.length - 1];
  return (
    <section className="mb-5 rounded-xl border border-line bg-card-2 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <VersionField
          label="Version"
          value={`V${submission.version}${isLatest ? " - Current" : " - Historical"}`}
        />
        <VersionField
          label="Submitted"
          value={formatDate(submission.submitted_at)}
        />
        <VersionField
          label="Status"
          value={normalizeStatus(submission.status)}
        />
        <VersionField label="Review Round" value={reviewRound || "-"} />
        <VersionField
          label="Reviewer"
          value={submission.reviewer_name || "-"}
        />
        <VersionField
          label="Approval Date"
          value={formatDate(submission.approved_at)}
        />
        <div className="sm:col-span-2">
          <VersionField
            label="Latest Reviewer Notes"
            value={latestFeedback?.comments || "-"}
          />
        </div>
      </div>
    </section>
  );
}

function VersionField({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-ink">
        {value}
      </p>
    </div>
  );
}

function VersionHistoryTable({
  selected,
  versions,
  onOpen,
}: {
  selected: CaseSubmission;
  versions: CaseSubmission[];
  onOpen: (submission: CaseSubmission) => void;
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-line">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-card-2 text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2 text-left">Version</th>
            <th className="px-3 py-2 text-left">Submitted</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Reviewer</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-card">
          {versions.map((version) => {
            const active = version.submission_id === selected.submission_id;
            return (
              <tr
                key={version.submission_id}
                className={`cursor-pointer hover:bg-card-2 ${active ? "bg-brand-50 dark:bg-brand-400/10" : ""}`}
                onClick={() => onOpen(version)}
              >
                <td className="px-3 py-2 font-semibold text-ink">
                  V{version.version}
                </td>
                <td className="px-3 py-2 text-muted">
                  {formatDate(version.submitted_at)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusClass(version.status)}`}
                  >
                    {normalizeStatus(version.status)}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted">
                  {version.reviewer_name || "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StaffIdentity({ submission }: { submission: CaseSubmission }) {
  const src = avatarSrc(submission.staff_profile_image_path);
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50 dark:bg-brand-400/10 text-xs font-bold text-brand-600 dark:text-brand-400">
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          initials(submission.staff_name)
        )}
      </div>
      <div>
        <p className="font-semibold text-ink">{submission.staff_name}</p>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {submission.staff_role}
        </p>
      </div>
    </div>
  );
}

function ReportHeader({ submission }: { submission: CaseSubmission }) {
  const src = avatarSrc(submission.staff_profile_image_path);
  return (
    <div className="border-b border-line bg-card-2 px-6 py-5">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50 dark:bg-brand-400/10 text-sm font-bold text-brand-600 dark:text-brand-400">
          {src ? (
            <img src={src} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(submission.staff_name)
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-ink">
            {submission.title}
          </p>
          <p className="mt-1 text-sm text-muted">
            Prepared by{" "}
            <span className="font-semibold text-ink">
              {submission.staff_name}
            </span>
            <span className="mx-2 text-faint">|</span>
            <span className="font-semibold uppercase tracking-wide text-muted">
              {submission.staff_role}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

function SnapshotTable({
  items,
  compact = false,
}: {
  items: SubmissionSnapshot[];
  compact?: boolean;
}) {
  return (
    <div
      className={`${compact ? "" : "mt-5 rounded-xl border border-line"} overflow-x-auto`}
    >
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-card-2 text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3 text-left">Control No.</th>
            <th className="px-4 py-3 text-left">Client</th>
            <th className="px-4 py-3 text-left">Case Type</th>
            <th className="px-4 py-3 text-left">Case Status</th>
            <th className="px-4 py-3 text-left">Date Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-card">
          {items.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center">
                <div className="mx-auto max-w-md">
                  <p className="text-sm font-semibold text-ink">
                    No cases found for this coverage.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Adjust the start/end dates or create case records within
                    this period, then regenerate the preview.
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={item.record.case_id} className="hover:bg-card-2">
                <td className="px-4 py-3 font-semibold text-ink">
                  {item.record.intake_record.control_no}
                </td>
                <td className="px-4 py-3 text-muted">{item.client_name}</td>
                <td className="px-4 py-3 text-muted">
                  {item.record.cases.cause_of_action ||
                    item.record.intake_record.nature_of_case}
                </td>
                <td className="px-4 py-3 text-muted">
                  {item.record.cases.status_of_case}
                </td>
                <td className="px-4 py-3 text-muted">
                  {item.record.intake_record.form_date ||
                    item.record.last_updated}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
