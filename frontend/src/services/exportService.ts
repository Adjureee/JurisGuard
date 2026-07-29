import { z } from "zod";
import type {
  CaseParticipant,
  ClientClassification,
  ClientRecord,
  CriminalCaseRecord,
} from "../types";

export type CaseTableFilter = "all" | "urban" | "rural" | "male" | "female" | "terminated";

export interface CriminalCaseRow {
  record: CriminalCaseRecord;
  client?: ClientRecord;
  clientName: string;
}

export const criminalCaseExportFilterSchema = z.object({
  status: z.enum(["All", "Pending", "Terminated"]).default("All"),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  location_type: z.enum(["All", "Urban", "Rural"]).default("All"),
  barangay: z.string().optional(),
  case_category: z.string().optional(),
  gender: z.enum(["All", "Male", "Female"]).default("All"),
  staff: z.string().optional(),
  ocr_status: z.string().optional(),
  termination_status: z.string().optional(),
});

export type CriminalCaseExportFilterDto = z.infer<typeof criminalCaseExportFilterSchema>;

export interface CriminalCaseRowFilterDto extends Partial<CriminalCaseExportFilterDto> {
  search?: string;
  table_filter?: CaseTableFilter;
}

const PAO_EXPORT_COLUMN_COUNT = 23;

const PAO_INVENTORY_HEADERS = [
  "CONTROL NUMBER",
  "PARTY REPRESENTED",
  "GENDER / SEX",
  "TITLE OF THE CASE",
  "COURT / BODY",
  "CASE NO.",
  "CAUSE OF ACTION",
  "STATUS OF THE CASE",
  "LAST ACTION TAKEN",
  "CAUSE OF TERMINATION",
  "DATE OF TERMINATION",
  "AGE",
  "URBAN",
  "RURAL",
  "DRUGS",
  "SENIOR",
  "CICL",
  "DATE OF CONFINEMENT",
  "PLACE OF DETENTION",
  "CASE RECEIVED",
  "ADDRESS",
  "CONTACT NUMBER",
  "RELATIONSHIP TO APPLICANT",
] as const;

function recordDate(record: CriminalCaseRecord) {
  return record.intake_record.form_date || record.last_updated;
}

export function filterCriminalCaseRows(
  rows: CriminalCaseRow[],
  filters: CriminalCaseRowFilterDto
) {
  const normalized = (filters.search ?? "").trim().toLowerCase();
  const status = filters.status ?? "All";
  const locationType = filters.location_type ?? "All";

  return rows.filter(({ record, clientName, client }) => {
    const participantSexValues = record.participants?.length
      ? record.participants.map((participant) => participant.sex)
      : client
        ? [client.client.sex]
        : [];
    const matchesSearch =
      !normalized ||
      [
        clientName,
        record.intake_record.control_no,
        record.cases.title_of_case,
        record.cases.case_no,
        record.cases.status_of_case,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);

    const tableFilter = filters.table_filter ?? "all";
    const matchesTableFilter =
      tableFilter === "all" ||
      (tableFilter === "urban" && record.cases.location_type === "Urban") ||
      (tableFilter === "rural" && record.cases.location_type === "Rural") ||
      (tableFilter === "male" && participantSexValues.includes("Male")) ||
      (tableFilter === "female" && participantSexValues.includes("Female")) ||
      (tableFilter === "terminated" && record.cases.status_of_case === "Terminated");

    const matchesStatus = status === "All" || record.cases.status_of_case === status;
    const matchesLocation =
      locationType === "All" || record.cases.location_type === locationType;
    const barangay = filters.barangay ?? "All";
    const category = filters.case_category ?? "All";
    const gender = filters.gender ?? "All";
    const staff = filters.staff ?? "All";
    const terminationStatus = filters.termination_status ?? "All";
    const matchesBarangay = barangay === "All" || (record.cases.incident_barangay ?? "") === barangay;
    const rowCategory = record.cases.cause_of_action || record.intake_record.nature_of_case;
    const matchesCategory = category === "All" || rowCategory === category;
    const matchesGender = gender === "All" || participantSexValues.includes(gender);
    const rowStaff = record.created_by_user_id === null ? "Unassigned" : `User #${record.created_by_user_id}`;
    const matchesStaff = staff === "All" || rowStaff === staff;
    const rowTerminationStatus =
      record.cases.is_terminated || record.cases.status_of_case === "Terminated"
        ? "Terminated"
        : "Pending";
    const matchesTerminationStatus =
      terminationStatus === "All" || rowTerminationStatus === terminationStatus;
    const date = recordDate(record);
    const matchesDateFrom = !filters.date_from || date >= filters.date_from;
    const matchesDateTo = !filters.date_to || date <= filters.date_to;

    return (
      matchesSearch &&
      matchesTableFilter &&
      matchesStatus &&
      matchesLocation &&
      matchesBarangay &&
      matchesCategory &&
      matchesGender &&
      matchesStaff &&
      matchesTerminationStatus &&
      matchesDateFrom &&
      matchesDateTo
    );
  });
}

