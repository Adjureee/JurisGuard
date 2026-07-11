import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";
import DateFilterSelect from "../components/DateFilterSelect";
import PageHeader from "../components/PageHeader";
import ModalPortal from "../components/modals/ModalPortal";
import { listCaseRecords, listClientRecords } from "../services/recordService";
import type { ClientRecord, CriminalCaseRecord } from "../types";
import {
  buildCriminalCasesExcelHtml,
  type CriminalCaseExportFilterDto,
  type CriminalCaseRow,
} from "../services/exportService";
import {
  matchesDateFilter,
  type DateFilterValue,
} from "../utils/dateFilters";

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    date,
  );
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

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-[#2B3642]">
        {value || "-"}
      </p>
    </div>
  );
}

type TerminatedSortColumn = "client" | "title" | "reason" | "date" | "status";

const terminatedExportFilters: CriminalCaseExportFilterDto = {
  status: "All",
  date_from: "",
  date_to: "",
  location_type: "All",
  barangay: "All",
  case_category: "All",
  gender: "All",
  staff: "All",
  ocr_status: "All",
  termination_status: "All",
};

function SortHeader({
  column,
  label,
  sortBy,
  sortDirection,
  onSort,
}: {
  column: TerminatedSortColumn;
  label: string;
  sortBy: TerminatedSortColumn;
  sortDirection: "asc" | "desc";
  onSort: (column: TerminatedSortColumn) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className="inline-flex items-center gap-1 font-semibold leading-none text-[#4B5563] hover:text-[#2B3642]"
    >
      {label}
      <span className="text-[10px] leading-none">
        {sortBy === column ? (sortDirection === "asc" ? "UP" : "DOWN") : ""}
      </span>
    </button>
  );
}

export default function TerminatedCasesPage() {
  const navigate = useNavigate();
  const [cases, setCases] = useState<CriminalCaseRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [search, setSearch] = useState("");
  const [resolutionFilter, setResolutionFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilterValue>("all");
  const [selectedRecord, setSelectedRecord] =
    useState<CriminalCaseRecord | null>(null);
  const [sortBy, setSortBy] = useState<TerminatedSortColumn>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    async function loadRecords() {
      try {
        const [clientRows, caseRows] = await Promise.all([
          listClientRecords(),
          listCaseRecords(),
        ]);
        if (!cancelled) {
          setClients(clientRows);
          setCases(
            caseRows.filter(
              (record) =>
                record.cases.is_terminated ||
                record.cases.status_of_case === "Terminated",
            ),
          );
        }
      } catch (error) {
        if (!cancelled)
          toast.error(
            error instanceof Error
              ? error.message
              : "Unable to load terminated cases",
          );
      }
    }
    void loadRecords();
    return () => {
      cancelled = true;
    };
  }, []);

  const clientById = useMemo(
    () => new Map(clients.map((client) => [client.client_id, client])),
    [clients],
  );
  const resolutionOptions = useMemo(
    () =>
      Array.from(
        new Set(
          cases
            .map((record) => record.cases.resolution_type)
            .filter(Boolean) as string[],
        ),
      ).sort(),
    [cases],
  );
  const filteredRows = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const rows = cases.filter((record) => {
      const clientName = clientById.get(record.client_id)?.client.name ?? "";
      const haystack = [
        clientName,
        record.cases.title_of_case,
        record.cases.termination_reason,
        record.cases.termination_remarks,
        record.cases.handled_by,
      ]
        .join(" ")
        .toLowerCase();
      if (normalized && !haystack.includes(normalized)) return false;
      if (
        resolutionFilter !== "all" &&
        record.cases.resolution_type !== resolutionFilter
      )
        return false;
      if (
        !matchesDateFilter(
          record.cases.terminated_at ||
            record.cases.date_of_termination ||
            record.last_updated,
          dateFilter,
        )
      )
        return false;
      return true;
    });
    return rows.sort((left, right) => {
      const leftClient = clientById.get(left.client_id)?.client.name ?? "";
      const rightClient = clientById.get(right.client_id)?.client.name ?? "";
      const leftValue =
        sortBy === "client"
          ? leftClient
          : sortBy === "title"
            ? left.cases.title_of_case
            : sortBy === "reason"
              ? (left.cases.termination_reason ?? "")
              : sortBy === "status"
                ? left.cases.status_of_case
                : (left.cases.terminated_at ?? "");
      const rightValue =
        sortBy === "client"
          ? rightClient
          : sortBy === "title"
            ? right.cases.title_of_case
            : sortBy === "reason"
              ? (right.cases.termination_reason ?? "")
              : sortBy === "status"
                ? right.cases.status_of_case
                : (right.cases.terminated_at ?? "");
      const result = String(leftValue).localeCompare(String(rightValue));
      return sortDirection === "asc" ? result : -result;
    });
  }, [
    cases,
    clientById,
    dateFilter,
    resolutionFilter,
    search,
    sortBy,
    sortDirection,
  ]);
  const exportRows = useMemo<CriminalCaseRow[]>(
    () =>
      filteredRows.map((record) => {
        const client = clientById.get(record.client_id);
        return {
          record,
          client,
          clientName: client?.client.name ?? "Unknown client",
        };
      }),
    [clientById, filteredRows],
  );

  const exportExcel = () => {
    downloadText(
      "terminated-cases.xls",
      buildCriminalCasesExcelHtml(exportRows, terminatedExportFilters),
      "application/vnd.ms-excel;charset=utf-8",
    );
  };

  const changeSort = (column: TerminatedSortColumn) => {
    setSortBy(column);
    setSortDirection((current) =>
      sortBy === column && current === "asc" ? "desc" : "asc",
    );
  };

