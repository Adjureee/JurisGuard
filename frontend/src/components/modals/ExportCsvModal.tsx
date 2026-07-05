import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import ModalPortal from "./ModalPortal";
import { useAuth } from "../../contexts/AuthContext";
import { useAuditLogStore } from "../../features/auditLogs/auditLogStore";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import { createAuditLog } from "../../services/auditService";
import {
  buildCriminalCasesCsv,
  buildCriminalCasesExcelHtml,
  downloadCsv,
  filterCriminalCaseRows,
  type CriminalCaseExportFilterDto,
  type CriminalCaseRow,
} from "../../services/exportService";

interface ExportCsvModalProps {
  isOpen: boolean;
  rows: CriminalCaseRow[];
  onClose: () => void;
}

const initialFilters: CriminalCaseExportFilterDto = {
  status: "All",
  date_from: "",
  date_to: "",
  location_type: "All",
  barangay: "All",
  case_category: "All",
  staff: "All",
  ocr_status: "All",
  termination_status: "All",
};

type ExportType = "csv" | "excel";

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
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

export default function ExportCsvModal({ isOpen, rows, onClose }: ExportCsvModalProps) {
  const { user } = useAuth();
  const addLog = useAuditLogStore((state) => state.addLog);
  const addNotification = useNotificationStore((state) => state.addNotification);
  const [filters, setFilters] = useState<CriminalCaseExportFilterDto>(initialFilters);
  const [exportType, setExportType] = useState<ExportType>("csv");
  const exportRows = useMemo(() => filterCriminalCaseRows(rows, filters), [filters, rows]);
  const options = useMemo(
    () => ({
      barangays: uniqueValues(rows.map(({ record }) => record.cases.incident_barangay ?? "")),
      categories: uniqueValues(rows.map(({ record }) => record.cases.cause_of_action || record.intake_record.nature_of_case)),
      staff: uniqueValues(rows.map(({ record }) => record.created_by_user_id === null ? "Unassigned" : `User #${record.created_by_user_id}`)),
    }),
    [rows]
  );

  if (!isOpen) return null;

  const updateFilter = (key: keyof CriminalCaseExportFilterDto, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleExport = async () => {
    if (exportRows.length === 0) {
      toast.error("No records match the selected export filters.");
      return;
    }
    const toastId = toast.loading("Preparing report export...");
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const action = exportType === "csv" ? "Export CSV" : "Export Excel";
      const description = `${user?.full_name || user?.email || "User"} exported ${exportRows.length} criminal case record${exportRows.length === 1 ? "" : "s"} as ${exportType.toUpperCase()}`;
      const entityId = new Date().toISOString();
      await createAuditLog({
        action,
        module: "Export",
        description,
        entity_type: "criminal_case_export",
        entity_id: entityId,
      });
      if (exportType === "csv") {
        const csv = buildCriminalCasesCsv(rows, filters);
        downloadCsv(`jurisguard-criminal-cases_${stamp}.csv`, csv);
      } else {
        downloadText(`jurisguard-criminal-cases_${stamp}.xls`, buildCriminalCasesExcelHtml(rows, filters), "application/vnd.ms-excel;charset=utf-8");
      }
      addLog({
        userId: user?.user_id,
        user: user?.full_name || user?.email,
        action,
        module: "Export",
        description,
        entityType: "criminal_case_export",
        entityId,
      });
      addNotification({
        type: "export_completed",
        userId: user?.user_id,
        title: "Report Export",
        message: `${exportType.toUpperCase()} exported`,
        redirectTo: "/criminal-cases",
        entityType: "criminal_case_export",
        entityId,
      });
      toast.success("Report exported", { id: toastId });
      onClose();
    } catch {
      toast.error("Failed export", { id: toastId });
    }
  };

  return (
    <ModalPortal>
    <div className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm transition-opacity duration-200" role="dialog" aria-modal="true">
      <div className="jurisguard-modal-surface w-full max-w-3xl animate-[modalIn_200ms_ease-out] overflow-hidden rounded-2xl border border-line bg-card shadow-xl">
        <div className="flex items-center justify-between gap-4 border-b border-line bg-card-2 px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-ink">Advanced Criminal Cases Export</h2>
            <p className="mt-1 text-sm text-muted">
              Filter legal records and export to CSV or Excel.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition duration-200 hover:bg-card hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 bg-card px-6 py-5">
          <div className="grid gap-3 rounded-xl border border-line bg-card-2 p-3 sm:grid-cols-2">
            {(["csv", "excel"] as ExportType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setExportType(type)}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold uppercase ${
                  exportType === type
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-line2 bg-card text-ink hover:bg-card-2"
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-sm font-medium text-ink">Case Status</span>
            <select
              value={filters.status}
              onChange={(event) => updateFilter("status", event.target.value)}
              className="mt-1 w-full rounded-lg border border-line2 bg-card px-3 py-2 text-sm text-ink outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
            >
              <option>All</option>
              <option>Active</option>
              <option>Pending</option>
              <option>Ongoing</option>
              <option>Terminated</option>
              <option>Archived</option>
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-ink">Date From</span>
              <input
                type="date"
                value={filters.date_from}
                onChange={(event) => updateFilter("date_from", event.target.value)}
                className="mt-1 w-full rounded-lg border border-line2 bg-card px-3 py-2 text-sm text-ink outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Date To</span>
              <input
                type="date"
                value={filters.date_to}
                onChange={(event) => updateFilter("date_to", event.target.value)}
                className="mt-1 w-full rounded-lg border border-line2 bg-card px-3 py-2 text-sm text-ink outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-ink">Location Type</span>
            <select
              value={filters.location_type}
              onChange={(event) => updateFilter("location_type", event.target.value)}
              className="mt-1 w-full rounded-lg border border-line2 bg-card px-3 py-2 text-sm text-ink outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
            >
              <option>All</option>
              <option>Urban</option>
              <option>Rural</option>
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-ink">Barangay</span>
              <select value={filters.barangay} onChange={(event) => updateFilter("barangay", event.target.value)} className="mt-1 w-full rounded-lg border border-line2 bg-card px-3 py-2 text-sm text-ink outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20">
                <option>All</option>
                {options.barangays.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Case Category</span>
              <select value={filters.case_category} onChange={(event) => updateFilter("case_category", event.target.value)} className="mt-1 w-full rounded-lg border border-line2 bg-card px-3 py-2 text-sm text-ink outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20">
                <option>All</option>
                {options.categories.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Staff</span>
              <select value={filters.staff} onChange={(event) => updateFilter("staff", event.target.value)} className="mt-1 w-full rounded-lg border border-line2 bg-card px-3 py-2 text-sm text-ink outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20">
                <option>All</option>
                {options.staff.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Termination Status</span>
              <select value={filters.termination_status} onChange={(event) => updateFilter("termination_status", event.target.value)} className="mt-1 w-full rounded-lg border border-line2 bg-card px-3 py-2 text-sm text-ink outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20">
                <option>All</option>
                <option>Active</option>
                <option>Terminated</option>
              </select>
            </label>
          </div>

          <div className="rounded-lg border border-line bg-card-2 px-4 py-3 text-sm text-muted">
            {exportRows.length} record{exportRows.length === 1 ? "" : "s"} will be exported.
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-between border-t border-line bg-card-2 px-6 py-4">
          <button
            type="button"
            onClick={() => setFilters(initialFilters)}
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-muted transition duration-200 hover:bg-card-2"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-brand-700"
          >
            Export {exportType.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

