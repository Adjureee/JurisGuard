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
};

export default function ExportCsvModal({ isOpen, rows, onClose }: ExportCsvModalProps) {
  const { user } = useAuth();
  const addLog = useAuditLogStore((state) => state.addLog);
  const addNotification = useNotificationStore((state) => state.addNotification);
  const [filters, setFilters] = useState<CriminalCaseExportFilterDto>(initialFilters);
  const exportRows = useMemo(() => filterCriminalCaseRows(rows, filters), [filters, rows]);

  if (!isOpen) return null;

  const updateFilter = (key: keyof CriminalCaseExportFilterDto, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleExport = () => {
    const toastId = toast.loading("Preparing CSV export...");
    try {
      const csv = buildCriminalCasesCsv(rows, filters);
      downloadCsv("jurisguard-criminal-cases.csv", csv);
      addLog({
        userId: user?.user_id,
        user: user?.full_name || user?.email,
        action: "Export CSV",
        module: "Export",
        description: `Exported ${exportRows.length} criminal case record${exportRows.length === 1 ? "" : "s"}`,
        entityType: "criminal_case_export",
        entityId: new Date().toISOString(),
      });
      addNotification({
        type: "export_completed",
        userId: user?.user_id,
        title: "CSV Export",
        message: "CSV exported",
        redirectTo: "/criminal-cases",
        entityType: "criminal_case_export",
        entityId: new Date().toISOString(),
      });
      toast.success("CSV exported", { id: toastId });
      onClose();
    } catch {
      toast.error("Failed export", { id: toastId });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827]/30 px-4 py-6 backdrop-blur-sm transition-opacity duration-200">
      <div className="w-full max-w-xl animate-[modalIn_200ms_ease-out] overflow-hidden rounded-lg border border-[#E5E7EB] bg-white shadow-2xl shadow-[#111827]/10">
        <div className="flex items-center justify-between gap-4 border-b border-[#E5E7EB] bg-[#F3F4F6] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Export Criminal Cases</h2>
            <p className="mt-1 text-sm text-[#6B7280]">
              Export filtered case records to CSV.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-[#6B7280] transition duration-200 hover:bg-white hover:text-[#111827]"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 bg-white px-6 py-5">
          <label className="block">
            <span className="text-sm font-medium text-[#111827]/80">Case Status</span>
            <select
              value={filters.status}
              onChange={(event) => updateFilter("status", event.target.value)}
              className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition duration-200 focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/15"
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
              <span className="text-sm font-medium text-[#111827]/80">Date From</span>
              <input
                type="date"
                value={filters.date_from}
                onChange={(event) => updateFilter("date_from", event.target.value)}
                className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition duration-200 focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/15"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#111827]/80">Date To</span>
              <input
                type="date"
                value={filters.date_to}
                onChange={(event) => updateFilter("date_to", event.target.value)}
                className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition duration-200 focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/15"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-[#111827]/80">Location Type</span>
            <select
              value={filters.location_type}
              onChange={(event) => updateFilter("location_type", event.target.value)}
              className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition duration-200 focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/15"
            >
              <option>All</option>
              <option>Urban</option>
              <option>Rural</option>
            </select>
          </label>

          <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-sm text-[#6B7280]">
            {exportRows.length} record{exportRows.length === 1 ? "" : "s"} will be exported.
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-between border-t border-[#E5E7EB] bg-[#F3F4F6] px-6 py-4">
          <button
            type="button"
            onClick={() => setFilters(initialFilters)}
            className="rounded-md border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-medium text-[#6B7280] transition duration-200 hover:bg-gray-50"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="rounded-md bg-[#2F80ED] px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-[#1f6fd6]"
          >
            Export CSV
          </button>
        </div>
      </div>
    </div>
  );
}