return (
    <MainLayout>
      <div className="flex h-[calc(100vh-110px)] min-w-0 max-w-full flex-col gap-4 overflow-hidden">
        <div className="shrink-0">
          <PageHeader
            eyebrow="Case Archive"
            title="Terminated Cases"
            description="Review closed criminal case records, termination reasons, archive details, and official export outputs."
            compact
          />
        </div>

      <section className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col rounded-xl border border-[#CBD5E1] bg-white p-4 shadow-sm">
        {/* Filters remain fixed at the top of the section */}
        <div className="mb-3 grid shrink-0 gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,360px)_200px_190px_auto_auto] xl:items-end">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
              Search
            </span>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search terminated cases..."
              className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] px-3 text-sm outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
              Resolution
            </span>
            <select
              value={resolutionFilter}
              onChange={(event) => setResolutionFilter(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
            >
              <option value="all">All resolutions</option>
              {resolutionOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <DateFilterSelect
            value={dateFilter}
            onChange={setDateFilter}
          />
          <div className="flex h-9 items-center gap-2 rounded-md border border-[#D1D5DB] bg-[#F8FAFC] px-3">
            <span className="font-semibold text-[#4B5563]">Total:</span>
            <span className="rounded-md bg-[#704389] px-2.5 py-1 text-base font-semibold leading-none text-white">
              {filteredRows.length}
            </span>
          </div>
          <button
            type="button"
            onClick={exportExcel}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[#704389] px-3.5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-[#5F3675]"
          >
            Export Excel
          </button>
        </div>

        {/* NEW: Scrollable Table Container */}
        <div className="relative min-h-0 max-w-full flex-1 overflow-y-auto overflow-x-auto rounded-lg border border-[#CBD5E1]">
          <table className="w-full min-w-[980px] text-sm">
            {/* NEW: Sticky Table Header */}
            <thead className="sticky top-0 z-10 border-b border-[#D1D5DB] bg-[#E5E7EB] text-xs uppercase tracking-wide text-[#374151]">
              <tr>
                <th className="px-3 py-3 text-left font-semibold">
                  <SortHeader
                    column="client"
                    label="Client Name"
                    sortBy={sortBy}
                    sortDirection={sortDirection}
                    onSort={changeSort}
                  />
                </th>
                <th className="px-3 py-3 text-left font-semibold">
                  <SortHeader
                    column="title"
                    label="Case Title"
                    sortBy={sortBy}
                    sortDirection={sortDirection}
                    onSort={changeSort}
                  />
                </th>
                <th className="px-3 py-3 text-left font-semibold">
                  <SortHeader
                    column="reason"
                    label="Termination Reason"
                    sortBy={sortBy}
                    sortDirection={sortDirection}
                    onSort={changeSort}
                  />
                </th>
                <th className="px-3 py-3 text-left font-semibold">
                  <SortHeader
                    column="date"
                    label="Date Terminated"
                    sortBy={sortBy}
                    sortDirection={sortDirection}
                    onSort={changeSort}
                  />
                </th>
                <th className="px-3 py-3 text-left font-semibold">
                  Terminated By
                </th>
                <th className="px-3 py-3 text-left font-semibold">
                  <SortHeader
                    column="status"
                    label="Status"
                    sortBy={sortBy}
                    sortDirection={sortDirection}
                    onSort={changeSort}
                  />
                </th>
                <th className="px-3 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center text-[#2B3642]/50"
                  >
                    No terminated cases found.
                  </td>
                </tr>
              ) : (
                filteredRows.map((record) => (
                  <tr
                    key={record.case_id}
                    className="odd:bg-white even:bg-[#F9FAFB] hover:bg-[#F3F7FB]"
                  >
                    <td className="px-3 py-4 font-medium text-[#2B3642]">
                      {clientById.get(record.client_id)?.client.name ??
                        "Unknown client"}
                    </td>
                    <td className="px-3 py-4 text-[#4B5563]">
                      {record.cases.title_of_case || "-"}
                    </td>
                    <td className="px-3 py-4 text-[#4B5563]">
                      {record.cases.termination_reason || "-"}
                    </td>
                    <td className="px-3 py-4 text-[#4B5563]">
                      {formatDate(record.cases.terminated_at)}
                    </td>
                    <td className="px-3 py-4 text-[#4B5563]">
                      {record.cases.handled_by || "-"}
                    </td>
                    <td className="px-3 py-4">
                      <span className="rounded-full bg-[#FEE2E2] px-2.5 py-1 text-xs font-semibold text-[#991B1B]">
                        {record.cases.status_of_case}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedRecord(record)}
                        className="rounded-md border border-[#704389] bg-white px-3 py-1.5 text-xs font-semibold text-[#704389] transition hover:bg-[#704389] hover:text-white"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </section>
      </div>

      {/* Modal logic remains completely untouched */}
      {selectedRecord && (
        <ModalPortal>
        <div className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="jurisguard-modal-surface max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
              <h2 className="text-base font-bold text-[#2B3642]">
                Terminated Case Details
              </h2>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="rounded-md px-3 py-1.5 text-sm font-semibold text-[#4B5563] hover:bg-[#F8FAFC]"
              >
                Close
              </button>
            </div>
            <div className="grid gap-3 overflow-y-auto p-5 md:grid-cols-2">
              <DetailField
                label="Client Name"
                value={clientById.get(selectedRecord.client_id)?.client.name}
              />
              <DetailField
                label="Case Title"
                value={selectedRecord.cases.title_of_case}
              />
              <DetailField
                label="Case Number"
                value={selectedRecord.cases.case_no}
              />
              <DetailField
                label="Resolution Type"
                value={selectedRecord.cases.resolution_type}
              />
              <DetailField
                label="Termination Reason"
                value={selectedRecord.cases.termination_reason}
              />
              <DetailField
                label="Date Terminated"
                value={formatDate(selectedRecord.cases.terminated_at)}
              />
              <DetailField
                label="Terminated By"
                value={selectedRecord.cases.handled_by}
              />
              <DetailField
                label="Status"
                value={selectedRecord.cases.status_of_case}
              />
              <div className="md:col-span-2">
                <DetailField
                  label="Final Remarks"
                  value={selectedRecord.cases.termination_remarks}
                />
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
              <button
                type="button"
                onClick={() =>
                  navigate(
                    `/criminal-cases/form-view/${selectedRecord.case_id}`,
                  )
                }
                className="rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] transition hover:bg-[#F7F0FA]"
              >
                View Form
              </button>
              <button
                type="button"
                onClick={() =>
                  navigate(
                    `/criminal-cases/form-view/${selectedRecord.case_id}?autoPrint=1`,
                  )
                }
                className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#5F3675]"
              >
                Print Form
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </MainLayout>
  );
}
