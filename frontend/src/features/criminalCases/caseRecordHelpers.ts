import type {
  CaseListItem,
  CaseParticipant,
  ClientClassification,
  ClientRecord,
  CriminalCaseRecord,
} from "../../types";
import type { DateFilterValue } from "../../utils/dateFilters";
import { civilStatusOptions } from "./clientFieldOptions";
import type { CaseFormValues, ClientFormValues } from "./schemas";

export const courtBodyOptions = [
  "RTC Branch 4",
  "RTC Branch 34",
  "Family Court - Panabo District",
  "MTCC - Panabo District",
];

export const courtFilterOptions = ["All Courts", ...courtBodyOptions];
export const CASE_PAGE_SIZE = 50;

export const classificationOptions = [
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

export function participantPartyRepresented(participant: CaseParticipant) {
  if (participant.party_represented) return participant.party_represented;
  if (participant.applicant_role === "Others") {
    return participant.applicant_role_other || "";
  }
  return participant.applicant_role || "";
}

export function toCaseListItem(record: CriminalCaseRecord): CaseListItem {
  return {
    case_id: record.case_id,
    client_id: record.client_id,
    case_type: record.case_type ?? "Criminal",
    created_by_user_id: record.created_by_user_id,
    control_no: record.intake_record.control_no,
    form_date: record.intake_record.form_date,
    party_represented: record.intake_record.party_represented,
    nature_of_case: record.intake_record.nature_of_case,
    title_of_case: record.cases.title_of_case,
    case_no: record.cases.case_no,
    court_body: record.cases.court_body,
    status_of_case: record.cases.status_of_case,
    is_terminated: Boolean(record.cases.is_terminated),
    location_type: record.cases.location_type,
    cause_of_action: record.cases.cause_of_action,
    participants: (record.participants ?? []).map((participant) => ({
      client_id: participant.client_id,
      name: participant.name,
      sex: participant.sex,
      party_represented: participantPartyRepresented(participant),
      applicant_role: participant.applicant_role,
      applicant_role_other: participant.applicant_role_other,
    })),
    last_updated: record.last_updated,
  };
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function caseDateRange(filter: DateFilterValue, now = new Date()) {
  if (filter === "all") return { date_from: "", date_to: "" };
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  if (filter === "today") {
    // Same day for both inclusive date bounds.
  } else if (filter === "last7" || filter === "last30") {
    start.setDate(start.getDate() - (filter === "last7" ? 6 : 29));
  } else if (filter === "month") {
    start.setDate(1);
  } else {
    start.setMonth(0, 1);
  }
  return { date_from: localDateKey(start), date_to: localDateKey(end) };
}

export function toClientFormValues(client: ClientRecord): ClientFormValues {
  return {
    client: { ...client.client },
    client_details: {
      ...client.client_details,
      detained: client.client_details.detained ?? undefined,
    },
    client_classification: { ...client.client_classification },
  };
}

function caseRepresentativeSex(value?: string): "" | "Male" | "Female" {
  return value === "Male" || value === "Female" ? value : "";
}

type CivilStatusOption =
  | "Single"
  | "Married"
  | "Widowed"
  | "Separated"
  | "Annulled"
  | "Divorced"
  | "None";

function caseRepresentativeCivilStatus(value?: string): CivilStatusOption | "" {
  return civilStatusOptions.includes(value ?? "")
    ? (value as CivilStatusOption)
    : "";
}

export function toCaseFormValues(record: CriminalCaseRecord): CaseFormValues {
  const clientRepresentatives = record.participants?.length
    ? record.participants.map((participant) => ({
        client_id: participant.client_id,
        representative: {
          rep_name: participant.representative?.rep_name ?? "",
          rep_age: participant.representative?.rep_age ?? 0,
          rep_sex: caseRepresentativeSex(participant.representative?.rep_sex),
          civil_status: caseRepresentativeCivilStatus(
            participant.representative?.civil_status,
          ),
          rep_address: participant.representative?.rep_address ?? "",
          rep_contact_no: participant.representative?.rep_contact_no ?? "",
          relationship_to_applicant:
            participant.representative?.relationship_to_applicant ?? "",
          rep_email: participant.representative?.rep_email ?? "",
        },
      }))
    : [
        {
          client_id: record.client_id,
          representative: {
            rep_name: record.representative.rep_name,
            rep_age: record.representative.rep_age,
            rep_sex: caseRepresentativeSex(record.representative.rep_sex),
            civil_status: caseRepresentativeCivilStatus(
              record.representative.civil_status,
            ),
            rep_address: record.representative.rep_address,
            rep_contact_no: record.representative.rep_contact_no,
            relationship_to_applicant:
              record.representative.relationship_to_applicant,
            rep_email: record.representative.rep_email ?? "",
          },
        },
      ];
  return {
    client_id: record.client_id,
    client_representatives: clientRepresentatives,
    intake_record: { ...record.intake_record },
    representative: {
      ...record.representative,
      rep_email: record.representative.rep_email ?? "",
    },
    adverse_party: { ...record.adverse_party },
    cases: {
      ...record.cases,
      case_status: record.cases.case_status ?? record.cases.status_of_case,
      incident_barangay: record.cases.incident_barangay ?? "",
      incident_city: record.cases.incident_city ?? "",
      incident_address: record.cases.incident_address ?? "",
      latitude: record.cases.latitude ?? "",
      longitude: record.cases.longitude ?? "",
      detained: Boolean(record.cases.detained),
      date_of_confinement: record.cases.date_of_confinement ?? "",
      place_of_detention: record.cases.place_of_detention ?? "",
      location_type: record.cases.location_type ?? "",
      cause_of_action: record.cases.cause_of_action ?? "",
      facts_of_case: record.cases.facts_of_case ?? "",
      assigned_pao: record.cases.assigned_pao ?? "",
      filing_date: record.cases.filing_date ?? "",
      hearing_schedule: record.cases.hearing_schedule ?? "",
      remarks: record.cases.remarks ?? "",
    },
  };
}

export function caseParticipants(
  record: CriminalCaseRecord,
  fallbackClient?: ClientRecord,
): CaseParticipant[] {
  if (record.participants?.length) return record.participants;
  return fallbackClient
    ? [
        {
          case_client_id: "",
          client_id: fallbackClient.client_id,
          name: fallbackClient.client.name,
          sex: fallbackClient.client.sex,
          age: fallbackClient.client.age,
          party_represented: record.intake_record.party_represented,
          applicant_role: record.intake_record.applicant_role,
          applicant_role_other: record.intake_record.applicant_role_other,
          address: fallbackClient.client_details.address,
          contact_no: fallbackClient.client_details.contact_no,
          classification: fallbackClient.client_classification,
        },
      ]
    : [];
}

export function participantNames(
  record: CriminalCaseRecord,
  fallbackClient?: ClientRecord,
) {
  return caseParticipants(record, fallbackClient)
    .map((participant) => participant.name)
    .filter(Boolean);
}

export function participantClassificationLabels(participant: CaseParticipant) {
  return classificationOptions
    .filter(([key]) =>
      Boolean(
        participant.classification?.[key as keyof ClientClassification],
      ),
    )
    .map(([, label]) => label);
}
