import { useEffect, useMemo, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { useSearchParams } from 'react-router-dom';
import MainLayout from "../layouts/MainLayout";
import DateFilterSelect from "../components/DateFilterSelect";
import PageHeader from "../components/PageHeader";
import ModalPortal from "../components/modals/ModalPortal";
import { useNotificationStore } from "../features/notifications/notificationStore";
import ProtectedProfileImage from "../components/ProtectedProfileImage";
import {
  createCaseSubmission,
  getCaseSubmission,
  getCaseSubmissionHistory,
  listCaseSubmissions,
  previewCaseSubmission,
  resubmitCaseSubmission,
  submitCaseSubmission,
  updateCaseSubmission,
  type CaseSubmission,
  type SubmissionSnapshot,
} from "../services/caseSubmissionService";
import {
  matchesDateFilter,
  type DateFilterValue,
} from "../utils/dateFilters";

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

function statusClass(status: string) {
  const normalizedStatus = normalizeStatus(status);
  if (normalizedStatus === "Approved") return "bg-[#ECFDF5] text-[#065F46]";
  if (normalizedStatus === "Correction Required")
    return "bg-[#FFFBEB] text-[#92400E]";
  if (
    normalizedStatus === "Submitted" ||
    normalizedStatus === "Under Review" ||
    normalizedStatus === "Resubmitted"
  )
    return "bg-[#F7F0FA] text-[#704389]";
  return "bg-[#F8FAFC] text-[#4B5563]";
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

type ReportModalMode = "create" | "edit-draft" | "revise";

export default function CaseSubmissionsPage() {
  const addNotification = useNotificationStore(
    (state) => state.addNotification,
  );
  const [submissions, setSubmissions] = useState<CaseSubmission[]>([]);
  const [selected, setSelected] = useState<CaseSubmission | null>(null);
  const [history, setHistory] = useState<CaseSubmission[]>([]);
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
  const [dashboardParams, setDashboardParams] = useSearchParams();
  useEffect(() => {
    const id = dashboardParams.get('submission');
    if (!id || loadingSubmissions) return;
    const match = submissions.find(row => row.submission_id === id);
    if (match) setSearch(match.title);
    const next = new URLSearchParams(dashboardParams); next.delete('submission');
    setDashboardParams(next, { replace: true });
  }, [dashboardParams, setDashboardParams, submissions, loadingSubmissions]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilterValue>("all");

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
      if (
        !matchesDateFilter(
          submission.submitted_at ||
            submission.updated_at ||
            submission.created_at,
          dateFilter,
        )
      )
        return false;
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
  }, [dateFilter, search, statusFilter, submissions]);
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
    const [details, historyRows] = await Promise.all([
      getCaseSubmission(submission.submission_id),
      getCaseSubmissionHistory(submission.submission_id),
    ]);
    setSelected(details);
    setHistory(historyRows);
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
          redirectTo: "/dashboard",
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
    toast.success("Report submitted");
    addNotification({
      type: "workflow",
      targetRole: "admin",
      title: "Draft Submitted",
      message: `${updated.staff_name} submitted ${updated.title}`,
      redirectTo: "/dashboard",
      entityType: "case_submission",
      entityId: updated.submission_id,
    });
    await loadSubmissions();
    await openSubmission(updated);
  };

  return (
    <MainLayout>
      <div className="flex h-[calc(100vh-110px)] min-w-0 max-w-full flex-col gap-4 overflow-hidden">
        <div className="shrink-0">
          <PageHeader
            eyebrow="Case Submissions"
            title="Report Management"
            description="Create, submit, and manage your report drafts and corrections."
            compact
            actions={
              <button
                type="button"
                onClick={openCreateModal}
                className="h-9 rounded-lg bg-[#704389] px-3.5 text-sm font-semibold text-white hover:bg-[#5F3675]"
              >
                Create Report
              </button>
            }
          />
        </div>

      <section className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col rounded-xl border border-[#CBD5E1] bg-white p-4 shadow-sm">
        <div className="mb-3 grid shrink-0 gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,360px)_200px_190px_auto] xl:items-end">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
              Search
            </span>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search report, period, status..."
              className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
              Status
            </span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
            >
              <option value="all">All Statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <DateFilterSelect value={dateFilter} onChange={setDateFilter} />
          <div className="flex h-9 items-center gap-2 rounded-md border border-[#D1D5DB] bg-[#F8FAFC] px-3">
            <span className="font-semibold text-[#4B5563]">Total:</span>
            <span className="rounded-md bg-[#704389] px-2.5 py-1 text-base font-semibold leading-none text-white">
              {filteredSubmissions.length}
            </span>
          </div>
        </div>
        <div className="relative min-h-0 max-w-full flex-1 overflow-y-auto overflow-x-auto rounded-lg border border-[#CBD5E1]">
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
        </div>
      </section>
      </div>

      {reportModalOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#EEF2F6]/90 px-4 py-6 backdrop-blur-sm">
            <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#704389]">
                    {reportModalMode === "revise"
                      ? "Correction Workflow"
                      : "Report Snapshot"}
                  </p>
                  <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-950">
                    {reportModalMode === "create"
                      ? "Create Report"
                      : reportModalMode === "revise"
                        ? "Revise Report"
                        : "Edit Draft"}
                  </h2>
                  <p className="mt-1 text-sm leading-5 text-slate-600">
                    Select a coverage period, preview included cases, then save
                    the report draft.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReportModalOpen(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-lg font-semibold leading-none text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                  aria-label="Close report dialog"
                >
                  x
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-5">
                {reportModalMode === "revise" &&
                editingSubmission?.feedback.length ? (
                  <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-bold text-amber-800">
                      Admin Correction Notes - Version{" "}
                      {editingSubmission.version}
                    </p>
                    <div className="mt-2 space-y-2">
                      {editingSubmission.feedback.map((item) => (
                        <p
                          key={item.feedback_id}
                          className="text-sm text-slate-700"
                        >
                          {item.comments}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_170px_170px]">
                    <label>
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Submission Title
                      </span>
                      <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="May 2026 Intake Report"
                        className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-[#704389] focus:ring-4 focus:ring-[#704389]/10"
                      />
                    </label>
                    <label>
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Start Date
                      </span>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(event) => setDateFrom(event.target.value)}
                        className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-[#704389] focus:ring-4 focus:ring-[#704389]/10"
                      />
                    </label>
                    <label>
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        End Date
                      </span>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(event) => setDateTo(event.target.value)}
                        className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-[#704389] focus:ring-4 focus:ring-[#704389]/10"
                      />
                    </label>
                  </div>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Summary notes"
                    className="mt-4 min-h-20 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-[#704389] focus:ring-4 focus:ring-[#704389]/10"
                  />
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">
                        Case Snapshot Preview
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {preview.length} case{preview.length === 1 ? "" : "s"}{" "}
                        included in this coverage period.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={runPreview}
                      disabled={loading}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loading ? "Loading Preview..." : "Regenerate Preview"}
                    </button>
                  </div>
                  <SnapshotTable items={preview} compact />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4">
                <p className="text-xs font-medium text-slate-500">
                  Drafts stay editable until submitted for review.
                </p>
                <button
                  type="button"
                  onClick={saveReportModal}
                  disabled={loading || !title}
                  className="rounded-lg bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5F3675] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
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
            <div className="jurisguard-modal-surface flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-xl">
              <ReportHeader submission={selected} />
              <div className="min-h-0 flex-1 overflow-y-auto p-6">
                {selected.notes && (
                  <div className="mb-5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4 text-sm text-[#4B5563]">
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
                  <section className="rounded-xl border border-[#E5E7EB] bg-white p-4">
                    <h3 className="font-bold text-[#2B3642]">
                      Version History
                    </h3>
                    <VersionHistoryTable
                      selected={selected}
                      versions={orderedHistory}
                      onOpen={(submission) => void openSubmission(submission)}
                    />
                  </section>
                  <section className="rounded-xl border border-[#E5E7EB] bg-white p-4">
                    <h3 className="font-bold text-[#2B3642]">
                      Correction Notes
                    </h3>
                    <div className="mt-3 space-y-3">
                      {selected.feedback.length === 0 ? (
                        <p className="text-sm text-[#6B7280]">
                          No correction notes yet.
                        </p>
                      ) : (
                        selected.feedback.map((item) => (
                          <div
                            key={item.feedback_id}
                            className="rounded-lg bg-[#F9FAFB] p-3 text-sm"
                          >
                            <p className="font-semibold text-[#2B3642]">
                              {item.reviewer_name}
                            </p>
                            <p className="mt-1 text-[#4B5563]">
                              {item.comments}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-[#E5E7EB] bg-[#F8FAFC] px-6 py-4">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#2B3642] hover:bg-[#F3F4F6]"
                >
                  Close
                </button>
                {selectedIsLatest && selectedStatus === "Draft" && (
                  <button
                    type="button"
                    onClick={() => void openEditModal(selected, "edit-draft")}
                    className="rounded-lg border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] hover:bg-[#F7F0FA]"
                  >
                    Edit Draft
                  </button>
                )}
                {selectedIsLatest && selectedStatus === "Draft" && (
                  <button
                    type="button"
                    onClick={() => void submitDraft(selected)}
                    className="rounded-lg bg-[#704389] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5F3675]"
                  >
                    Submit Report
                  </button>
                )}
                {selectedIsLatest &&
                  selectedStatus === "Correction Required" && (
                    <button
                      type="button"
                      onClick={() => void openEditModal(selected, "revise")}
                      className="rounded-lg bg-[#704389] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5F3675]"
                    >
                      Revise Report
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
      <thead className="sticky top-0 z-10 border-b border-[#D1D5DB] bg-[#E5E7EB] text-xs uppercase tracking-wide text-[#374151]">
        <tr>
          <th className="px-3 py-3 text-left font-semibold">Report</th>
          <th className="px-3 py-3 text-left font-semibold">Period</th>
          <th className="px-3 py-3 text-left font-semibold">Cases</th>
          <th className="px-3 py-3 text-left font-semibold">Status</th>
          <th className="px-3 py-3 text-left font-semibold">Last Updated</th>
          <th className="px-3 py-3 text-right font-semibold">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#E5E7EB]">
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
              <tr key={submission.submission_id} className="odd:bg-white even:bg-[#F9FAFB] transition duration-200 hover:bg-[#F3F7FB]">
                <td className="px-3 py-4 font-semibold text-[#2B3642]">
                  {submission.title}
                </td>
                <td className="px-3 py-4 text-[#4B5563]">
                  {formatDate(submission.date_from)} -{" "}
                  {formatDate(submission.date_to)}
                </td>
                <td className="px-3 py-4 text-[#4B5563]">
                  {submission.case_count}
                </td>
                <td className="px-3 py-4">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(status)}`}
                  >
                    {status}
                  </span>
                </td>
                <td className="px-3 py-4 text-[#4B5563]">
                  {formatDate(submission.updated_at)}
                </td>
                <td className="px-3 py-4">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onOpen(submission)}
                      className="rounded-md border border-[#D1D5DB] bg-white px-3 py-1.5 text-xs font-semibold text-[#2B3642] hover:bg-[#F3F4F6]"
                    >
                      View
                    </button>
                    {status === "Draft" && (
                      <button
                        type="button"
                        onClick={() => onEdit(submission)}
                        className="rounded-md border border-[#704389] bg-white px-3 py-1.5 text-xs font-semibold text-[#704389] hover:bg-[#F7F0FA]"
                      >
                        Edit
                      </button>
                    )}
                    {status === "Draft" && (
                      <button
                        type="button"
                        onClick={() => onSubmit(submission)}
                        className="rounded-md bg-[#704389] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#5F3675]"
                      >
                        Submit
                      </button>
                    )}
                    {status === "Correction Required" && (
                      <button
                        type="button"
                        onClick={() => onRevise(submission)}
                        className="rounded-md bg-[#704389] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#5F3675]"
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
        <td colSpan={colSpan} className="px-5 py-10 text-center text-[#6B7280]">
          Loading report submissions...
        </td>
      </tr>
    );
  }

  if (error) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-5 py-10 text-center">
          <p className="font-semibold text-[#9F1239]">
            Unable to load report submissions.
          </p>
          <p className="mt-1 text-sm text-[#6B7280]">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-lg bg-[#704389] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5F3675]"
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
        <td colSpan={colSpan} className="px-5 py-10 text-center text-[#6B7280]">
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
    <div className="mb-4 rounded-xl border border-[#E5E7EB] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-[#2B3642]">Version History</h3>
          <p className="mt-1 text-sm text-[#6B7280]">
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
                    ? "border-[#704389] bg-[#F7F0FA] text-[#704389]"
                    : "border-[#D1D5DB] bg-white text-[#4B5563] hover:bg-[#F8FAFC]"
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
    <section className="mb-5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
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
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-[#2B3642]">
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
    <div className="mt-3 overflow-hidden rounded-xl border border-[#E5E7EB]">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-[#E5E7EB] text-xs uppercase tracking-wide text-[#374151]">
          <tr>
            <th className="px-3 py-2 text-left">Version</th>
            <th className="px-3 py-2 text-left">Submitted</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Reviewer</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB] bg-white">
          {versions.map((version) => {
            const active = version.submission_id === selected.submission_id;
            return (
              <tr
                key={version.submission_id}
                className={`cursor-pointer hover:bg-[#F9FAFB] ${active ? "bg-[#F7F0FA]" : ""}`}
                onClick={() => onOpen(version)}
              >
                <td className="px-3 py-2 font-semibold text-[#2B3642]">
                  V{version.version}
                </td>
                <td className="px-3 py-2 text-[#4B5563]">
                  {formatDate(version.submitted_at)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusClass(version.status)}`}
                  >
                    {normalizeStatus(version.status)}
                  </span>
                </td>
                <td className="px-3 py-2 text-[#4B5563]">
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

function ReportHeader({ submission }: { submission: CaseSubmission }) {
  return (
    <div className="border-b border-[#E5E7EB] bg-[#F8FAFC] px-6 py-5">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#F7F0FA] text-sm font-bold text-[#704389]">
          <ProtectedProfileImage path={submission.staff_profile_image_path} className="h-full w-full object-cover" fallback={initials(submission.staff_name)} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-[#111827]">
            {submission.title}
          </p>
          <p className="mt-1 text-sm text-[#4B5563]">
            Prepared by{" "}
            <span className="font-semibold text-[#2B3642]">
              {submission.staff_name}
            </span>
            <span className="mx-2 text-[#D1D5DB]">|</span>
            <span className="font-semibold uppercase tracking-wide text-[#6B7280]">
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
      className={`${compact ? "" : "mt-5 rounded-xl border border-[#E5E7EB]"} overflow-x-auto`}
    >
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-4 py-3 text-left">Control No.</th>
            <th className="px-4 py-3 text-left">Client</th>
            <th className="px-4 py-3 text-left">Case Type</th>
            <th className="px-4 py-3 text-left">Case Status</th>
            <th className="px-4 py-3 text-left">Date Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB] bg-white">
          {items.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center">
                <div className="mx-auto max-w-md">
                  <p className="text-sm font-semibold text-slate-700">
                    No cases found for this coverage.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Adjust the start/end dates or create case records within
                    this period, then regenerate the preview.
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={item.record.case_id} className="hover:bg-[#F9FAFB]">
                <td className="px-4 py-3 font-semibold text-[#2B3642]">
                  {item.record.intake_record.control_no}
                </td>
                <td className="px-4 py-3 text-[#4B5563]">{item.client_name}</td>
                <td className="px-4 py-3 text-[#4B5563]">
                  {item.record.cases.cause_of_action ||
                    item.record.intake_record.nature_of_case}
                </td>
                <td className="px-4 py-3 text-[#4B5563]">
                  {item.record.cases.status_of_case}
                </td>
                <td className="px-4 py-3 text-[#4B5563]">
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
