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
import {
  caseFormSchema,
  type CaseFormValues,
} from "../../features/criminalCases/schemas";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import {
  dataUrlToFile,
  extractCaseFromDocument,
  type CaseExtractionResult,
  type ExtractionEngineMode,
} from "../../services/documentExtractionService";
import type {
  ClientRecord,
  ExtractionMap,
  ExtractionStatus,
  IntakeMethod,
} from "../../types";

type CaseOcrPayload = CaseExtractionResult["extracted"];

const extractionEngineLabels: Record<ExtractionEngineMode, string> = {
  auto: "Auto",
  offline: "Offline PaddleOCR",
  cloud: "Cloud Vision",
};

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
    coi_agree_different_office: false,
    coi_agree_same_dept_appeal: false,
    coi_waive_right_to_complain: false,
    coi_trust_assigned_counsel: false,
    proof_submission_deadline: "",
    proof_itr_date: "",
    proof_brgy_date: "",
    proof_dswd_date: "",
    proof_others_details: "",
    proof_others_date: "",
    inv_plaintiff: false,
    inv_defendant: false,
    inv_oppositor: false,
    inv_petitioner: false,
    inv_respondent: false,
    inv_complainant: false,
    inv_accused: false,
    inv_others: "",
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
  "intake_record.coi_agree_different_office",
  "intake_record.coi_agree_same_dept_appeal",
  "intake_record.coi_waive_right_to_complain",
  "intake_record.coi_trust_assigned_counsel",
  "intake_record.proof_submission_deadline",
  "intake_record.proof_itr_date",
  "intake_record.proof_brgy_date",
  "intake_record.proof_dswd_date",
  "intake_record.proof_others_details",
  "intake_record.proof_others_date",
  "intake_record.inv_plaintiff",
  "intake_record.inv_defendant",
  "intake_record.inv_oppositor",
  "intake_record.inv_petitioner",
  "intake_record.inv_respondent",
  "intake_record.inv_complainant",
  "intake_record.inv_accused",
  "intake_record.inv_others",
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
  "Buenavista",
  "Cacao",
  "Cagangohan",
  "Consolacion",
  "Dapco",
  "Datu Abdul Dadia",
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
  return <p className="mt-1 text-xs text-rose-400">{message}</p>;
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
  status?: ExtractionStatus;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-600">
        {label}
        <FieldStatus status={status} />
      </span>
      <input
        type={type}
        {...registration}
        className="mt-1 w-full rounded-lg border border-parchment-300 bg-card px-3 py-2 text-sm text-gray-800 outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
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
  status?: ExtractionStatus;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-600">
        {label}
        <FieldStatus status={status} />
      </span>
      <textarea
        {...registration}
        rows={4}
        className="mt-1 w-full rounded-lg border border-parchment-300 bg-card px-3 py-2 text-sm text-gray-800 outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
      />
      <FieldError message={error} />
    </label>
  );
}

