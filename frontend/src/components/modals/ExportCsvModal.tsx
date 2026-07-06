import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import ModalPortal from "./ModalPortal";
import { useAuth } from "../../contexts/AuthContext";
import { useAuditLogStore } from "../../features/auditLogs/auditLogStore";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import { createAuditLog } from "../../services/auditService";
import {
  buildCriminalCasesExcelHtml,
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
  gender: "All",
  ocr_status: "All",
  termination_status: "All",
};

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
  const exportRows = useMemo(() => filterCriminalCaseRows(rows, filters), [filters, rows]);
  const options = useMemo(
    () => ({
      barangays: uniqueValues(rows.map(({ record }) => record.cases.incident_barangay ?? "")),
      categories: uniqueValues(rows.map(({ record }) => record.cases.cause_of_action || record.intake_record.nature_of_case)),
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
      const action = "Export Excel";
      const description = `${user?.full_name || user?.email || "User"} exported ${exportRows.length} criminal case record${exportRows.length === 1 ? "" : "s"} as EXCEL`;
      const entityId = new Date().toISOString();
      await createAuditLog({
        action,
        module: "Export",
        description,
        entity_type: "criminal_case_export",
        entity_id: entityId,
      });
      downloadText(`jurisguard-criminal-cases_${stamp}.xls`, buildCriminalCasesExcelHtml(rows, filters), "application/vnd.ms-excel;charset=utf-8");
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
        message: "EXCEL exported",
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
      <div className="jurisguard-modal-surface w-full max-w-3xl animate-[modalIn_200ms_ease-out] overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-xl">
        <div className="flex items-center justify-between gap-4 border-b border-[#E5E7EB] bg-[#F8FAFC] px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-[#2B3642]">Advanced Criminal Cases Export</h2>
            <p className="mt-1 text-sm text-[#4B5563]">
              Filter legal records and export to Excel.
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
          <label className="block">
            <span className="text-sm font-medium text-[#2B3642]">Case Status</span>
            <select
              value={filters.status}
              onChange={(event) => updateFilter("status", event.target.value)}
              className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
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
                className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#2B3642]">Date To</span>
              <input
                type="date"
                value={filters.date_to}
                onChange={(event) => updateFilter("date_to", event.target.value)}
                className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-[#2B3642]">Location Type</span>
            <select
              value={filters.location_type}
              onChange={(event) => updateFilter("location_type", event.target.value)}
              className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
            >
              <option>All</option>
              <option>Urban</option>
              <option>Rural</option>
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-[#2B3642]">Barangay</span>
              <select value={filters.barangay} onChange={(event) => updateFilter("barangay", event.target.value)} className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20">
                <option>All</option>
                {options.barangays.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#2B3642]">Case Category</span>
              <select value={filters.case_category} onChange={(event) => updateFilter("case_category", event.target.value)} className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20">
                <option>All</option>
                {options.categories.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#2B3642]">Gender</span>
              <select value={filters.gender} onChange={(event) => updateFilter("gender", event.target.value)} className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20">
                <option>All</option>
                <option>Male</option>
                <option>Female</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#2B3642]">Termination Status</span>
              <select value={filters.termination_status} onChange={(event) => updateFilter("termination_status", event.target.value)} className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20">
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
            className="rounded-lg bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-[#5F3675]"
          >
            Export Excel
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

