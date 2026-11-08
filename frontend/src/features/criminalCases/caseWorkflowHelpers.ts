import type { getClientCases } from "../../services/recordService";
import type { CaseType, ClientRecord } from "../../types";
import { applicantRoleOptions, civilStatusOptions } from "./clientFieldOptions";
import type { AddCaseFormValues } from "./schemas";

export type CaseRepresentativeValues =
  AddCaseFormValues["client_representatives"][number]["representative"];

export function localDateInputValue(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const emptyRepresentativeValues = (): CaseRepresentativeValues => ({
  rep_name: "",
  rep_age: 0,
  rep_sex: "" as const,
  civil_status: "" as const,
  rep_address: "",
  rep_contact_no: "",
  relationship_to_applicant: "",
  rep_email: "",
});

export function hasSavedRepresentative(client?: ClientRecord) {
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

export function clientRepresentativeValues(
  client: ClientRecord,
): CaseRepresentativeValues {
  if (!hasSavedRepresentative(client)) return emptyRepresentativeValues();
  const details = client.client_details;
  const representativeSex = ["Male", "Female"].includes(
    details.representative_sex,
  )
    ? details.representative_sex
    : "";
  const representativeCivilStatus = civilStatusOptions.includes(
    details.representative_civil_status,
  )
    ? details.representative_civil_status
    : "";
  const storedText = (value: string) =>
    /^none$/i.test(value.trim()) ? "" : value;
  return {
    rep_name: storedText(details.representative_name || ""),
    rep_age: details.representative_age || 0,
    rep_sex: representativeSex as CaseRepresentativeValues["rep_sex"],
    civil_status:
      representativeCivilStatus as CaseRepresentativeValues["civil_status"],
    rep_address: storedText(details.representative_address || ""),
    rep_contact_no: storedText(details.representative_contact_no || ""),
    relationship_to_applicant: storedText(
      details.representative_relationship || "",
    ),
    rep_email: storedText(details.representative_email || ""),
  };
}

export const createDefaultValues = (
  clientId = "",
  caseType: CaseType = "Criminal",
  clients: ClientRecord[] = [],
): AddCaseFormValues => {
  const civilIntakeDefaults =
    caseType === "Civil"
      ? {
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
        }
      : {};
  const civilCaseDefaults =
    caseType === "Civil"
      ? {
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
        }
      : {};

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
  };
};

export function generatedCaseTitle(clients: ClientRecord[], caseType: CaseType) {
  const names = clients
    .map((client) => client.client.name.trim())
    .filter(Boolean);
  const prefix = caseType === "Civil" ? "Civil Case -" : "PP vs.";
  const fallback =
    caseType === "Civil" ? "Civil Case - Client" : "PP vs. Client";
  if (names.length === 0) return fallback;
  if (names.length === 1) return `${prefix} ${names[0]}`;
  if (names.length === 2) return `${prefix} ${names[0]} and ${names[1]}`;
  return `${prefix} ${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function getFirstValidationMessage(errors: unknown): string | null {
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

export function selectedClassificationNames(client: ClientRecord) {
  return reviewClassificationLabels
    .filter(([field]) => Boolean(client.client_classification[field]))
    .map(([, label]) => label);
}

export function displayDate(value?: string) {
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

export function partyFromHistoricalCase(
  record: Awaited<ReturnType<typeof getClientCases>>[number],
  clientId: string,
) {
  const participant = record.participants?.find(
    (item) => item.client_id === clientId,
  );
  const participantRole = participant?.applicant_role || "";
  if (applicantRoleOptions.includes(participantRole)) {
    return {
      role: participantRole,
      other:
        participantRole === "Others"
          ? participant?.applicant_role_other || ""
          : "",
    };
  }
  const hasMultipleParticipants = (record.participants?.length ?? 0) > 1;
  const caseRole = record.intake_record.applicant_role || "";
  if (!hasMultipleParticipants && applicantRoleOptions.includes(caseRole)) {
    return {
      role: caseRole,
      other:
        caseRole === "Others"
          ? record.intake_record.applicant_role_other || ""
          : "",
    };
  }
  const caseParty = hasMultipleParticipants
    ? ""
    : record.intake_record.party_represented;
  const rawValue = participant?.party_represented || caseParty || "";
  const recognized = recognizedParty(rawValue);
  if (recognized) return recognized;
  return null;
}
