import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useForm } from "react-hook-form";
import type { ChangeEvent, KeyboardEvent } from "react";
import type {
  FieldPath,
  Resolver,
  UseFormRegisterReturn,
} from "react-hook-form";
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
  CaseType,
  ClientRecord,
  ExtractionMap,
  ExtractionStatus,
  IntakeMethod,
} from "../../types";
import ClientInformationModal from "./ClientInformationModal";

type CaseOcrPayload = CaseExtractionResult["extracted"];

const extractionEngineLabels: Record<ExtractionEngineMode, string> = {
  auto: "Auto",
  offline: "Offline PaddleOCR",
  cloud: "Cloud Vision",
};

interface CaseWorkflowProps {
  clients: ClientRecord[];
  lockedClient?: ClientRecord;
  lockedClients?: ClientRecord[];
  caseType?: CaseType;
  requireReviewBeforeSubmit?: boolean;
  submitLabel?: string;
  onSubmit: (values: CaseFormValues) => void | Promise<void>;
}

const createDefaultValues = (
  clientId = "",
  caseType: CaseType = "Criminal",
): CaseFormValues => ({
  client_id: clientId,
  client_ids: clientId ? [clientId] : [],
  case_type: caseType,
  intake_record: {
    control_no: "",
    form_date: new Date().toLocaleDateString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    }),
    region: "",
    district_office: "Panabo City Public Attorney's Office",
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
    proof_submission_satisfied: false,
    proof_itr_satisfied: false,
    proof_itr_date: "",
    proof_brgy_satisfied: false,
    proof_brgy_date: "",
    proof_dswd_satisfied: false,
    proof_dswd_date: "",
    proof_others_satisfied: false,
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
    detained: false,
    date_of_confinement: "",
    place_of_detention: "",
    location_type: "",
    cause_of_action: "",
    facts_of_case: "",
    pending_in_court: true,
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
  "intake_record.district_office",
  "intake_record.applicant_role",
  "intake_record.nature_of_request",
  "intake_record.nature_of_case",
  "intake_record.proof_submission_satisfied",
  "intake_record.proof_submission_deadline",
  "intake_record.proof_itr_satisfied",
  "intake_record.proof_itr_date",
  "intake_record.proof_brgy_satisfied",
  "intake_record.proof_brgy_date",
  "intake_record.proof_dswd_satisfied",
  "intake_record.proof_dswd_date",
  "intake_record.proof_others_satisfied",
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
  "cases.case_no",
  "cases.court_body",
  "cases.facts_of_case",
  "cases.cause_of_action",
  "cases.status_of_case",
  "cases.last_action_taken",
  "cases.detained",
  "cases.cause_of_termination",
  "cases.date_of_termination",
] as Array<FieldPath<CaseFormValues>>;

const overwriteDefaultOcrFields = new Set<FieldPath<CaseFormValues>>([
  "intake_record.form_date",
]);

const urbanBarangays = [
  "Cagangohan",
  "Datu Abdul Dadia",
  "Gredu (Poblacion)",
  "J.P. Laurel",
  "New Pandan (Poblacion)",
  "New Visayas",
  "Quezon",
  "San Francisco (Poblacion)",
  "San Vicente",
  "Salvacion",
  "Santo Nino (Poblacion)",
];

const ruralBarangays = [
  "A. O. Floirendo",
  "Buenavista",
  "Cacao",
  "Consolacion",
  "Dapco",
  "Kasilak",
  "Katipunan",
  "Katualan",
  "Kauswagan",
  "Kiotoy",
  "Little Panay",
  "Lower Panaga (Roxas)",
  "Mabunao",
  "Maduao",
  "Malativas",
  "Manay",
  "Nanyo",
  "New Malaga (Dalisay)",
  "New Malitbog",
  "San Nicolas",
  "San Pedro",
  "San Roque",
  "Santa Cruz",
  "Sindaton",
  "Southern Davao",
  "Tagpore",
  "Tibungol",
  "Upper Licanan",
  "Waterfall",
];

const panaboBarangays = [...urbanBarangays, ...ruralBarangays];

const courtBodyOptions = [
  "RTC Branch 4",
  "RTC Branch 34",
  "Family Court - Panabo District",
  "MTCC - Panabo District",
];

const civilStatusOptions = [
  "Single",
  "Married",
  "Widowed",
  "Separated",
  "Annulled",
  "Divorced",
  "None",
];

const natureOfRequestOptions = [
  "Legal Advice",
  "Inquest/Legal Assistance",
  "Legal Documentation",
  "Mediation/Conciliation",
  "Representation in Court/Quasi-Judicial Bodies",
  "Administration of Oath",
];

const natureOfCaseOptions = [
  "Criminal",
  "Administrative",
  "Civil",
  "Labor",
  "Appeal",
];

const applicantRoleOptions = [
  "Plaintiff",
  "Defendant",
  "Oppositor",
  "Petitioner",
  "Respondent",
  "Complainant",
  "Accused",
  "Others",
];

