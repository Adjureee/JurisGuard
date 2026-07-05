import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import toast from "react-hot-toast";
import { useForm } from "react-hook-form";
import type {
  FieldPath,
  Resolver,
  UseFormRegisterReturn,
} from "react-hook-form";
import { useAuth } from "../../contexts/AuthContext";
import { useAuditLogStore } from "../../features/auditLogs/auditLogStore";
import { FieldStatus } from "../../features/criminalCases/components/FieldStatus";
import { StepIndicator } from "../../features/criminalCases/components/StepIndicator";
import { useCamera } from "../../features/criminalCases/hooks/useCamera";
import { useCriminalCasesStore } from "../../features/criminalCases/criminalCasesStore";
import {
  clientFormSchema,
  type ClientFormValues,
} from "../../features/criminalCases/schemas";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import {
  dataUrlToFile,
  extractClientFromDocument,
  type ExtractionEngineMode,
} from "../../services/documentExtractionService";
import {
  createCaseRecord,
  createClientRecord,
} from "../../services/recordService";
import type {
  ClientRecord,
  ExtractionMap,
  ExtractedClientPayload,
  IntakeMethod,
} from "../../types";
import { CaseWorkflow } from "./CaseWorkflow";
import ModalPortal from "./ModalPortal";

interface AddClientModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const extractionEngineLabels: Record<ExtractionEngineMode, string> = {
  auto: "Auto",
  offline: "Offline PaddleOCR",
  cloud: "Cloud Vision",
};

const defaultValues: ClientFormValues = {
  client: {
    name: "",
    age: 0,
    sex: "",
    civil_status: "",
    religion: "",
    educational_attainment: "",
    citizenship: "Filipino",
    language_dialect: "",
  },
  client_details: {
    address: "",
    contact_no: "",
    email: "",
    individual_monthly_income: "",
    spouse: "",
    address_of_spouse: "",
    contact_no_of_spouse: "",
    representative_name: "",
    representative_age: 0,
    representative_sex: "",
    representative_civil_status: "",
    representative_address: "",
    representative_contact_no: "",
    representative_relationship: "",
    representative_email: "",
    detained: false,
    detained_since: "",
    place_of_detention: "",
  },
  client_classification: {
    flag_senior: false,
    flag_cicl: false,
    flag_female: false,
    flag_urban: false,
    flag_rural: false,
    flag_drugs: false,
    flag_foreign_national: false,
    flag_vawc_victim: false,
    flag_refugee_evacuee: false,
    flag_law_enforcer: false,
    flag_tenant_agrarian: false,
    flag_ofw_land_based: false,
    flag_ofw_sea_based: false,
    flag_arrested_terrorism: false,
    flag_indigenous_people: false,
    flag_pwd: false,
    flag_former_rebel_fve: false,
    flag_torture_victim: false,
    flag_trafficking_victim: false,
    flag_voluntary_rehab_petitioner: false,
    classification_notes: "",
  },
};

const steps = ["CLIENT", "CLIENT_DETAILS", "CLIENT_CLASSIFICATION"];
const workflowSteps = [
  "Intake Method",
  "Client",
  "Client Details",
  "Classification",
];

const stepFields: Array<Array<FieldPath<ClientFormValues>>> = [
  [
    "client.name",
    "client.age",
    "client.sex",
    "client.civil_status",
    "client.religion",
    "client.educational_attainment",
    "client.citizenship",
    "client.language_dialect",
  ],
  [
    "client_details.address",
    "client_details.contact_no",
    "client_details.email",
    "client_details.individual_monthly_income",
    "client_details.representative_email",
  ],
  [],
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
  status?: ExtractionMap[string];
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-muted">
        {label}
        <FieldStatus status={status} />
      </span>
      <input
        type={type}
        {...registration}
        className="mt-1 w-full rounded-lg border border-line2 bg-card px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
      />
      <FieldError message={error} />
    </label>
  );
}

function SelectInput({
  label,
  registration,
  error,
  status,
  options,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  status?: ExtractionMap[string];
  options: string[];
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-muted">
        {label}
        <FieldStatus status={status} />
      </span>
      <select
        {...registration}
        className="mt-1 w-full rounded-lg border border-line2 bg-card px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
      >
        <option value="">Select</option>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
      <FieldError message={error} />
    </label>
  );
}

