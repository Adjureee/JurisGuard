import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useForm } from "react-hook-form";
import type { KeyboardEvent } from "react";
import type {
  Resolver,
  UseFormRegisterReturn,
} from "react-hook-form";
import { StepIndicator } from "../../features/criminalCases/components/StepIndicator";
import {
  addCaseFormSchema,
  criminalAddCaseFormSchema,
  type AddCaseFormValues,
} from "../../features/criminalCases/schemas";
import type {
  CaseType,
  ClientRecord,
} from "../../types";
import ClientInformationModal from "./ClientInformationModal";
import { getClientCases } from "../../services/recordService";
import { useConfirmation } from "../ConfirmationProvider";
import { relationshipOptions } from "../../features/criminalCases/clientFieldOptions";

interface CaseWorkflowProps {
  clients: ClientRecord[];
  lockedClient?: ClientRecord;
  lockedClients?: ClientRecord[];
  caseType?: CaseType;
  requireReviewBeforeSubmit?: boolean;
  submitLabel?: string;
  stepNumberOffset?: number;
  onClientUpdated?: (client: ClientRecord) => void;
  onSubmit: (values: AddCaseFormValues) => void | Promise<void>;
}

function localDateInputValue(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type CaseRepresentativeValues = AddCaseFormValues["client_representatives"][number]["representative"];

const emptyRepresentativeValues = (): CaseRepresentativeValues => ({
  rep_name: "",
  rep_age: 0,
  rep_sex: "" as const,
  civil_status: "" as const,
  rep_address: "",
  rep_contact_no: "",
  relationship_to_applicant: "",
  rep_email: "",
});

const createDefaultValues = (
  clientId = "",
  caseType: CaseType = "Criminal",
  clients: ClientRecord[] = [],
): AddCaseFormValues => {
  const civilIntakeDefaults = caseType === "Civil" ? {
    party_represented: "",
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
  } : {};
  const civilCaseDefaults = caseType === "Civil" ? {
    case_status: "Pending",
    incident_address: "",
    latitude: "",
    longitude: "",
    facts_of_case: "",
    pending_in_court: true,
    cause_of_termination: "",
    date_of_termination: "",
    assigned_pao: "",
    filing_date: "",
    hearing_schedule: "",
    remarks: "",
  } : {};

  return {
    client_id: clientId,
    client_ids: clientId ? [clientId] : [],
    case_type: caseType,
    intake_record: {
      control_no: "",
      form_date: localDateInputValue(),
      region: "Regional Office No. XI",
      district_office: "Panabo City District Office",
      applicant_role: "",
      applicant_role_other: "",
      ...civilIntakeDefaults,
    },
    representative: {
      rep_name: "",
      rep_age: 0,
      rep_sex: "",
      civil_status: "",
      rep_address: "",
      rep_contact_no: "",
      relationship_to_applicant: "",
      rep_email: "",
    },
    client_representatives: clients.map((client) => ({
      client_id: client.client_id,
      representative: clientRepresentativeValues(client),
    })),
    adverse_party: { role: "", name: "", address: "" },
    cases: {
      title_of_case: "",
      case_no: "",
      court_body: "",
      status_of_case: "Pending",
      incident_barangay: "",
      incident_city: "Panabo City",
      last_action_taken: "",
      detained: false,
      date_of_confinement: "",
      place_of_detention: "",
      location_type: "",
      cause_of_action: "",
      ...civilCaseDefaults,
    },
  } as AddCaseFormValues;
};

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

const civilStatusOptions = [
  "Single",
  "Married",
  "Widowed",
  "Separated",
  "Annulled",
  "Divorced",
  "None",
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

function clientRepresentativeValues(client: ClientRecord): CaseRepresentativeValues {
  if (!hasSavedRepresentative(client)) return emptyRepresentativeValues();
  const details = client.client_details;
  const representativeSex = ["Male", "Female"].includes(details.representative_sex)
    ? details.representative_sex
    : "";
  const representativeCivilStatus = civilStatusOptions.includes(details.representative_civil_status)
    ? details.representative_civil_status
    : "";
  const storedText = (value: string) => /^none$/i.test(value.trim()) ? "" : value;
  return {
    rep_name: storedText(details.representative_name || ""),
    rep_age: details.representative_age || 0,
    rep_sex: representativeSex as CaseRepresentativeValues["rep_sex"],
    civil_status: representativeCivilStatus as CaseRepresentativeValues["civil_status"],
    rep_address: storedText(details.representative_address || ""),
    rep_contact_no: storedText(details.representative_contact_no || ""),
    relationship_to_applicant: storedText(details.representative_relationship || ""),
    rep_email: storedText(details.representative_email || ""),
  };
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
  disabled = false,
  readOnly = false,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#4B5563]">
        {label}
      </span>
      <input
        type={type}
        disabled={disabled}
        readOnly={readOnly}
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
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#4B5563]">
        {label}
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

function InventorySourceField({
  label,
  value,
  source,
}: {
  label: string;
  value: string;
  source: string;
}) {
  return (
    <div className="rounded-md border border-[#D1D5DB] bg-[#F8FAFC] px-3 py-2.5">
      <p className="text-sm font-medium text-[#4B5563]">{label}</p>
      <p className="mt-1 min-h-5 break-words text-sm font-semibold text-[#2B3642]">
        {value || "Not provided"}
      </p>
      <p className="mt-1 text-xs text-[#6B7280]">{source}</p>
    </div>
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

function displayDate(value?: string) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
}

function recognizedParty(value: string) {
  const trimmed = value.trim();
  if (applicantRoleOptions.includes(trimmed)) return { role: trimmed, other: "" };
  const other = /^Others:\s*(.+)$/i.exec(trimmed)?.[1]?.trim();
  return other ? { role: "Others", other } : null;
}

function partyFromHistoricalCase(
  record: Awaited<ReturnType<typeof getClientCases>>[number],
  clientId: string,
) {
  const participant = record.participants?.find((item) => item.client_id === clientId);
  const participantRole = participant?.applicant_role || "";
  if (applicantRoleOptions.includes(participantRole)) {
    return {
      role: participantRole,
      other: participantRole === "Others" ? participant?.applicant_role_other || "" : "",
    };
  }
  const hasMultipleParticipants = (record.participants?.length ?? 0) > 1;
  const caseRole = record.intake_record.applicant_role || "";
  if (!hasMultipleParticipants && applicantRoleOptions.includes(caseRole)) {
    return {
      role: caseRole,
      other: caseRole === "Others" ? record.intake_record.applicant_role_other || "" : "",
    };
  }
  const caseParty = hasMultipleParticipants ? "" : record.intake_record.party_represented;
  const rawValue = participant?.party_represented || caseParty || "";
  const recognized = recognizedParty(rawValue);
  if (recognized) return recognized;
  return null;
}

export function CaseWorkflow({
  clients,
  lockedClient,
  lockedClients,
  caseType = "Criminal",
  requireReviewBeforeSubmit = false,
  submitLabel = "Save Case",
  stepNumberOffset = 0,
  onClientUpdated,
  onSubmit,
}: CaseWorkflowProps) {
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
  const [query, setQuery] = useState("");
  const [viewingClient, setViewingClient] = useState<ClientRecord | null>(null);
  const [editingClient, setEditingClient] = useState<ClientRecord | null>(null);
  const [collapsedRepresentativeClientIds, setCollapsedRepresentativeClientIds] = useState<string[]>(
    () => lockedSelectionClients.filter(hasSavedRepresentative).map((client) => client.client_id),
  );
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>(
    lockedSelectionClients.map((client) => client.client_id),
  );
  const [activeClientIndex, setActiveClientIndex] = useState(0);
  const confirm = useConfirmation();
  const standaloneSteps = requireReviewBeforeSubmit
    ? [
        "Select Client",
        "Case Details",
        "Classification",
        "Review",
      ]
    : ["Select Client", "Case Details"];
  const lockedSteps = requireReviewBeforeSubmit
    ? ["Case Details", "Classification", "Review"]
    : ["Case Details"];
  const steps = hasLockedSelection ? lockedSteps : standaloneSteps;
  const formSchema = caseType === "Criminal" ? criminalAddCaseFormSchema : addCaseFormSchema;
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    watch,
    trigger,
    formState: { isSubmitting, errors },
  } = useForm<AddCaseFormValues>({
    resolver: zodResolver(formSchema) as Resolver<AddCaseFormValues>,
    defaultValues: createDefaultValues(
      lockedSelectionClients[0]?.client_id ?? "",
      caseType,
      lockedSelectionClients,
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
  const scannedSelectedClients = selectedClients.filter((client) => client.paper_intake);
  const applicantRole = watch("intake_record.applicant_role");
  const clientRepresentativeEntries = watch("client_representatives") ?? [];
  const caseStatus = watch("cases.status_of_case");
  const caseDetained = Boolean(watch("cases.detained"));
  const locationType = watch("cases.location_type");
  const incidentBarangay = watch("cases.incident_barangay");
  const partyLookupKey = selectedClients.map((client) => client.client_id).join("|");
  const partyLookupClientsRef = useRef(selectedClients);
  const partySelectionTouched = useRef(false);
  const submitInProgressRef = useRef(false);
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
  const isCaseFormStep = hasLockedSelection ? step === 0 : step === 1;
  const classificationStep = hasLockedSelection ? 1 : 2;
  const reviewStep = hasLockedSelection ? 2 : 3;
  const isClassificationStep =
    requireReviewBeforeSubmit && step === classificationStep;
  const isReviewStep = requireReviewBeforeSubmit && step === reviewStep;
  const reviewValues = watch();
  const collapsedRepresentativeIds = useMemo(
    () => new Set(collapsedRepresentativeClientIds),
    [collapsedRepresentativeClientIds],
  );
  const filteredBarangays =
    locationType === "Urban"
      ? urbanBarangays
      : locationType === "Rural"
        ? ruralBarangays
        : panaboBarangays;

  useEffect(() => {
    partyLookupClientsRef.current = selectedClients;
  }, [selectedClients]);

  useEffect(() => {
    let isCurrent = true;
    partySelectionTouched.current = false;
    setValue("intake_record.applicant_role", "", { shouldValidate: true });
    setValue("intake_record.applicant_role_other", "", { shouldValidate: false });
    const clientsToLookup = partyLookupClientsRef.current;
    if (!partyLookupKey || clientsToLookup.length === 0) {
      return () => {
        isCurrent = false;
      };
    }

    Promise.all(
      clientsToLookup.map(async (client) => {
        const records = await getClientCases(client.client_id, "All");
        return records[0]
          ? partyFromHistoricalCase(records[0], client.client_id)
          : null;
      }),
    )
      .then((values) => {
        if (!isCurrent || partySelectionTouched.current) return;
        const first = values[0];
        const sameForAll = Boolean(first) && values.every(
          (value) => value?.role === first?.role && value?.other === first?.other,
        );
        if (!sameForAll || !first) return;
        setValue("intake_record.applicant_role", first.role, {
          shouldDirty: false,
          shouldValidate: true,
        });
        setValue("intake_record.applicant_role_other", first.other, {
          shouldDirty: false,
          shouldValidate: true,
        });
      })
      .catch(() => {
        // Historical values are optional; keep the field blank if lookup fails.
      });

    return () => {
      isCurrent = false;
    };
  }, [partyLookupKey, setValue]);

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
    const current = getValues("client_representatives") ?? [];
    const selectedIds = selectedClients.map((client) => client.client_id);
    if (current.length === selectedIds.length && current.every((entry, index) => entry.client_id === selectedIds[index])) {
      return;
    }
    const nextValues = selectedClients.map((client) =>
      current.find((entry) => entry.client_id === client.client_id) ?? {
        client_id: client.client_id,
        representative: clientRepresentativeValues(client),
      },
    );
    setValue("client_representatives", nextValues, { shouldValidate: false });
  }, [getValues, partyLookupKey, selectedClients, setValue]);

  useEffect(() => {
    if (caseType === "Criminal") return;
    const pending = caseStatus !== "Terminated";
    setValue("cases.pending_in_court", pending, { shouldDirty: true });
    setValue("cases.case_status", caseStatus, { shouldDirty: true });
  }, [caseStatus, caseType, setValue]);

  useEffect(() => {
    if (!incidentBarangay || (locationType && filteredBarangays.includes(incidentBarangay))) return;
    setValue("cases.incident_barangay", "", { shouldDirty: true, shouldValidate: true });
  }, [filteredBarangays, incidentBarangay, locationType, setValue]);

  const selectClient = (client: ClientRecord) => {
    setSelectedClientIds((current) => {
      if (current.includes(client.client_id)) {
        toast.error("Client is already selected.");
        return current;
      }
      return [...current, client.client_id];
    });
    setCollapsedRepresentativeClientIds((current) =>
      hasSavedRepresentative(client) && !current.includes(client.client_id)
        ? [...current, client.client_id]
        : current.filter((clientId) => clientId !== client.client_id),
    );
    setQuery("");
  };

  const clearClient = () => {
    setQuery("");
  };

  const removeSelectedClient = async (clientId: string) => {
    const clientToRemove = selectedClients.find((client) => client.client_id === clientId);
    if (!clientToRemove) return;
    const confirmed = await confirm({
      title: "Remove selected client?",
      message: `Are you sure you want to remove ${clientToRemove.client.name} from this case? This only removes the client from the current case selection.`,
      confirmLabel: "Remove Client",
    });
    if (!confirmed) return;
    setSelectedClientIds((current) =>
      current.filter((selectedId) => selectedId !== clientId),
    );
    setValue(
      "client_representatives",
      getValues("client_representatives").filter((entry) => entry.client_id !== clientId),
      { shouldDirty: true, shouldValidate: false },
    );
    setCollapsedRepresentativeClientIds((current) =>
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

  const submitCase = async (values: AddCaseFormValues) => {
    if (submitInProgressRef.current) return;
    submitInProgressRef.current = true;
    try {
      const generatedTitle = generatedCaseTitle(selectedClients, caseType);
      const normalizedStatus = values.cases.status_of_case === "Terminated"
        ? "Terminated"
        : "Pending";
      const normalizedDetained = Boolean(values.cases.detained);
      const representedParty =
        values.intake_record.applicant_role === "Others"
          ? values.intake_record.applicant_role_other
          : values.intake_record.applicant_role;
      const caseValues = { ...values.cases };
      delete (caseValues as Partial<AddCaseFormValues["cases"]>).incident_address;
      delete (caseValues as Partial<AddCaseFormValues["cases"]>).latitude;
      delete (caseValues as Partial<AddCaseFormValues["cases"]>).longitude;
      const primaryClientRepresentative = values.client_representatives.find(
        (entry) => entry.client_id === (selectedClient?.client_id ?? values.client_id),
      )?.representative ?? emptyRepresentativeValues();
      await onSubmit({
        ...values,
        case_type: caseType,
        client_id: selectedClient?.client_id ?? values.client_id,
        client_ids: selectedClients.map((client) => client.client_id),
        client_representatives: values.client_representatives.filter((entry) =>
          selectedClients.some((client) => client.client_id === entry.client_id),
        ),
        representative: primaryClientRepresentative,
        intake_record: {
          ...values.intake_record,
          district_office: values.intake_record.district_office,
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
          ...caseValues,
          title_of_case: generatedTitle,
          status_of_case: normalizedStatus,
          ...(caseType === "Civil"
            ? {
                case_status: normalizedStatus,
                pending_in_court: normalizedStatus === "Pending",
              }
            : {}),
          incident_city: "Panabo City",
          detained: normalizedDetained,
          date_of_confinement: normalizedDetained
            ? values.cases.date_of_confinement
            : "",
          place_of_detention: normalizedDetained
            ? values.cases.place_of_detention
            : "",
        },
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save case",
      );
    } finally {
      submitInProgressRef.current = false;
    }
  };

  const selectedClientsSection = (
    <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-[#1F2937]">
        {selectedClients.length === 1 ? "Selected Client" : "Selected Clients"}
      </h3>
      <div className="mt-3 flex flex-wrap content-start gap-2">
        {selectedClients.map((client) => (
          <SelectedClientCard
            key={client.client_id}
            client={client}
            locked={hasLockedSelection}
            onView={() => setViewingClient(client)}
            onRemove={hasLockedSelection ? undefined : () => void removeSelectedClient(client.client_id)}
          />
        ))}
      </div>
    </section>
  );

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
        <StepIndicator steps={steps} currentStep={step} stepNumberOffset={stepNumberOffset} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#F8FAFC] px-6 py-5">
        {!hasLockedSelection && step === 0 && (
          <div className="grid min-h-0 gap-5 lg:grid-cols-[0.9fr_1.1fr]">
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
                <div
                  className={`space-y-3 p-3 ${
                    selectedClients.length > 0
                      ? "max-h-64 overflow-y-auto"
                      : ""
                  }`}
                >
                  {selectedClients.length === 0 ? (
                    <div className="py-2 text-center text-sm text-[#4B5563]">
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

            <div className="min-h-0 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
              <div className="sticky top-0 border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 text-sm font-semibold text-[#4B5563]">
                Existing Clients
              </div>
              <div className="max-h-96 min-h-0 divide-y divide-[#E5E7EB] overflow-y-auto">
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

        {isCaseFormStep && (
          <div className="space-y-6">
            {hasLockedSelection && selectedClientsSection}

            {caseType === "Criminal" && (
              <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                <h3 className="text-base font-semibold text-[#1F2937]">
                  Report heading
                </h3>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <TextInput
                    label="Regional Office"
                    registration={register("intake_record.region")}
                    readOnly
                  />
                  <TextInput
                    label="District Office"
                    registration={register("intake_record.district_office")}
                    error={errors.intake_record?.district_office?.message}
                    readOnly
                  />
                </div>
              </section>
            )}

            {!hasLockedSelection && selectedClientsSection}

            {caseType === "Criminal" && (
              <>
                <section
                  data-testid="criminal-inventory-fields"
                  className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-[#1F2937]">
                        Inventory report fields
                      </h3>
                      <p className="mt-1 max-w-3xl text-sm leading-6 text-[#4B5563]">
                        Fields follow the same order as the Excel inventory report. Values from Part II are shown as read-only until you open the scanned intake editor.
                      </p>
                    </div>
                    {onClientUpdated && scannedSelectedClients.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {scannedSelectedClients.map((client) => (
                          <button
                            key={client.client_id}
                            type="button"
                            onClick={() => setEditingClient(client)}
                            className="min-h-11 rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] transition hover:bg-[#F7F0FA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]"
                          >
                            {scannedSelectedClients.length === 1
                              ? "Edit scanned Parts II and II-A"
                              : `Edit scan: ${client.client.name}`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid gap-5 md:grid-cols-2">
                    <TextInput
                      label="Control Number"
                      registration={register("intake_record.control_no")}
                      error={errors.intake_record?.control_no?.message}
                    />
                    <label className="block">
                      <span className="text-sm font-medium text-[#4B5563]">Court / Body</span>
                      <select
                        {...register("cases.court_body")}
                        className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                      >
                        <option>Branch 4</option>
                        <option>Branch 34</option>
                        <option>MTCC</option>
                      </select>
                      <FieldError message={errors.cases?.court_body?.message} />
                    </label>
                    <InventorySourceField
                      label="Title of the Case"
                      value={generatedCaseTitle(selectedClients, caseType)}
                      source="Generated from the selected client records"
                    />
                    <TextInput
                      label="Case No."
                      registration={register("cases.case_no")}
                      error={errors.cases?.case_no?.message}
                    />

                    <fieldset className="md:col-span-2">
                      <legend className="text-sm font-medium text-[#4B5563]">
                        Party Represented
                      </legend>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {applicantRoleOptions.map((role) => (
                          <label key={role} className="flex min-h-10 items-center gap-2 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                            <input
                              type="radio"
                              value={role}
                              {...register("intake_record.applicant_role", {
                                onChange: () => { partySelectionTouched.current = true; },
                              })}
                              className="h-4 w-4 border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                            />
                            {role}
                          </label>
                        ))}
                      </div>
                      <FieldError message={errors.intake_record?.applicant_role?.message} />
                      {applicantRole === "Others" && (
                        <div className="mt-3 max-w-md">
                          <TextInput
                            label="Specify Party Represented"
                            registration={register("intake_record.applicant_role_other")}
                            error={errors.intake_record?.applicant_role_other?.message}
                          />
                        </div>
                      )}
                    </fieldset>

                    <div className="md:col-span-2">
                      <TextArea
                        label="Cause of Action"
                        registration={register("cases.cause_of_action")}
                        error={errors.cases?.cause_of_action?.message}
                      />
                    </div>

                    <label className="block">
                      <span className="text-sm font-medium text-[#4B5563]">
                        Status of Case
                      </span>
                      <select
                        {...register("cases.status_of_case")}
                        className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
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

                    <label className="md:col-span-2 flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                      <input type="checkbox" {...register("cases.detained")} className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]" />
                      Client is detained
                    </label>
                    {caseDetained && (
                      <>
                        <TextInput label="Date of Confinement" type="date" registration={register("cases.date_of_confinement")} error={errors.cases?.date_of_confinement?.message} />
                        <TextInput label="Place of Detention" registration={register("cases.place_of_detention")} error={errors.cases?.place_of_detention?.message} />
                      </>
                    )}

                    <TextInput
                      label="Case Received"
                      type="date"
                      registration={register("intake_record.form_date")}
                      error={errors.intake_record?.form_date?.message}
                    />
                  </div>
                </section>

              </>
            )}

            {caseType === "Civil" && <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Case Identification
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <TextInput
                  label="Control No."
                  registration={register("intake_record.control_no")}
                  error={errors.intake_record?.control_no?.message}
                />
                <label className="block">
                  <span className="text-sm font-medium text-[#4B5563]">Court / Body</span>
                  <select
                    {...register("cases.court_body")}
                    className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                  >
                    <option>Branch 4</option>
                    <option>Branch 34</option>
                    <option>MTCC</option>
                  </select>
                  <FieldError message={errors.cases?.court_body?.message} />
                </label>
                <InventorySourceField
                  label="Title of the Case"
                  value={generatedCaseTitle(selectedClients, caseType)}
                  source="Generated from the selected client records"
                />
                <TextInput
                  label="Case No."
                  registration={register("cases.case_no")}
                  error={errors.cases?.case_no?.message}
                />
                <TextInput
                  label="Regional Office"
                  registration={register("intake_record.region")}
                  readOnly
                />
                <TextInput
                  label="District Office"
                  registration={register("intake_record.district_office")}
                  error={errors.intake_record?.district_office?.message}
                  readOnly
                />
              </div>
            </section>}

            {caseType === "Civil" && <>
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
            </>}

            {caseType === "Civil" && (
            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Applicant Case Involvement (Party Represented)
              </h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {applicantRoleOptions.map((role) => (
                  <label key={role} className="flex min-h-10 items-center gap-2 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                    <input
                      type="radio"
                      value={role}
                      {...register("intake_record.applicant_role", {
                        onChange: () => { partySelectionTouched.current = true; },
                      })}
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
                    label="Specify Party Represented"
                    registration={register(
                      "intake_record.applicant_role_other",
                    )}
                    error={errors.intake_record?.applicant_role_other?.message}
                  />
                </div>
              )}
            </section>
            )}

            {caseType === "Civil" && (
              <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                <h3 className="text-base font-semibold text-[#1F2937]">Cause of Action</h3>
                <div className="mt-3">
                  <TextArea
                    label="Cause of Action"
                    registration={register("cases.cause_of_action")}
                    error={errors.cases?.cause_of_action?.message}
                  />
                </div>
              </section>
            )}

            {caseType === "Civil" && (
            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Case Status
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-[#4B5563]">
                    Status of Case
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
                  Client is detained
                </label>
                {caseDetained && (
                  <>
                    <TextInput
                      label="Date of Confinement"
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
                <TextInput
                  label="Case Received"
                  type="date"
                  registration={register("intake_record.form_date")}
                  error={errors.intake_record?.form_date?.message}
                />
              </div>
            </section>
            )}

            {caseType === "Civil" && <>
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
                </label>
                <TextInput
                  label="Submission Deadline (optional)"
                  type="date"
                  registration={register("intake_record.proof_submission_deadline")}
                  error={errors.intake_record?.proof_submission_deadline?.message}
                />
                <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                  <input
                    type="checkbox"
                    {...register("intake_record.proof_itr_satisfied")}
                    className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                  />
                  Income Tax Return / proof of income satisfied
                </label>
                <TextInput
                  label="ITR Date (optional)"
                  type="date"
                  registration={register("intake_record.proof_itr_date")}
                  error={errors.intake_record?.proof_itr_date?.message}
                />
                <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                  <input
                    type="checkbox"
                    {...register("intake_record.proof_brgy_satisfied")}
                    className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                  />
                  Barangay certification / indigency satisfied
                </label>
                <TextInput
                  label="Barangay Certification Date (optional)"
                  type="date"
                  registration={register("intake_record.proof_brgy_date")}
                  error={errors.intake_record?.proof_brgy_date?.message}
                />
                <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                  <input
                    type="checkbox"
                    {...register("intake_record.proof_dswd_satisfied")}
                    className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                  />
                  DSWD certification satisfied
                </label>
                <TextInput
                  label="DSWD Certification Date (optional)"
                  type="date"
                  registration={register("intake_record.proof_dswd_date")}
                  error={errors.intake_record?.proof_dswd_date?.message}
                />
                <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                  <input
                    type="checkbox"
                    {...register("intake_record.proof_others_satisfied")}
                    className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                  />
                  Other accepted proof satisfied
                </label>
                <TextInput
                  label="Other Proof Date (optional)"
                  type="date"
                  registration={register("intake_record.proof_others_date")}
                  error={errors.intake_record?.proof_others_date?.message}
                />
                <div className="md:col-span-2">
                  <TextInput
                    label="Other Proof Details"
                    registration={register("intake_record.proof_others_details")}
                    error={errors.intake_record?.proof_others_details?.message}
                  />
                </div>
              </div>
            </section>
            </>}

            {caseType === "Civil" && (
            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Case Facts and Cause
              </h3>
              <div className="mt-3 grid gap-4">
                <TextArea
                  label="Fact of the Case"
                  registration={register("cases.facts_of_case")}
                  error={errors.cases?.facts_of_case?.message}
                />
              </div>
            </section>
            )}

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Representative Information
              </h3>
              <div className="mt-3 space-y-3">
                {selectedClients.map((client) => {
                  const representativeIndex = clientRepresentativeEntries.findIndex(
                    (entry) => entry.client_id === client.client_id,
                  );
                  if (representativeIndex < 0) return null;
                  const fieldPrefix = `client_representatives.${representativeIndex}.representative` as const;
                  const collapsed = collapsedRepresentativeIds.has(client.client_id);
                  const representativeErrors = errors.client_representatives?.[representativeIndex]?.representative;
                  return (
                    <article key={client.client_id} className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold text-[#2B3642]">{client.client.name}</h4>
                        <label className="flex items-center gap-2 text-sm font-medium text-[#4B5563]">
                          <input
                            type="checkbox"
                            checked={collapsed}
                            onChange={(event) => {
                              const shouldCollapse = event.target.checked;
                              setCollapsedRepresentativeClientIds((current) =>
                                shouldCollapse
                                  ? current.includes(client.client_id)
                                    ? current
                                    : [...current, client.client_id]
                                  : current.filter((clientId) => clientId !== client.client_id),
                              );
                            }}
                            className="h-4 w-4 rounded border-[#D1D5DB] text-[#704389] focus:ring-[#704389]"
                          />
                          Representative Information
                        </label>
                      </div>
                      {!collapsed && (
                        <div className="mt-4 grid gap-4">
                          <div>
                            <TextInput
                              label="Representative Name"
                              registration={register(`${fieldPrefix}.rep_name`)}
                              error={representativeErrors?.rep_name?.message}
                            />
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <TextInput
                              label="Representative Age"
                              type="number"
                              registration={register(`${fieldPrefix}.rep_age`, { valueAsNumber: true })}
                              error={representativeErrors?.rep_age?.message}
                            />
                            <label className="block">
                              <span className="text-sm font-medium text-[#4B5563]">Representative Sex</span>
                              <select
                                {...register(`${fieldPrefix}.rep_sex`)}
                                className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                              >
                                <option value="">Select</option>
                                <option>Male</option>
                                <option>Female</option>
                              </select>
                              <FieldError message={representativeErrors?.rep_sex?.message} />
                            </label>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <label className="block">
                              <span className="text-sm font-medium text-[#4B5563]">Civil Status</span>
                              <select
                                {...register(`${fieldPrefix}.civil_status`)}
                                className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                              >
                                <option value="">Select</option>
                                {civilStatusOptions.map((option) => <option key={option}>{option}</option>)}
                              </select>
                              <FieldError message={representativeErrors?.civil_status?.message} />
                            </label>
                            <TextInput
                              label="Representative Address"
                              registration={register(`${fieldPrefix}.rep_address`)}
                              error={representativeErrors?.rep_address?.message}
                            />
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <TextInput
                              label="Contact Number"
                              registration={register(`${fieldPrefix}.rep_contact_no`)}
                              error={representativeErrors?.rep_contact_no?.message}
                            />
                            <label className="block">
                              <span className="text-sm font-medium text-[#4B5563]">Relationship to Applicant</span>
                              <select
                                {...register(`${fieldPrefix}.relationship_to_applicant`)}
                                className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                              >
                                <option value="">Select</option>
                                {relationshipOptions.map((option) => <option key={option}>{option}</option>)}
                              </select>
                              <FieldError message={representativeErrors?.relationship_to_applicant?.message} />
                            </label>
                          </div>
                          <div>
                            <TextInput
                              label="Representative Email"
                              type="email"
                              registration={register(`${fieldPrefix}.rep_email`)}
                              error={representativeErrors?.rep_email?.message}
                            />
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
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
                    <option value="">Select location type</option>
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
                  readOnly
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
                  label="Case Received"
                  value={displayDate(reviewValues.intake_record.form_date)}
                />
                <ReviewField
                  label="Regional Office"
                  value={reviewValues.intake_record.region}
                />
                <ReviewField
                  label="District Office"
                  value={reviewValues.intake_record.district_office}
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
                  label="Nature of Case"
                  value={reviewValues.intake_record.nature_of_case}
                />
                <ReviewField
                  label="Party Represented"
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
                <ReviewField label="City" value="Panabo City" />
                <ReviewField
                  label="Detained"
                  value={reviewValues.cases.detained}
                />
                <ReviewField
                  label="Date of Confinement"
                  value={displayDate(reviewValues.cases.date_of_confinement)}
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

            {selectedClients.map((client) => {
              const representative = reviewValues.client_representatives.find(
                (entry) => entry.client_id === client.client_id,
              )?.representative;
              return (
                <section key={client.client_id} className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                  <h3 className="text-base font-semibold text-[#1F2937]">
                    Representative Information — {client.client.name}
                  </h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    <ReviewField label="Representative Name" value={representative?.rep_name} />
                    <ReviewField label="Representative Age" value={representative?.rep_age} />
                    <ReviewField label="Representative Sex" value={representative?.rep_sex} />
                    <ReviewField label="Civil Status" value={representative?.civil_status} />
                    <ReviewField label="Representative Address" value={representative?.rep_address} />
                    <ReviewField label="Contact Number" value={representative?.rep_contact_no} />
                    <ReviewField label="Relationship to Applicant" value={representative?.relationship_to_applicant} />
                    <ReviewField label="Representative Email" value={representative?.rep_email} />
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 flex justify-between border-t border-[#E5E7EB] bg-white px-6 py-4 shadow-[0_-6px_18px_rgba(17,24,39,0.04)]">
        <button
          type="button"
          onClick={() => {
            setStep((current) => Math.max(current - 1, 0));
          }}
          disabled={step === 0}
          className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-[#4B5563] transition duration-200 hover:bg-[#E5E7EB] hover:text-[#2B3642] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Back
        </button>

        <div className="flex flex-wrap justify-end gap-2">
          {!lockedClient && step === 0 && (
            <button
              type="button"
              onClick={continueFromClient}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md  transition duration-200 hover:bg-[#5F3675]"
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
              disabled={isSubmitting}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md  transition duration-200 hover:bg-[#5F3675]"
            >
              {isSubmitting ? "Saving…" : submitLabel}
            </button>
          )}
          {isReviewStep && (
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md  transition duration-200 hover:bg-[#5F3675]"
            >
              {isSubmitting ? "Saving…" : submitLabel}
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
      <ClientInformationModal
        client={editingClient}
        onClose={() => setEditingClient(null)}
        onSaved={onClientUpdated}
      />
    </form>
  );
}