function generatedCaseTitle(clients: ClientRecord[], caseType: CaseType) {
  const names = clients
    .map((client) => client.client.name.trim())
    .filter(Boolean);
  const prefix = caseType === "Civil" ? "Civil Case -" : "PP vs.";
  const fallback = caseType === "Civil" ? "Civil Case - Client" : "PP vs. Client";
  if (names.length === 0) return fallback;
  if (names.length === 1) return `${prefix} ${names[0]}`;
  if (names.length === 2) return `${prefix} ${names[0]} and ${names[1]}`;
  return `${prefix} ${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function hasSavedRepresentative(client?: ClientRecord) {
  if (!client) return false;
  const details = client.client_details;
  const name = details.representative_name?.trim().toLowerCase();
  const civilStatus = details.representative_civil_status?.trim().toLowerCase();
  return Boolean(
    name &&
      name !== "none" &&
      name !== "not applicable" &&
      civilStatus !== "none",
  );
}

function splitSelectedOptions(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasSelectedOption(value: string, option: string) {
  const selected = splitSelectedOptions(value);
  if (option === "Others") {
    return selected.some((item) => item === "Others" || item.startsWith("Others:"));
  }
  return selected.includes(option);
}

function getOtherOptionText(value: string) {
  const selected = splitSelectedOptions(value).find((item) =>
    item.startsWith("Others:"),
  );
  return selected ? selected.replace(/^Others:\s*/, "") : "";
}

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
  disabled = false,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  type?: string;
  status?: ExtractionStatus;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#4B5563]">
        {label}
        <FieldStatus status={status} />
      </span>
      <input
        type={type}
        disabled={disabled}
        {...registration}
        className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20 disabled:cursor-not-allowed disabled:bg-[#F3F4F6] disabled:text-[#6B7280]"
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
      <span className="text-sm font-medium text-[#4B5563]">
        {label}
        <FieldStatus status={status} />
      </span>
      <textarea
        {...registration}
        rows={4}
        className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
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
      className={`rounded-lg border bg-white p-5 text-left shadow-sm  transition duration-200 hover:-translate-y-px hover:shadow-md ${
        selected
          ? "border-[#704389] shadow-[#704389]/20"
          : "border-[#E5E7EB] hover:border-[#704389]"
      }`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#704389]/10 text-[#704389]">
        <i className={`fa-solid ${icon}`} aria-hidden="true" />
      </div>
      <p className="mt-4 text-base font-semibold text-[#2B3642]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#4B5563]">{description}</p>
    </button>
  );
}

function SelectedClientCard({
  client,
  locked = false,
  onView,
  onRemove,
}: {
  client: ClientRecord;
  locked?: boolean;
  onView: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex min-w-[240px] max-w-full items-center gap-3 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm sm:max-w-[320px]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#704389] text-xs font-semibold text-white">
        {initials(client.client.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#2B3642]">
          {client.client.name}
        </p>
        {locked && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#704389]">
            Selected
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onView}
          className="rounded-md border border-[#704389] bg-white px-2.5 py-1 text-xs font-semibold text-[#704389] transition hover:bg-[#704389] hover:text-white"
        >
          View
        </button>
        {onRemove && !locked && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-semibold text-[#4B5563] transition hover:bg-[#F8FAFC]"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

const reviewClassificationLabels: Array<
  [keyof ClientRecord["client_classification"], string]
> = [
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
];

function selectedClassificationNames(client: ClientRecord) {
  return reviewClassificationLabels
    .filter(([field]) => Boolean(client.client_classification[field]))
    .map(([, label]) => label);
}

function ReviewField({
  label,
  value,
}: {
  label: string;
  value: string | number | boolean | undefined | null;
}) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-[#2B3642]">
        {typeof value === "boolean" ? (value ? "Yes" : "No") : value || "-"}
      </p>
    </div>
  );
}

export function CaseWorkflow({
  clients,
  lockedClient,
  lockedClients,
  caseType = "Criminal",
  requireReviewBeforeSubmit = false,
  submitLabel = "Save Case",
  onSubmit,
}: CaseWorkflowProps) {
  const addNotification = useNotificationStore(
    (state) => state.addNotification,
  );
  const { user } = useAuth();
  const lockedSelectionClients = useMemo(
    () =>
      lockedClients?.length
        ? lockedClients
        : lockedClient
          ? [lockedClient]
          : [],
    [lockedClient, lockedClients],
  );
  const hasLockedSelection = lockedSelectionClients.length > 0;
  const [step, setStep] = useState(0);
  const [method, setMethod] = useState<IntakeMethod | null>(null);
  const [query, setQuery] = useState("");
  const [viewingClient, setViewingClient] = useState<ClientRecord | null>(null);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>(
    lockedSelectionClients.map((client) => client.client_id),
  );
  const [activeClientIndex, setActiveClientIndex] = useState(0);
  const [documentPreview, setDocumentPreview] = useState<string | null>(null);
  const [documentLabel, setDocumentLabel] = useState("");
  const [indicators, setIndicators] = useState<ExtractionMap>({});
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionEngine, setExtractionEngine] =
    useState<ExtractionEngineMode>("auto");
  const [replaceExistingWithOcr, setReplaceExistingWithOcr] = useState(false);
  const [useClientRepresentative, setUseClientRepresentative] = useState(false);
  const {
    videoRef,
    isCameraActive,
    cameraError,
    startCamera,
    stopCamera,
    captureFrame,
  } = useCamera();
  const standaloneSteps = requireReviewBeforeSubmit
    ? [
        "Select Client",
        "Encoding Method",
        "Case Details",
        "Classification",
        "Review",
      ]
    : ["Select Client", "Encoding Method", "Case Details"];
  const lockedSteps = requireReviewBeforeSubmit
    ? ["Encoding Method", "Case Details", "Classification", "Review"]
    : ["Encoding Method", "Case Details"];
  const steps = hasLockedSelection ? lockedSteps : standaloneSteps;
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    trigger,
    getValues,
    formState: { errors },
  } = useForm<CaseFormValues>({
    resolver: zodResolver(caseFormSchema) as Resolver<CaseFormValues>,
    defaultValues: createDefaultValues(
      lockedSelectionClients[0]?.client_id ?? "",
      caseType,
    ),
    mode: "onBlur",
  });

  const selectedClientId = watch("client_id");
  const selectedClientIdSet = useMemo(
    () => new Set(selectedClientIds),
    [selectedClientIds],
  );
  const selectedClients = useMemo(
    () =>
      hasLockedSelection
        ? lockedSelectionClients
        : selectedClientIds
            .map((clientId) =>
              clients.find((client) => client.client_id === clientId),
            )
            .filter((client): client is ClientRecord => Boolean(client)),
    [clients, hasLockedSelection, lockedSelectionClients, selectedClientIds],
  );
  const selectedClient = selectedClients[0];
  const canReuseClientRepresentative = hasSavedRepresentative(selectedClient);
  const applicantRole = watch("intake_record.applicant_role");
  const natureOfRequest = watch("intake_record.nature_of_request");
  const representativeCivilStatus = watch("representative.civil_status");
  const caseStatus = watch("cases.status_of_case");
  const caseDetained = Boolean(watch("cases.detained"));
  const locationType = watch("cases.location_type");
  const incidentBarangay = watch("cases.incident_barangay");
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
  const isCaseFormStep = hasLockedSelection ? step === 1 : step === 2;
  const classificationStep = hasLockedSelection ? 2 : 3;
  const reviewStep = hasLockedSelection ? 3 : 4;
  const isClassificationStep =
    requireReviewBeforeSubmit && step === classificationStep;
  const isReviewStep = requireReviewBeforeSubmit && step === reviewStep;
  const isMethodStep = hasLockedSelection ? step === 0 : step === 1;
  const reviewValues = watch();
  const selectedClientIsDetained = Boolean(
    selectedClient?.client_details.detained,
  );
  const representativeNotApplicable = representativeCivilStatus === "None";
  const filteredBarangays =
    locationType === "Urban"
      ? urbanBarangays
      : locationType === "Rural"
        ? ruralBarangays
        : panaboBarangays;

  useEffect(() => {
    setActiveClientIndex(0);
  }, [query]);

  useEffect(() => {
    if (hasLockedSelection) {
      const clientIds = lockedSelectionClients.map((client) => client.client_id);
      setSelectedClientIds(clientIds);
      setValue("client_id", clientIds[0] ?? "", { shouldValidate: true });
      setValue("client_ids", clientIds, { shouldValidate: true });
    }
  }, [hasLockedSelection, lockedSelectionClients, setValue]);

  useEffect(() => {
    if (hasLockedSelection) return;
    setValue("client_id", selectedClientIds[0] ?? "", {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue("client_ids", selectedClientIds, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [hasLockedSelection, selectedClientIds, setValue]);

  useEffect(() => {
    setUseClientRepresentative(canReuseClientRepresentative);
  }, [canReuseClientRepresentative, selectedClient?.client_id]);

  useEffect(() => {
    if (canReuseClientRepresentative) return;
    setValue("representative.rep_name", "", { shouldDirty: false });
    setValue("representative.rep_age", 0, { shouldDirty: false });
    setValue("representative.rep_sex", "", { shouldDirty: false });
    setValue("representative.civil_status", "", { shouldDirty: false });
    setValue("representative.rep_address", "", { shouldDirty: false });
    setValue("representative.rep_contact_no", "", { shouldDirty: false });
    setValue("representative.relationship_to_applicant", "", {
      shouldDirty: false,
    });
  }, [canReuseClientRepresentative, selectedClient?.client_id, setValue]);

  useEffect(() => {
    if (!selectedClient || !useClientRepresentative) return;
    setValue(
      "representative.rep_name",
      selectedClient.client_details.representative_name || "",
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "representative.rep_age",
      selectedClient.client_details.representative_age || 0,
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "representative.rep_sex",
      selectedClient.client_details.representative_sex || "",
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "representative.civil_status",
      selectedClient.client_details.representative_civil_status || "",
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "representative.rep_address",
      selectedClient.client_details.representative_address || "",
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "representative.rep_contact_no",
      selectedClient.client_details.representative_contact_no || "",
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "representative.relationship_to_applicant",
      selectedClient.client_details.representative_relationship ||
        "Client representative",
      { shouldDirty: true, shouldValidate: true },
    );
  }, [selectedClient, setValue, useClientRepresentative]);

  useEffect(() => {
    if (!representativeNotApplicable) return;
    setValue("representative.rep_name", "", { shouldDirty: true });
    setValue("representative.rep_age", 0, { shouldDirty: true });
    setValue("representative.rep_sex", "", { shouldDirty: true });
    setValue("representative.rep_address", "", { shouldDirty: true });
    setValue("representative.rep_contact_no", "", { shouldDirty: true });
    setValue("representative.relationship_to_applicant", "", {
      shouldDirty: true,
    });
  }, [representativeNotApplicable, setValue]);

  useEffect(() => {
    if (!selectedClient) return;
    if (!selectedClientIsDetained) return;
    setValue("cases.detained", true, { shouldDirty: true, shouldValidate: true });
    const detentionDate = selectedClient.client_details.detained_since;
    const detentionPlace = selectedClient.client_details.place_of_detention;
    if (detentionDate) {
      setValue("cases.date_of_confinement", detentionDate, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    if (detentionPlace) {
      setValue("cases.place_of_detention", detentionPlace, {
        shouldDirty: true,
      });
    }
  }, [selectedClient, selectedClientIsDetained, setValue]);

  useEffect(() => {
    if (caseDetained) return;
    setValue("cases.date_of_confinement", "", { shouldDirty: true, shouldValidate: true });
    setValue("cases.place_of_detention", "", { shouldDirty: true, shouldValidate: true });
  }, [caseDetained, setValue]);

  useEffect(() => {
    const pending = caseStatus !== "Terminated";
    setValue("cases.pending_in_court", pending, { shouldDirty: true });
    setValue("cases.case_status", caseStatus, { shouldDirty: true });
  }, [caseStatus, setValue]);

  useEffect(() => {
    if (!incidentBarangay || filteredBarangays.includes(incidentBarangay)) return;
    setValue("cases.incident_barangay", "", { shouldDirty: true, shouldValidate: true });
  }, [filteredBarangays, incidentBarangay, setValue]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const selectClient = (client: ClientRecord) => {
    setSelectedClientIds((current) => {
      if (current.includes(client.client_id)) {
        toast.error("Client is already selected.");
        return current;
      }
      return [...current, client.client_id];
    });
    setQuery("");
  };

  const clearClient = () => {
    setSelectedClientIds([]);
    setQuery("");
  };

  const removeSelectedClient = (clientId: string) => {
    setSelectedClientIds((current) =>
      current.filter((selectedId) => selectedId !== clientId),
    );
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
    if (selectedClientIds.length === 0) {
      toast.error("Select at least one client before continuing.");
      return;
    }
    const valid = await trigger("client_id");
    if (!valid) return;
    setStep(1);
  };

  const continueFromMethod = () => {
    if (!method) {
      toast.error("Select an encoding method before continuing.");
      return;
    }
    setStep(hasLockedSelection ? 1 : 2);
  };

  const continueFromDetails = async () => {
    const valid = await trigger();
    if (!valid) {
      toast.error(
        getFirstValidationMessage(errors) ??
          "Please resolve validation errors before reviewing.",
      );
      return;
    }
    setStep(classificationStep);
  };

  const continueToReview = () => setStep(reviewStep);

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
      const cloudApproved = extractionEngine === "cloud" && window.confirm(
        "Send this legal document to the authorized cloud extraction service? This requires enabled institutional policy."
      );
      if (extractionEngine === "cloud" && !cloudApproved) {
        throw new Error("Cloud extraction was not approved.");
      }
      const result = await extractCaseFromDocument(file, {
        extractionMode: extractionEngine,
        cloudApproved,
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

  const updateOtherOption = (
    text: string,
  ) => {
    setValue("intake_record.nature_of_request", text.trim() ? `Others: ${text}` : "Others", {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const submitCase = async (values: CaseFormValues) => {
    try {
      const generatedTitle = generatedCaseTitle(selectedClients, caseType);
      const normalizedStatus = values.cases.status_of_case === "Terminated"
        ? "Terminated"
        : "Pending";
      const representedParty =
        values.intake_record.applicant_role === "Others"
          ? values.intake_record.applicant_role_other
          : values.intake_record.applicant_role;
      await onSubmit({
        ...values,
        case_type: caseType,
        client_id: selectedClient?.client_id ?? values.client_id,
        client_ids: selectedClients.map((client) => client.client_id),
        intake_record: {
          ...values.intake_record,
          district_office:
            values.intake_record.district_office ||
            "Panabo City Public Attorney's Office",
          party_represented: representedParty,
          inv_plaintiff: values.intake_record.applicant_role === "Plaintiff",
          inv_defendant: values.intake_record.applicant_role === "Defendant",
          inv_oppositor: values.intake_record.applicant_role === "Oppositor",
          inv_petitioner: values.intake_record.applicant_role === "Petitioner",
          inv_respondent: values.intake_record.applicant_role === "Respondent",
          inv_complainant: values.intake_record.applicant_role === "Complainant",
          inv_accused: values.intake_record.applicant_role === "Accused",
          inv_others:
            values.intake_record.applicant_role === "Others"
              ? values.intake_record.applicant_role_other
              : "",
        },
        adverse_party: {
          role: "",
          name: "",
          address: "",
        },
        cases: {
          ...values.cases,
          title_of_case: generatedTitle,
          status_of_case: normalizedStatus,
          case_status: normalizedStatus,
          pending_in_court: normalizedStatus === "Pending",
          incident_city: values.cases.incident_city || "Panabo City",
          detained: caseDetained,
          date_of_confinement: caseDetained
            ? values.cases.date_of_confinement
            : "",
          place_of_detention: caseDetained
            ? values.cases.place_of_detention
            : "",
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
      <div className="border-b border-[#E5E7EB] bg-white px-6 py-4">
        <StepIndicator steps={steps} currentStep={step} />
      </div>

      <div className="flex-1 overflow-y-auto bg-[#F8FAFC] px-6 py-5">
        {!hasLockedSelection && step === 0 && (
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <label className="block">
                <span className="text-sm font-medium text-[#4B5563]">
                  Search existing client
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={handleClientSearchKeyDown}
                  placeholder="Search by name or client id"
                  className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                  aria-label="Search existing clients"
                />
              </label>
              <p className="text-sm text-[#4B5563]">
                Search by client name or client ID to locate an existing client.
              </p>
              <FieldError message={errors.client_id?.message} />

              <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB]">
                <div className="border-b border-[#E5E7EB] px-4 py-3 text-sm font-semibold text-[#2B3642]">
                  Selected Clients
                </div>
                <div className="h-64 space-y-3 overflow-y-auto p-3">
                  {selectedClients.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-center text-sm text-[#4B5563]">
                      No clients selected.
                    </div>
                  ) : (
                    selectedClients.map((client) => (
                      <SelectedClientCard
                        key={client.client_id}
                        client={client}
                        onView={() => setViewingClient(client)}
                        onRemove={() => removeSelectedClient(client.client_id)}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
              <div className="sticky top-0 border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 text-sm font-semibold text-[#4B5563]">
                Existing Clients
              </div>
              <div className="max-h-96 divide-y divide-[#E5E7EB] overflow-y-auto">
                {!hasSearch ? (
                  <div className="px-4 py-8 text-center text-sm text-[#4B5563]">
                    Start typing to search clients.
                  </div>
                ) : visibleClients.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-[#4B5563]">
                    No matching clients found.
                  </div>
                ) : (
                  visibleClients.map((client, index) => (
                    (() => {
                      const alreadySelected = selectedClientIdSet.has(client.client_id);
                      return (
                    <button
                      type="button"
                      key={client.client_id}
                      onClick={() => selectClient(client)}
                      disabled={alreadySelected}
                      className={`block w-full px-4 py-3 text-left transition duration-200 hover:bg-[#F8FAFC] ${
                        selectedClientId === client.client_id ||
                        alreadySelected ||
                        activeClientIndex === index
                          ? "bg-[#F7F0FA]"
                          : "bg-white"
                      } disabled:cursor-not-allowed disabled:opacity-70`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[#2B3642]">
                            {client.client.name}
                          </p>
                          <p className="mt-1 text-xs text-[#4B5563]">
                            {client.client_id}
                          </p>
                        </div>
                        <span className="text-xs font-medium text-[#4B5563]">
                          {alreadySelected ? "Selected" : client.client.sex}
                        </span>
                      </div>
                    </button>
                      );
                    })()
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {isMethodStep && (
          <div className="space-y-5">
            {selectedClients.length > 0 && (
              <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
                <div className="border-b border-[#E5E7EB] px-4 py-3 text-sm font-semibold text-[#2B3642]">
                  Selected Clients
                </div>
                <div className="flex h-44 flex-wrap content-start gap-2 overflow-y-auto p-3">
                  {selectedClients.map((client) => (
                    <SelectedClientCard
                      key={client.client_id}
                      client={client}
                      locked={hasLockedSelection}
                      onView={() => setViewingClient(client)}
                      onRemove={() => {
                        removeSelectedClient(client.client_id);
                        setStep(0);
                      }}
                    />
                  ))}
                </div>
              </div>
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
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 shadow-sm">
              <div>
                <p className="text-sm font-semibold text-[#2B3642]">
                  {hasLockedSelection
                    ? selectedClients.length === 1
                      ? "Client selected automatically"
                      : "Clients selected automatically"
                    : selectedClients.length === 1
                      ? selectedClients[0].client.name
                      : `${selectedClients.length} clients selected`}
                </p>
                {hasLockedSelection && (
                  <p className="text-sm text-[#2B3642]">
                    {selectedClients
                      .map((client) => client.client.name)
                      .join(", ")}
                  </p>
                )}
                <p className="text-xs text-[#4B5563]">
                  Method:{" "}
                  {method === "manual"
                    ? "Manual Entry"
                    : method === "camera"
                      ? "Live OCR Scan"
                      : "Upload Document"}
                </p>
              </div>
            </div>

            {method !== "manual" && (
              <div className="grid gap-3 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-sm text-[#1E3A8A] md:grid-cols-[minmax(0,1fr)_220px]">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={replaceExistingWithOcr}
                    onChange={(event) =>
                      setReplaceExistingWithOcr(event.target.checked)
                    }
                    className="mt-0.5 h-4 w-4 rounded border-[#2F80ED] text-[#2F80ED] focus:ring-[#2F80ED]"
                  />
                  <span>
                    <span className="block font-semibold">
                      Replace existing fields with scanned values
                    </span>
                    <span className="mt-1 block text-[#1E40AF]">
                      Leave this off to fill only blank fields. Form Date is
                      always updated from Petsa when the scan finds it.
                    </span>
                  </span>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-[#1E3A8A]">
                    OCR Engine
                  </span>
                  <select
                    value={extractionEngine}
                    onChange={(event) =>
                      setExtractionEngine(
                        event.target.value as ExtractionEngineMode,
                      )
                    }
                    className="mt-1 h-10 w-full rounded-md border border-[#93C5FD] bg-white px-3 text-sm font-semibold text-[#111827] outline-none focus:border-[#2F80ED] focus:ring-2 focus:ring-[#2F80ED]/20"
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
              <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    className="aspect-video w-full rounded-md border border-[#E5E7EB] bg-white object-cover"
                  />
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={startCamera}
                      className="w-full rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:bg-[#5F3675]"
                    >
                      Start Camera
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="w-full rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#4B5563] transition duration-200 hover:bg-[#F8FAFC]"
                    >
                      Stop Camera
                    </button>
                    <button
                      type="button"
                      disabled={!isCameraActive || isExtracting}
                      onClick={handleCapture}
                      className="w-full rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] transition duration-200 hover:bg-[#704389] hover:text-white disabled:opacity-50"
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
              <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <label className="block">
                  <span className="text-sm font-semibold text-[#4B5563]">
                    Upload case document image
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUpload}
                    className="mt-3 block w-full text-sm text-[#4B5563] file:mr-4 file:rounded-md file:border-0 file:bg-[#704389] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
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
                      className="max-h-40 w-full rounded-md border border-emerald-200 object-cover"
                    />
                  ) : (
                    <div className="flex h-32 items-center justify-center rounded-md border border-emerald-200 bg-white text-sm font-medium text-emerald-700">
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

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Case Identification
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <TextInput
                  label="Control No."
                  registration={register("intake_record.control_no")}
                  error={errors.intake_record?.control_no?.message}
                  status={indicators["intake_record.control_no"]}
                />
                <label className="block">
                  <span className="text-sm font-medium text-[#4B5563]">
                    Court/Body
                    <FieldStatus status={indicators["cases.court_body"]} />
                  </span>
                  <select
                    {...register("cases.court_body")}
                    className="mt-1 w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                  >
                    <option value="">Select court/body</option>
                    {courtBodyOptions.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                  <FieldError message={errors.cases?.court_body?.message} />
                </label>
                <TextInput
                  label="Case No."
                  registration={register("cases.case_no")}
                  error={errors.cases?.case_no?.message}
                  status={indicators["cases.case_no"]}
                />
                <TextInput
                  label="District Office"
                  registration={register("intake_record.district_office")}
                  error={errors.intake_record?.district_office?.message}
                  status={indicators["intake_record.district_office"]}
                />
                <TextInput
                  label="Form Date"
                  registration={register("intake_record.form_date")}
                  error={errors.intake_record?.form_date?.message}
                  status={indicators["intake_record.form_date"]}
                />
              </div>
              <div className="mt-3 rounded-md border border-[#E7D7EE] bg-[#F7F0FA] px-3 py-2 text-sm font-semibold text-[#5F3675]">
                Case title will be generated automatically as{" "}
                {generatedCaseTitle(selectedClients, caseType)}.
              </div>
            </section>

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Nature of Request
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {natureOfRequestOptions.map((option) => (
                  <label
                    key={option}
                    className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]"
                  >
                    <input
                      type="radio"
                      value={option}
                      {...register("intake_record.nature_of_request")}
                      className="h-4 w-4 border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                    />
                    {option}
                  </label>
                ))}
                <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                  <input
                    type="radio"
                    value="Others"
                    {...register("intake_record.nature_of_request")}
                    checked={hasSelectedOption(natureOfRequest, "Others")}
                    onChange={() =>
                      setValue("intake_record.nature_of_request", "Others", {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                    className="h-4 w-4 border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                  />
                  Others
                </label>
                {hasSelectedOption(natureOfRequest, "Others") && (
                  <label className="block">
                    <span className="text-sm font-medium text-[#4B5563]">
                      Specify Other Request
                    </span>
                    <input
                      type="text"
                      value={getOtherOptionText(natureOfRequest)}
                      onChange={(event) =>
                        updateOtherOption(event.target.value)
                      }
                      className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                    />
                  </label>
                )}
              </div>
              <FieldError
                message={errors.intake_record?.nature_of_request?.message}
              />
            </section>

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                I. Nature of the Case
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {natureOfCaseOptions.map((option) => (
                  <label
                    key={option}
                    className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]"
                  >
                    <input
                      type="radio"
                      value={option}
                      {...register("intake_record.nature_of_case")}
                      className="h-4 w-4 border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                    />
                    {option}
                  </label>
                ))}
              </div>
              <FieldError message={errors.intake_record?.nature_of_case?.message} />
            </section>

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Applicant Case Involvement (Party Represented)
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {applicantRoleOptions.map((role) => (
                  <label
                    key={role}
                    className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]"
                  >
                    <input
                      type="radio"
                      value={role}
                      {...register("intake_record.applicant_role")}
                      className="h-4 w-4 border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
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
            </section>

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Case Status
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-[#4B5563]">
                    Status of Case
                    <FieldStatus status={indicators["cases.status_of_case"]} />
                  </span>
                  <select
                    {...register("cases.status_of_case")}
                    className="mt-1 w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                  >
                    <option>Pending</option>
                    <option>Terminated</option>
                  </select>
                </label>
                <TextInput
                  label="Last Action Taken"
                  registration={register("cases.last_action_taken")}
                  error={errors.cases?.last_action_taken?.message}
                />
                <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                  <input
                    type="checkbox"
                    {...register("cases.detained")}
                    className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                  />
                  Detained
                  <FieldStatus status={indicators["cases.detained"]} />
                </label>
                {caseDetained && (
                  <>
                    <TextInput
                      label="Date of Detention"
                      type="date"
                      registration={register("cases.date_of_confinement")}
                      error={errors.cases?.date_of_confinement?.message}
                    />
                    <TextInput
                      label="Place of Detention"
                      registration={register("cases.place_of_detention")}
                      error={errors.cases?.place_of_detention?.message}
                    />
                  </>
                )}
                {caseStatus === "Terminated" && (
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

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-[#1F2937]">
                    Representative
                  </h3>
                  {canReuseClientRepresentative && useClientRepresentative && (
                    <p className="mt-1 text-sm text-[#4B5563]">
                      Using representative details already saved on the client
                      record.
                    </p>
                  )}
                </div>
                {canReuseClientRepresentative && (
                  <div className="grid gap-2 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-2 text-sm font-semibold text-[#4B5563] sm:grid-cols-2">
                    <label className="flex items-center gap-2 rounded-md bg-white px-3 py-2">
                      <input
                        type="radio"
                        name="case-representative-source"
                        checked={useClientRepresentative}
                        onChange={() => setUseClientRepresentative(true)}
                        className="h-4 w-4 border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                      />
                      Use Representative Details Already Saved
                    </label>
                    <label className="flex items-center gap-2 rounded-md bg-white px-3 py-2">
                      <input
                        type="radio"
                        name="case-representative-source"
                        checked={!useClientRepresentative}
                        onChange={() => setUseClientRepresentative(false)}
                        className="h-4 w-4 border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                      />
                      Use Different Representative
                    </label>
                  </div>
                )}
              </div>

              {!canReuseClientRepresentative || !useClientRepresentative ? (
                <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <TextInput
                    label="Representative Name"
                    registration={register("representative.rep_name")}
                    error={errors.representative?.rep_name?.message}
                    disabled={representativeNotApplicable}
                  />
                  <TextInput
                    label="Representative Age"
                    type="number"
                    registration={register("representative.rep_age", {
                      valueAsNumber: true,
                    })}
                    error={errors.representative?.rep_age?.message}
                    disabled={representativeNotApplicable}
                  />
                  <label className="block">
                    <span className="text-sm font-medium text-[#4B5563]">
                      Representative Sex
                    </span>
                    <select
                      {...register("representative.rep_sex")}
                      disabled={representativeNotApplicable}
                      className="mt-1 w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                    >
                      <option value="">Select</option>
                      <option>Male</option>
                      <option>Female</option>
                    </select>
                    <FieldError
                      message={errors.representative?.rep_sex?.message}
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-[#4B5563]">
                      Civil Status
                    </span>
                    <select
                      {...register("representative.civil_status")}
                      className="mt-1 w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                    >
                      <option value="">Select</option>
                      {civilStatusOptions.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                    <FieldError
                      message={errors.representative?.civil_status?.message}
                    />
                  </label>
                  <TextInput
                    label="Representative Address"
                    registration={register("representative.rep_address")}
                    error={errors.representative?.rep_address?.message}
                    disabled={representativeNotApplicable}
                  />
                  <TextInput
                    label="Representative Contact No."
                    registration={register("representative.rep_contact_no")}
                    error={errors.representative?.rep_contact_no?.message}
                    disabled={representativeNotApplicable}
                  />
                  <TextInput
                    label="Relationship to Applicant"
                    registration={register(
                      "representative.relationship_to_applicant",
                    )}
                    error={
                      errors.representative?.relationship_to_applicant?.message
                    }
                    disabled={representativeNotApplicable}
                  />
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-[#E7D7EE] bg-[#F7F0FA] p-4">
                  <p className="text-sm font-semibold text-[#5F3675]">
                    {selectedClient?.client_details.representative_name ||
                      selectedClient?.client.name ||
                      "Client representative"}
                  </p>
                  <p className="mt-1 text-sm text-[#5F3675]">
                    {selectedClient?.client_details
                      .representative_relationship ||
                      "Representative details will be copied into this case."}
                  </p>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Proof of Qualification
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                  <input
                    type="checkbox"
                    {...register("intake_record.proof_submission_satisfied")}
                    className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                  />
                  Will submit proof later
                  <FieldStatus status={indicators["intake_record.proof_submission_satisfied"]} />
                </label>
                <TextInput
                  label="Submission Deadline (optional)"
                  type="date"
                  registration={register("intake_record.proof_submission_deadline")}
                  error={errors.intake_record?.proof_submission_deadline?.message}
                  status={indicators["intake_record.proof_submission_deadline"]}
                />
                <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                  <input
                    type="checkbox"
                    {...register("intake_record.proof_itr_satisfied")}
                    className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                  />
                  Income Tax Return / proof of income satisfied
                  <FieldStatus status={indicators["intake_record.proof_itr_satisfied"]} />
                </label>
                <TextInput
                  label="ITR Date (optional)"
                  type="date"
                  registration={register("intake_record.proof_itr_date")}
                  error={errors.intake_record?.proof_itr_date?.message}
                  status={indicators["intake_record.proof_itr_date"]}
                />
                <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                  <input
                    type="checkbox"
                    {...register("intake_record.proof_brgy_satisfied")}
                    className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                  />
                  Barangay certification / indigency satisfied
                  <FieldStatus status={indicators["intake_record.proof_brgy_satisfied"]} />
                </label>
                <TextInput
                  label="Barangay Certification Date (optional)"
                  type="date"
                  registration={register("intake_record.proof_brgy_date")}
                  error={errors.intake_record?.proof_brgy_date?.message}
                  status={indicators["intake_record.proof_brgy_date"]}
                />
                <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                  <input
                    type="checkbox"
                    {...register("intake_record.proof_dswd_satisfied")}
                    className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                  />
                  DSWD certification satisfied
                  <FieldStatus status={indicators["intake_record.proof_dswd_satisfied"]} />
                </label>
                <TextInput
                  label="DSWD Certification Date (optional)"
                  type="date"
                  registration={register("intake_record.proof_dswd_date")}
                  error={errors.intake_record?.proof_dswd_date?.message}
                  status={indicators["intake_record.proof_dswd_date"]}
                />
                <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                  <input
                    type="checkbox"
                    {...register("intake_record.proof_others_satisfied")}
                    className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                  />
                  Other accepted proof satisfied
                  <FieldStatus status={indicators["intake_record.proof_others_satisfied"]} />
                </label>
                <TextInput
                  label="Other Proof Date (optional)"
                  type="date"
                  registration={register("intake_record.proof_others_date")}
                  error={errors.intake_record?.proof_others_date?.message}
                  status={indicators["intake_record.proof_others_date"]}
                />
                <div className="md:col-span-2">
                  <TextInput
                    label="Other Proof Details"
                    registration={register("intake_record.proof_others_details")}
                    error={errors.intake_record?.proof_others_details?.message}
                    status={indicators["intake_record.proof_others_details"]}
                  />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Case Facts and Cause
              </h3>
              <div className="mt-3 grid gap-4">
                <TextArea
                  label="Fact of the Case"
                  registration={register("cases.facts_of_case")}
                  error={errors.cases?.facts_of_case?.message}
                  status={indicators["cases.facts_of_case"]}
                />
                <TextArea
                  label="Cause of Action"
                  registration={register("cases.cause_of_action")}
                  error={errors.cases?.cause_of_action?.message}
                  status={indicators["cases.cause_of_action"]}
                />
              </div>
            </section>

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Incident Location
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-[#4B5563]">
                    Location Type
                  </span>
                  <select
                    {...register("cases.location_type")}
                    className="mt-1 w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                  >
                    <option value="">Select</option>
                    <option>Urban</option>
                    <option>Rural</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#4B5563]">
                    Barangay
                  </span>
                  <select
                    {...register("cases.incident_barangay")}
                    disabled={!locationType}
                    className="mt-1 w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                  >
                    <option value="">
                      {locationType ? "Select barangay" : "Select location type first"}
                    </option>
                    {filteredBarangays.map((barangay) => (
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

        {isClassificationStep && (
          <div className="space-y-5">
            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Applicant Classification
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {selectedClients.map((client) => {
                  const classifications = selectedClassificationNames(client);
                  return (
                    <div
                      key={client.client_id}
                      className="rounded-md border border-[#E5E7EB] bg-white p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#2B3642]">
                            {client.client.name}
                          </p>
                          <p className="mt-1 text-xs text-[#6B7280]">
                            {client.client_id}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setViewingClient(client)}
                          className="shrink-0 rounded-md border border-[#704389] bg-white px-2.5 py-1 text-xs font-semibold text-[#704389] transition hover:bg-[#704389] hover:text-white"
                        >
                          View
                        </button>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-[#2B3642]">
                        {classifications.join(", ") || "None selected"}
                      </p>
                      {client.client_classification.classification_notes && (
                        <p className="mt-2 text-xs leading-5 text-[#4B5563]">
                          {client.client_classification.classification_notes}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {isReviewStep && (
          <div className="space-y-5">
            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Selected Clients
              </h3>
              <div className="mt-3 flex max-h-44 flex-wrap content-start gap-2 overflow-y-auto">
                {selectedClients.map((client) => (
                  <SelectedClientCard
                    key={client.client_id}
                    client={client}
                    locked
                    onView={() => setViewingClient(client)}
                  />
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Case Information
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <ReviewField
                  label="Control No."
                  value={reviewValues.intake_record.control_no}
                />
                <ReviewField
                  label="Case Title"
                  value={generatedCaseTitle(selectedClients, caseType)}
                />
                <ReviewField
                  label="Case No."
                  value={reviewValues.cases.case_no}
                />
                <ReviewField
                  label="Court / Body"
                  value={reviewValues.cases.court_body}
                />
                <ReviewField
                  label="Nature of Request"
                  value={reviewValues.intake_record.nature_of_request}
                />
                <ReviewField
                  label="Nature of Case"
                  value={reviewValues.intake_record.nature_of_case}
                />
                <ReviewField
                  label="Applicant Case Involvement"
                  value={
                    reviewValues.intake_record.applicant_role === "Others"
                      ? reviewValues.intake_record.applicant_role_other
                      : reviewValues.intake_record.applicant_role
                  }
                />
                <ReviewField
                  label="Status"
                  value={reviewValues.cases.status_of_case}
                />
                <ReviewField
                  label="Last Action Taken"
                  value={reviewValues.cases.last_action_taken}
                />
                <ReviewField
                  label="Cause of Action"
                  value={reviewValues.cases.cause_of_action}
                />
                <ReviewField
                  label="Location Type"
                  value={reviewValues.cases.location_type}
                />
                <ReviewField
                  label="Barangay"
                  value={reviewValues.cases.incident_barangay}
                />
                <ReviewField
                  label="Detained"
                  value={reviewValues.cases.detained}
                />
                <ReviewField
                  label="Date of Detention"
                  value={reviewValues.cases.date_of_confinement}
                />
                <ReviewField
                  label="Place of Detention"
                  value={reviewValues.cases.place_of_detention}
                />
              </div>
              <div className="mt-3">
                <ReviewField
                  label="Facts of Case"
                  value={reviewValues.cases.facts_of_case}
                />
              </div>
            </section>

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Representative
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <ReviewField
                  label="Representative Name"
                  value={reviewValues.representative.rep_name}
                />
                <ReviewField
                  label="Representative Contact"
                  value={reviewValues.representative.rep_contact_no}
                />
                <ReviewField
                  label="Relationship to Applicant"
                  value={reviewValues.representative.relationship_to_applicant}
                />
              </div>
            </section>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 flex justify-between border-t border-[#E5E7EB] bg-white px-6 py-4 shadow-[0_-6px_18px_rgba(17,24,39,0.04)]">
        <button
          type="button"
          onClick={() => setStep((current) => Math.max(current - 1, 0))}
          disabled={step === 0}
          className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-[#4B5563] transition duration-200 hover:bg-[#E5E7EB] hover:text-[#2B3642] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Back
        </button>

        <div className="flex flex-wrap justify-end gap-2">
          {isCaseFormStep && (
            <button
              type="button"
              onClick={() => setStep(hasLockedSelection ? 0 : 1)}
              className="rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] transition duration-200 hover:bg-[#704389] hover:text-white"
            >
              Change Method
            </button>
          )}
          {!lockedClient && step === 0 && (
            <button
              type="button"
              onClick={continueFromClient}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md  transition duration-200 hover:bg-[#5F3675]"
            >
              Continue
            </button>
          )}
          {isMethodStep && (
            <button
              type="button"
              onClick={continueFromMethod}
              disabled={!method}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md  transition duration-200 hover:bg-[#5F3675] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          )}
          {isCaseFormStep && requireReviewBeforeSubmit && (
            <button
              type="button"
              onClick={continueFromDetails}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md  transition duration-200 hover:bg-[#5F3675]"
            >
              Continue
            </button>
          )}
          {isCaseFormStep && !requireReviewBeforeSubmit && (
            <button
              type="submit"
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md  transition duration-200 hover:bg-[#5F3675]"
            >
              {submitLabel}
            </button>
          )}
          {isReviewStep && (
            <button
              type="submit"
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md  transition duration-200 hover:bg-[#5F3675]"
            >
              {submitLabel}
            </button>
          )}
          {isClassificationStep && (
            <button
              type="button"
              onClick={continueToReview}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md  transition duration-200 hover:bg-[#5F3675]"
            >
              Continue
            </button>
          )}
        </div>
      </div>
      <ClientInformationModal
        client={viewingClient}
        onClose={() => setViewingClient(null)}
      />
    </form>
  );
}
