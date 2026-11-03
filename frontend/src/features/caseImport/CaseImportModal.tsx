import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, FileUp, LoaderCircle, Trash2, Upload } from "lucide-react";
import toast from "react-hot-toast";
import ModalPortal from "../../components/modals/ModalPortal";
import {
  importCaseRecords,
  previewCaseImport,
  caseImportErrorMessage,
  type CaseImportPreview,
  type CaseImportResult,
  type CaseImportReviewCase,
} from "../../services/caseImportService";
import type { CaseType, ClientRecord } from "../../types";
import {
  applicantRoleOptions,
  civilStatusOptions,
  educationalAttainmentOptions,
  languageDialectOptions,
  relationshipOptions,
  religionOptions,
  sexOptions,
} from "../criminalCases/clientFieldOptions";

interface CaseImportModalProps {
  caseType: CaseType;
  existingClients: ClientRecord[];
  onClose: () => void;
  onImported: () => Promise<void>;
}

type ModalPhase = "upload" | "extracting" | "review" | "importing" | "complete";
const REVIEW_PAGE_SIZE = 20;

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toDateInput(value: string) {
  if (!value || isReviewNA(value)) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function isReviewNA(value: unknown) {
  return typeof value === "string" && value.trim().toUpperCase() === "NA";
}

function isMissingReviewValue(value: unknown) {
  return value == null || (typeof value === "string" && (!value.trim() || isReviewNA(value)));
}

const caseIssueCache = new WeakMap<CaseImportReviewCase, string[]>();

function isRecognizedOption(value: string, options: string[]) {
  return options.some((option) => option.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
}

function caseIssues(entry: CaseImportReviewCase) {
  const cached = caseIssueCache.get(entry);
  if (cached) return cached;
  const issues: string[] = [];
  if (isMissingReviewValue(entry.control_no) || entry.control_no.length > 20) issues.push("Control Number is required (20 characters maximum).");
  if (isMissingReviewValue(entry.title) || entry.title.length > 255) issues.push("Title of the Case is required (255 characters maximum).");
  if (entry.court.length > 255) issues.push("Court / Body must be 255 characters or fewer.");
  if (entry.case_no.length > 20) issues.push("Case Number must be 20 characters or fewer.");
  if (isMissingReviewValue(entry.case_received) || !toDateInput(entry.case_received)) issues.push("A valid Case Received date is required.");
  if (!isMissingReviewValue(entry.date_of_termination) && !toDateInput(entry.date_of_termination)) issues.push("Date of Termination is invalid.");
  if (!isMissingReviewValue(entry.date_of_confinement) && !toDateInput(entry.date_of_confinement)) issues.push("Date of Confinement is invalid.");
  if (!["Pending", "Terminated"].includes(entry.status)) issues.push("Choose a valid case status.");
  if (entry.duplicate) issues.push(entry.duplicate_message || "Possible duplicate Control Number.");
  if (entry.errors.some((error) => error.startsWith("Conflicting")) && !entry.conflict_reviewed) {
    issues.push("Review and confirm the conflicting shared case information.");
  }
  if (!entry.clients.length) issues.push("At least one client is required.");
  entry.clients.forEach((client, index) => {
    const creatingClient = !client.existing_client_id;
    if (creatingClient && (isMissingReviewValue(client.client_name) || client.client_name.length > 255)) issues.push(`Client ${index + 1}: enter a client name (255 characters maximum) or select an existing client.`);
    if (!isMissingReviewValue(client.sex) && !["m", "male", "f", "female"].includes(client.sex.trim().toLowerCase())) issues.push(`Client ${index + 1}: gender/sex must be Male or Female when provided.`);
    if (client.party_represented.length > 100) issues.push(`Client ${index + 1}: Party Represented must be 100 characters or fewer.`);
    if (creatingClient && isMissingReviewValue(client.sex)) issues.push(`Client ${index + 1}: gender/sex is required for a new client.`);
    if (!isMissingReviewValue(client.sex) && !isRecognizedOption(client.sex, sexOptions)) issues.push(`Client ${index + 1}: choose a recognized Gender / Sex option.`);
    if (creatingClient && isMissingReviewValue(client.age)) issues.push(`Client ${index + 1}: age is required for a new client.`);
    if (!isMissingReviewValue(client.age) && (!Number.isInteger(Number(client.age)) || Number(client.age) < 0 || Number(client.age) > 150)) {
      issues.push(`Client ${index + 1}: age must be a whole number between 0 and 150.`);
    }
    if (creatingClient) {
      if (!isMissingReviewValue(client.civil_status) && !isRecognizedOption(client.civil_status, civilStatusOptions)) issues.push(`Client ${index + 1}: choose a recognized Civil Status option.`);
      if (!isMissingReviewValue(client.educational_attainment) && !isRecognizedOption(client.educational_attainment, educationalAttainmentOptions)) issues.push(`Client ${index + 1}: choose a recognized Educational Attainment option.`);
      if (!isMissingReviewValue(client.religion) && !isRecognizedOption(client.religion, religionOptions)) issues.push(`Client ${index + 1}: review the unrecognized Religion value.`);
      if (!isMissingReviewValue(client.language_dialect) && !isRecognizedOption(client.language_dialect, languageDialectOptions)) issues.push(`Client ${index + 1}: review the unrecognized Language / Dialect value.`);
      if (!isMissingReviewValue(client.relationship) && !isRecognizedOption(client.relationship, relationshipOptions)) issues.push(`Client ${index + 1}: review the unrecognized Relationship to Applicant value.`);
      if (!isMissingReviewValue(client.party_represented) && !isRecognizedOption(client.party_represented, applicantRoleOptions)) issues.push(`Client ${index + 1}: choose a recognized Party Represented option.`);
      for (const [value, label] of [
        [client.civil_status, "Civil Status"], [client.religion, "Religion"],
        [client.educational_attainment, "Educational Attainment"], [client.citizenship, "Citizenship"],
        [client.language_dialect, "Language / Dialect"], [client.address, "Address"],
      ]) {
        if (isMissingReviewValue(value)) issues.push(`Client ${index + 1}: ${label} is required for a new client.`);
      }
      for (const [value, label, max] of [
        [client.civil_status, "Civil Status", 50], [client.religion, "Religion", 100],
        [client.educational_attainment, "Educational Attainment", 150], [client.citizenship, "Citizenship", 100],
        [client.language_dialect, "Language / Dialect", 100], [client.relationship, "Relationship to Applicant", 100],
      ] as const) {
        if (value.length > max) issues.push(`Client ${index + 1}: ${label} must be ${max} characters or fewer.`);
      }
      if (!/^[0-9]{1,11}$/.test(client.contact_no.trim())) issues.push(`Client ${index + 1}: a valid Contact Number is required for a new client.`);
    }
    for (const flag of [client.urban, client.rural, client.drugs, client.female, client.senior, client.cicl]) {
      const value = String(flag ?? "").trim().toLowerCase();
      if (value && !["1", "0", "yes", "no", "true", "false", "y", "n"].includes(value)) {
        issues.push(`Client ${index + 1}: classification values must be yes/no.`);
        break;
      }
    }
    if (client.location_indicators_present) {
      const rural = String(client.rural ?? "").trim().toLowerCase();
      const urban = String(client.urban ?? "").trim().toLowerCase();
      if (!((rural === "1" && urban === "0") || (rural === "0" && urban === "1"))) {
        issues.push(`Client ${index + 1}: choose exactly one location indicator, Rural or Urban; zero or conflicting values need review.`);
      }
    }
    if (creatingClient && [client.female, client.senior, client.cicl].some((flag) => flag !== null && flag !== "") && !client.flags_reviewed) {
      issues.push(`Client ${index + 1}: review and confirm the Female, Senior, and CICL indicators.`);
    }
  });
  caseIssueCache.set(entry, issues);
  return issues;
}

function Field({ label, value, onChange, type = "text", showNA = true }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date" | "number" | "tel";
  showNA?: boolean;
}) {
  const dateValue = type === "date" ? toDateInput(value) : "";
  const handleBlur = () => {
    if (showNA && isMissingReviewValue(value)) onChange("NA");
  };
  return (
    <label className="block min-w-0">
      <span className="text-xs font-semibold text-[#4B5563]">{label}</span>
      <span className="relative mt-1 block">
        {showNA && type === "date" && isMissingReviewValue(value) && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2.5 z-10 flex items-center text-sm text-[#6B7280]">NA</span>}
        <input
          type={type}
          value={type === "date" ? dateValue : value}
          placeholder={showNA && type === "text" ? "NA" : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={handleBlur}
          className="h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-2.5 text-sm text-[#2B3642] outline-none placeholder:text-[#6B7280] focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
        />
      </span>
    </label>
  );
}

function SelectField({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const recognized = !value || isRecognizedOption(value, options);
  return (
    <label className="block min-w-0">
      <span className="text-xs font-semibold text-[#4B5563]">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-2.5 text-sm text-[#2B3642]">
        <option value="">Select</option>
        {!recognized && <option value={value}>Review: {value}</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      {!recognized && <span className="mt-1 block text-[11px] font-medium text-amber-700">Unrecognized source value; choose a listed option.</span>}
    </label>
  );
}

function ComboField({ label, value, options, listId, onChange }: {
  label: string;
  value: string;
  options: string[];
  listId: string;
  onChange: (value: string) => void;
}) {
  const recognized = !value || isRecognizedOption(value, options);
  return (
    <label className="block min-w-0">
      <span className="text-xs font-semibold text-[#4B5563]">{label}</span>
      <input list={listId} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-2.5 text-sm text-[#2B3642]" />
      <datalist id={listId}>{options.map((option) => <option key={option} value={option} />)}</datalist>
      {value && !recognized && <span className="mt-1 block text-[11px] font-medium text-amber-700">Unrecognized source value; review or choose a listed value.</span>}
    </label>
  );
}

export default function CaseImportModal({ caseType, existingClients, onClose, onImported }: CaseImportModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const extractionInFlight = useRef(false);
  const extractionAbort = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<ModalPhase>("upload");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Pick<CaseImportPreview, "source_filename" | "workbook_format" | "rows_processed"> | null>(null);
  const [entries, setEntries] = useState<CaseImportReviewCase[]>([]);
  const [reviewPage, setReviewPage] = useState(0);
  const [openCases, setOpenCases] = useState<Set<string>>(() => new Set());
  const [result, setResult] = useState<CaseImportResult | null>(null);

  const readyEntries = useMemo(
    () => entries.filter((entry) => caseIssues(entry).length === 0),
    [entries],
  );
  const reviewStats = useMemo(() => entries.reduce((stats, entry) => {
    stats.clientRows += entry.clients.length;
    stats.duplicates += Number(entry.duplicate);
    for (const client of entry.clients) {
      stats.newClients += Number(!client.existing_client_id);
      stats.possibleMatches += Number(client.possible_matches.length > 0);
    }
    return stats;
  }, { clientRows: 0, duplicates: 0, newClients: 0, possibleMatches: 0 }), [entries]);
  const pageCount = Math.max(1, Math.ceil(entries.length / REVIEW_PAGE_SIZE));
  const visibleEntries = useMemo(
    () => entries.slice(reviewPage * REVIEW_PAGE_SIZE, (reviewPage + 1) * REVIEW_PAGE_SIZE),
    [entries, reviewPage],
  );

  useEffect(() => () => extractionAbort.current?.abort(), []);

  const selectFile = (next: File | null) => {
    setError("");
    if (!next) {
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (!/\.(xlsx|xls)$/i.test(next.name)) {
      setFile(null);
      setError("Choose an .xlsx or .xls file.");
      return;
    }
    if (next.size > 15 * 1024 * 1024) {
      setFile(null);
      setError("The file is larger than the 15 MB limit.");
      return;
    }
    setFile(next);
    setReviewPage(0);
  };

  const extract = async () => {
    if (!file || phase !== "upload" || extractionInFlight.current) return;
    extractionInFlight.current = true;
    const controller = new AbortController();
    extractionAbort.current = controller;
    setPhase("extracting");
    setUploadProgress(0);
    setError("");
    try {
      const extracted = await previewCaseImport(file, caseType, setUploadProgress, controller.signal);
      setPreview({
        source_filename: extracted.source_filename,
        workbook_format: extracted.workbook_format,
        rows_processed: extracted.rows_processed,
      });
      setEntries(extracted.cases);
      setReviewPage(0);
      setOpenCases(new Set());
      setPhase("review");
    } catch (cause) {
      if (controller.signal.aborted) return;
      const details = cause !== null && typeof cause === "object" ? cause as Record<string, unknown> : {};
      const response = details.response !== null && typeof details.response === "object"
        ? details.response as Record<string, unknown>
        : {};
      console.error("Excel case extraction failed.", {
        stage: "preview",
        status: response.status,
        code: typeof details.code === "string" ? details.code : undefined,
        errorType: cause instanceof Error ? cause.name : typeof cause,
      });
      setError(caseImportErrorMessage(cause, "Unable to read this workbook. Check the file and retry."));
      setPhase("upload");
    } finally {
      extractionInFlight.current = false;
      if (extractionAbort.current === controller) extractionAbort.current = null;
    }
  };

  const updateEntry = (key: string, patch: Partial<CaseImportReviewCase>) => {
    setEntries((current) => current.map((entry) => entry.import_key === key ? { ...entry, ...patch } : entry));
  };

  const updateClient = (key: string, clientIndex: number, patch: Partial<CaseImportReviewCase["clients"][number]>) => {
    if (patch.client_name !== undefined) {
      const normalizedName = patch.client_name.trim().toLocaleLowerCase();
      patch = {
        ...patch,
        possible_matches: normalizedName
          ? existingClients
              .filter((client) => client.client.name.trim().toLocaleLowerCase() === normalizedName)
              .slice(0, 5)
              .map((client) => ({
                client_id: Number(client.client_id),
                name: client.client.name,
                age: client.client.age,
                sex: client.client.sex,
                address: client.client_details.address,
              }))
          : [],
        existing_client_id: null,
      };
    }
    setEntries((current) => current.map((entry) => entry.import_key !== key ? entry : {
      ...entry,
      clients: entry.clients.map((client, index) => index === clientIndex ? { ...client, ...patch } : client),
    }));
  };

  const importReady = async () => {
    if (!preview || phase !== "review") return;
    setPhase("importing");
    setError("");
    try {
      const duplicateCaseCount = entries.filter((entry) => entry.duplicate).length;
      const heldCaseCount = entries.filter((entry) => !entry.duplicate && caseIssues(entry).length > 0).length;
      const imported = await importCaseRecords(caseType, preview.source_filename, readyEntries, heldCaseCount, duplicateCaseCount);
      setResult(imported);
      setPhase("complete");
      void onImported().catch(() => toast.error("Records imported, but the case list could not be refreshed."));
    } catch (cause) {
      const details = cause !== null && typeof cause === "object" ? cause as Record<string, unknown> : {};
      const response = details.response !== null && typeof details.response === "object"
        ? details.response as Record<string, unknown>
        : {};
      console.error("Excel case import failed.", {
        stage: "import",
        status: response.status,
        code: typeof details.code === "string" ? details.code : undefined,
        errorType: cause instanceof Error ? cause.name : typeof cause,
      });
      setError(caseImportErrorMessage(cause, "The import could not be completed. Review the records and retry."));
      setPhase("review");
      toast.error("Import failed. No existing records were overwritten.");
    }
  };

  return (
    <ModalPortal>
      <div className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="case-import-title">
        <div className="jurisguard-modal-surface flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-xl">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#E5E7EB] bg-[#604477] px-5 py-4 text-white sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <FileSpreadsheet className="h-6 w-6 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <h2 id="case-import-title" className="text-lg font-bold">{phase === "complete" ? "Import Complete" : "Import Excel Records"}</h2>
                <p className="mt-0.5 text-sm text-white/85">Destination: {caseType} Cases</p>
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={phase === "importing"} className="rounded-md px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50">Close</button>
          </header>

          {phase === "upload" && (
            <div className="space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
              <p className="text-sm text-[#4B5563]">Upload an Excel inventory to extract and review case and client records before they are added to JurisGuard.</p>
              <div
                onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => { event.preventDefault(); setIsDragging(false); selectFile(event.dataTransfer.files[0] || null); }}
                className={`rounded-xl border-2 border-dashed p-7 text-center transition ${isDragging ? "border-[#704389] bg-[#F7F0FA]" : "border-[#CBD5E1] bg-[#F9FAFB]"}`}
              >
                <Upload className="mx-auto h-8 w-8 text-[#704389]" aria-hidden="true" />
                <p className="mt-2 font-semibold text-[#2B3642]">Drop an Excel file here</p>
                <p className="mt-1 text-xs text-[#6B7280]">.xlsx or .xls · Up to 15 MB · Workbook contents are checked before extraction</p>
                <button type="button" onClick={() => inputRef.current?.click()} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-[#704389] px-4 text-sm font-semibold text-white hover:bg-[#5F3675]">
                  <FileUp className="h-4 w-4" /> Browse File
                </button>
                <input ref={inputRef} type="file" accept=".xlsx,.xls" className="sr-only" onChange={(event) => { selectFile(event.target.files?.[0] || null); event.target.value = ""; }} />
              </div>
              {file && <div className="flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] px-4 py-3">
                <div className="flex min-w-0 items-center gap-3"><FileSpreadsheet className="h-5 w-5 shrink-0 text-[#704389]" /><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#2B3642]">{file.name}</p><p className="text-xs text-[#6B7280]">{formatBytes(file.size)}</p></div></div>
                <button type="button" onClick={() => selectFile(null)} aria-label="Remove selected file" className="rounded p-2 text-[#6B7280] hover:bg-[#F3F4F6] hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
              </div>}
              {error && <p role="alert" className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
              <div className="flex justify-end gap-2 border-t border-[#E5E7EB] pt-4">
                <button type="button" onClick={onClose} className="h-9 rounded-md border border-[#D1D5DB] px-4 text-sm font-semibold text-[#4B5563]">Cancel</button>
                <button type="button" onClick={() => void extract()} disabled={!file} className="h-9 rounded-md bg-[#704389] px-4 text-sm font-semibold text-white hover:bg-[#5F3675] disabled:cursor-not-allowed disabled:opacity-50">Start Extraction</button>
              </div>
            </div>
          )}

          {phase === "extracting" && (
            <div className="m-auto w-full max-w-xl space-y-4 px-6 py-12 text-center">
              <LoaderCircle className="mx-auto h-10 w-10 animate-spin text-[#704389]" aria-hidden="true" />
              <div><p className="font-semibold text-[#2B3642]">{uploadProgress < 100 ? `Receiving workbook · ${uploadProgress}%` : "Reading workbook and checking records"}</p><p className="mt-1 truncate text-sm text-[#6B7280]">{file?.name}</p></div>
              <div className="h-2 overflow-hidden rounded-full bg-[#E5E7EB]" role="progressbar" aria-label="File upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}>
                {uploadProgress < 100 ? <div className="h-full bg-[#704389] transition-[width]" style={{ width: `${uploadProgress}%` }} /> : <div className="h-full w-1/3 animate-pulse rounded-full bg-[#704389]" />}
              </div>
              <p className="text-xs text-[#6B7280]">Server validation runs after upload; the processing indicator remains indeterminate until review results are ready.</p>
            </div>
          )}

          {phase === "review" && preview && (
            <>
              <div className="shrink-0 border-b border-[#E5E7EB] px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="font-semibold text-[#2B3642]">Review extracted records</p><p className="mt-1 text-xs text-[#6B7280]">{preview.source_filename} · {preview.workbook_format} · {preview.rows_processed} populated rows processed</p></div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#4B5563]">
                    <span>{entries.length} cases</span>
                    <span>{reviewStats.clientRows} client rows</span>
                    <span>{readyEntries.length} ready</span>
                    <span>{reviewStats.duplicates} duplicates</span>
                    <span>{reviewStats.newClients} new clients</span>
                    <span>{reviewStats.possibleMatches} possible matches</span>
                  </div>
                </div>
                {entries.length > REVIEW_PAGE_SIZE && <div className="mt-3 flex items-center justify-between border-t border-[#E5E7EB] pt-3 text-xs text-[#4B5563]">
                  <span>Cases {reviewPage * REVIEW_PAGE_SIZE + 1}–{Math.min((reviewPage + 1) * REVIEW_PAGE_SIZE, entries.length)} of {entries.length}</span>
                  <div className="flex gap-2">
                    <button type="button" disabled={reviewPage === 0} onClick={() => setReviewPage((page) => Math.max(0, page - 1))} className="rounded border border-[#D1D5DB] px-2.5 py-1 font-semibold disabled:opacity-40">Previous</button>
                    <span className="self-center">Page {reviewPage + 1} of {pageCount}</span>
                    <button type="button" disabled={reviewPage + 1 >= pageCount} onClick={() => setReviewPage((page) => Math.min(pageCount - 1, page + 1))} className="rounded border border-[#D1D5DB] px-2.5 py-1 font-semibold disabled:opacity-40">Next</button>
                  </div>
                </div>}
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#F9FAFB] px-4 py-4 sm:px-6">
                {visibleEntries.map((entry) => {
                  const issues = caseIssues(entry);
                  const casePatch = (patch: Partial<CaseImportReviewCase>) => updateEntry(entry.import_key, patch);
                  return <details key={entry.import_key} className="overflow-hidden rounded-lg border border-[#D1D5DB] bg-white" open={openCases.has(entry.import_key)} onToggle={(event) => {
                    const isOpen = event.currentTarget.open;
                    setOpenCases((current) => {
                      const next = new Set(current);
                      if (isOpen) next.add(entry.import_key);
                      else next.delete(entry.import_key);
                      return next;
                    });
                  }}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0"><span className="block truncate text-sm font-bold text-[#2B3642]">{entry.control_no || "Missing Control Number"} · {entry.title || "Untitled case"}</span><span className="mt-0.5 block text-xs text-[#6B7280]">{entry.clients.length} client row(s) · source row{entry.source_rows.length === 1 ? "" : "s"} {entry.source_rows.join(", ")}</span></span>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${entry.duplicate ? "bg-amber-100 text-amber-800" : issues.length ? "bg-red-100 text-red-700" : "bg-green-100 text-green-800"}`}>{entry.duplicate ? "Possible duplicate" : issues.length ? "Needs review" : "Ready"}</span>
                    </summary>
                    {openCases.has(entry.import_key) && <div className="space-y-4 border-t border-[#E5E7EB] p-4">
                      {entry.duplicate && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{entry.duplicate_message} This record will be held; existing data will not be overwritten.</p>}
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Control Number" value={entry.control_no} onChange={(value) => casePatch({ control_no: value })} />
                        <Field label="Title of the Case" value={entry.title} onChange={(value) => casePatch({ title: value })} />
                        <Field label="Court / Body" value={entry.court} onChange={(value) => casePatch({ court: value })} />
                        <Field label="Case Number" value={entry.case_no} onChange={(value) => casePatch({ case_no: value })} />
                        <Field label="Cause of Action" value={entry.cause_of_action} onChange={(value) => casePatch({ cause_of_action: value })} />
                        <Field label="Nature of Case" value={entry.nature_of_case} onChange={(value) => casePatch({ nature_of_case: value })} />
                        <label className="block"><span className="text-xs font-semibold text-[#4B5563]">Status</span><select value={entry.status} onChange={(event) => casePatch({ status: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-2.5 text-sm"><option value="NA">NA</option><option>Pending</option><option>Terminated</option></select></label>
                        <Field label="Case Received" type="date" value={entry.case_received} onChange={(value) => casePatch({ case_received: value })} />
                        <Field label="Last Action Taken" value={entry.last_action} onChange={(value) => casePatch({ last_action: value })} />
                        <Field label="Cause of Termination" value={entry.cause_of_termination} onChange={(value) => casePatch({ cause_of_termination: value })} />
                        <Field label="Date of Termination" type="date" value={entry.date_of_termination} onChange={(value) => casePatch({ date_of_termination: value })} />
                        <Field label="Date of Confinement" type="date" value={entry.date_of_confinement} onChange={(value) => casePatch({ date_of_confinement: value })} />
                        <Field label="Place of Detention" value={entry.place_of_detention} onChange={(value) => casePatch({ place_of_detention: value })} />
                      </div>
                      {Object.keys(entry.conflicting_values).length > 0 && <>
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"><p className="font-bold">Conflicting shared values</p><ul className="mt-1 space-y-1 text-xs">{Object.entries(entry.conflicting_values).map(([field, values]) => <li key={field}><span className="font-semibold">{field.replaceAll("_", " ")}:</span> {values.map((value) => value || "(blank)").join(" · ")}</li>)}</ul><p className="mt-2 text-xs">Conflicting fields are left blank above. Choose or enter the value to keep before confirming.</p></div>
                        <label className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"><input type="checkbox" checked={Boolean(entry.conflict_reviewed)} onChange={(event) => casePatch({ conflict_reviewed: event.target.checked })} className="mt-1 accent-[#704389]" /><span>I reviewed the source values and resolved each conflicting field above.</span></label>
                      </>}
                      <div className="space-y-3">
                        <h4 className="text-sm font-bold text-[#2B3642]">Associated clients</h4>
                        {entry.clients.map((client, index) => <div key={`${client.source_row}-${index}`} className="rounded-lg border border-[#E5E7EB] bg-[#FBFCFD] p-3">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Client {index + 1} · source row {client.source_row}</p>{client.possible_matches.length > 0 && <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">{client.possible_matches.length} possible match(es)</span>}</div>
                          {client.possible_matches.length > 0 && <label className="mb-3 block"><span className="text-xs font-semibold text-[#4B5563]">Client matching (confirm manually)</span><select value={client.existing_client_id ?? ""} onChange={(event) => updateClient(entry.import_key, index, { existing_client_id: event.target.value ? Number(event.target.value) : null })} className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-2.5 text-sm"><option value="">Create a new client</option>{client.possible_matches.map((match) => <option key={match.client_id} value={match.client_id}>{match.name} · #{match.client_id}{match.age == null ? "" : ` · age ${match.age}`}{match.address ? ` · ${match.address}` : ""}</option>)}</select></label>}
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <Field showNA={false} label="Client Name" value={client.client_name} onChange={(value) => updateClient(entry.import_key, index, { client_name: value })} />
                            <Field showNA={false} label="Age" type="number" value={String(client.age ?? "")} onChange={(value) => updateClient(entry.import_key, index, { age: value })} />
                            <SelectField label="Gender / Sex" value={client.sex} options={sexOptions} onChange={(value) => updateClient(entry.import_key, index, { sex: value })} />
                            <SelectField label="Civil Status" value={client.civil_status} options={civilStatusOptions} onChange={(value) => updateClient(entry.import_key, index, { civil_status: value })} />
                            <ComboField label="Religion" value={client.religion} options={religionOptions} listId={`client-religion-${entry.import_key}-${index}`} onChange={(value) => updateClient(entry.import_key, index, { religion: value })} />
                            <SelectField label="Educational Attainment" value={client.educational_attainment} options={educationalAttainmentOptions} onChange={(value) => updateClient(entry.import_key, index, { educational_attainment: value })} />
                            <Field showNA={false} label="Citizenship" value={client.citizenship} onChange={(value) => updateClient(entry.import_key, index, { citizenship: value })} />
                            <ComboField label="Language / Dialect" value={client.language_dialect} options={languageDialectOptions} listId={`client-language-${entry.import_key}-${index}`} onChange={(value) => updateClient(entry.import_key, index, { language_dialect: value })} />
                            <SelectField label="Party Represented" value={client.party_represented} options={applicantRoleOptions} onChange={(value) => updateClient(entry.import_key, index, { party_represented: value })} />
                            <Field showNA={false} label="Address" value={client.address} onChange={(value) => updateClient(entry.import_key, index, { address: value })} />
                            <Field showNA={false} label="Contact Number" type="tel" value={client.contact_no} onChange={(value) => updateClient(entry.import_key, index, { contact_no: value })} />
                            <ComboField label="Relationship to Applicant" value={client.relationship} options={relationshipOptions} listId={`client-relationship-${entry.import_key}-${index}`} onChange={(value) => updateClient(entry.import_key, index, { relationship: value })} />
                            {(["urban", "rural", "drugs", "female", "senior", "cicl"] as const).map((flag) => {
                              const rawValue = client[flag];
                              const value = rawValue === true ? "1" : rawValue === false ? "0" : String(rawValue ?? "").toLowerCase();
                              const label = flag === "cicl" ? "CICL" : flag === "drugs" ? "Drug-related" : flag.charAt(0).toUpperCase() + flag.slice(1);
                              const positiveLabel = flag === "rural" ? "Rural" : flag === "urban" ? "Urban" : "Yes";
                              return <label key={flag} className="block"><span className="text-xs font-semibold text-[#4B5563]">{label}</span><select value={value === "yes" || value === "true" ? "1" : value === "no" || value === "false" ? "0" : value} onChange={(event) => updateClient(entry.import_key, index, { [flag]: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-2.5 text-sm"><option value="">Not provided</option><option value="1">{positiveLabel}</option><option value="0">No</option></select></label>;
                            })}
                          </div>
                          <label className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"><input type="checkbox" checked={Boolean(client.flags_reviewed)} onChange={(event) => updateClient(entry.import_key, index, { flags_reviewed: event.target.checked })} className="mt-1 accent-[#704389]" /><span>I reviewed the source indicators for Female, Senior, and CICL for this client.</span></label>
                          {client.existing_client_id && <p className="mt-2 text-xs font-medium text-[#166534]">Existing client selected. Extracted details will not overwrite the client's saved profile.</p>}
                        </div>)}
                      </div>
                      {issues.length > 0 && <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800"><p className="font-bold">Held until corrected</p><ul className="mt-1 list-inside list-disc">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
                    </div>}
                  </details>;
                })}
                {entries.length === 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No case rows were recognized for review.</p>}
                {error && <p role="alert" className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
              </div>
              <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#E5E7EB] px-5 py-4 sm:px-6">
                <button type="button" onClick={() => { setPhase("upload"); setPreview(null); setEntries([]); setError(""); }} className="h-9 rounded-md border border-[#D1D5DB] px-4 text-sm font-semibold text-[#4B5563]">Back to Upload</button>
                <div className="flex gap-2"><button type="button" onClick={onClose} className="h-9 rounded-md border border-[#D1D5DB] px-4 text-sm font-semibold text-[#4B5563]">Cancel Import</button><button type="button" disabled={!entries.length} onClick={() => void importReady()} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#704389] px-4 text-sm font-semibold text-white hover:bg-[#5F3675] disabled:cursor-not-allowed disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />Import {readyEntries.length} Valid Case(s)</button></div>
              </footer>
            </>
          )}

          {phase === "importing" && <div className="m-auto space-y-3 px-6 py-12 text-center"><LoaderCircle className="mx-auto h-10 w-10 animate-spin text-[#704389]" /><p className="font-semibold text-[#2B3642]">Saving reviewed records…</p><p className="text-sm text-[#6B7280]">Each case and its client links are saved together.</p></div>}

          {phase === "complete" && result && <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-6 sm:px-6">
            <p className="flex items-center gap-2 text-sm font-semibold text-green-800"><CheckCircle2 className="h-5 w-5" />Import finished for {caseType} Cases.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[["Cases imported", result.cases_imported], ["New clients created", result.clients_created], ["Existing clients linked", result.existing_clients_linked], ["Cases held for correction", result.cases_held], ["Possible duplicates skipped", result.duplicate_cases_skipped], ["Failed records", result.failed_records]].map(([label, value]) => <div key={label} className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4"><p className="text-xs font-semibold text-[#6B7280]">{label}</p><p className="mt-1 text-2xl font-bold text-[#2B3642]">{value}</p></div>)}</div>
            {result.failures.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-bold text-amber-900">Held records</p><ul className="mt-2 space-y-1 text-xs text-amber-900">{result.failures.map((failure, index) => <li key={`${failure.control_no}-${index}`}>{failure.control_no}: {failure.reason}</li>)}</ul></div>}
            <div className="flex justify-end border-t border-[#E5E7EB] pt-4"><button type="button" onClick={onClose} className="h-9 rounded-md bg-[#704389] px-5 text-sm font-semibold text-white hover:bg-[#5F3675]">Close</button></div>
          </div>}
        </div>
      </div>
    </ModalPortal>
  );
}