function getPayloadValue(
  payload: ExtractedClientPayload,
  path: FieldPath<ClientFormValues>,
) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, payload);
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
      key={value}
      onClick={() => onSelect(value)}
      className={`rounded-lg border bg-card p-5 text-left shadow-sm  transition duration-200 hover:shadow-md ${
        selected
          ? "border-brand-600 shadow-brand-600/20"
          : "border-line hover:border-brand-600"
      }`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600/10 text-brand-600 dark:text-brand-400">
        <i className={`fa-solid ${icon}`} aria-hidden="true" />
      </div>
      <p className="mt-4 text-base font-semibold text-ink">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
    </button>
  );
}

const classificationOptions = [
  ["flag_senior", "Senior Citizen"],
  ["flag_cicl", "Child in Conflict with the Law"],
  ["flag_female", "Female"],
  ["flag_urban", "Urban"],
  ["flag_rural", "Rural"],
  ["flag_drugs", "Drug-related"],
  ["flag_foreign_national", "Foreign National"],
  ["flag_vawc_victim", "VAWC Victim"],
  ["flag_refugee_evacuee", "Refugee / Evacuee"],
  ["flag_law_enforcer", "Law Enforcer"],
  ["flag_tenant_agrarian", "Tenant in Agrarian Case"],
  ["flag_ofw_land_based", "OFW Land-Based"],
  ["flag_ofw_sea_based", "OFW Sea-Based"],
  ["flag_arrested_terrorism", "Arrested for Terrorism"],
  ["flag_indigenous_people", "Indigenous People"],
  ["flag_pwd", "PWD"],
  ["flag_former_rebel_fve", "Former Rebel / FVE"],
  ["flag_torture_victim", "Victim of Torture"],
  ["flag_trafficking_victim", "Victim of Trafficking"],
  ["flag_voluntary_rehab_petitioner", "Petitioner for Voluntary Rehab"],
] as const;