function CheckboxInput({
  label,
  registration,
  status,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  status?: ExtractionStatus;
}) {
  return (
    <label className="flex items-center gap-3 rounded-lg border border-line bg-parchment-100 px-3 py-2 text-sm font-medium text-gray-900/80">
      <input
        type="checkbox"
        {...registration}
        className="h-4 w-4 rounded border-line text-brand-500 focus:ring-brand-500"
      />
      <span>
        {label}
        <FieldStatus status={status} />
      </span>
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

function getPayloadValue(
  source: CaseOcrPayload,
  path: FieldPath<CaseFormValues>,
) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function getFirstValidationMessage(errors: unknown): string | null {
  if (!errors || typeof errors !== "object") return null;

  for (const value of Object.values(errors as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;

    const nestedMessage = getFirstValidationMessage(value);
    if (nestedMessage) return nestedMessage;
  }

  return null;
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
      className={`rounded-lg border bg-card p-5 text-left shadow-sm  transition duration-200 hover:shadow-md ${
        selected
          ? "border-brand-600 shadow-brand-600/20"
          : "border-line hover:border-brand-600"
      }`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600/10 text-brand-600">
        <i className={`fa-solid ${icon}`} aria-hidden="true" />
      </div>
      <p className="mt-4 text-base font-semibold text-gray-800">{title}</p>
      <p className="mt-2 text-sm leading-6 text-gray-600">{description}</p>
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
    <div className="rounded-lg border border-line bg-card p-4 shadow-sm ">
      {locked && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-600">
          Client selected automatically
        </p>
      )}
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
          {initials(client.client.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-gray-800">
            {client.client.name}
          </p>
          <div className="mt-2 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
            <span>Sex: {client.client.sex || "-"}</span>
            <span>Age: {client.client.age || "-"}</span>
            <span className="sm:col-span-2">
              Address: {client.client_details.address || "-"}
            </span>
          </div>
        </div>
      </div>
      {!locked && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onChange}
            className="rounded-lg border border-brand-600 bg-card px-3 py-1.5 text-xs font-semibold text-brand-600 transition duration-200 hover:bg-brand-50 hover:text-brand-700"
          >
            Change Client
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-gray-600 transition duration-200 hover:bg-parchment-100"
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
  const addNotification = useNotificationStore(
    (state) => state.addNotification,
  );
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [method, setMethod] = useState<IntakeMethod | null>(null);
  const [query, setQuery] = useState("");
  const [activeClientIndex, setActiveClientIndex] = useState(0);
  const [documentPreview, setDocumentPreview] = useState<string | null>(null);
  const [documentLabel, setDocumentLabel] = useState("");
  const [indicators, setIndicators] = useState<ExtractionMap>({});
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionEngine, setExtractionEngine] =
    useState<ExtractionEngineMode>("auto");
  const [replaceExistingWithOcr, setReplaceExistingWithOcr] = useState(false);
  const [useClientRepresentative, setUseClientRepresentative] = useState(
    Boolean(lockedClient),
  );
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
    lockedClient ??
    clients.find((client) => client.client_id === selectedClientId);
  const status = watch("cases.status_of_case");
  const applicantRole = watch("intake_record.applicant_role");
  const pendingInCourt = watch("cases.pending_in_court");
  const hasSearch = query.trim().length > 0;
  const filteredClients = useMemo(() => {
    if (!hasSearch) return [];
    const normalized = query.trim().toLowerCase();
    return clients.filter((client) =>
      `${client.client_id} ${client.client.name}`
        .toLowerCase()
        .includes(normalized),
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
    setValue(
      "representative.rep_name",
      selectedClient.client_details.representative_name || "Not applicable",
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "representative.rep_age",
      selectedClient.client_details.representative_age || 0,
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "representative.rep_sex",
      selectedClient.client_details.representative_sex ||
        selectedClient.client.sex ||
        "",
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "representative.civil_status",
      selectedClient.client_details.representative_civil_status || "",
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "representative.rep_address",
      selectedClient.client_details.representative_address ||
        selectedClient.client_details.address ||
        "",
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "representative.rep_contact_no",
      selectedClient.client_details.representative_contact_no ||
        selectedClient.client_details.contact_no ||
        "",
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "representative.relationship_to_applicant",
      selectedClient.client_details.representative_relationship ||
        "Client representative",
      { shouldDirty: true, shouldValidate: true },
    );
  }, [selectedClient, setValue, useClientRepresentative]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const selectClient = (client: ClientRecord) => {
    setValue("client_id", client.client_id, {
      shouldValidate: true,
      shouldDirty: true,
    });
    setQuery(client.client.name);
  };

  const clearClient = () => {
    setValue("client_id", "", { shouldValidate: true, shouldDirty: true });
    setQuery("");
  };

  const handleClientSearchKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveClientIndex((current) =>
        Math.min(current + 1, visibleClients.length - 1),
      );
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
      const isEmpty =
        current === "" ||
        current === false ||
        current === undefined ||
        current === null;
      const canOverwriteDefault = overwriteDefaultOcrFields.has(path);

      if (
        (isEmpty || canOverwriteDefault || replaceExistingWithOcr) &&
        extracted !== undefined &&
        extracted !== null &&
        extracted !== ""
      ) {
        setValue(path, extracted as never, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    });
  };

  const runOcr = async (file: File, preview: string, label: string) => {
    setDocumentPreview(preview);
    setDocumentLabel(label);
    setIsExtracting(true);
    const toastId = toast.loading("Extracting case fields...");

    try {
      const result = await extractCaseFromDocument(file, {
        userId: user?.user_id,
        extractionMode: extractionEngine,
      });
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
      toast.error(error instanceof Error ? error.message : "OCR failed", {
        id: toastId,
      });
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

    const file = await dataUrlToFile(
      captured,
      `live-case-scan-${Date.now()}.png`,
    );
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
      toast.error(
        error instanceof Error ? error.message : "Unable to save case",
      );
    }
  };

  return (
    <form
      onSubmit={handleSubmit(submitCase, () =>
        toast.error(
          getFirstValidationMessage(errors) ??
            "Please resolve validation errors before saving.",
        ),
      )}
      className="flex max-h-[calc(92vh-138px)] flex-col"
    >
      <div className="border-b border-line bg-card px-6 py-4">
        <StepIndicator steps={steps} currentStep={step} />
      </div>

      <div className="flex-1 overflow-y-auto bg-card px-6 py-5">
        {!lockedClient && step === 0 && (
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-gray-600">
                  Search existing client
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={handleClientSearchKeyDown}
                  placeholder="Search by name or client id"
                  className="mt-1 w-full rounded-lg border border-parchment-300 bg-card px-3 py-2 text-sm text-gray-800 outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
                  aria-label="Search existing clients"
                />
              </label>
              <p className="text-sm text-gray-600">
                Search by client name or client ID to locate an existing client.
              </p>
              <FieldError message={errors.client_id?.message} />

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={clearClient}
                  className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-gray-600 transition duration-200 hover:bg-gray-200 hover:text-gray-800"
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

            <div className="overflow-hidden rounded-lg border border-line">
              <div className="sticky top-0 border-b border-line bg-parchment-100 px-4 py-3 text-sm font-semibold text-gray-600">
                Existing Clients
              </div>
              <div className="max-h-96 divide-y divide-line overflow-y-auto">
                {!hasSearch ? (
                  <div className="px-4 py-8 text-center text-sm text-gray-600">
                    Start typing to search clients.
                  </div>
                ) : visibleClients.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-gray-600">
                    No matching clients found.
                  </div>
                ) : (
                  visibleClients.map((client, index) => (
                    <button
                      type="button"
                      key={client.client_id}
                      onClick={() => selectClient(client)}
                      className={`block w-full px-4 py-3 text-left transition duration-200 hover:bg-parchment-100 ${
                        selectedClientId === client.client_id ||
                        activeClientIndex === index
                          ? "bg-brand-50"
                          : "bg-card"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">
                            {client.client.name}
                          </p>
                          <p className="mt-1 text-xs text-gray-600">
                            {client.client_id}
                          </p>
                        </div>
                        <span className="text-xs font-medium text-gray-600">
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
              <MethodCard
                value="manual"
                title="Manual Entry"
                description="Enter case data manually."
                icon="fa-keyboard"
                selected={method === "manual"}
                onSelect={setMethod}
              />
              <MethodCard
                value="camera"
                title="Live OCR Scan"
                description="Use live camera scanning."
                icon="fa-camera"
                selected={method === "camera"}
                onSelect={setMethod}
              />
              <MethodCard
                value="upload"
                title="Upload Document"
                description="Upload a case document image."
                icon="fa-upload"
                selected={method === "upload"}
                onSelect={setMethod}
              />
            </div>
          </div>
        )}

        {isCaseFormStep && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-parchment-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  {lockedClient
                    ? "Client selected automatically"
                    : selectedClient?.client.name || "No client selected"}
                </p>
                {lockedClient && (
                  <p className="text-sm text-gray-800">
                    {lockedClient.client.name}
                  </p>
                )}
                <p className="text-xs text-gray-600">
                  Method:{" "}
                  {method === "manual"
                    ? "Manual Entry"
                    : method === "camera"
                      ? "Live OCR Scan"
                      : "Upload Document"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!lockedClient && (
                  <button
                    type="button"
                    onClick={() => setStep(0)}
                    className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-gray-600 transition duration-200 hover:bg-parchment-100"
                  >
                    Change Client
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setStep(lockedClient ? 0 : 1)}
                  className="rounded-lg border border-brand-600 bg-card px-3 py-1.5 text-xs font-semibold text-brand-600 transition duration-200 hover:bg-brand-50 hover:text-brand-700"
                >
                  Change Method
                </button>
              </div>
            </div>

            {method !== "manual" && (
              <div className="grid gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 md:grid-cols-[minmax(0,1fr)_220px]">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={replaceExistingWithOcr}
                    onChange={(event) =>
                      setReplaceExistingWithOcr(event.target.checked)
                    }
                    className="mt-0.5 h-4 w-4 rounded border-brand-500 text-brand-500 focus:ring-brand-500"
                  />
                  <span>
                    <span className="block font-semibold">
                      Replace existing fields with scanned values
                    </span>
                    <span className="mt-1 block text-brand-800">
                      Leave this off to fill only blank fields. Form Date is
                      always updated from Petsa when the scan finds it.
                    </span>
                  </span>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-brand-900">
                    OCR Engine
                  </span>
                  <select
                    value={extractionEngine}
                    onChange={(event) =>
                      setExtractionEngine(
                        event.target.value as ExtractionEngineMode,
                      )
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-brand-300 bg-card px-3 text-sm font-semibold text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  >
                    {Object.entries(extractionEngineLabels).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
            )}

            {method === "camera" && (
              <div className="rounded-lg border border-line bg-parchment-100 p-4">
                <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    className="aspect-video w-full rounded-lg border border-line bg-card object-cover"
                  />
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={startCamera}
                      className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:bg-brand-700"
                    >
                      Start Camera
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="w-full rounded-lg border border-line bg-card px-4 py-2 text-sm font-semibold text-gray-600 transition duration-200 hover:bg-parchment-100"
                    >
                      Stop Camera
                    </button>
                    <button
                      type="button"
                      disabled={!isCameraActive || isExtracting}
                      onClick={handleCapture}
                      className="w-full rounded-lg border border-brand-600 bg-card px-4 py-2 text-sm font-semibold text-brand-600 transition duration-200 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
                    >
                      {isExtracting ? "Extracting..." : "Capture Case Fields"}
                    </button>
                    {cameraError && (
                      <p className="text-sm text-red-600">{cameraError}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {method === "upload" && (
              <div className="rounded-lg border border-dashed border-line bg-parchment-100 p-4">
                <label className="block">
                  <span className="text-sm font-semibold text-gray-600">
                    Upload case document image
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUpload}
                    className="mt-3 block w-full text-sm text-gray-600 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                  />
                </label>
              </div>
            )}

            {hasOcrResult && (
              <div className="grid gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 lg:grid-cols-[220px_1fr]">
                <div>
                  {documentPreview ? (
                    <img
                      src={documentPreview}
                      alt="Document preview"
                      className="max-h-40 w-full rounded-lg border border-emerald-200 object-cover"
                    />
                  ) : (
                    <div className="flex h-32 items-center justify-center rounded-lg border border-emerald-200 bg-card text-sm font-medium text-emerald-700">
                      {documentLabel || "PDF document"}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-800">
                    Review extracted case fields before saving.
                  </p>
                  <p className="mt-1 text-sm text-emerald-700">
                    OCR maps Filipino PAO labels like Petsa, Control No.,
                    Rehiyon, and request details into the case fields.
                  </p>
                </div>
              </div>
            )}

            <section className="border-t border-line pt-4 first:border-t-0 first:pt-0">
              <h3 className="text-sm font-semibold text-gray-800">
                Case Identification
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <TextInput
                  label="Control No."
                  registration={register("intake_record.control_no")}
                  error={errors.intake_record?.control_no?.message}
                  status={indicators["intake_record.control_no"]}
                />
                <TextInput
                  label="Form Date"
                  registration={register("intake_record.form_date")}
                  error={errors.intake_record?.form_date?.message}
                  status={indicators["intake_record.form_date"]}
                />
                <TextInput
                  label="Region"
                  registration={register("intake_record.region")}
                  error={errors.intake_record?.region?.message}
                  status={indicators["intake_record.region"]}
                />
                <TextInput
                  label="District Office"
                  registration={register("intake_record.district_office")}
                  error={errors.intake_record?.district_office?.message}
                  status={indicators["intake_record.district_office"]}
                />
                <TextInput
                  label="Party Represented"
                  registration={register("intake_record.party_represented")}
                  error={errors.intake_record?.party_represented?.message}
                />
                <TextInput
                  label="Nature of Request"
                  registration={register("intake_record.nature_of_request")}
                  error={errors.intake_record?.nature_of_request?.message}
                />
                <TextInput
                  label="Nature of Case"
                  registration={register("intake_record.nature_of_case")}
                  error={errors.intake_record?.nature_of_case?.message}
                />
              </div>
            </section>

            <section className="border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-gray-900">
                Conflict of Interest Agreement
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <CheckboxInput
                  label="Different office may assist if conflict exists"
                  registration={register(
                    "intake_record.coi_agree_different_office",
                  )}
                  status={
                    indicators["intake_record.coi_agree_different_office"]
                  }
                />
                <CheckboxInput
                  label="Same department appeal may proceed"
                  registration={register(
                    "intake_record.coi_agree_same_dept_appeal",
                  )}
                  status={
                    indicators["intake_record.coi_agree_same_dept_appeal"]
                  }
                />
                <CheckboxInput
                  label="Waives right to complain on conflict handling"
                  registration={register(
                    "intake_record.coi_waive_right_to_complain",
                  )}
                  status={
                    indicators["intake_record.coi_waive_right_to_complain"]
                  }
                />
                <CheckboxInput
                  label="Trusts assigned counsel"
                  registration={register(
                    "intake_record.coi_trust_assigned_counsel",
                  )}
                  status={
                    indicators["intake_record.coi_trust_assigned_counsel"]
                  }
                />
              </div>
            </section>

            <section className="border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-gray-900">
                Proof of Qualification
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <TextInput
                  label="Submission Deadline"
                  type="date"
                  registration={register(
                    "intake_record.proof_submission_deadline",
                  )}
                  error={
                    errors.intake_record?.proof_submission_deadline?.message
                  }
                  status={indicators["intake_record.proof_submission_deadline"]}
                />
                <TextInput
                  label="ITR Date"
                  type="date"
                  registration={register("intake_record.proof_itr_date")}
                  error={errors.intake_record?.proof_itr_date?.message}
                  status={indicators["intake_record.proof_itr_date"]}
                />
                <TextInput
                  label="Barangay Certification Date"
                  type="date"
                  registration={register("intake_record.proof_brgy_date")}
                  error={errors.intake_record?.proof_brgy_date?.message}
                  status={indicators["intake_record.proof_brgy_date"]}
                />
                <TextInput
                  label="DSWD Certification Date"
                  type="date"
                  registration={register("intake_record.proof_dswd_date")}
                  error={errors.intake_record?.proof_dswd_date?.message}
                  status={indicators["intake_record.proof_dswd_date"]}
                />
                <TextInput
                  label="Other Proof Date"
                  type="date"
                  registration={register("intake_record.proof_others_date")}
                  error={errors.intake_record?.proof_others_date?.message}
                  status={indicators["intake_record.proof_others_date"]}
                />
                <TextInput
                  label="Other Proof Details"
                  registration={register("intake_record.proof_others_details")}
                  error={errors.intake_record?.proof_others_details?.message}
                  status={indicators["intake_record.proof_others_details"]}
                />
              </div>
            </section>

            <section className="border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-gray-800">
                VIII Applicant Case Involvement
              </h3>
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
                  <label
                    key={role}
                    className="flex items-center gap-3 rounded-lg border border-line bg-parchment-100 px-3 py-2 text-sm font-medium text-gray-600"
                  >
                    <input
                      type="radio"
                      value={role}
                      {...register("intake_record.applicant_role")}
                      className="h-4 w-4 border-line text-brand-600 focus:ring-brand-600"
                    />
                    {role}
                  </label>
                ))}
              </div>
              <FieldError
                message={errors.intake_record?.applicant_role?.message}
              />
              {applicantRole === "Others" && (
                <div className="mt-3 max-w-md">
                  <TextInput
                    label="Specify Role"
                    registration={register(
                      "intake_record.applicant_role_other",
                    )}
                    error={errors.intake_record?.applicant_role_other?.message}
                  />
                </div>
              )}
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <CheckboxInput
                  label="Plaintiff"
                  registration={register("intake_record.inv_plaintiff")}
                  status={indicators["intake_record.inv_plaintiff"]}
                />
                <CheckboxInput
                  label="Defendant"
                  registration={register("intake_record.inv_defendant")}
                  status={indicators["intake_record.inv_defendant"]}
                />
                <CheckboxInput
                  label="Oppositor"
                  registration={register("intake_record.inv_oppositor")}
                  status={indicators["intake_record.inv_oppositor"]}
                />
                <CheckboxInput
                  label="Petitioner"
                  registration={register("intake_record.inv_petitioner")}
                  status={indicators["intake_record.inv_petitioner"]}
                />
                <CheckboxInput
                  label="Respondent"
                  registration={register("intake_record.inv_respondent")}
                  status={indicators["intake_record.inv_respondent"]}
                />
                <CheckboxInput
                  label="Complainant"
                  registration={register("intake_record.inv_complainant")}
                  status={indicators["intake_record.inv_complainant"]}
                />
                <CheckboxInput
                  label="Accused"
                  registration={register("intake_record.inv_accused")}
                  status={indicators["intake_record.inv_accused"]}
                />
                <TextInput
                  label="Others"
                  registration={register("intake_record.inv_others")}
                  error={errors.intake_record?.inv_others?.message}
                  status={indicators["intake_record.inv_others"]}
                />
              </div>
            </section>

            <section className="border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">
                    Representative
                  </h3>
                  {lockedClient && useClientRepresentative && (
                    <p className="mt-1 text-sm text-gray-600">
                      Using representative details already saved on the client
                      record.
                    </p>
                  )}
                </div>
                {lockedClient && (
                  <label className="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm font-semibold text-gray-600">
                    <input
                      type="checkbox"
                      checked={!useClientRepresentative}
                      onChange={(event) =>
                        setUseClientRepresentative(!event.target.checked)
                      }
                      className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-600"
                    />
                    Use Different Representative
                  </label>
                )}
              </div>

              {!lockedClient || !useClientRepresentative ? (
                <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <TextInput
                    label="Representative Name"
                    registration={register("representative.rep_name")}
                    error={errors.representative?.rep_name?.message}
                  />
                  <TextInput
                    label="Representative Age"
                    type="number"
                    registration={register("representative.rep_age", {
                      valueAsNumber: true,
                    })}
                    error={errors.representative?.rep_age?.message}
                  />
                  <label className="block">
                    <span className="text-sm font-medium text-gray-600">
                      Representative Sex
                    </span>
                    <select
                      {...register("representative.rep_sex")}
                      className="mt-1 w-full rounded-lg border border-parchment-300 px-3 py-2 text-sm text-gray-800 outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
                    >
                      <option value="">Select</option>
                      <option>Male</option>
                      <option>Female</option>
                    </select>
                    <FieldError
                      message={errors.representative?.rep_sex?.message}
                    />
                  </label>
                  <TextInput
                    label="Civil Status"
                    registration={register("representative.civil_status")}
                    error={errors.representative?.civil_status?.message}
                  />
                  <TextInput
                    label="Representative Address"
                    registration={register("representative.rep_address")}
                    error={errors.representative?.rep_address?.message}
                  />
                  <TextInput
                    label="Representative Contact No."
                    registration={register("representative.rep_contact_no")}
                    error={errors.representative?.rep_contact_no?.message}
                  />
                  <TextInput
                    label="Relationship to Applicant"
                    registration={register(
                      "representative.relationship_to_applicant",
                    )}
                    error={
                      errors.representative?.relationship_to_applicant?.message
                    }
                  />
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-4">
                  <p className="text-sm font-semibold text-brand-700">
                    {selectedClient?.client_details.representative_name ||
                      selectedClient?.client.name ||
                      "Client representative"}
                  </p>
                  <p className="mt-1 text-sm text-brand-700">
                    {selectedClient?.client_details
                      .representative_relationship ||
                      "Representative details will be copied into this case."}
                  </p>
                </div>
              )}
            </section>

            <section className="border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-gray-800">
                VIII-A Adverse Party
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <TextInput
                  label="Adverse Party Role"
                  registration={register("adverse_party.role")}
                  error={errors.adverse_party?.role?.message}
                />
                <TextInput
                  label="Adverse Party Name"
                  registration={register("adverse_party.name")}
                  error={errors.adverse_party?.name?.message}
                />
                <div className="md:col-span-2">
                  <TextInput
                    label="Adverse Party Address"
                    registration={register("adverse_party.address")}
                    error={errors.adverse_party?.address?.message}
                  />
                </div>
              </div>
            </section>

            <section className="border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-gray-800">
                Case Status
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-gray-600">
                    Status of Case
                    <FieldStatus status={indicators["cases.status_of_case"]} />
                  </span>
                  <select
                    {...register("cases.status_of_case")}
                    className="mt-1 w-full rounded-lg border border-parchment-300 px-3 py-2 text-sm text-gray-800 outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
                  >
                    <option>Pending</option>
                    <option>Ongoing</option>
                    <option>Active</option>
                    <option>Terminated</option>
                    <option>Archived</option>
                  </select>
                </label>
                <TextInput
                  label="Last Action Taken"
                  registration={register("cases.last_action_taken")}
                  error={errors.cases?.last_action_taken?.message}
                />
                <TextInput
                  label="Date of Confinement"
                  type="date"
                  registration={register("cases.date_of_confinement")}
                />
                <TextInput
                  label="Place of Detention"
                  registration={register("cases.place_of_detention")}
                />
                <label className="block">
                  <span className="text-sm font-medium text-gray-600">
                    Location Type
                  </span>
                  <select
                    {...register("cases.location_type")}
                    className="mt-1 w-full rounded-lg border border-parchment-300 px-3 py-2 text-sm text-gray-800 outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
                  >
                    <option value="">Select</option>
                    <option>Urban</option>
                    <option>Rural</option>
                  </select>
                </label>
                <label className="flex items-center gap-3 rounded-lg border border-line bg-parchment-100 px-3 py-2 text-sm font-medium text-gray-600">
                  <input
                    type="checkbox"
                    {...register("cases.pending_in_court")}
                    className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-600"
                  />
                  Pending in Court?
                </label>
                <div className="md:col-span-2 lg:col-span-3">
                  <TextArea
                    label="VIII-B Facts of Case"
                    registration={register("cases.facts_of_case")}
                    error={errors.cases?.facts_of_case?.message}
                    status={indicators["cases.facts_of_case"]}
                  />
                </div>
                <div className="md:col-span-2 lg:col-span-3">
                  <TextArea
                    label="VIII-C Cause of Action / Nature of Offense"
                    registration={register("cases.cause_of_action")}
                    error={errors.cases?.cause_of_action?.message}
                    status={indicators["cases.cause_of_action"]}
                  />
                </div>
                {pendingInCourt && (
                  <div className="md:col-span-2 lg:col-span-3">
                    <h4 className="mb-3 text-sm font-semibold text-gray-800">
                      VIII-D Pending Court Details
                    </h4>
                    <div className="grid gap-4 md:grid-cols-3">
                      <TextInput
                        label="Title of Case"
                        registration={register("cases.title_of_case")}
                        error={errors.cases?.title_of_case?.message}
                        status={indicators["cases.title_of_case"]}
                      />
                      <TextInput
                        label="Docket Number"
                        registration={register("cases.case_no")}
                        error={errors.cases?.case_no?.message}
                        status={indicators["cases.case_no"]}
                      />
                      <TextInput
                        label="Court / Body / Tribunal"
                        registration={register("cases.court_body")}
                        error={errors.cases?.court_body?.message}
                        status={indicators["cases.court_body"]}
                      />
                    </div>
                  </div>
                )}
                {status === "Terminated" && (
                  <>
                    <TextInput
                      label="Cause of Termination"
                      registration={register("cases.cause_of_termination")}
                      status={indicators["cases.cause_of_termination"]}
                    />
                    <TextInput
                      label="Date of Termination"
                      type="date"
                      registration={register("cases.date_of_termination")}
                      status={indicators["cases.date_of_termination"]}
                    />
                  </>
                )}
              </div>
            </section>

            <section className="border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-gray-800">
                Incident Location
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-gray-600">
                    Barangay
                  </span>
                  <select
                    {...register("cases.incident_barangay")}
                    className="mt-1 w-full rounded-lg border border-parchment-300 px-3 py-2 text-sm text-gray-800 outline-none transition duration-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
                  >
                    <option value="">Select barangay</option>
                    {panaboBarangays.map((barangay) => (
                      <option key={barangay}>{barangay}</option>
                    ))}
                  </select>
                </label>
                <TextInput
                  label="City"
                  registration={register("cases.incident_city")}
                />
                <div className="lg:col-span-3">
                  <TextInput
                    label="Incident Address"
                    registration={register("cases.incident_address")}
                  />
                </div>
                <TextInput
                  label="Latitude (optional)"
                  registration={register("cases.latitude")}
                />
                <TextInput
                  label="Longitude (optional)"
                  registration={register("cases.longitude")}
                />
              </div>
            </section>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 flex justify-between border-t border-line bg-card px-6 py-4">
        <button
          type="button"
          onClick={() => setStep((current) => Math.max(current - 1, 0))}
          disabled={step === 0}
          className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-gray-600 transition duration-200 hover:bg-gray-200 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Back
        </button>

        <div className="flex flex-wrap justify-end gap-2">
          {!lockedClient && step > 0 && (
            <button
              type="button"
              onClick={() => setStep(0)}
              className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-gray-600 transition duration-200 hover:bg-gray-200 hover:text-gray-800"
            >
              Change Client
            </button>
          )}
          {isCaseFormStep && (
            <button
              type="button"
              onClick={() => setStep(lockedClient ? 0 : 1)}
              className="rounded-lg border border-brand-600 bg-card px-4 py-2 text-sm font-semibold text-brand-600 transition duration-200 hover:bg-brand-50 hover:text-brand-700"
            >
              Change Method
            </button>
          )}
          {!lockedClient && step === 0 && (
            <button
              type="button"
              onClick={continueFromClient}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-brand-700"
            >
              Continue
            </button>
          )}
          {isMethodStep && (
            <button
              type="button"
              onClick={continueFromMethod}
              disabled={!method}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          )}
          {isCaseFormStep && (
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-brand-700"
            >
              {submitLabel}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
