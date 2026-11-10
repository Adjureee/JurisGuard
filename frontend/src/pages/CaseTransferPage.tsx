import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../contexts/AuthContext";
import { useConfirmation } from "../components/ConfirmationProvider";
import MainLayout from "../layouts/MainLayout";
import PageHeader from "../components/PageHeader";
import ModalPortal from "../components/modals/ModalPortal";
import logo1 from "../logo/logo1.png";
import logo2 from "../logo/logo2.png";
import { createAuditLog } from "../services/auditService";
import {
  confirmCaseTransfer, createCaseTransfer, getCaseTransfer, listCaseTransfers,
  listTransferAttorneys, listTransferCases, returnCaseTransfer, submitCaseTransfer,
  updateCaseTransfer, buildCaseTransferExcel, getTransferErrorMessage, type CaseTransfer, type TransferAdminEntry, type TransferAttorney,
  type TransferCase,
} from "../services/caseTransferService";

const emptyEntry = (section: "ADMIN 1" | "ADMIN 2" | "ADMIN 3", row = 1): TransferAdminEntry => ({
  section, row_number: row, control_no: "", title_of_case: "", docket_no: "", date_received: "", status_of_case: "", cause_of_action: "",
});

function dateText(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function statusClass(status: string) {
  if (status === "Completed") return "bg-emerald-50 text-emerald-700";
  if (status === "Pending Receipt") return "bg-purple-50 text-[#704389]";
  if (status === "Returned for Correction") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export default function CaseTransferPage() {
  const { user } = useAuth();
  const confirm = useConfirmation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedReportId = searchParams.get("report");
  const [reports, setReports] = useState<CaseTransfer[]>([]);
  const [attorneys, setAttorneys] = useState<TransferAttorney[]>([]);
  const [selected, setSelected] = useState<CaseTransfer | null>(null);
  const [cases, setCases] = useState<Record<"Criminal" | "Civil", TransferCase[]>>({ Criminal: [], Civil: [] });
  const [casesLoading, setCasesLoading] = useState({ Criminal: false, Civil: false });
  const [casesError, setCasesError] = useState<Record<"Criminal" | "Civil", string | null>>({ Criminal: null, Civil: null });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [entries, setEntries] = useState<TransferAdminEntry[]>([]);
  const [title, setTitle] = useState("Transfer of Cases");
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [recipient, setRecipient] = useState("");
  const [sourceAttorney, setSourceAttorney] = useState("");
  const [search, setSearch] = useState({ Criminal: "", Civil: "" });
  const [modal, setModal] = useState<"create" | "view" | "entry" | "return" | null>(null);
  const [entryDraft, setEntryDraft] = useState<TransferAdminEntry>(emptyEntry("ADMIN 1"));
  const [editingEntryIndex, setEditingEntryIndex] = useState<number | null>(null);
  const [returnRemarks, setReturnRemarks] = useState("");
  const [editingReportId, setEditingReportId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [reportRows, people] = await Promise.all([listCaseTransfers(), listTransferAttorneys()]);
    setReports(reportRows); setAttorneys(people);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((error) => toast.error(error instanceof Error ? error.message : "Unable to load transfers")); }, 0); return () => window.clearTimeout(timer); }, [load]);

  useEffect(() => {
    if (!requestedReportId) return;
    let cancelled = false;
    const clearReportQuery = () => setSearchParams((params) => {
      params.delete("report");
      return params;
    }, { replace: true });
    const reportId = Number(requestedReportId);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      clearReportQuery();
      return;
    }

    void getCaseTransfer(reportId)
      .then((report) => {
        if (!cancelled) {
          setSelected(report);
          setModal("view");
        }
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Unable to open transfer report");
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
          clearReportQuery();
        }
      });

    return () => { cancelled = true; };
  }, [requestedReportId, setSearchParams]);

  const sourceUserId = user?.role === "admin" ? Number(sourceAttorney) || undefined : user?.user_id;
  useEffect(() => {
    if (modal !== "create" || !sourceUserId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCasesLoading({ Criminal: true, Civil: true });
      setCasesError({ Criminal: null, Civil: null });
      void Promise.allSettled([
        listTransferCases("Criminal", search.Criminal, sourceUserId),
        listTransferCases("Civil", search.Civil, sourceUserId),
      ]).then(([criminalResult, civilResult]) => {
        if (cancelled) return;
        const getError = (result: PromiseSettledResult<TransferCase[]>) => result.status === "rejected"
          ? result.reason instanceof Error ? result.reason.message : "Unable to load eligible cases"
          : null;
        setCases({
          Criminal: criminalResult.status === "fulfilled" ? criminalResult.value : [],
          Civil: civilResult.status === "fulfilled" ? civilResult.value : [],
        });
        setCasesError({ Criminal: getError(criminalResult), Civil: getError(civilResult) });
      }).finally(() => {
        if (!cancelled) setCasesLoading({ Criminal: false, Civil: false });
      });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [modal, search.Civil, search.Criminal, sourceUserId]);

  const openCreate = () => { setSelected(null); setEditingReportId(null); setEditingEntryIndex(null); setSelectedIds([]); setEntries([]); setRecipient(""); setSourceAttorney(user?.role === "admin" ? "" : String(user?.user_id || "")); setSearch({ Criminal: "", Civil: "" }); setTitle("Transfer of Cases"); setReportDate(new Date().toISOString().slice(0, 10)); setModal("create"); };
  const openEdit = (report: CaseTransfer) => { setEditingReportId(report.report_id); setSelectedIds(report.items.map((item) => item.case_id)); setEntries(report.administrative_entries); setRecipient(String(report.to_user_id)); setSourceAttorney(String(report.from_user_id)); setSearch({ Criminal: "", Civil: "" }); setCases({ Criminal: [], Civil: [] }); setCasesLoading({ Criminal: false, Civil: false }); setCasesError({ Criminal: null, Civil: null }); setTitle(report.title); setReportDate(report.report_date.slice(0, 10)); setModal("create"); };
  const closeDraft = async () => {
    const hasChanges = Boolean(editingReportId || selectedIds.length || entries.length || recipient || title !== "Transfer of Cases");
    if (hasChanges) {
      const confirmed = await confirm({
        title: "Discard Transfer Report?",
        message: "Are you sure you want to cancel? Any unsaved selections or changes to this transfer report will be discarded.",
        confirmLabel: "Discard Report",
      });
      if (!confirmed) return;
    }
    setModal(null);
  };
  const openReport = async (report: CaseTransfer) => { setBusy(true); try { setSelected(await getCaseTransfer(report.report_id)); setModal("view"); } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to open report"); } finally { setBusy(false); } };
  const toggleCase = (caseId: number) => setSelectedIds((current) => current.includes(caseId) ? current.filter((id) => id !== caseId) : [...current, caseId]);
  const payload = () => ({ title, report_date: reportDate, from_user_id: Number(sourceAttorney), to_user_id: Number(recipient), case_ids: selectedIds, administrative_entries: entries });
  const saveDraft = async () => {
    if (!sourceUserId || !recipient || !selectedIds.length) {
      toast.error("Select transferring and receiving attorneys and at least one case.");
      return;
    }
    if (sourceUserId === Number(recipient)) {
      toast.error("The transferring and receiving attorneys must be different.");
      return;
    }
    setBusy(true);
    try {
      const report = editingReportId
        ? await updateCaseTransfer(editingReportId, payload())
        : await createCaseTransfer(payload());
      toast.success(editingReportId ? "Transfer report updated" : "Transfer draft created");
      await load();
      setSelected(report);
      setEditingReportId(null);
      setModal("view");
    } catch (error) {
      toast.error(getTransferErrorMessage(error, "Unable to save transfer"));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const report = await submitCaseTransfer(selected.report_id);
      setSelected(report);
      await load();
      toast.success("Transfer submitted for receipt");
    } catch (error) {
      toast.error(getTransferErrorMessage(error, "Unable to submit transfer"));
    } finally {
      setBusy(false);
    }
  };
  const returnReport = async () => {
    if (!selected || !returnRemarks.trim()) return;
    setBusy(true);
    try {
      const report = await returnCaseTransfer(selected.report_id, returnRemarks);
      setSelected(report);
      setReturnRemarks("");
      setModal("view");
      await load();
      toast.success("Transfer returned for correction");
    } catch (error) {
      toast.error(getTransferErrorMessage(error, "Unable to return transfer"));
    } finally {
      setBusy(false);
    }
  };
  const confirmAction = async () => {
    if (!selected) return;
    const confirmed = await confirm({
      title: "Confirm Case Transfer?",
      message: "Confirm receipt and update all selected case assignments to you?",
      confirmLabel: "Confirm Receipt",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const report = await confirmCaseTransfer(selected.report_id);
      setSelected(report);
      await load();
      toast.success("Transfer received and assignments updated");
    } catch (error) {
      toast.error(getTransferErrorMessage(error, "Unable to confirm transfer"));
    } finally {
      setBusy(false);
    }
  };
  const downloadExcel = async () => {
    if (!selected || user?.role !== "admin") return;
    setBusy(true);
    try {
      const buffer = await buildCaseTransferExcel(selected, logo1, logo2);
      await createAuditLog({
        action: "Export Excel", module: "Export",
        entity_type: "case_transfer_export", entity_id: String(selected.report_id),
      });
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `transfer-of-cases-${selected.report_id}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Excel report downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to generate Excel report");
    } finally {
      setBusy(false);
    }
  };

  const selectedCounts = useMemo(() => ({ Criminal: selectedIds.filter((id) => cases.Criminal.some((item) => item.case_id === id)).length, Civil: selectedIds.filter((id) => cases.Civil.some((item) => item.case_id === id)).length }), [cases, selectedIds]);
  const editable = selected?.status === "Draft" || selected?.status === "Returned for Correction";
  const canReceive = Boolean(selected && selected.to_user_id === user?.user_id && selected.status === "Pending Receipt");

  return <MainLayout><div className="case-transfer-page mx-auto max-w-[1500px] space-y-4">
    <PageHeader eyebrow="Operations" title="Case Transfer" description="Prepare, review, receive, and preserve case handover reports." actions={<div className="flex flex-wrap gap-2">{selected && editable && user?.role === "admin" && selected.initiated_by_user_id === user.user_id && <button type="button" onClick={() => openEdit(selected)} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm font-semibold text-[#334155] transition hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]">Edit Selected Transfer</button>}<button type="button" onClick={openCreate} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#704389] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5f3675] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]">Create Transfer Report</button></div>} />
    {selected?.initiated_by_user_name && <p className="rounded-lg border border-[#E7D7EE] bg-[#F7F0FA] px-4 py-3 text-sm text-[#526174]">Initiated by administrator: <span className="font-semibold text-[#243344]">{selected.initiated_by_user_name}</span></p>}
    <section aria-label="Case transfer reports" className="overflow-hidden rounded-xl border border-[#CBD5E1] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] px-4 py-3 sm:px-5">
        <div><h2 className="font-semibold text-[#243344]">Transfer reports</h2><p className="mt-0.5 text-sm text-[#64748B]">{reports.length} {reports.length === 1 ? "report" : "reports"}</p></div>
      </div>
      <div className="records-table-scroll max-w-full overflow-auto">
        <table className="records-table w-full min-w-[760px] text-left text-sm">
          <thead className="sticky top-0 z-10 border-b border-[#D1D5DB] text-xs font-semibold uppercase tracking-wide"><tr><th className="px-4 py-3">Report</th><th className="px-4 py-3">From</th><th className="px-4 py-3">To</th><th className="px-4 py-3">Cases</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Updated</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
          <tbody className="divide-y divide-[#E5E7EB]">{reports.map((report) => <tr key={report.report_id}>
            <td className="px-4 py-3 font-semibold text-[#243344]">{report.title}<div className="mt-0.5 text-xs font-normal text-[#64748B]">As of {dateText(report.report_date)}</div></td>
            <td className="px-4 py-3">{report.from_user_name}</td><td className="px-4 py-3">{report.to_user_name}</td><td className="px-4 py-3 tabular-nums">{report.items.length}</td>
            <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(report.status)}`}>{report.status}</span></td>
            <td className="px-4 py-3 text-[#64748B]">{dateText(report.updated_at)}</td>
            <td className="px-4 py-3 text-right"><button type="button" onClick={() => void openReport(report)} className="inline-flex min-h-10 items-center rounded-md px-3 font-semibold text-[#704389] transition hover:bg-[#F7F0FA] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]">Open</button></td>
          </tr>)}{!reports.length && <tr><td colSpan={7} className="px-4 py-12 text-center text-[#64748B]">No transfer reports yet. Create a report to begin a case handover.</td></tr>}</tbody>
        </table>
      </div>
    </section>
    {modal === "create" && <ModalPortal>
      <div className="jurisguard-modal-overlay case-transfer-modal fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
        <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-[#CBD5E1] bg-white p-0 shadow-2xl">
          <div className="flex shrink-0 items-center justify-between bg-[#704389] px-5 py-4 text-white sm:px-6">
            <h2 className="text-xl font-bold text-white">Create Transfer of Cases</h2>
            <button type="button" onClick={closeDraft} aria-label="Close create transfer modal" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/50 text-2xl leading-none text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">×</button>
          </div>
          <div className="min-h-0 overflow-y-auto bg-[#F8FAFC] p-4 sm:p-6">
          <div className="grid gap-4 rounded-xl border border-[#DDE3EA] bg-white p-4 md:grid-cols-2 sm:p-5">
            <label className="text-sm font-semibold">Report title<input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] px-3 font-normal" /></label>
            <label className="text-sm font-semibold">Report date<input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] px-3 font-normal" /></label>
          </div>
          <div className="mt-4 grid gap-4 rounded-xl border border-[#DDE3EA] bg-white p-4 md:grid-cols-2 sm:p-5">
            <label className="text-sm font-semibold">From
              {user?.role === "admin" ? <select value={sourceAttorney} onChange={(event) => {
                const nextSource = event.target.value;
                setSourceAttorney(nextSource);
                setSelectedIds([]);
                setSearch({ Criminal: "", Civil: "" });
                setCases({ Criminal: [], Civil: [] });
                setCasesLoading({ Criminal: false, Civil: false });
                setCasesError({ Criminal: null, Civil: null });
                setRecipient((current) => Number(current) === Number(nextSource) ? "" : current);
              }} className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] px-3 font-normal">
                <option value="">Select transferring attorney</option>
                {attorneys.map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name}</option>)}
              </select> : <div className="mt-1 flex h-10 items-center rounded-md border border-[#D1D5DB] bg-[#F8FAFC] px-3 font-normal text-[#374151]">{user?.full_name || "Current attorney"}</div>}
            </label>
            <label className="text-sm font-semibold">To
              <select value={recipient} onChange={(event) => setRecipient(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] px-3 font-normal">
                <option value="">Select receiving attorney</option>
                {attorneys.filter((person) => person.user_id !== sourceUserId).map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {(["Criminal", "Civil"] as const).map((type) => <section key={type} className="rounded-xl border border-[#DDE3EA] bg-white p-4">
              <div className="flex items-center justify-between gap-3"><h3 className="font-bold text-[#243344]">{type} cases <span className="ml-1 inline-flex rounded-full bg-[#F7F0FA] px-2.5 py-1 text-xs font-semibold text-[#704389]">{selectedCounts[type]} selected</span></h3><button type="button" disabled={!sourceUserId || casesLoading[type] || !cases[type].length} onClick={() => { const visible = cases[type].map((item) => item.case_id); setSelectedIds((current) => Array.from(new Set([...current, ...visible]))); }} className="min-h-10 rounded-md px-3 text-xs font-semibold text-[#704389] transition hover:bg-[#F7F0FA] disabled:opacity-50">Select visible</button></div>
              <input value={search[type]} onChange={(event) => setSearch((current) => ({ ...current, [type]: event.target.value }))} placeholder={`Search ${type.toLowerCase()} cases`} disabled={!sourceUserId} className="mt-3 h-9 w-full rounded-md border border-[#D1D5DB] px-3 text-sm disabled:bg-[#F8FAFC]" />
              <div className="mt-3 max-h-64 overflow-y-auto divide-y divide-[#E5E7EB] rounded-lg border border-[#E5E7EB] px-2">
                {casesLoading[type] ? <p className="py-6 text-center text-xs text-[#6B7280]">Loading eligible cases...</p>
                  : casesError[type] ? <p role="alert" className="py-6 text-center text-xs text-red-700">{casesError[type]}</p>
                    : !sourceUserId ? <p className="py-6 text-center text-xs text-[#6B7280]">Select a transferring attorney to load eligible cases.</p>
                      : cases[type].map((item) => <label key={item.case_id} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm transition hover:bg-[#F8FAFC]"><input type="checkbox" checked={selectedIds.includes(item.case_id)} onChange={() => toggleCase(item.case_id)} className="mt-1 h-4 w-4 accent-[#704389]" /><span className="min-w-0 break-words"><b>{item.control_no || `Case #${item.case_id}`}</b> {item.title_of_case}<span className="block text-xs text-[#64748B]">{item.case_no || "No docket"} · {item.status_of_case}</span></span></label>)}
                {!casesLoading[type] && !casesError[type] && sourceUserId && !cases[type].length && <p className="py-6 text-center text-xs text-[#6B7280]">No eligible cases found.</p>}
              </div>
            </section>)}
          </div>
          <div className="mt-4 rounded-xl border border-[#DDE3EA] bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between"><h3 className="font-bold">Administrative entries</h3><button type="button" onClick={() => { setEditingEntryIndex(null); setEntryDraft(emptyEntry("ADMIN 1", entries.filter((entry) => entry.section === "ADMIN 1").length + 1)); setModal("entry"); }} className="rounded-md border border-[#704389] px-3 py-1.5 text-xs font-semibold text-[#704389]">Add entry</button></div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">{(["ADMIN 1", "ADMIN 2", "ADMIN 3"] as const).map((section) => <div key={section} className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-3"><h4 className="text-xs font-bold uppercase text-[#64748B]">{section}</h4>{entries.map((entry, entryIndex) => entry.section === section ? <div key={`${entry.section}-${entry.row_number}-${entryIndex}`} className="mt-2 flex items-center justify-between gap-2 text-xs"><span className="min-w-0 break-words">{entry.row_number}. {entry.title_of_case || "Untitled entry"}</span><span className="flex shrink-0 gap-2"><button type="button" onClick={() => { setEditingEntryIndex(entryIndex); setEntryDraft(entry); setModal("entry"); }} className="min-h-9 rounded px-2 font-semibold text-[#704389] transition hover:bg-[#F7F0FA]">Edit</button><button type="button" onClick={() => setEntries((current) => current.filter((_, index) => index !== entryIndex))} className="min-h-9 rounded px-2 text-red-700 transition hover:bg-rose-50">Remove</button></span></div> : null)}{!entries.some((entry) => entry.section === section) && <p className="mt-2 text-xs text-[#64748B]">No entries</p>}</div>)}</div>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[#E5E7EB] pt-4"><button type="button" onClick={closeDraft} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm font-semibold text-[#334155] transition hover:bg-[#F8FAFC]">Cancel</button><button type="button" disabled={busy || !sourceUserId} onClick={() => void saveDraft()} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#704389] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5F3675] disabled:opacity-50">{busy ? "Saving..." : "Create Draft"}</button></div>
          </div>
        </div>
      </div>
    </ModalPortal>}
    {modal === "entry" && <ModalPortal><div className="jurisguard-modal-overlay case-transfer-modal fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-2xl rounded-xl border border-[#CBD5E1] bg-white p-5 shadow-2xl sm:p-6"><h2 className="text-lg font-bold">Administrative entry</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{([["section", "Administrative Section"], ["control_no", "Control No."], ["title_of_case", "Title of the Case"], ["docket_no", "Docket No."], ["date_received", "Date Received"], ["status_of_case", "Status of the Case"], ["cause_of_action", "Cause of Action"]] as const).map(([key, label]) => <label key={key} className="text-sm font-semibold">{label}{key === "section" ? <select value={entryDraft.section} onChange={(event) => setEntryDraft((current) => ({ ...current, section: event.target.value as TransferAdminEntry["section"] }))} className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] px-2 font-normal"><option value="ADMIN 1">ADMIN 1</option><option value="ADMIN 2">ADMIN 2</option><option value="ADMIN 3">ADMIN 3</option></select> : <input type={key === "date_received" ? "date" : "text"} value={entryDraft[key]} onChange={(event) => setEntryDraft((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] px-2 font-normal" />}</label>)}</div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setModal("create")} className="rounded-md border px-3 py-2 text-sm">Cancel</button><button type="button" onClick={() => { const requiredFields: Array<[keyof TransferAdminEntry, string]> = [["control_no", "Control No."], ["title_of_case", "Title of the Case"], ["docket_no", "Docket No."], ["date_received", "Date Received"], ["status_of_case", "Status of the Case"], ["cause_of_action", "Cause of Action"]]; const missing = requiredFields.find(([key]) => !String(entryDraft[key]).trim()); if (missing) { toast.error(`${missing[1]} is required.`); return; } setEntries((current) => editingEntryIndex === null ? [...current, entryDraft] : current.map((entry, index) => index === editingEntryIndex ? entryDraft : entry)); setEditingEntryIndex(null); setModal("create"); }} className="rounded-md bg-[#704389] px-3 py-2 text-sm font-semibold text-white">{editingEntryIndex === null ? "Add Entry" : "Save Entry"}</button></div></div></div></ModalPortal>}
    {modal === "view" && selected && <ModalPortal>
      <div className="jurisguard-modal-overlay case-transfer-modal fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
        <div className="flex max-h-[88vh] w-[92vw] max-w-6xl flex-col overflow-hidden rounded-xl border border-[#CBD5E1] bg-white shadow-2xl">
          <div className="flex shrink-0 items-start justify-between gap-4 bg-[#704389] px-5 py-4 text-white sm:px-6">
            <div className="min-w-0">
              <h2 className="text-lg font-bold sm:text-xl">Case Transfer Report</h2>
              <p className="mt-1 break-words text-sm text-white/85">{selected.title} · {selected.from_user_name} → {selected.to_user_name} · As of {dateText(selected.report_date)}</p>
            </div>
            <button type="button" onClick={() => setModal(null)} aria-label="Close case transfer report" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-white/50 text-2xl leading-none text-white/90 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">×</button>
          </div>
          <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(selected.status)}`}>{selected.status}</span>
              <span className="text-sm text-[#6B7280]">{selected.items.length} cases, {selected.administrative_entries.length} administrative entries</span>
            </div>
            {selected.remarks && <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800"><b>Remarks:</b> {selected.remarks}</div>}
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <section className="min-w-0">
                <h3 className="font-bold text-[#243344]">A. Criminal cases</h3>
                {selected.items.filter((item) => item.section === "Criminal").map((item) => <p key={item.item_id} className="break-words border-b py-2 text-sm">{item.snapshot.control_no} · {item.snapshot.title_of_case}</p>)}
              </section>
              <section className="min-w-0">
                <h3 className="font-bold text-[#243344]">B. Civil cases</h3>
                {selected.items.filter((item) => item.section === "Civil").map((item) => <p key={item.item_id} className="break-words border-b py-2 text-sm">{item.snapshot.control_no} · {item.snapshot.title_of_case}</p>)}
              </section>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">{(["ADMIN 1", "ADMIN 2", "ADMIN 3"] as const).map((section) => <section key={section} className="min-w-0 rounded-xl border border-[#DDE3EA] bg-[#F8FAFC] p-4"><h3 className="text-xs font-bold uppercase text-[#64748B]">{section}</h3>{selected.administrative_entries.filter((entry) => entry.section === section).map((entry) => <p key={entry.entry_id} className="mt-2 break-words border-t border-[#E5E7EB] pt-2 text-sm">{entry.row_number}. {entry.title_of_case || "Untitled"}</p>)}</section>)}</div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[#E5E7EB] bg-white px-4 py-3 sm:px-6">
            {user?.role === "admin" && <button type="button" onClick={downloadExcel} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm font-semibold text-[#334155] transition hover:bg-[#F8FAFC]">Download Excel report</button>}
            {editable && selected.from_user_id === user?.user_id && <><button type="button" onClick={() => openEdit(selected)} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm font-semibold text-[#334155] transition hover:bg-[#F8FAFC]">Edit report</button><button type="button" disabled={busy} onClick={() => void submit()} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#704389] px-4 text-sm font-semibold text-white transition hover:bg-[#5F3675]">Submit report</button></>}
            {canReceive && <><button type="button" onClick={() => setModal("return")} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-800 transition hover:bg-amber-50">Return for correction</button><button type="button" disabled={busy} onClick={() => void confirmAction()} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800">Confirm receipt</button></>}
          </div>
        </div>
      </div>
    </ModalPortal>}
    {modal === "return" && selected && <ModalPortal><div className="jurisguard-modal-overlay case-transfer-modal fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-lg rounded-xl border border-[#CBD5E1] bg-white p-5 shadow-2xl sm:p-6"><h2 className="text-lg font-bold">Return for correction</h2><textarea value={returnRemarks} onChange={(event) => setReturnRemarks(event.target.value)} placeholder="Explain what needs correction" className="mt-4 min-h-32 w-full rounded-md border border-[#D1D5DB] p-3 text-sm" /><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setModal("view")} className="rounded-md border px-3 py-2 text-sm">Cancel</button><button type="button" disabled={busy || returnRemarks.trim().length < 5} onClick={() => void returnReport()} className="rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Return Report</button></div></div></div></ModalPortal>}
  </div></MainLayout>;
}
