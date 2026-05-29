import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useForm } from "react-hook-form";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { FieldPath, UseFormRegisterReturn } from "react-hook-form";
import { useAuth } from "../../contexts/AuthContext";
import { FieldStatus } from "../../features/criminalCases/components/FieldStatus";
import { StepIndicator } from "../../features/criminalCases/components/StepIndicator";
import { useCamera } from "../../features/criminalCases/hooks/useCamera";
import { caseFormSchema, type CaseFormValues } from "../../features/criminalCases/schemas";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import {
  dataUrlToFile,
  extractCaseFromDocument,
  type CaseExtractionResult,
} from "../../services/documentExtractionService";
import type { ClientRecord, ExtractionMap, IntakeMethod } from "../../types";

type CaseOcrPayload = CaseExtractionResult["extracted"];

interface CaseWorkflowProps {
  clients: ClientRecord[];
  lockedClient?: ClientRecord;
  submitLabel?: string;
  onSubmit: (values: CaseFormValues) => void | Promise<void>;
}

const createDefaultValues = (clientId = ""): CaseFormValues => ({
  client_id: clientId,
  intake_record: {
    control_no: "",
    form_date: new Date().toLocaleDateString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    }),
    region: "",
    district_office: "",
    party_represented: "",
    applicant_role: "",
    applicant_role_other: "",
    nature_of_request: "",
    nature_of_case: "",
  },
  representative: {
    rep_name: "",
    rep_age: 0,
    rep_sex: "",
    civil_status: "",
    rep_address: "",
    rep_contact_no: "",
    relationship_to_applicant: "",
  },
  adverse_party: {
    role: "",
    name: "",
    address: "",
  },
  cases: {
    title_of_case: "",
    case_no: "",
    court_body: "",
    status_of_case: "Pending",
    case_status: "Pending",
    incident_barangay: "",
    incident_city: "Panabo City",
    incident_address: "",
    latitude: "",
    longitude: "",
    last_action_taken: "",
    date_of_confinement: "",
    place_of_detention: "",
    location_type: "",
    cause_of_action: "",
    facts_of_case: "",
    pending_in_court: false,
    cause_of_termination: "",
    date_of_termination: "",
    assigned_pao: "",
    filing_date: "",
    hearing_schedule: "",
    remarks: "",
  },
});

const caseOcrFields = [
  "intake_record.control_no",
  "intake_record.form_date",
  "intake_record.region",
  "intake_record.district_office",
  "intake_record.party_represented",
  "intake_record.applicant_role",
  "intake_record.nature_of_request",
  "intake_record.nature_of_case",
  "representative.rep_name",
  "representative.rep_age",
  "representative.rep_sex",
  "representative.civil_status",
  "representative.rep_address",
  "representative.rep_contact_no",
  "representative.relationship_to_applicant",
  "adverse_party.role",
  "adverse_party.name",
  "adverse_party.address",
  "cases.case_no",
  "cases.court_body",
  "cases.title_of_case",
  "cases.facts_of_case",
  "cases.cause_of_action",
  "cases.status_of_case",
  "cases.last_action_taken",
  "cases.pending_in_court",
  "cases.cause_of_termination",
  "cases.date_of_termination",
] as Array<FieldPath<CaseFormValues>>;

const overwriteDefaultOcrFields = new Set<FieldPath<CaseFormValues>>([
  "intake_record.form_date",
]);

const panaboBarangays = [
  "A. O. Floirendo",
  "Cacao",
  "Cagangohan",
  "Consolacion",
  "Dapco",
  "Gredu",
  "J. P. Laurel",
  "Kasilak",
  "Katipunan",
  "Katualan",
  "Kauswagan",
  "Kiotoy",
  "Little Panay",
  "Lower Panaga",
  "Mabunao",
  "Maduao",
  "Malativas",
  "Manay",
  "Nanyo",
  "New Malaga",
  "New Malitbog",
  "New Pandan",
  "New Visayas",
  "Quezon",
  "Salvacion",
  "San Francisco",
  "San Nicolas",
  "San Pedro",
  "San Roque",
  "San Vicente",
  "Santa Cruz",
  "Santo Nino",
  "Sindaton",
  "Southern Davao",
  "Tagpore",
  "Tibungol",
  "Upper Licanan",
  "Waterfall",
];

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