function csvCell(value: string | number | undefined | null) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(values: Array<string | number | undefined | null>) {
  return values.map(csvCell).join(",");
}

function centeredTitleRow(title: string) {
  const columns = Array<string>(PAO_EXPORT_COLUMN_COUNT).fill("");
  columns[Math.floor(PAO_EXPORT_COLUMN_COUNT / 2)] = title;
  return csvRow(columns);
}

function emptyCsvRow() {
  return csvRow(Array<string>(PAO_EXPORT_COLUMN_COUNT).fill(""));
}

function formatAsOfDate(date = new Date()) {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function boolFlag(value: boolean | undefined) {
  return value ? 1 : 0;
}

interface ExportParticipantRow {
  partyRepresented: string;
  sex: string | undefined;
  age: number | undefined;
  address: string | undefined;
  contactNo: string | undefined;
  relationshipToApplicant: string | undefined;
  classification: Partial<ClientClassification> | undefined;
}

function participantInvolvement(participant: CaseParticipant) {
  return participant.applicant_role === "Others"
    ? participant.applicant_role_other
    : participant.applicant_role;
}

function exportParticipantRows(
  record: CriminalCaseRecord,
  client?: ClientRecord,
): ExportParticipantRow[] {
  if ((record.participants?.length ?? 0) > 1) {
    return (record.participants ?? []).map((participant) => ({
      partyRepresented:
        participant.name || participant.party_represented || "Unknown client",
      sex: participant.sex,
      age: participant.age,
      address: participant.address,
      contactNo: participant.contact_no,
      relationshipToApplicant: participantInvolvement(participant),
      classification: participant.classification,
    }));
  }

  return [
    {
      partyRepresented: record.intake_record.party_represented,
      sex: client?.client.sex,
      age: client?.client.age,
      address: client?.client_details.address,
      contactNo: client?.client_details.contact_no,
      relationshipToApplicant:
        record.representative.relationship_to_applicant ||
        client?.client_details.representative_relationship,
      classification: client?.client_classification,
    },
  ];
}

function participantValues(
  record: CriminalCaseRecord,
  participant: ExportParticipantRow,
) {
  return [
    participant.partyRepresented,
    participant.sex,
    participant.age,
    boolFlag(participant.classification?.flag_urban),
    boolFlag(participant.classification?.flag_rural),
    boolFlag(participant.classification?.flag_drugs),
    boolFlag(participant.classification?.flag_senior),
    boolFlag(participant.classification?.flag_cicl),
    participant.address,
    participant.contactNo,
    participant.relationshipToApplicant ||
      record.representative.relationship_to_applicant,
  ];
}

export function buildCriminalCasesCsv(
  rows: CriminalCaseRow[],
  filters: CriminalCaseExportFilterDto
) {
  const parsedFilters = criminalCaseExportFilterSchema.parse(filters);
  const filteredRows = filterCriminalCaseRows(rows, parsedFilters);
  const titleRows = [
    "REPUBLIKA NG PILIPINAS",
    "KAGAWARAN NG KATARUNGAN",
    "TANGGAPAN NG MANANANGGOL PAMBAYAN",
    "(PUBLIC ATTORNEY'S OFFICE)",
    "Regional Office No. XI",
    "Panabo City District Office",
    "YEAR-END INVENTORY OF CASES",
    `As of ${formatAsOfDate()}`,
  ];

  const lines = filteredRows.map(({ record, client }) =>
    csvRow([
      record.intake_record.control_no,
      record.intake_record.party_represented,
      client?.client.sex,
      record.cases.title_of_case,
      record.cases.court_body,
      record.cases.case_no,
      record.cases.cause_of_action,
      record.cases.status_of_case,
      record.cases.last_action_taken,
      record.cases.cause_of_termination,
      record.cases.date_of_termination,
      client?.client.age,
      boolFlag(client?.client_classification.flag_urban),
      boolFlag(client?.client_classification.flag_rural),
      boolFlag(client?.client_classification.flag_drugs),
      boolFlag(client?.client_classification.flag_senior),
      boolFlag(client?.client_classification.flag_cicl),
      record.cases.date_of_confinement,
      record.cases.place_of_detention,
      record.intake_record.form_date,
      client?.client_details.address,
      client?.client_details.contact_no,
      record.representative.relationship_to_applicant ||
        client?.client_details.representative_relationship,
    ])
  );

  return [
    ...titleRows.map(centeredTitleRow),
    emptyCsvRow(),
    csvRow([...PAO_INVENTORY_HEADERS]),
    ...lines,
  ].join("\n");
}

function htmlCell(value: string | number | undefined | null) {
  return String(value ?? "").replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char] ?? char));
}