export default function AddClientModal({
  isOpen,
  onClose,
}: AddClientModalProps) {
  const { user } = useAuth();
  const upsertClient = useCriminalCasesStore((state) => state.upsertClient);
  const upsertCase = useCriminalCasesStore((state) => state.upsertCase);
  const addLog = useAuditLogStore((state) => state.addLog);
  const addNotification = useNotificationStore(
    (state) => state.addNotification,
  );
  const [method, setMethod] = useState<IntakeMethod | null>(null);
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<"client" | "case">("client");
  const [createdClient, setCreatedClient] = useState<ClientRecord | null>(null);
  const [documentPreview, setDocumentPreview] = useState<string | null>(null);
  const [documentLabel, setDocumentLabel] = useState("");
  const [indicators, setIndicators] = useState<ExtractionMap>({});
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionEngine, setExtractionEngine] =
    useState<ExtractionEngineMode>("auto");
  const {
    videoRef,
    isCameraActive,
    cameraError,
    startCamera,
    stopCamera,
    captureFrame,
  } = useCamera();
  const {
    register,
    handleSubmit,
    trigger,
    watch,
    reset,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema) as Resolver<ClientFormValues>,
    defaultValues,
    mode: "onBlur",
  });

  if (!isOpen) return null;

  const values = watch();
  const hasOcrResult = Object.keys(indicators).length > 0;

  const closeModal = () => {
    stopCamera();
    reset(defaultValues);
    setMethod(null);
    setStep(0);
    setDocumentPreview(null);
    setDocumentLabel("");
    setIndicators({});
    setPhase("client");
    setCreatedClient(null);
    onClose();
  };

  const applyExtractedPayload = (payload: ExtractedClientPayload) => {
    const fieldPaths = [
      "client.name",
      "client.age",
      "client.sex",
      "client.civil_status",
      "client.religion",
      "client.educational_attainment",
      "client.citizenship",
      "client.language_dialect",
      "client_details.address",
      "client_details.contact_no",
      "client_details.email",
      "client_details.individual_monthly_income",
      "client_details.spouse",
      "client_details.address_of_spouse",
      "client_details.contact_no_of_spouse",
      "client_details.representative_name",
      "client_details.representative_age",
      "client_details.representative_sex",
      "client_details.representative_civil_status",
      "client_details.representative_address",
      "client_details.representative_contact_no",
      "client_details.representative_relationship",
      "client_details.representative_email",
      "client_details.detained",
      "client_details.detained_since",
      "client_details.place_of_detention",
      "client_classification.flag_senior",
      "client_classification.flag_cicl",
      "client_classification.flag_female",
      "client_classification.flag_urban",
      "client_classification.flag_rural",
      "client_classification.flag_drugs",
      "client_classification.flag_foreign_national",
      "client_classification.flag_vawc_victim",
      "client_classification.flag_refugee_evacuee",
      "client_classification.flag_law_enforcer",
      "client_classification.flag_tenant_agrarian",
      "client_classification.flag_ofw_land_based",
      "client_classification.flag_ofw_sea_based",
      "client_classification.flag_arrested_terrorism",
      "client_classification.flag_indigenous_people",
      "client_classification.flag_pwd",
      "client_classification.flag_former_rebel_fve",
      "client_classification.flag_torture_victim",
      "client_classification.flag_trafficking_victim",
      "client_classification.flag_voluntary_rehab_petitioner",
      "client_classification.classification_notes",
    ] as Array<FieldPath<ClientFormValues>>;

    fieldPaths.forEach((path) => {
      const current = getValues(path);
      const extracted = getPayloadValue(payload, path);
      const isEmpty =
        current === "" ||
        current === false ||
        current === 0 ||
        current === undefined;

      if (
        isEmpty &&
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
    const toastId = toast.loading("Extracting client fields...");

    try {
      const result = await extractClientFromDocument(file, {
        userId: user?.user_id,
        extractionMode: extractionEngine,
      });
      setIndicators(result.indicators);
      applyExtractedPayload(result.extracted);
      setStep(0);
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
      `live-client-scan-${Date.now()}.png`,
    );
    await runOcr(file, captured, "Live camera capture");
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
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

  const nextStep = async () => {
    const valid = await trigger(stepFields[step]);
    if (!valid) {
      toast.error(
        getFirstValidationMessage(errors) ??
          "Please resolve validation errors before continuing.",
      );
      return;
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
  };

  const onSubmit = async (data: ClientFormValues) => {
    try {
      const client = await createClientRecord(data);
      upsertClient(client);
      addLog({
        userId: user?.user_id,
        user: user?.full_name || user?.email,
        action: "Create Client",
        module: "Clients",
        description: `Client record created for ${client.client.name}`,
        entityType: "client",
        entityId: client.client_id,
      });
      addNotification({
        type: "client_created",
        userId: user?.user_id,
        title: "Client Record",
        message: "Client successfully created",
        redirectTo: "/criminal-cases",
        entityType: "client",
        entityId: client.client_id,
      });
      toast.success("Client created");
      stopCamera();
      setCreatedClient(client);
      setPhase("case");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create client",
      );
    }
  };

  return (
    <ModalPortal>
      <div
        className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm transition-opacity duration-200"
        role="dialog"
        aria-modal="true"
      >
        <div className="jurisguard-modal-surface max-h-[92vh] w-full max-w-6xl animate-[modalIn_200ms_ease-out] overflow-hidden rounded-2xl border border-line bg-card shadow-xl">
          <div className="border-b border-line bg-card-2 px-6 py-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  Add Client
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {phase === "client"
                    ? "Create client record first."
                    : "Attach criminal case to the new client."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition duration-200 hover:bg-line hover:text-ink"
              >
                Close
              </button>
            </div>
          </div>

          {phase === "case" && createdClient ? (
            <CaseWorkflow
              clients={[]}
              lockedClient={createdClient}
              submitLabel="Save Case"
              onSubmit={async (values) => {
                const record = await createCaseRecord(values);
                upsertCase(record);
                addLog({
                  userId: user?.user_id,
                  user: user?.full_name || user?.email,
                  action: "Create Case",
                  module: "Cases",
                  description: `Case ${record.intake_record.control_no} attached to ${createdClient.client.name}`,
                  entityType: "case",
                  entityId: record.case_id,
                });
                addNotification({
                  type: "case_created",
                  userId: user?.user_id,
                  title: "Case Update",
                  message: "Case attached to new client",
                  redirectTo: `/criminal-cases?case=${encodeURIComponent(record.case_id)}`,
                  entityType: "case",
                  entityId: record.case_id,
                });
                toast.success("Case attached");
                closeModal();
              }}
            />
          ) : !method ? (
            <>
              <div className="border-b border-line bg-card px-6 py-4">
                <StepIndicator steps={workflowSteps} currentStep={0} />
              </div>
              <div className="grid gap-4 bg-card p-6 md:grid-cols-3">
                <MethodCard
                  value="manual"
                  title="Manual Entry"
                  description="Encode client details using a guided form."
                  icon="fa-keyboard"
                  selected={method === "manual"}
                  onSelect={setMethod}
                />
                <MethodCard
                  value="camera"
                  title="Live Camera OCR"
                  description="Start camera, capture a document, then review extracted fields."
                  icon="fa-camera"
                  selected={method === "camera"}
                  onSelect={setMethod}
                />
                <MethodCard
                  value="upload"
                  title="Upload Document OCR"
                  description="Upload an image or PDF and review extracted fields."
                  icon="fa-upload"
                  selected={method === "upload"}
                  onSelect={setMethod}
                />
              </div>
            </>
          ) : (
            <form
              onSubmit={handleSubmit(onSubmit, () =>
                toast.error(
                  getFirstValidationMessage(errors) ??
                    "Please resolve validation errors before saving.",
                ),
              )}
              className="flex max-h-[calc(92vh-74px)] flex-col"
            >
              <div className="border-b border-line bg-card px-6 py-4">
                <StepIndicator steps={workflowSteps} currentStep={step + 1} />
              </div>

              <div className="flex-1 overflow-y-auto bg-card px-6 py-5">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      Method:{" "}
                      {method === "manual"
                        ? "Manual Entry"
                        : method === "camera"
                          ? "Live Camera OCR"
                          : "Upload Document OCR"}
                    </p>
                    <p className="text-xs text-muted">
                      Switch methods anytime without clearing entered fields.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMethod(null)}
                    className="rounded-lg border border-brand-600 bg-card px-3 py-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 transition duration-200 hover:bg-brand-50 dark:hover:bg-brand-400/10 hover:text-brand-700 dark:hover:text-brand-300"
                  >
                    Change Method
                  </button>
                </div>

                {method !== "manual" && (
                  <div className="mb-5 rounded-lg border border-brand-200 dark:border-brand-400/30 bg-brand-50 dark:bg-brand-400/10 px-4 py-3">
                    <label className="block max-w-xs">
                      <span className="text-xs font-semibold uppercase text-brand-900 dark:text-brand-100">
                        OCR Engine
                      </span>
                      <select
                        value={extractionEngine}
                        onChange={(event) =>
                          setExtractionEngine(
                            event.target.value as ExtractionEngineMode,
                          )
                        }
                        className="mt-1 h-10 w-full rounded-lg border border-brand-300 bg-card px-3 text-sm font-semibold text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
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
                  <div className="mb-5 rounded-lg border border-line bg-card-2 p-4">
                    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                      <video
                        ref={videoRef}
                        muted
                        playsInline
                        className="aspect-video w-full rounded-lg border border-line bg-card-2 object-cover"
                      />
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={startCamera}
                          className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                        >
                          Start Camera
                        </button>
                        <button
                          type="button"
                          onClick={stopCamera}
                          className="w-full rounded-lg border border-line bg-card px-4 py-2 text-sm font-semibold text-muted hover:bg-card-2"
                        >
                          Stop Camera
                        </button>
                        <button
                          type="button"
                          disabled={!isCameraActive || isExtracting}
                          onClick={handleCapture}
                          className="w-full rounded-lg border border-brand-600 bg-card px-4 py-2 text-sm font-semibold text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-400/10 hover:text-brand-700 dark:hover:text-brand-300 disabled:opacity-50"
                        >
                          {isExtracting ? "Extracting..." : "Capture"}
                        </button>
                        {cameraError && (
                          <p className="text-sm text-red-600 dark:text-red-400">{cameraError}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {method === "upload" && (
                  <div className="mb-5 rounded-lg border border-dashed border-line bg-card-2 p-4">
                    <label className="block">
                      <span className="text-sm font-semibold text-muted">
                        Upload image or PDF
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleUpload}
                        className="mt-3 block w-full text-sm text-muted file:mr-4 file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                      />
                    </label>
                  </div>
                )}

                {hasOcrResult && (
                  <div className="mb-5 grid gap-4 rounded-lg border border-green-700/30 bg-green-700/10 p-4 lg:grid-cols-[220px_1fr]">
                    <div>
                      {documentPreview ? (
                        <img
                          src={documentPreview}
                          alt="Document preview"
                          className="max-h-40 w-full rounded-lg border border-emerald-200 dark:border-emerald-400/25 object-cover"
                        />
                      ) : (
                        <div className="flex h-32 items-center justify-center rounded-lg border border-emerald-200 dark:border-emerald-400/25 bg-card text-sm font-medium text-emerald-700 dark:text-emerald-300">
                          {documentLabel || "PDF document"}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                        Review extracted fields before saving.
                      </p>
                      <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
                        OCR filled empty fields only. Extracted and missing
                        indicators are shown beside labels.
                      </p>
                    </div>
                  </div>
                )}

                {step === 0 && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextInput
                      label="Name"
                      registration={register("client.name")}
                      error={errors.client?.name?.message}
                      status={indicators["client.name"]}
                    />
                    <TextInput
                      label="Age"
                      type="number"
                      registration={register("client.age", {
                        valueAsNumber: true,
                      })}
                      error={errors.client?.age?.message}
                      status={indicators["client.age"]}
                    />
                    <SelectInput
                      label="Sex"
                      registration={register("client.sex")}
                      error={errors.client?.sex?.message}
                      status={indicators["client.sex"]}
                      options={["Female", "Male"]}
                    />
                    <TextInput
                      label="Civil Status"
                      registration={register("client.civil_status")}
                      error={errors.client?.civil_status?.message}
                      status={indicators["client.civil_status"]}
                    />
                    <TextInput
                      label="Religion"
                      registration={register("client.religion")}
                      error={errors.client?.religion?.message}
                      status={indicators["client.religion"]}
                    />
                    <TextInput
                      label="Educational Attainment"
                      registration={register("client.educational_attainment")}
                      error={errors.client?.educational_attainment?.message}
                      status={indicators["client.educational_attainment"]}
                    />
                    <TextInput
                      label="Citizenship"
                      registration={register("client.citizenship")}
                      error={errors.client?.citizenship?.message}
                      status={indicators["client.citizenship"]}
                    />
                    <TextInput
                      label="Language / Dialect"
                      registration={register("client.language_dialect")}
                      error={errors.client?.language_dialect?.message}
                      status={indicators["client.language_dialect"]}
                    />
                  </div>
                )}

                {step === 1 && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <TextInput
                        label="Address"
                        registration={register("client_details.address")}
                        error={errors.client_details?.address?.message}
                        status={indicators["client_details.address"]}
                      />
                    </div>
                    <TextInput
                      label="Contact No."
                      registration={register("client_details.contact_no")}
                      error={errors.client_details?.contact_no?.message}
                      status={indicators["client_details.contact_no"]}
                    />
                    <TextInput
                      label="Email"
                      type="email"
                      registration={register("client_details.email")}
                      error={errors.client_details?.email?.message}
                      status={indicators["client_details.email"]}
                    />
                    <TextInput
                      label="Individual Monthly Income"
                      registration={register(
                        "client_details.individual_monthly_income",
                      )}
                      error={
                        errors.client_details?.individual_monthly_income
                          ?.message
                      }
                      status={
                        indicators["client_details.individual_monthly_income"]
                      }
                    />
                    <TextInput
                      label="Spouse"
                      registration={register("client_details.spouse")}
                      status={indicators["client_details.spouse"]}
                    />
                    <TextInput
                      label="Address of Spouse"
                      registration={register(
                        "client_details.address_of_spouse",
                      )}
                      status={indicators["client_details.address_of_spouse"]}
                    />
                    <TextInput
                      label="Contact No. of Spouse"
                      registration={register(
                        "client_details.contact_no_of_spouse",
                      )}
                      status={indicators["client_details.contact_no_of_spouse"]}
                    />
                    <TextInput
                      label="Representative Name"
                      registration={register(
                        "client_details.representative_name",
                      )}
                      status={indicators["client_details.representative_name"]}
                    />
                    <TextInput
                      label="Representative Age"
                      type="number"
                      registration={register(
                        "client_details.representative_age",
                        { valueAsNumber: true },
                      )}
                      error={errors.client_details?.representative_age?.message}
                      status={indicators["client_details.representative_age"]}
                    />
                    <SelectInput
                      label="Representative Sex"
                      registration={register(
                        "client_details.representative_sex",
                      )}
                      status={indicators["client_details.representative_sex"]}
                      options={["Female", "Male"]}
                    />
                    <TextInput
                      label="Representative Civil Status"
                      registration={register(
                        "client_details.representative_civil_status",
                      )}
                      status={
                        indicators["client_details.representative_civil_status"]
                      }
                    />
                    <TextInput
                      label="Representative Address"
                      registration={register(
                        "client_details.representative_address",
                      )}
                      status={
                        indicators["client_details.representative_address"]
                      }
                    />
                    <TextInput
                      label="Representative Contact Number"
                      registration={register(
                        "client_details.representative_contact_no",
                      )}
                      status={
                        indicators["client_details.representative_contact_no"]
                      }
                    />
                    <TextInput
                      label="Relationship to Applicant"
                      registration={register(
                        "client_details.representative_relationship",
                      )}
                      status={
                        indicators["client_details.representative_relationship"]
                      }
                    />
                    <TextInput
                      label="Representative Email"
                      type="email"
                      registration={register(
                        "client_details.representative_email",
                      )}
                      error={
                        errors.client_details?.representative_email?.message
                      }
                      status={indicators["client_details.representative_email"]}
                    />
                    <label className="flex items-center gap-3 rounded-lg border border-line bg-card-2 px-3 py-2 text-sm font-medium text-muted">
                      <input
                        type="checkbox"
                        {...register("client_details.detained")}
                        className="h-4 w-4 rounded border-line text-brand-600 dark:text-brand-400"
                      />
                      Detained
                      <FieldStatus
                        status={indicators["client_details.detained"]}
                      />
                    </label>
                    <TextInput
                      label="Detained Since"
                      type="date"
                      registration={register("client_details.detained_since")}
                      status={indicators["client_details.detained_since"]}
                    />
                    <TextInput
                      label="Place of Detention"
                      registration={register(
                        "client_details.place_of_detention",
                      )}
                      status={indicators["client_details.place_of_detention"]}
                    />
                  </div>
                )}

                {step === 2 && (
                  <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                    <div>
                      <h3 className="text-base font-semibold text-ink">
                        Classification
                      </h3>
                      <p className="mt-1 text-sm text-muted">
                        Include all classification fields before saving.
                      </p>
                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {classificationOptions.map(([name, label]) => (
                          <label
                            key={name}
                            className="flex items-center gap-3 rounded-lg border border-line bg-card-2 px-3 py-2 text-sm font-medium text-muted"
                          >
                            <input
                              type="checkbox"
                              {...register(
                                `client_classification.${name as keyof ClientFormValues["client_classification"]}`,
                              )}
                              className="h-4 w-4 rounded border-line text-brand-600 dark:text-brand-400"
                            />
                            {label}
                            <FieldStatus
                              status={
                                indicators[`client_classification.${name}`]
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <div className="mt-4">
                        <TextInput
                          label="Classification Notes"
                          registration={register(
                            "client_classification.classification_notes",
                          )}
                          status={
                            indicators[
                              "client_classification.classification_notes"
                            ]
                          }
                        />
                      </div>
                    </div>

                    <div className="rounded-lg border border-line bg-card-2 p-4">
                      <h3 className="text-sm font-semibold text-ink">
                        Review client information before saving.
                      </h3>
                      <dl className="mt-3 space-y-2 text-sm">
                        <div>
                          <dt className="text-muted">Client</dt>
                          <dd className="font-medium text-ink">
                            {values.client.name || "Not provided"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">Contact</dt>
                          <dd className="font-medium text-ink">
                            {values.client_details.contact_no || "Not provided"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">Address</dt>
                          <dd className="font-medium text-ink">
                            {values.client_details.address || "Not provided"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">Representative</dt>
                          <dd className="font-medium text-ink">
                            {values.client_details.representative_name ||
                              "Not provided"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">Relationship</dt>
                          <dd className="font-medium text-ink">
                            {values.client_details
                              .representative_relationship || "Not provided"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">Classifications</dt>
                          <dd className="font-medium text-ink">
                            {classificationOptions
                              .filter(
                                ([name]) => values.client_classification[name],
                              )
                              .map(([, label]) => label)
                              .join(", ") || "None selected"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                )}
              </div>

              <div className="sticky bottom-0 flex justify-between border-t border-line bg-card px-6 py-4">
                <button
                  type="button"
                  onClick={() =>
                    step === 0
                      ? setMethod(null)
                      : setStep((current) => Math.max(current - 1, 0))
                  }
                  className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-muted transition duration-200 hover:bg-line hover:text-ink"
                >
                  Back
                </button>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setMethod(null)}
                    className="rounded-lg border border-brand-600 bg-card px-4 py-2 text-sm font-semibold text-brand-600 dark:text-brand-400 transition duration-200 hover:bg-brand-50 dark:hover:bg-brand-400/10 hover:text-brand-700 dark:hover:text-brand-300"
                  >
                    Change Method
                  </button>
                  {step < steps.length - 1 ? (
                    <button
                      type="button"
                      onClick={nextStep}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
                    >
                      Continue
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:bg-emerald-700"
                    >
                      Create Client & Attach Case
                    </button>
                  )}
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
