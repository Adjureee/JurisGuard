import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FileScan, FileUp } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import MainLayout from "../layouts/MainLayout";
import DateFilterSelect from "../components/DateFilterSelect";
import PageHeader from "../components/PageHeader";
import AddCaseModal from "../components/modals/AddCaseModal";
import AddClientModal from "../components/modals/AddClientModal";
import {
  ScanIntakeModal,
  UploadIntakeModal,
} from "../components/modals/DedicatedPaperIntakeModals";
import ExportCsvModal from "../components/modals/ExportCsvModal";
import CaseImportModal from "../features/caseImport/CaseImportModal";
import {
  CASE_PAGE_SIZE,
  caseDateRange,
  courtFilterOptions,
  participantNames,
  toCaseListItem,
} from "../features/criminalCases/caseRecordHelpers";
import { ClientRecordModal } from "../features/criminalCases/components/ClientRecordModal";
import {
  EyeIcon,
  ManualInputSelectionModal,
  PlusIcon,
  UploadScanSelectionModal,
} from "../features/criminalCases/components/IntakeSelectionModals";
import { useCriminalCasesStore } from "../features/criminalCases/criminalCasesStore";
import type { CriminalCaseRow } from "../services/exportService";
import {
  getCaseRecord,
  getClientCases,
  getClientRecord,
  listCaseRecordsPage,
  listCaseRecordsPageForExport,
  listClientRecords,
  type CaseRecordPageFilters,
} from "../services/recordService";
import type {
  CaseListItem,
  CaseType,
  CriminalCaseRecord,
} from "../types";
import type { DateFilterValue } from "../utils/dateFilters";

interface CaseListRow {
  record: CaseListItem;
}

interface CasesPageProps {
  caseType?: CaseType;
  pageEyebrow?: string;
  pageTitle?: string;
  pageDescription?: string;
}

