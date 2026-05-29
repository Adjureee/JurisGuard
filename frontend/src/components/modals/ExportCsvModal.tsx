import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useAuth } from "../../contexts/AuthContext";
import { useAuditLogStore } from "../../features/auditLogs/auditLogStore";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import {
  buildCriminalCasesCsv,
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

type ExportType = "csv" | "excel" | "pdf";

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

function tableCell(value: string | number | undefined | null) {
  return String(value ?? "").replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char] ?? char));
}

function buildInventoryTable(rows: CriminalCaseRow[]) {
  const headers = ["Control No.", "Client", "Status", "Barangay", "Category", "Date", "Termination", "Staff"];
  const body = rows
    .map(({ record, clientName }) => {
      const termination = record.cases.is_terminated || record.cases.status_of_case === "Terminated" ? "Terminated" : "Active";
      const staff = record.created_by_user_id === null ? "Unassigned" : `User #${record.created_by_user_id}`;
      return `<tr><td>${tableCell(record.intake_record.control_no)}</td><td>${tableCell(clientName)}</td><td>${tableCell(record.cases.status_of_case)}</td><td>${tableCell(record.cases.incident_barangay)}</td><td>${tableCell(record.cases.cause_of_action || record.intake_record.nature_of_case)}</td><td>${tableCell(record.intake_record.form_date || record.last_updated)}</td><td>${tableCell(termination)}</td><td>${tableCell(staff)}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8" /><style>body{font-family:Arial,sans-serif;color:#2B3642}table{border-collapse:collapse;width:100%}th{background:#E9EEF3;text-transform:uppercase;letter-spacing:.04em}th,td{border:1px solid #D6DEE7;padding:8px;font-size:12px}</style></head><body><h2>JurisGuard Criminal Cases Export</h2><table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></body></html>`;
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

  const handleExport = () => {
    if (exportRows.length === 0) {
      toast.error("No records match the selected export filters.");
      return;
    }
    const toastId = toast.loading("Preparing report export...");
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      if (exportType === "csv") {
        const csv = buildCriminalCasesCsv(rows, filters);
        downloadCsv(`jurisguard-criminal-cases_${stamp}.csv`, csv);
      } else if (exportType === "excel") {
        downloadText(`jurisguard-criminal-cases_${stamp}.xls`, buildInventoryTable(exportRows), "application/vnd.ms-excel;charset=utf-8");
      } else {
        const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1100,height=800");
        if (!printWindow) throw new Error("Popup blocked. Allow popups to export PDF.");
        printWindow.document.write(buildInventoryTable(exportRows));
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      }
      addLog({
        userId: user?.user_id,
        user: user?.full_name || user?.email,
        action: exportType === "csv" ? "Export CSV" : exportType === "excel" ? "Export Excel" : "Export PDF",
        module: "Export",
        description: `${user?.full_name || user?.email || "User"} exported ${exportRows.length} criminal case record${exportRows.length === 1 ? "" : "s"} as ${exportType.toUpperCase()}`,
        entityType: "criminal_case_export",
        entityId: new Date().toISOString(),
      });
      addNotification({
        type: "export_completed",
        userId: user?.user_id,
        title: "Report Export",
        message: `${exportType.toUpperCase()} exported`,
        redirectTo: "/criminal-cases",
        entityType: "criminal_case_export",
        entityId: new Date().toISOString(),
      });
      toast.success("Report exported", { id: toastId });
      onClose();
    } catch {
      toast.error("Failed export", { id: toastId });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm transition-opacity duration-200">
      <div className="w-full max-w-3xl animate-[modalIn_200ms_ease-out] overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-xl">
        <div className="flex items-center justify-between gap-4 border-b border-[#E5E7EB] bg-[#F8FAFC] px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-[#2B3642]">Advanced Criminal Cases Export</h2>
            <p className="mt-1 text-sm text-[#4B5563]">
              Filter legal records and export to CSV, Excel, or print-ready PDF.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-[#4B5563] transition duration-200 hover:bg-white hover:text-[#2B3642]"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 bg-white px-6 py-5">
          <div className="grid gap-3 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3 sm:grid-cols-3">
            {(["csv", "excel", "pdf"] as ExportType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setExportType(type)}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold uppercase ${
                  exportType === type
                    ? "border-[#4A7FB0] bg-[#4A7FB0] text-white"
                    : "border-[#D1D5DB] bg-white text-[#2B3642] hover:bg-[#F3F7FB]"
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-sm font-medium text-[#2B3642]">Case Status</span>
            <select
              value={filters.status}
              onChange={(event) => updateFilter("status", event.target.value)}
              className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#4A7FB0] focus:ring-2 focus:ring-[#4A7FB0]/20"
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
              <span className="text-sm font-medium text-[#2B3642]">Date From</span>
              <input
                type="date"
                value={filters.date_from}
                onChange={(event) => updateFilter("date_from", event.target.value)}
                className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#4A7FB0] focus:ring-2 focus:ring-[#4A7FB0]/20"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#2B3642]">Date To</span>
              <input
                type="date"
                value={filters.date_to}
                onChange={(event) => updateFilter("date_to", event.target.value)}
                className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#4A7FB0] focus:ring-2 focus:ring-[#4A7FB0]/20"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-[#2B3642]">Location Type</span>
            <select
              value={filters.location_type}
              onChange={(event) => updateFilter("location_type", event.target.value)}
              className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#4A7FB0] focus:ring-2 focus:ring-[#4A7FB0]/20"
            >
              <option>All</option>
              <option>Urban</option>
              <option>Rural</option>
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-[#2B3642]">Barangay</span>
              <select value={filters.barangay} onChange={(event) => updateFilter("barangay", event.target.value)} className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#4A7FB0] focus:ring-2 focus:ring-[#4A7FB0]/20">
                <option>All</option>
                {options.barangays.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#2B3642]">Case Category</span>
              <select value={filters.case_category} onChange={(event) => updateFilter("case_category", event.target.value)} className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#4A7FB0] focus:ring-2 focus:ring-[#4A7FB0]/20">
                <option>All</option>
                {options.categories.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#2B3642]">Staff</span>
              <select value={filters.staff} onChange={(event) => updateFilter("staff", event.target.value)} className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#4A7FB0] focus:ring-2 focus:ring-[#4A7FB0]/20">
                <option>All</option>
                {options.staff.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#2B3642]">Termination Status</span>
              <select value={filters.termination_status} onChange={(event) => updateFilter("termination_status", event.target.value)} className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#4A7FB0] focus:ring-2 focus:ring-[#4A7FB0]/20">
                <option>All</option>
                <option>Active</option>
                <option>Terminated</option>
              </select>
            </label>
          </div>

          <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#4B5563]">
            {exportRows.length} record{exportRows.length === 1 ? "" : "s"} will be exported.
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-between border-t border-[#E5E7EB] bg-[#F8FAFC] px-6 py-4">
          <button
            type="button"
            onClick={() => setFilters(initialFilters)}
            className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-[#4B5563] transition duration-200 hover:bg-[#F8FAFC]"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="rounded-md bg-[#4A7FB0] px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-[#3E6D97]"
          >
            Export {exportType.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
