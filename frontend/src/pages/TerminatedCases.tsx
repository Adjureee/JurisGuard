import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import MainLayout from "../layouts/MainLayout";
import { listCaseRecords, listClientRecords } from "../services/recordService";
import type { ClientRecord, CriminalCaseRecord } from "../types";

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function csvEscape(value: string | number | null | undefined) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function DetailField({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-[#111827]">{value || "-"}</p>
    </div>
  );
}

type TerminatedSortColumn = "client" | "title" | "reason" | "date" | "status";

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
      className="inline-flex items-center gap-1 font-semibold text-[#374151] hover:text-[#111827]"
    >
      {label}
      <span className="text-[10px]">{sortBy === column ? (sortDirection === "asc" ? "UP" : "DOWN") : ""}</span>
    </button>
  );
}

export default function TerminatedCasesPage() {
  const [cases, setCases] = useState<CriminalCaseRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [search, setSearch] = useState("");
  const [resolutionFilter, setResolutionFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedRecord, setSelectedRecord] = useState<CriminalCaseRecord | null>(null);
  const [sortBy, setSortBy] = useState<TerminatedSortColumn>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const pageSize = 8;

  useEffect(() => {
    let cancelled = false;
    async function loadRecords() {
      try {
        const [clientRows, caseRows] = await Promise.all([listClientRecords(), listCaseRecords()]);
        if (!cancelled) {
          setClients(clientRows);
          setCases(
            caseRows.filter(
              (record) => record.cases.is_terminated || record.cases.status_of_case === "Terminated"
            )
          );
        }
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Unable to load terminated cases");
      }
    }
    void loadRecords();
    return () => {
      cancelled = true;
    };
  }, []);

  const clientById = useMemo(
    () => new Map(clients.map((client) => [client.client_id, client])),
    [clients]
  );
  const resolutionOptions = useMemo(
    () =>
      Array.from(
        new Set(cases.map((record) => record.cases.resolution_type).filter(Boolean) as string[])
      ).sort(),
    [cases]
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
      if (resolutionFilter !== "all" && record.cases.resolution_type !== resolutionFilter) return false;
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
              ? left.cases.termination_reason ?? ""
              : sortBy === "status"
                ? left.cases.status_of_case
                : left.cases.terminated_at ?? "";
      const rightValue =
        sortBy === "client"
          ? rightClient
          : sortBy === "title"
            ? right.cases.title_of_case
            : sortBy === "reason"
              ? right.cases.termination_reason ?? ""
              : sortBy === "status"
                ? right.cases.status_of_case
                : right.cases.terminated_at ?? "";
      const result = String(leftValue).localeCompare(String(rightValue));
      return sortDirection === "asc" ? result : -result;
    });
  }, [cases, clientById, resolutionFilter, search, sortBy, sortDirection]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const exportCsv = () => {
    const header = [
      "Client name",
      "Case title",
      "Termination reason",
      "Date terminated",
      "Terminated by",
      "Status",
    ];
    const lines = filteredRows.map((record) =>
      [
        clientById.get(record.client_id)?.client.name ?? "Unknown client",
        record.cases.title_of_case,
        record.cases.termination_reason,
        record.cases.terminated_at,
        record.cases.handled_by,
        record.cases.status_of_case,
      ]
        .map(csvEscape)
        .join(",")
    );
    const blob = new Blob([[header.map(csvEscape).join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "terminated-cases.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const changeSort = (column: TerminatedSortColumn) => {
    setSortBy(column);
    setSortDirection((current) => (sortBy === column && current === "asc" ? "desc" : "asc"));
  };

  return (
    <MainLayout>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#2F80ED]">Case Archive</p>
          <h1 className="text-2xl font-semibold text-[#111827]">Terminated Cases</h1>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="h-10 rounded-md bg-[#2F80ED] px-4 text-sm font-semibold text-white transition hover:bg-[#1f6fd6]"
        >
          Export CSV
        </button>
      </div>

      <section className="rounded-lg border border-[#E5E7EB] bg-white shadow-sm shadow-[#111827]/10">
        <div className="grid gap-3 border-b border-[#E5E7EB] px-5 py-4 md:grid-cols-[1fr_220px]">
          <input
            type="text"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search terminated cases..."
            className="h-10 rounded-md border border-[#D1D5DB] px-3 text-sm outline-none focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/15"
          />
          <select
            value={resolutionFilter}
            onChange={(event) => {
              setResolutionFilter(event.target.value);
              setPage(1);
            }}
            className="h-10 rounded-md border border-[#D1D5DB] bg-white px-3 text-sm outline-none focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/15"
          >
            <option value="all">All resolutions</option>
            {resolutionOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b border-[#E5E7EB] bg-[#F3F4F6] text-[#374151]">
              <tr>
                <th className="px-5 py-3 text-left"><SortHeader column="client" label="Client Name" sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /></th>
                <th className="px-5 py-3 text-left"><SortHeader column="title" label="Case Title" sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /></th>
                <th className="px-5 py-3 text-left"><SortHeader column="reason" label="Termination Reason" sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /></th>
                <th className="px-5 py-3 text-left"><SortHeader column="date" label="Date Terminated" sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /></th>
                <th className="px-5 py-3 text-left font-semibold">Terminated By</th>
                <th className="px-5 py-3 text-left"><SortHeader column="status" label="Status" sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /></th>
                <th className="px-5 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-[#6B7280]">
                    No terminated cases found.
                  </td>
                </tr>
              ) : (
                pageRows.map((record) => (
                  <tr key={record.case_id} className="bg-white hover:bg-gray-50">
                    <td className="px-5 py-4 font-medium text-[#111827]">
                      {clientById.get(record.client_id)?.client.name ?? "Unknown client"}
                    </td>
                    <td className="px-5 py-4 text-[#111827]/80">{record.cases.title_of_case || "-"}</td>
                    <td className="px-5 py-4 text-[#111827]/80">{record.cases.termination_reason || "-"}</td>
                    <td className="px-5 py-4 text-[#111827]/80">{formatDate(record.cases.terminated_at)}</td>
                    <td className="px-5 py-4 text-[#111827]/80">{record.cases.handled_by || "-"}</td>
                    <td className="px-5 py-4">
                      <span className="rounded-full bg-[#FEE2E2] px-2.5 py-1 text-xs font-semibold text-[#991B1B]">
                        {record.cases.status_of_case}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedRecord(record)}
                        className="rounded-md border border-[#111827] bg-white px-3 py-1.5 text-xs font-semibold text-[#111827] transition hover:bg-[#111827] hover:text-white"
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E7EB] px-5 py-4">
          <p className="text-sm text-[#6B7280]">
            Page {page} of {totalPages} - {filteredRows.length} records
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              className="rounded-md border border-[#D1D5DB] bg-white px-3 py-1.5 text-sm font-medium text-[#6B7280] disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page === totalPages}
              className="rounded-md border border-[#D1D5DB] bg-white px-3 py-1.5 text-sm font-medium text-[#6B7280] disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827]/45 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
              <h2 className="text-base font-semibold text-[#111827]">Terminated Case Details</h2>
              <button type="button" onClick={() => setSelectedRecord(null)} className="rounded-md px-3 py-1.5 text-sm font-semibold text-[#6B7280] hover:bg-[#F3F4F6]">
                Close
              </button>
            </div>
            <div className="grid gap-3 overflow-y-auto p-5 md:grid-cols-2">
              <DetailField label="Client Name" value={clientById.get(selectedRecord.client_id)?.client.name} />
              <DetailField label="Case Title" value={selectedRecord.cases.title_of_case} />
              <DetailField label="Case Number" value={selectedRecord.cases.case_no} />
              <DetailField label="Resolution Type" value={selectedRecord.cases.resolution_type} />
              <DetailField label="Termination Reason" value={selectedRecord.cases.termination_reason} />
              <DetailField label="Date Terminated" value={formatDate(selectedRecord.cases.terminated_at)} />
              <DetailField label="Terminated By" value={selectedRecord.cases.handled_by} />
              <DetailField label="Status" value={selectedRecord.cases.status_of_case} />
              <div className="md:col-span-2">
                <DetailField label="Final Remarks" value={selectedRecord.cases.termination_remarks} />
              </div>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