export default function CriminalCasesPage({
  caseType = "Criminal",
  pageEyebrow,
  pageTitle,
  pageDescription,
}: CasesPageProps = {}) {
  const { user } = useAuth();
  const canCollaborateOnCases =
    user?.role === "admin" ||
    user?.role === "staff" ||
    user?.role === "legal_staff";
  const isAdmin = user?.role === "admin";
  const clients = useCriminalCasesStore((state) => state.clients);
  const setClients = useCriminalCasesStore((state) => state.setClients);
  const upsertClient = useCriminalCasesStore((state) => state.upsertClient);
  const upsertCase = useCriminalCasesStore((state) => state.upsertCase);
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState<"All" | "Male" | "Female">(
    "All",
  );
  const [locationFilter, setLocationFilter] = useState<
    "All" | "Urban" | "Rural"
  >("All");
  const [courtFilter, setCourtFilter] = useState("All Courts");
  const [dateFilter, setDateFilter] = useState<DateFilterValue>("all");
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showManualInputModal, setShowManualInputModal] = useState(false);
  const [showUploadScanModal, setShowUploadScanModal] = useState(false);
  const [showScanWorkflowModal, setShowScanWorkflowModal] = useState(false);
  const [showUploadWorkflowModal, setShowUploadWorkflowModal] = useState(false);
  const [dashboardIntakeMode, setDashboardIntakeMode] = useState<
    "manual" | "scan" | undefined
  >();
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportRows, setExportRows] = useState<CriminalCaseRow[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [matchingCaseCount, setMatchingCaseCount] = useState(0);
  const [caseItems, setCaseItems] = useState<CaseListItem[]>([]);
  const [casePage, setCasePage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [activeClientCases, setActiveClientCases] = useState<
    CriminalCaseRecord[]
  >([]);
  const [hasLoadedClientDirectory, setHasLoadedClientDirectory] =
    useState(false);
  const [dashboardParams, setDashboardParams] = useSearchParams();
  useEffect(() => {
    const action = dashboardParams.get("action");
    if (action === "intake" || action === "client") {
      setDashboardIntakeMode(action === "intake" ? "scan" : "manual");
      setShowClientModal(true);
    }
    if (action === "case") setShowCaseModal(true);
    if (action) {
      const next = new URLSearchParams(dashboardParams);
      next.delete("action");
      setDashboardParams(next, { replace: true });
    }
  }, [dashboardParams, setDashboardParams]);
  const [actionMode, setActionMode] = useState<"view" | "update">("view");

  useEffect(() => {
    const clientId = dashboardParams.get("client");
    const caseId = dashboardParams.get("case");
    if (!clientId && !caseId) return;
    let cancelled = false;
    async function resolveRecordLink() {
      try {
        if (caseId) {
          const record = await getCaseRecord(caseId);
          const [client, relatedCases] = await Promise.all([
            getClientRecord(record.client_id),
            getClientCases(record.client_id, caseType),
          ]);
          if (cancelled) return;
          upsertClient(client);
          setActiveClientCases(relatedCases);
          setActiveClientId(record.client_id);
          setActionMode("view");
        } else if (clientId) {
          const client =
            clients.find((item) => item.client_id === clientId) ??
            (await getClientRecord(clientId));
          const relatedCases = await getClientCases(clientId, caseType);
          if (cancelled) return;
          upsertClient(client);
          setActiveClientId(clientId);
          setActiveClientCases(relatedCases);
          setActionMode("view");
        }
        if (!cancelled) {
          const next = new URLSearchParams(dashboardParams);
          next.delete("client");
          next.delete("case");
          setDashboardParams(next, { replace: true });
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Unable to open the linked record",
          );
        }
      }
    }
    void resolveRecordLink();
    return () => {
      cancelled = true;
    };
  }, [caseType, clients, dashboardParams, setDashboardParams, upsertClient]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setCasePage(1);
  }, [
    caseType,
    debouncedSearch,
    genderFilter,
    locationFilter,
    courtFilter,
    dateFilter,
  ]);

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(matchingCaseCount / CASE_PAGE_SIZE));
    if (casePage > lastPage) setCasePage(lastPage);
  }, [casePage, matchingCaseCount]);

  const dateRange = useMemo(() => caseDateRange(dateFilter), [dateFilter]);
  const caseListFilters = useMemo<CaseRecordPageFilters>(
    () => ({
      case_type: caseType,
      page: casePage,
      page_size: CASE_PAGE_SIZE,
      search: debouncedSearch,
      gender: genderFilter,
      location: locationFilter,
      court: courtFilter === "All Courts" ? "All" : courtFilter,
      ...dateRange,
    }),
    [
      casePage,
      caseType,
      dateRange,
      debouncedSearch,
      genderFilter,
      locationFilter,
      courtFilter,
    ],
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function loadCasePage() {
      setIsLoading(true);
      setLoadError("");
      try {
        const result = await listCaseRecordsPage(caseListFilters);
        if (!cancelled) {
          setCaseItems(result.items);
          setMatchingCaseCount(result.total);
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "Unable to load records";
          setLoadError(message);
          toast.error(message);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadCasePage();

    return () => {
      cancelled = true;
    };
  }, [caseListFilters, user]);

  const visibleClients = useMemo(
    () =>
      canCollaborateOnCases
        ? clients
        : clients.filter(
            (client) =>
              client.created_by_user_id === null ||
              client.created_by_user_id === user?.user_id,
          ),
    [canCollaborateOnCases, clients, user?.user_id],
  );
  const tableCases = caseItems;

  const rows = useMemo<CaseListRow[]>(
    () => tableCases.map((record) => ({ record })),
    [tableCases],
  );

  const filteredRows = rows;

  const activeClient =
    visibleClients.find((client) => client.client_id === activeClientId) ??
    null;

  const openRecord = async (record: CaseListItem, mode: "view" | "update") => {
    setActiveClientCases([]);
    try {
      const details = await getCaseRecord(record.case_id);
      const [client, relatedCases] = await Promise.all([
        getClientRecord(details.client_id),
        getClientCases(details.client_id, caseType),
      ]);
      upsertClient(client);
      setActiveClientCases(relatedCases);
      if (mode === "update" && !hasLoadedClientDirectory) {
        setClients(await listClientRecords());
        setHasLoadedClientDirectory(true);
      }
      setActionMode(mode);
      setActiveClientId(details.client_id);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to open this client record",
      );
    }
  };

  const openImportModal = async () => {
    try {
      if (!hasLoadedClientDirectory) {
        setClients(await listClientRecords());
        setHasLoadedClientDirectory(true);
      }
      setShowImportModal(true);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load clients for import",
      );
    }
  };

  const openExportModal = async () => {
    if (!isAdmin) return;
    setExportLoading(true);
    const toastId = toast.loading("Loading all matching rows for export...");
    try {
      const firstPage = await listCaseRecordsPageForExport({
        ...caseListFilters,
        page: 1,
      });
      const records = [...firstPage.items];
      const pageCount = Math.ceil(firstPage.total / CASE_PAGE_SIZE);
      for (
        let firstPageInBatch = 2;
        firstPageInBatch <= pageCount;
        firstPageInBatch += 4
      ) {
        const batch = await Promise.all(
          Array.from(
            { length: Math.min(4, pageCount - firstPageInBatch + 1) },
            (_, offset) =>
              listCaseRecordsPageForExport({
                ...caseListFilters,
                page: firstPageInBatch + offset,
              }),
          ),
        );
        batch.forEach((result) => records.push(...result.items));
      }
      const allRows = records.map((record) => {
        const client = visibleClients.find(
          (item) => item.client_id === record.client_id,
        );
        const names = participantNames(record, client);
        return {
          record,
          client,
          clientName:
            names.join(" ") || client?.client.name || "Unknown client",
        };
      });
      setExportRows(allRows);
      setShowExportModal(true);
      toast.success(`${allRows.length.toLocaleString()} matching rows ready`, {
        id: toastId,
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not load matching rows for export",
        { id: toastId },
      );
    } finally {
      setExportLoading(false);
    }
  };

  const refreshCaseListAfterSave = (record: CriminalCaseRecord) => {
    upsertCase(record);
    setCaseItems((current) =>
      current.map((item) =>
        item.case_id === record.case_id ? toCaseListItem(record) : item,
      ),
    );
    setActiveClientCases((current) =>
      current.map((item) => (item.case_id === record.case_id ? record : item)),
    );
    void listCaseRecordsPage(caseListFilters)
      .then((result) => {
        setCaseItems(result.items);
        setMatchingCaseCount(result.total);
      })
      .catch(() =>
        toast.error(
          "The case was saved, but the table could not be refreshed. Refresh the page to see the latest list.",
        ),
      );
  };

  return (
    <MainLayout>
      {/* 1. Global Height Wrapper: Locks the page to the viewport height */}
      <div className="records-workspace flex h-full max-w-full flex-col gap-4">
        {/* 2. Header Area: shrink-0 keeps it from compressing */}
        <div className="shrink-0">
          <PageHeader
            eyebrow={pageEyebrow ?? `${caseType} Cases`}
            title={pageTitle ?? `${caseType} Case Records Management`}
            description={
              pageDescription ??
              `Manage PAO Panabo client profiles, active ${caseType.toLowerCase()} case records, printable intake forms, and update workflows.`
            }
            compact
            actions={
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowManualInputModal(false);
                    setShowUploadScanModal(true);
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#704389] bg-white px-3.5 text-sm font-semibold text-[#704389] shadow-sm transition hover:bg-[#FAF7FC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]"
                >
                  <FileScan className="h-4 w-4" aria-hidden="true" />
                  Upload / Scan Input
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadScanModal(false);
                    setShowManualInputModal(true);
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#704389] px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5F3675]"
                >
                  <PlusIcon />
                  Manual Input
                </button>
              </div>
            }
          />
        </div>

        {/* 3. Main Content Card: flex-1 min-h-0 allows it to absorb remaining screen space */}
        <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col rounded-xl border border-[#CBD5E1] bg-white p-4 shadow-sm">
          {/* 4. Filters Area: shrink-0 preserves its height */}
          <div className="records-toolbar mb-3 grid min-w-0 shrink-0 gap-3 md:grid-cols-2 xl:items-end">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Search
              </span>
              <input
                type="text"
                placeholder="Search case..."
                className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none transition placeholder:text-[#4B5563] focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setCasePage(1);
                }}
              />
            </label>
            <DateFilterSelect
              value={dateFilter}
              onChange={(value) => {
                setDateFilter(value);
                setCasePage(1);
              }}
            />
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Court / Body
              </span>
              <select
                value={courtFilter}
                onChange={(event) => {
                  setCourtFilter(event.target.value);
                  setCasePage(1);
                }}
                className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none transition focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              >
                {courtFilterOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Gender
              </span>
              <select
                value={genderFilter}
                onChange={(event) => {
                  setGenderFilter(
                    event.target.value as "All" | "Male" | "Female",
                  );
                  setCasePage(1);
                }}
                aria-label="Filter by gender"
                className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none transition focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              >
                <option value="All">All Genders</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Location
              </span>
              <select
                value={locationFilter}
                onChange={(event) => {
                  setLocationFilter(
                    event.target.value as "All" | "Urban" | "Rural",
                  );
                  setCasePage(1);
                }}
                aria-label="Filter by location"
                className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none transition focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              >
                <option value="All">All Locations</option>
                <option value="Urban">Urban</option>
                <option value="Rural">Rural</option>
              </select>
            </label>
            <div className="records-toolbar-footer">
              <p className="text-sm text-[#526174]">
                Showing{" "}
                <strong className="font-semibold tabular-nums text-[#243344]">
                  {filteredRows.length
                    ? (casePage - 1) * CASE_PAGE_SIZE + 1
                    : 0}
                  –{Math.min(casePage * CASE_PAGE_SIZE, matchingCaseCount)}
                </strong>{" "}
                of{" "}
                <strong className="font-semibold tabular-nums text-[#243344]">
                  {matchingCaseCount.toLocaleString()}
                </strong>{" "}
                matching records
              </p>
              <div
                role="group"
                aria-label={
                  isAdmin ? "Excel import and export" : "Excel import"
                }
                className="records-excel-actions flex min-w-0 items-center gap-2"
              >
                {canCollaborateOnCases && (
                  <button
                    type="button"
                    onClick={() => void openImportModal()}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm font-semibold text-[#334155] transition hover:bg-[#F8FAFC]"
                  >
                    <FileUp className="h-4 w-4" aria-hidden="true" />
                    Import Excel
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => void openExportModal()}
                    disabled={exportLoading || isLoading}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[#704389] px-3.5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-[#5F3675]"
                  >
                    {exportLoading ? "Preparing export…" : "Export Excel"}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 5. Scrollable Table Container: Flex-1 fills the rest of the card perfectly */}
          <div
            tabIndex={0}
            role="region"
            aria-label="Case records table. Scroll horizontally for all columns."
            className="records-table-scroll relative min-h-0 max-w-full flex-1 overflow-auto rounded-lg border border-[#CBD5E1]"
          >
            <table className="records-table w-full min-w-[1040px] text-sm">
              <thead className="sticky top-0 z-10 border-b border-[#D1D5DB] bg-[#E5E7EB] text-xs uppercase tracking-wide text-[#374151]">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold">
                    Control No.
                  </th>
                  <th className="px-3 py-3 text-left font-semibold">
                    Party Represented
                  </th>
                  <th className="px-3 py-3 text-left font-semibold">
                    Gender / Sex
                  </th>
                  <th className="px-3 py-3 text-left font-semibold">Title</th>
                  <th className="px-3 py-3 text-left font-semibold">
                    Case No.
                  </th>
                  <th className="px-3 py-3 text-left font-semibold">
                    Court / Body
                  </th>
                  <th className="px-3 py-3 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-5 py-10 text-center text-[#2B3642]/50"
                    >
                      {isLoading
                        ? `Loading ${caseType.toLowerCase()} cases…`
                        : loadError
                          ? loadError
                          : `No ${caseType.toLowerCase()} cases found.`}
                    </td>
                  </tr>
                ) : (
                  filteredRows.map(({ record }) => {
                    const representedParties = record.participants
                      .map(
                        (participant) =>
                          participant.party_represented ||
                          participant.applicant_role ||
                          "",
                      )
                      .filter(Boolean);
                    if (
                      representedParties.length === 0 &&
                      record.party_represented
                    ) {
                      representedParties.push(record.party_represented);
                    }
                    const sexes = record.participants
                      .map((participant) => participant.sex)
                      .filter(Boolean);
                    return (
                      <tr
                        key={record.case_id}
                        className="odd:bg-white even:bg-[#F9FAFB] transition duration-200 hover:bg-[#F3F7FB]"
                      >
                        <td className="px-3 py-4 text-[#2B3642]">
                          {record.control_no}
                        </td>
                        <td className="px-3 py-4 text-[#4B5563]">
                          <div className="space-y-1">
                            {representedParties.length
                              ? representedParties.map((party, index) => (
                                  <div key={`${party}-${index}`}>{party}</div>
                                ))
                              : "-"}
                          </div>
                        </td>
                        <td className="px-3 py-4 text-[#4B5563]">
                          <div className="space-y-1">
                            {sexes.length
                              ? sexes.map((sex, index) => (
                                  <div key={`${sex}-${index}`}>{sex}</div>
                                ))
                              : "-"}
                          </div>
                        </td>
                        <td className="px-3 py-4 text-[#4B5563]">
                          {record.title_of_case}
                        </td>
                        <td className="px-3 py-4 text-[#4B5563]">
                          {record.case_no}
                        </td>
                        <td className="px-3 py-4 text-[#4B5563]">
                          {record.court_body}
                        </td>
                        <td className="px-3 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openRecord(record, "view")}
                              className="inline-flex items-center gap-1.5 rounded-md border border-[#704389] bg-white px-3 py-1.5 text-xs font-semibold text-[#704389] transition duration-200 hover:-translate-y-px hover:bg-[#704389] hover:text-white"
                            >
                              <EyeIcon />
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => openRecord(record, "update")}
                              className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#4B5563] transition duration-200 hover:-translate-y-px hover:bg-[#F8FAFC]"
                            >
                              Update
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex shrink-0 flex-col gap-2 border-t border-[#E2E8F0] pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[#526174]">
              Page {casePage.toLocaleString()} of{" "}
              {Math.max(
                1,
                Math.ceil(matchingCaseCount / CASE_PAGE_SIZE),
              ).toLocaleString()}{" "}
              · {CASE_PAGE_SIZE} records per page
            </p>
            <nav className="flex items-center gap-2" aria-label="Case record pages">
              <button
                type="button"
                onClick={() => setCasePage((page) => Math.max(1, page - 1))}
                disabled={casePage <= 1 || isLoading}
                className="inline-flex h-9 items-center rounded-md border border-[#CBD5E1] bg-white px-3 text-sm font-medium text-[#334155] transition hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setCasePage((page) => page + 1)}
                disabled={
                  casePage >= Math.ceil(matchingCaseCount / CASE_PAGE_SIZE) ||
                  isLoading
                }
                className="inline-flex h-9 items-center rounded-md border border-[#CBD5E1] bg-white px-3 text-sm font-medium text-[#334155] transition hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </nav>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showManualInputModal && (
        <ManualInputSelectionModal
          caseType={caseType}
          onClose={() => setShowManualInputModal(false)}
          onSelectCase={() => {
            setShowManualInputModal(false);
            setShowCaseModal(true);
          }}
          onSelectClient={() => {
            setShowManualInputModal(false);
            setDashboardIntakeMode("manual");
            setShowClientModal(true);
          }}
        />
      )}
      {showUploadScanModal && (
        <UploadScanSelectionModal
          onClose={() => setShowUploadScanModal(false)}
          onSelectScan={() => {
            setShowUploadScanModal(false);
            setShowUploadWorkflowModal(false);
            setShowScanWorkflowModal(true);
          }}
          onSelectUpload={() => {
            setShowUploadScanModal(false);
            setShowScanWorkflowModal(false);
            setShowUploadWorkflowModal(true);
          }}
        />
      )}
      {showScanWorkflowModal && (
        <ScanIntakeModal onClose={() => setShowScanWorkflowModal(false)} />
      )}
      {showUploadWorkflowModal && (
        <UploadIntakeModal onClose={() => setShowUploadWorkflowModal(false)} />
      )}
      <AddClientModal
        isOpen={showClientModal}
        initialMode={dashboardIntakeMode}
        onClose={() => {
          setShowClientModal(false);
          setDashboardIntakeMode(undefined);
        }}
      />
      <AddCaseModal
        isOpen={showCaseModal}
        onClose={() => setShowCaseModal(false)}
        caseType={caseType}
      />
      <ExportCsvModal
        isOpen={isAdmin && showExportModal}
        rows={exportRows}
        caseType={caseType}
        onClose={() => setShowExportModal(false)}
      />
      {canCollaborateOnCases && showImportModal && (
        <CaseImportModal
          caseType={caseType}
          existingClients={visibleClients}
          onClose={() => setShowImportModal(false)}
          onImported={async () => {
            const [clientRows, caseResult] = await Promise.all([
              listClientRecords(),
              listCaseRecordsPage(caseListFilters),
            ]);
            setClients(clientRows);
            setHasLoadedClientDirectory(true);
            setCaseItems(caseResult.items);
            setMatchingCaseCount(caseResult.total);
          }}
        />
      )}
      <ClientRecordModal
        mode={actionMode}
        caseType={caseType}
        client={activeClient}
        cases={activeClientCases}
        clients={visibleClients}
        onClose={() => {
          setActiveClientId(null);
          setActiveClientCases([]);
        }}
        onClientUpdated={upsertClient}
        onCaseUpdated={refreshCaseListAfterSave}
        onCaseTerminated={refreshCaseListAfterSave}
        onCreateClient={() => setShowClientModal(true)}
      />
    </MainLayout>
  );
}