export function buildCriminalCasesExcelHtml(
  rows: CriminalCaseRow[],
  filters: CriminalCaseExportFilterDto
) {
  const parsedFilters = criminalCaseExportFilterSchema.parse(filters);
  const filteredRows = filterCriminalCaseRows(rows, parsedFilters);
  const headers = [...PAO_INVENTORY_HEADERS];
  const participantRows = filteredRows.flatMap(({ record, client }) =>
    exportParticipantRows(record, client).map((participant) => ({
      record,
      participant,
    })),
  );
  const totalCases = new Set(
    filteredRows.map(
      ({ record }) => record.intake_record.control_no || record.case_id,
    ),
  ).size;
  const totalParticipants = participantRows.length;
  const totals = participantRows.reduce(
    (current, { participant }) => ({
      urban:
        current.urban + boolFlag(participant.classification?.flag_urban),
      rural:
        current.rural + boolFlag(participant.classification?.flag_rural),
      drugs:
        current.drugs + boolFlag(participant.classification?.flag_drugs),
      senior:
        current.senior + boolFlag(participant.classification?.flag_senior),
      cicl:
        current.cicl + boolFlag(participant.classification?.flag_cicl),
    }),
    { urban: 0, rural: 0, drugs: 0, senior: 0, cicl: 0 },
  );
  const body = filteredRows
    .map(({ record, client }) => {
      const participants = exportParticipantRows(record, client);
      const rowSpan = participants.length > 1 ? ` rowspan="${participants.length}"` : "";
      const sharedValues = [
        record.intake_record.control_no,
        record.cases.title_of_case,
        record.cases.court_body,
        record.cases.case_no,
        record.cases.cause_of_action,
        record.cases.status_of_case,
        record.cases.last_action_taken,
        record.cases.cause_of_termination,
        record.cases.date_of_termination,
        record.cases.date_of_confinement,
        record.cases.place_of_detention,
        record.intake_record.form_date,
      ];
      return participants
        .map((participant, index) => {
          const participantData = participantValues(record, participant);
          const cells = [
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[0])}</td>` : "",
            `<td>${htmlCell(participantData[0])}</td>`,
            `<td>${htmlCell(participantData[1])}</td>`,
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[1])}</td>` : "",
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[2])}</td>` : "",
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[3])}</td>` : "",
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[4])}</td>` : "",
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[5])}</td>` : "",
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[6])}</td>` : "",
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[7])}</td>` : "",
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[8])}</td>` : "",
            `<td>${htmlCell(participantData[2])}</td>`,
            `<td>${htmlCell(participantData[3])}</td>`,
            `<td>${htmlCell(participantData[4])}</td>`,
            `<td>${htmlCell(participantData[5])}</td>`,
            `<td>${htmlCell(participantData[6])}</td>`,
            `<td>${htmlCell(participantData[7])}</td>`,
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[9])}</td>` : "",
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[10])}</td>` : "",
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[11])}</td>` : "",
            `<td>${htmlCell(participantData[8])}</td>`,
            `<td>${htmlCell(participantData[9])}</td>`,
            `<td>${htmlCell(participantData[10])}</td>`,
          ];
          return `<tr>${cells.join("")}</tr>`;
        })
        .join("");
    })
    .join("");
  const totalValues = [
    `TOTAL CASES: ${totalCases}`,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    totalParticipants,
    totals.urban,
    totals.rural,
    totals.drugs,
    totals.senior,
    totals.cicl,
    "",
    "",
    "",
    "",
    "",
    "",
  ];
  const totalRow = `<tr class="total">${totalValues.map((value) => `<td>${htmlCell(value)}</td>`).join("")}</tr>`;

  return `<!doctype html><html><head><meta charset="utf-8" /><style>body{font-family:Arial,sans-serif;color:#2B3642}table{border-collapse:collapse;width:100%}th{background:#E9EEF3;text-transform:uppercase;letter-spacing:.04em}th,td{border:1px solid #D6DEE7;padding:8px;font-size:12px;vertical-align:middle}.title{text-align:center;font-weight:700}.total td{background:#F3F4F6;font-weight:700}</style></head><body><p class="title">REPUBLIKA NG PILIPINAS</p><p class="title">KAGAWARAN NG KATARUNGAN</p><p class="title">TANGGAPAN NG MANANANGGOL PAMBAYAN</p><p class="title">(PUBLIC ATTORNEY'S OFFICE)</p><p class="title">Regional Office No. XI</p><p class="title">Panabo City District Office</p><p class="title">YEAR-END INVENTORY OF CASES</p><p class="title">As of ${htmlCell(formatAsOfDate())}</p><table><thead><tr>${headers.map((header) => `<th>${htmlCell(header)}</th>`).join("")}</tr></thead><tbody>${body}${totalRow}</tbody></table></body></html>`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