function TextInput({
  label,
  registration,
  error,
  type = "text",
  status,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  type?: string;
  status?: ExtractionMap[string];
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#111827]/80">
        {label}
        <FieldStatus status={status} />
      </span>
      <input
        type={type}
        {...registration}
        className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition duration-200 focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/15"
      />
      <FieldError message={error} />
    </label>
  );
}

function TextArea({
  label,
  registration,
  error,
  status,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  status?: ExtractionMap[string];
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#111827]/80">
        {label}
        <FieldStatus status={status} />
      </span>
      <textarea
        {...registration}
        rows={4}
        className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition duration-200 focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/15"
      />
      <FieldError message={error} />
    </label>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getPayloadValue(source: CaseOcrPayload, path: FieldPath<CaseFormValues>) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function MethodCard({
  value,
  title,
  description,
  icon,
  selected,
  onSelect,
}: {
  value: IntakeMethod;
  title: string;
  description: string;
  icon: string;
  selected: boolean;
  onSelect: (value: IntakeMethod) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`rounded-lg border bg-white p-5 text-left shadow-sm transition duration-200 hover:-translate-y-px hover:shadow-md ${
        selected
          ? "border-[#2F80ED] shadow-[#2F80ED]/15"
          : "border-[#E5E7EB] hover:border-[#2F80ED]"
      }`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2F80ED]">
        <i className={`fa-solid ${icon}`} aria-hidden="true" />
      </div>
      <p className="mt-4 text-base font-semibold text-[#111827]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#6B7280]">{description}</p>
    </button>
  );
}

function SelectedClientCard({
  client,
  locked = false,
  onChange,
  onRemove,
}: {
  client: ClientRecord;
  locked?: boolean;
  onChange?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 shadow-sm shadow-[#111827]/5">
      {locked && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#2F80ED]">
          Client selected automatically
        </p>
      )}
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#2F80ED] text-sm font-semibold text-white">
          {initials(client.client.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-[#111827]">{client.client.name}</p>
          <div className="mt-2 grid gap-2 text-sm text-[#6B7280] sm:grid-cols-2">
            <span>Sex: {client.client.sex || "-"}</span>
            <span>Age: {client.client.age || "-"}</span>
            <span className="sm:col-span-2">Address: {client.client_details.address || "-"}</span>
          </div>
        </div>
      </div>
      {!locked && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onChange}
            className="rounded-md border border-[#2F80ED] bg-white px-3 py-1.5 text-xs font-semibold text-[#2F80ED] transition duration-200 hover:-translate-y-px hover:bg-[#2F80ED] hover:text-white"
          >
            Change Client
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B7280] transition duration-200 hover:-translate-y-px hover:bg-gray-50"
          >
            Remove Selection
          </button>
        </div>
      )}
    </div>
  );
}

export function CaseWorkflow({
  clients,
  lockedClient,
  submitLabel = "Save Case",
  onSubmit,
}: CaseWorkflowProps) {
  const addNotification = useNotificationStore((state) => state.addNotification);
  const { user } = useAuth();
  const [step, setStep] = useState(lockedClient ? 0 : 0);
  const [method, setMethod] = useState<IntakeMethod | null>(null);
  const [query, setQuery] = useState("");
  const [activeClientIndex, setActiveClientIndex] = useState(0);
  const [documentPreview, setDocumentPreview] = useState<string | null>(null);
  const [documentLabel, setDocumentLabel] = useState("");
  const [indicators, setIndicators] = useState<ExtractionMap>({});
  const [isExtracting, setIsExtracting] = useState(false);
  const [replaceExistingWithOcr, setReplaceExistingWithOcr] = useState(false);
  const [useClientRepresentative, setUseClientRepresentative] = useState(Boolean(lockedClient));
  const {
    videoRef,
    isCameraActive,
    cameraError,
    startCamera,
    stopCamera,
    captureFrame,
  } = useCamera();
  const standaloneSteps = ["Select Client", "Encoding Method", "Case Details"];
  const lockedSteps = ["Encoding Method", "Case Details"];
  const steps = lockedClient ? lockedSteps : standaloneSteps;
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    trigger,
    getValues,
    formState: { errors },
  } = useForm<CaseFormValues>({
    resolver: zodResolver(caseFormSchema),
    defaultValues: createDefaultValues(lockedClient?.client_id ?? ""),
    mode: "onBlur",
  });

  const selectedClientId = watch("client_id");
  const selectedClient =
    lockedClient ?? clients.find((client) => client.client_id === selectedClientId);
  const status = watch("cases.status_of_case");
  const applicantRole = watch("intake_record.applicant_role");
  const pendingInCourt = watch("cases.pending_in_court");
  const hasSearch = query.trim().length > 0;
  const filteredClients = useMemo(() => {
    if (!hasSearch) return [];
    const normalized = query.trim().toLowerCase();
    return clients.filter((client) =>
      `${client.client_id} ${client.client.name}`.toLowerCase().includes(normalized)
    );
  }, [clients, hasSearch, query]);
  const visibleClients = filteredClients.slice(0, 8);
  const hasOcrResult = Object.keys(indicators).length > 0;
  const isCaseFormStep = lockedClient ? step === 1 : step === 2;
  const isMethodStep = lockedClient ? step === 0 : step === 1;

  useEffect(() => {
    setActiveClientIndex(0);
  }, [query]);

  useEffect(() => {
    if (lockedClient) {
      setValue("client_id", lockedClient.client_id, { shouldValidate: true });
    }
  }, [lockedClient, setValue]);

  useEffect(() => {
    if (!selectedClient || !useClientRepresentative) return;
    setValue("representative.rep_name", selectedClient.client_details.representative_name || "Not applicable", { shouldDirty: true, shouldValidate: true });
    setValue("representative.rep_age", selectedClient.client_details.representative_age || 0, { shouldDirty: true, shouldValidate: true });
    setValue("representative.rep_sex", selectedClient.client_details.representative_sex || selectedClient.client.sex || "", { shouldDirty: true, shouldValidate: true });
    setValue("representative.civil_status", selectedClient.client_details.representative_civil_status || "", { shouldDirty: true, shouldValidate: true });
    setValue("representative.rep_address", selectedClient.client_details.representative_address || selectedClient.client_details.address || "", { shouldDirty: true, shouldValidate: true });
    setValue("representative.rep_contact_no", selectedClient.client_details.representative_contact_no || selectedClient.client_details.contact_no || "", { shouldDirty: true, shouldValidate: true });
    setValue("representative.relationship_to_applicant", selectedClient.client_details.representative_relationship || "Client representative", { shouldDirty: true, shouldValidate: true });
  }, [selectedClient, setValue, useClientRepresentative]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const selectClient = (client: ClientRecord) => {
    setValue("client_id", client.client_id, { shouldValidate: true, shouldDirty: true });
    setQuery(client.client.name);
  };

  const clearClient = () => {
    setValue("client_id", "", { shouldValidate: true, shouldDirty: true });
    setQuery("");
  };

  const handleClientSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveClientIndex((current) => Math.min(current + 1, visibleClients.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveClientIndex((current) => Math.max(current - 1, 0));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const client = visibleClients[activeClientIndex];
      if (client) selectClient(client);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      clearClient();
    }
  };

  const continueFromClient = async () => {
    const valid = await trigger("client_id");
    if (!valid) {
      toast.error("Select a client before continuing.");
      return;
    }
    setStep(1);
  };

  const continueFromMethod = () => {
    if (!method) {
      toast.error("Select an encoding method before continuing.");
      return;
    }
    setStep(lockedClient ? 1 : 2);
  };

  const applyExtractedPayload = (payload: CaseOcrPayload) => {
    caseOcrFields.forEach((path) => {
      const current = getValues(path);
      const extracted = getPayloadValue(payload, path);
      const isEmpty = current === "" || current === false || current === undefined || current === null;
      const canOverwriteDefault = overwriteDefaultOcrFields.has(path);

      if ((isEmpty || canOverwriteDefault || replaceExistingWithOcr) && extracted !== undefined && extracted !== null && extracted !== "") {
        setValue(path, extracted as never, { shouldDirty: true, shouldValidate: true });
      }
    });
  };

  const runOcr = async (file: File, preview: string, label: string) => {
    setDocumentPreview(preview);
    setDocumentLabel(label);
    setIsExtracting(true);
    const toastId = toast.loading("Extracting case fields...");

    try {
      const result = await extractCaseFromDocument(file, { userId: user?.user_id });
      setIndicators(result.indicators);
      applyExtractedPayload(result.extracted);
      addNotification({
        type: "ocr_completed",
        userId: user?.user_id,
        message: "OCR extraction completed",
        entityType: "ocr",
        entityId: label,
      });
      toast.success("OCR extraction completed", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "OCR failed", { id: toastId });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleCapture = async () => {
    const captured = captureFrame() || "";
    if (!captured) {
      toast.error("Camera did not return an image.");
      return;
    }

    const file = await dataUrlToFile(captured, `live-case-scan-${Date.now()}.png`);
    await runOcr(file, captured, "Live camera case scan");
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast.error("Please upload a JPG, PNG, or WEBP image.");
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        await runOcr(file, String(reader.result), file.name);
      };
      reader.onerror = () => toast.error("Upload error");
      reader.readAsDataURL(file);
    } catch {
      toast.error("Upload error");
    }
  };

  const submitCase = async (values: CaseFormValues) => {
    try {
      await onSubmit({
        ...values,
        cases: {
          ...values.cases,
          case_status: values.cases.status_of_case,
          incident_city: values.cases.incident_city || "Panabo City",
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save case");
    }
  };

  return (
    <form
      onSubmit={handleSubmit(submitCase, () => toast.error("Please resolve validation errors before saving."))}
      className="flex max-h-[calc(92vh-138px)] flex-col"
    >
      <div className="border-b border-[#E5E7EB] bg-white px-6 py-4">
        <StepIndicator steps={steps} currentStep={step} />
      </div>

      <div className="flex-1 overflow-y-auto bg-white px-6 py-5">
        {!lockedClient && step === 0 && (
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-[#111827]/80">
                  Search existing client
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={handleClientSearchKeyDown}
                  placeholder="Search by name or client id"
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm outline-none transition duration-200 focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/15"
                  aria-label="Search existing clients"
                />
              </label>
              <p className="text-sm text-[#6B7280]">
                Search by client name or client ID to locate an existing client.
              </p>
              <FieldError message={errors.client_id?.message} />

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={clearClient}
                  className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B7280] transition duration-200 hover:-translate-y-px hover:bg-gray-50"
                >
                  Cancel Selection
                </button>
              </div>

              {selectedClient && (
                <SelectedClientCard
                  client={selectedClient}
                  onChange={() => {
                    clearClient();
                    setStep(0);
                  }}
                  onRemove={clearClient}
                />
              )}
            </div>

            <div className="overflow-hidden rounded-lg border border-[#E5E7EB]">
              <div className="sticky top-0 border-b border-[#E5E7EB] bg-[#F3F4F6] px-4 py-3 text-sm font-semibold text-[#374151]">
                Existing Clients
              </div>
              <div className="max-h-96 divide-y divide-[#E5E7EB] overflow-y-auto">
                {!hasSearch ? (
                  <div className="px-4 py-8 text-center text-sm text-[#6B7280]">
                    Start typing to search clients.
                  </div>
                ) : visibleClients.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-[#6B7280]">
                    No matching clients found.
                  </div>
                ) : (
                  visibleClients.map((client, index) => (
                    <button
                      type="button"
                      key={client.client_id}
                      onClick={() => selectClient(client)}
                      className={`block w-full px-4 py-3 text-left transition duration-200 hover:bg-gray-50 ${
                        selectedClientId === client.client_id || activeClientIndex === index
                          ? "bg-[#EFF6FF]"
                          : "bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[#111827]">
                            {client.client.name}
                          </p>
                          <p className="mt-1 text-xs text-[#6B7280]">{client.client_id}</p>
                        </div>
                        <span className="text-xs font-medium text-[#6B7280]">
                          {client.client.sex}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {isMethodStep && (
          <div className="space-y-5">
            {selectedClient && (
              <SelectedClientCard
                client={selectedClient}
                locked={Boolean(lockedClient)}
                onChange={() => setStep(0)}
                onRemove={() => {
                  clearClient();
                  setStep(0);
                }}
              />
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <MethodCard value="manual" title="Manual Entry" description="Enter case data manually." icon="fa-keyboard" selected={method === "manual"} onSelect={setMethod} />
              <MethodCard value="camera" title="Live OCR Scan" description="Use live camera scanning." icon="fa-camera" selected={method === "camera"} onSelect={setMethod} />
              <MethodCard value="upload" title="Upload Document" description="Upload a case document image." icon="fa-upload" selected={method === "upload"} onSelect={setMethod} />
            </div>
          </div>
        )}

        {isCaseFormStep && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-[#111827]">
                  {lockedClient ? "Client selected automatically" : selectedClient?.client.name || "No client selected"}
                </p>
                {lockedClient && <p className="text-sm text-[#111827]">{lockedClient.client.name}</p>}
                <p className="text-xs text-[#6B7280]">
                  Method: {method === "manual" ? "Manual Entry" : method === "camera" ? "Live OCR Scan" : "Upload Document"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!lockedClient && (
                  <button type="button" onClick={() => setStep(0)} className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B7280] transition duration-200 hover:-translate-y-px hover:bg-gray-50">
                    Change Client
                  </button>
                )}
                <button type="button" onClick={() => setStep(lockedClient ? 0 : 1)} className="rounded-md border border-[#2F80ED] bg-white px-3 py-1.5 text-xs font-semibold text-[#2F80ED] transition duration-200 hover:-translate-y-px hover:bg-[#2F80ED] hover:text-white">
                  Change Method
                </button>
              </div>
            </div>

            {method !== "manual" && (
              <label className="flex items-start gap-3 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-sm text-[#1E3A8A]">
                <input
                  type="checkbox"
                  checked={replaceExistingWithOcr}
                  onChange={(event) => setReplaceExistingWithOcr(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[#2F80ED] text-[#2F80ED] focus:ring-[#2F80ED]"
                />
                <span>
                  <span className="block font-semibold">Replace existing fields with scanned values</span>
                  <span className="mt-1 block text-[#1E40AF]">
                    Leave this off to fill only blank fields. Form Date is always updated from Petsa when the scan finds it.
                  </span>
                </span>
              </label>
            )}

            {method === "camera" && (
              <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                  <video ref={videoRef} muted playsInline className="aspect-video w-full rounded-md border border-[#E5E7EB] bg-white object-cover" />
                  <div className="space-y-3">
                    <button type="button" onClick={startCamera} className="w-full rounded-md bg-[#2F80ED] px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:bg-[#1f6fd6]">Start Camera</button>
                    <button type="button" onClick={stopCamera} className="w-full rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#111827]/80 transition duration-200 hover:bg-gray-50">Stop Camera</button>
                    <button type="button" disabled={!isCameraActive || isExtracting} onClick={handleCapture} className="w-full rounded-md border border-[#2F80ED] bg-white px-4 py-2 text-sm font-semibold text-[#2F80ED] transition duration-200 hover:bg-[#2F80ED] hover:text-white disabled:opacity-50">
                      {isExtracting ? "Extracting..." : "Capture Case Fields"}
                    </button>
                    {cameraError && <p className="text-sm text-red-600">{cameraError}</p>}
                  </div>
                </div>
              </div>
            )}

            {method === "upload" && (
              <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <label className="block">
                  <span className="text-sm font-semibold text-[#111827]/80">Upload case document image</span>
                  <input type="file" accept="image/*" onChange={handleUpload} className="mt-3 block w-full text-sm text-[#111827]/70 file:mr-4 file:rounded-md file:border-0 file:bg-[#2F80ED] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white" />
                </label>
              </div>
            )}

            {hasOcrResult && (
              <div className="grid gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 lg:grid-cols-[220px_1fr]">
                <div>
                  {documentPreview ? (
                    <img src={documentPreview} alt="Document preview" className="max-h-40 w-full rounded-md border border-emerald-200 object-cover" />
                  ) : (
                    <div className="flex h-32 items-center justify-center rounded-md border border-emerald-200 bg-white text-sm font-medium text-emerald-700">
                      {documentLabel || "PDF document"}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-800">Review extracted case fields before saving.</p>
                  <p className="mt-1 text-sm text-emerald-700">OCR maps Filipino PAO labels like Petsa, Control No., Rehiyon, and request details into the case fields.</p>
                </div>
              </div>
            )}

            <section className="border-t border-[#E5E7EB] pt-4 first:border-t-0 first:pt-0">
              <h3 className="text-sm font-semibold text-[#111827]">Case Identification</h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <TextInput label="Control No." registration={register("intake_record.control_no")} error={errors.intake_record?.control_no?.message} status={indicators["intake_record.control_no"]} />
                <TextInput label="Form Date" registration={register("intake_record.form_date")} error={errors.intake_record?.form_date?.message} status={indicators["intake_record.form_date"]} />
                <TextInput label="Region" registration={register("intake_record.region")} error={errors.intake_record?.region?.message} status={indicators["intake_record.region"]} />
                <TextInput label="District Office" registration={register("intake_record.district_office")} error={errors.intake_record?.district_office?.message} status={indicators["intake_record.district_office"]} />
                <TextInput label="Party Represented" registration={register("intake_record.party_represented")} error={errors.intake_record?.party_represented?.message} />
                <TextInput label="Nature of Request" registration={register("intake_record.nature_of_request")} error={errors.intake_record?.nature_of_request?.message} />
                <TextInput label="Nature of Case" registration={register("intake_record.nature_of_case")} error={errors.intake_record?.nature_of_case?.message} />
              </div>
            </section>

            <section className="border-t border-[#E5E7EB] pt-4">
              <h3 className="text-sm font-semibold text-[#111827]">VIII Applicant Case Involvement</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  "Plaintiff",
                  "Defendant",
                  "Oppositor",
                  "Petitioner",
                  "Respondent",
                  "Others",
                  "Complainant",
                  "Accused",
                ].map((role) => (
                  <label key={role} className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#111827]/80">
                    <input
                      type="radio"
                      value={role}
                      {...register("intake_record.applicant_role")}
                      className="h-4 w-4 border-[#E5E7EB] text-[#2F80ED] focus:ring-[#2F80ED]"
                    />
                    {role}
                  </label>
                ))}
              </div>
              <FieldError message={errors.intake_record?.applicant_role?.message} />
              {applicantRole === "Others" && (
                <div className="mt-3 max-w-md">
                  <TextInput label="Specify Role" registration={register("intake_record.applicant_role_other")} error={errors.intake_record?.applicant_role_other?.message} />
                </div>
              )}
            </section>

            <section className="border-t border-[#E5E7EB] pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#111827]">Representative</h3>
                  {lockedClient && useClientRepresentative && (
                    <p className="mt-1 text-sm text-[#6B7280]">
                      Using representative details already saved on the client record.
                    </p>
                  )}
                </div>
                {lockedClient && (
                  <label className="flex items-center gap-2 rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm font-semibold text-[#374151]">
                    <input
                      type="checkbox"
                      checked={!useClientRepresentative}
                      onChange={(event) => setUseClientRepresentative(!event.target.checked)}
                      className="h-4 w-4 rounded border-[#D1D5DB] text-[#2F80ED] focus:ring-[#2F80ED]"
                    />
                    Use Different Representative
                  </label>
                )}
              </div>

              {(!lockedClient || !useClientRepresentative) ? (
                <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <TextInput label="Representative Name" registration={register("representative.rep_name")} error={errors.representative?.rep_name?.message} />
                  <TextInput label="Representative Age" type="number" registration={register("representative.rep_age", { valueAsNumber: true })} error={errors.representative?.rep_age?.message} />
                  <TextInput label="Representative Sex" registration={register("representative.rep_sex")} error={errors.representative?.rep_sex?.message} />
                  <TextInput label="Civil Status" registration={register("representative.civil_status")} error={errors.representative?.civil_status?.message} />
                  <TextInput label="Representative Address" registration={register("representative.rep_address")} error={errors.representative?.rep_address?.message} />
                  <TextInput label="Representative Contact No." registration={register("representative.rep_contact_no")} error={errors.representative?.rep_contact_no?.message} />
                  <TextInput label="Relationship to Applicant" registration={register("representative.relationship_to_applicant")} error={errors.representative?.relationship_to_applicant?.message} />
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-4">
                  <p className="text-sm font-semibold text-[#1E3A8A]">
                    {selectedClient?.client_details.representative_name || selectedClient?.client.name || "Client representative"}
                  </p>
                  <p className="mt-1 text-sm text-[#1E40AF]">
                    {selectedClient?.client_details.representative_relationship || "Representative details will be copied into this case."}
                  </p>
                </div>
              )}
            </section>

            <section className="border-t border-[#E5E7EB] pt-4">
              <h3 className="text-sm font-semibold text-[#111827]">VIII-A Adverse Party</h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <TextInput label="Adverse Party Role" registration={register("adverse_party.role")} error={errors.adverse_party?.role?.message} />
                <TextInput label="Adverse Party Name" registration={register("adverse_party.name")} error={errors.adverse_party?.name?.message} />
                <div className="md:col-span-2">
                  <TextInput label="Adverse Party Address" registration={register("adverse_party.address")} error={errors.adverse_party?.address?.message} />
                </div>
              </div>
            </section>

            <section className="border-t border-[#E5E7EB] pt-4">
              <h3 className="text-sm font-semibold text-[#111827]">Case Status</h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-[#111827]/80">
                    Status of Case
                    <FieldStatus status={indicators["cases.status_of_case"]} />
                  </span>
                  <select {...register("cases.status_of_case")} className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition duration-200 focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/15">
                    <option>Pending</option>
                    <option>Ongoing</option>
                    <option>Active</option>
                    <option>Terminated</option>
                    <option>Archived</option>
                  </select>
                </label>
                <TextInput label="Last Action Taken" registration={register("cases.last_action_taken")} error={errors.cases?.last_action_taken?.message} />
                <TextInput label="Date of Confinement" type="date" registration={register("cases.date_of_confinement")} />
                <TextInput label="Place of Detention" registration={register("cases.place_of_detention")} />
                <label className="block">
                  <span className="text-sm font-medium text-[#111827]/80">Location Type</span>
                  <select {...register("cases.location_type")} className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition duration-200 focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/15">
                    <option value="">Select</option>
                    <option>Urban</option>
                    <option>Rural</option>
                  </select>
                </label>
                <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#111827]/80">
                  <input type="checkbox" {...register("cases.pending_in_court")} className="h-4 w-4 rounded border-[#E5E7EB] text-[#2F80ED] focus:ring-[#2F80ED]" />
                  Pending in Court?
                </label>
                <div className="md:col-span-2 lg:col-span-3">
                  <TextArea label="VIII-B Facts of Case" registration={register("cases.facts_of_case")} error={errors.cases?.facts_of_case?.message} status={indicators["cases.facts_of_case"]} />
                </div>
                <div className="md:col-span-2 lg:col-span-3">
                  <TextArea label="VIII-C Cause of Action / Nature of Offense" registration={register("cases.cause_of_action")} error={errors.cases?.cause_of_action?.message} status={indicators["cases.cause_of_action"]} />
                </div>
                {pendingInCourt && (
                  <div className="md:col-span-2 lg:col-span-3">
                    <h4 className="mb-3 text-sm font-semibold text-[#111827]">VIII-D Pending Court Details</h4>
                    <div className="grid gap-4 md:grid-cols-3">
                      <TextInput label="Title of Case" registration={register("cases.title_of_case")} error={errors.cases?.title_of_case?.message} status={indicators["cases.title_of_case"]} />
                      <TextInput label="Docket Number" registration={register("cases.case_no")} error={errors.cases?.case_no?.message} status={indicators["cases.case_no"]} />
                      <TextInput label="Court / Body / Tribunal" registration={register("cases.court_body")} error={errors.cases?.court_body?.message} status={indicators["cases.court_body"]} />
                    </div>
                  </div>
                )}
                {status === "Terminated" && (
                  <>
                    <TextInput label="Cause of Termination" registration={register("cases.cause_of_termination")} status={indicators["cases.cause_of_termination"]} />
                    <TextInput label="Date of Termination" type="date" registration={register("cases.date_of_termination")} status={indicators["cases.date_of_termination"]} />
                  </>
                )}
              </div>
            </section>

            <section className="border-t border-[#E5E7EB] pt-4">
              <h3 className="text-sm font-semibold text-[#111827]">Incident Location</h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-[#111827]/80">Barangay</span>
                  <select {...register("cases.incident_barangay")} className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#111827] outline-none transition duration-200 focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/15">
                    <option value="">Select barangay</option>
                    {panaboBarangays.map((barangay) => (
                      <option key={barangay}>{barangay}</option>
                    ))}
                  </select>
                </label>
                <TextInput label="City" registration={register("cases.incident_city")} />
                <div className="lg:col-span-3">
                  <TextInput label="Incident Address" registration={register("cases.incident_address")} />
                </div>
                <TextInput label="Latitude (optional)" registration={register("cases.latitude")} />
                <TextInput label="Longitude (optional)" registration={register("cases.longitude")} />
              </div>
            </section>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 flex justify-between border-t border-[#E5E7EB] bg-[#F3F4F6] px-6 py-4">
        <button
          type="button"
          onClick={() => setStep((current) => Math.max(current - 1, 0))}
          disabled={step === 0}
          className="rounded-md border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-medium text-[#6B7280] transition duration-200 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Back
        </button>

        <div className="flex flex-wrap justify-end gap-2">
          {!lockedClient && step > 0 && (
            <button type="button" onClick={() => setStep(0)} className="rounded-md border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-medium text-[#6B7280] transition duration-200 hover:bg-gray-50">
              Change Client
            </button>
          )}
          {isCaseFormStep && (
            <button type="button" onClick={() => setStep(lockedClient ? 0 : 1)} className="rounded-md border border-[#2F80ED] bg-white px-4 py-2 text-sm font-semibold text-[#2F80ED] transition duration-200 hover:bg-[#2F80ED] hover:text-white">
              Change Method
            </button>
          )}
          {!lockedClient && step === 0 && (
            <button type="button" onClick={continueFromClient} className="rounded-md bg-[#2F80ED] px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-[#1f6fd6]">
              Continue
            </button>
          )}
          {isMethodStep && (
            <button type="button" onClick={continueFromMethod} disabled={!method} className="rounded-md bg-[#2F80ED] px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-[#1f6fd6] disabled:cursor-not-allowed disabled:opacity-50">
              Continue
            </button>
          )}
          {isCaseFormStep && (
            <button type="submit" className="rounded-md bg-[#2F80ED] px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-[#1f6fd6]">
              {submitLabel}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
