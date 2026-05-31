import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FileDown, FileSpreadsheet } from "lucide-react";
import ModalPortal from "./ModalPortal";
import { useAuth } from "../../contexts/AuthContext";
import { useAuditLogStore } from "../../features/auditLogs/auditLogStore";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import { createAuditLog } from "../../services/auditService";

export type ReportExportType = "csv" | "excel";

export type ReportExportRow = Record<string, string | number | null | undefined>;

export interface ReportExportFilters {
  dateFrom: string;
  dateTo: string;
  caseStatus: string;
  barangay: string;
  caseCategory: string;
  month: string;
  year: string;
  staff: string;
  ocrStatus: string;
  terminationStatus: string;
}

interface ReportExportModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  fileName: string;
  rows: ReportExportRow[];
  scope: "admin" | "staff";
  redirectTo?: string;
  onClose: () => void;
}

const initialFilters: ReportExportFilters = {
  dateFrom: "",
  dateTo: "",
  caseStatus: "All",
  barangay: "All",
  caseCategory: "All",
  month: "All",
  year: "All",
  staff: "All",
  ocrStatus: "All",
  terminationStatus: "All",
};

function cleanValue(value: string | number | null | undefined) {
  return String(value ?? "");
}

function csvCell(value: string | number | null | undefined) {
  return `"${cleanValue(value).replace(/"/g, '""')}"`;
}

function buildCsv(rows: ReportExportRow[]) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = rows.map((row) => headers.map((header) => csvCell(row[header])).join(","));
  return [headers.map(csvCell).join(","), ...lines].join("\n");
}

function downloadBlob(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildExcelHtml(rows: ReportExportRow[], title: string) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const headerCells = headers.map((header) => `<th>${header}</th>`).join("");
  const bodyRows = rows
    .map((row) => `<tr>${headers.map((header) => `<td>${cleanValue(row[header])}</td>`).join("")}</tr>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8" /><style>body{font-family:Arial,sans-serif}table{border-collapse:collapse;width:100%}th{background:#E9EEF3;color:#2B3642;text-transform:uppercase}th,td{border:1px solid #D6DEE7;padding:8px;font-size:12px}</style></head><body><h2>${title}</h2><table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`;
}

function uniqueValues(rows: ReportExportRow[], keys: string[]) {
  const values = new Set<string>();
  rows.forEach((row) => {
    keys.forEach((key) => {
      const value = cleanValue(row[key]).trim();
      if (value) values.add(value);
    });
  });
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function dateOptionValues(rows: ReportExportRow[]) {
  return uniqueValues(rows, ["date", "report_date", "filing_date", "month", "uploaded_at", "timestamp"]);
}

function rowDate(row: ReportExportRow) {
  return cleanValue(row.date || row.report_date || row.filing_date || row.month || row.uploaded_at || row.timestamp);
}

function matchesFilter(row: ReportExportRow, filters: ReportExportFilters) {
  const date = rowDate(row);
  const dateOnly = date.length >= 10 ? date.slice(0, 10) : "";
  const status = cleanValue(row.case_status || row.status);
  const barangay = cleanValue(row.barangay || row.incident_barangay);
  const category = cleanValue(row.case_category || row.category || row.dataset);
  const staff = cleanValue(row.staff || row.user || row.encoded_by || row.uploaded_by);
  const ocrStatus = cleanValue(row.ocr_status);
  const terminationStatus = cleanValue(row.termination_status || row.is_terminated);

  return (
    (!filters.dateFrom || !dateOnly || dateOnly >= filters.dateFrom) &&
    (!filters.dateTo || !dateOnly || dateOnly <= filters.dateTo) &&
    (filters.month === "All" || (dateOnly && dateOnly.slice(5, 7) === filters.month)) &&
    (filters.year === "All" || (dateOnly && dateOnly.slice(0, 4) === filters.year)) &&
    (filters.caseStatus === "All" || status === filters.caseStatus) &&
    (filters.barangay === "All" || barangay === filters.barangay) &&
    (filters.caseCategory === "All" || category === filters.caseCategory) &&
    (filters.staff === "All" || staff === filters.staff) &&
    (filters.ocrStatus === "All" || ocrStatus === filters.ocrStatus) &&
    (filters.terminationStatus === "All" || terminationStatus === filters.terminationStatus)
  );
}

export default function ReportExportModal({
  isOpen,
  title,
  description,
  fileName,
  rows,
  scope,
  redirectTo = "/analytics",
  onClose,
}: ReportExportModalProps) {
  const { user } = useAuth();
  const addLog = useAuditLogStore((state) => state.addLog);
  const addNotification = useNotificationStore((state) => state.addNotification);
  const [filters, setFilters] = useState<ReportExportFilters>(initialFilters);
  const [exportType, setExportType] = useState<ReportExportType>("csv");
  const exportTypes = useMemo<ReportExportType[]>(
    () => ["csv", "excel"],
    []
  );

  const filteredRows = useMemo(() => rows.filter((row) => matchesFilter(row, filters)), [filters, rows]);
  const options = useMemo(() => {
    const dates = dateOptionValues(rows);
    return {
      statuses: uniqueValues(rows, ["case_status", "status"]),
      barangays: uniqueValues(rows, ["barangay", "incident_barangay"]),
      categories: uniqueValues(rows, ["case_category", "category", "dataset"]),
      months: Array.from(new Set(dates
        .map((value) => value.slice(5, 7))
        .filter((value) => /^\d{2}$/.test(value)))).sort(),
      years: Array.from(new Set(dates
        .map((value) => value.slice(0, 4))
        .filter((value) => /^\d{4}$/.test(value)))).sort(),
      staff: uniqueValues(rows, ["staff", "user", "encoded_by", "uploaded_by"]),
      ocrStatuses: uniqueValues(rows, ["ocr_status"]),
      terminationStatuses: uniqueValues(rows, ["termination_status", "is_terminated"]),
    };
  }, [rows]);

  if (!isOpen) return null;

  const updateFilter = (key: keyof ReportExportFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleExport = async () => {
    if (filteredRows.length === 0) {
      toast.error("No records match the selected export filters.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `${fileName}_${stamp}`;
    const toastId = toast.loading("Preparing report export...");

    try {
      const action = exportType === "csv" ? "Export CSV" : "Export Excel";
      const description = `${user?.full_name || user?.email || "User"} exported ${filteredRows.length} ${scope === "staff" ? "personal" : "institutional"} report rows as ${exportType.toUpperCase()}`;
      const entityId = new Date().toISOString();
      await createAuditLog({
        action,
        module: "Export",
        description,
        entity_type: `${scope}_report_export`,
        entity_id: entityId,
      });

      if (exportType === "csv") {
        downloadBlob(`${baseName}.csv`, buildCsv(filteredRows), "text/csv;charset=utf-8");
      } else {
        downloadBlob(`${baseName}.xls`, buildExcelHtml(filteredRows, title), "application/vnd.ms-excel;charset=utf-8");
      }

      addLog({
        userId: user?.user_id,
        user: user?.full_name || user?.email,
        action,
        module: "Export",
        description,
        entityType: `${scope}_report_export`,
        entityId,
      });
      addNotification({
        type: "export_completed",
        userId: user?.user_id,
        title: "Report Export",
        message: `${exportType.toUpperCase()} report exported`,
        redirectTo,
        entityType: `${scope}_report_export`,
        entityId,
      });
      toast.success("Report exported", { id: toastId });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export report", { id: toastId });
    }
  };

  const selectClass = "mt-1 h-10 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none transition focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20";
  const labelClass = "text-xs font-semibold uppercase tracking-wide text-[#2B3642]";

  return (
    <ModalPortal>
    <div className="jurisguard-modal-overlay bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="jurisguard-modal-surface flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-xl">
        <div className="shrink-0 border-b border-[#E5E7EB] bg-[#F8FAFC] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#2B3642]">{title}</h2>
            <p className="mt-1 max-w-2xl text-sm text-[#4B5563]">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 text-sm font-semibold text-[#2B3642] hover:bg-[#F3F7FB]">
            Close
          </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Available Rows</p>
              <p className="mt-1 text-xl font-bold text-[#111827]">{rows.length}</p>
            </div>
            <div className="rounded-xl border border-[#E7D7EE] bg-[#F7F0FA] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#704389]">Rows After Filters</p>
              <p className="mt-1 text-xl font-bold text-[#5F3675]">{filteredRows.length}</p>
            </div>
            <div className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Export Scope</p>
              <p className="mt-1 text-xl font-bold capitalize text-[#111827]">{scope}</p>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-5 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-4">
            <div className="mb-3">
              <p className="text-sm font-bold text-[#111827]">Export Format</p>
              <p className="mt-1 text-xs font-medium text-[#6B7280]">Choose the file type before applying filters.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
            {exportTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setExportType(type)}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold capitalize transition ${
                  exportType === type
                    ? "border-[#704389] bg-[#704389] text-white"
                    : "border-[#D1D5DB] bg-white text-[#2B3642] hover:bg-[#F3F7FB]"
                }`}
              >
                {type === "csv" && <FileDown className="h-4 w-4" />}
                {type === "excel" && <FileSpreadsheet className="h-4 w-4" />}
                {type}
              </button>
            ))}
            </div>
          </div>

          <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
            <div className="mb-4">
              <p className="text-sm font-bold text-[#111827]">Report Filters</p>
              <p className="mt-1 text-xs font-medium text-[#6B7280]">Filter first, then export the matching report rows.</p>
            </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="block">
              <span className={labelClass}>Date From</span>
              <input type="date" value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} className={selectClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Date To</span>
              <input type="date" value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} className={selectClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Case Status</span>
              <select value={filters.caseStatus} onChange={(event) => updateFilter("caseStatus", event.target.value)} className={selectClass}>
                <option>All</option>
                {options.statuses.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Barangay</span>
              <select value={filters.barangay} onChange={(event) => updateFilter("barangay", event.target.value)} className={selectClass}>
                <option>All</option>
                {options.barangays.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Case Category</span>
              <select value={filters.caseCategory} onChange={(event) => updateFilter("caseCategory", event.target.value)} className={selectClass}>
                <option>All</option>
                {options.categories.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Month</span>
              <select value={filters.month} onChange={(event) => updateFilter("month", event.target.value)} className={selectClass}>
                <option>All</option>
                {options.months.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Year</span>
              <select value={filters.year} onChange={(event) => updateFilter("year", event.target.value)} className={selectClass}>
                <option>All</option>
                {options.years.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Staff</span>
              <select value={filters.staff} onChange={(event) => updateFilter("staff", event.target.value)} className={selectClass}>
                <option>All</option>
                {options.staff.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>OCR Status</span>
              <select value={filters.ocrStatus} onChange={(event) => updateFilter("ocrStatus", event.target.value)} className={selectClass}>
                <option>All</option>
                {options.ocrStatuses.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Termination Status</span>
              <select value={filters.terminationStatus} onChange={(event) => updateFilter("terminationStatus", event.target.value)} className={selectClass}>
                <option>All</option>
                {options.terminationStatuses.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
          </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-[#E5E7EB] bg-[#F8FAFC] px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-[#4B5563]">
            <span className="font-bold text-[#2B3642]">{filteredRows.length}</span> matching rows will be exported.
          </p>
          <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setFilters(initialFilters)} className="rounded-lg border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#2B3642] hover:bg-[#F3F7FB]">
            Reset Filters
          </button>
          <button type="button" onClick={handleExport} className="rounded-lg bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#5F3675]">
            Export Report
          </button>
          </div>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

