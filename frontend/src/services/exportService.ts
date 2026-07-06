import { z } from "zod";
import type { CaseStatus, ClientRecord, CriminalCaseRecord } from "../types";

export type CaseTableFilter = "all" | "urban" | "rural" | "male" | "female" | "terminated";

export interface CriminalCaseRow {
  record: CriminalCaseRecord;
  client?: ClientRecord;
  clientName: string;
}

export const criminalCaseExportFilterSchema = z.object({
  status: z.enum(["All", "Active", "Pending", "Ongoing", "Terminated", "Archived"]).default("All"),
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
  "CASE NO",
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
      (tableFilter === "male" && client?.client.sex === "Male") ||
      (tableFilter === "female" && client?.client.sex === "Female") ||
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
    const matchesGender = gender === "All" || client?.client.sex === gender;
    const rowStaff = record.created_by_user_id === null ? "Unassigned" : `User #${record.created_by_user_id}`;
    const matchesStaff = staff === "All" || rowStaff === staff;
    const rowTerminationStatus =
      record.cases.is_terminated || record.cases.status_of_case === "Terminated"
        ? "Terminated"
        : "Active";
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
  const body = filteredRows
    .map(({ record, client }) => {
      const values = [
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
      ];
      return `<tr>${values.map((value) => `<td>${htmlCell(value)}</td>`).join("")}</tr>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8" /><style>body{font-family:Arial,sans-serif;color:#2B3642}table{border-collapse:collapse;width:100%}th{background:#E9EEF3;text-transform:uppercase;letter-spacing:.04em}th,td{border:1px solid #D6DEE7;padding:8px;font-size:12px}.title{text-align:center;font-weight:700}</style></head><body><p class="title">REPUBLIKA NG PILIPINAS</p><p class="title">KAGAWARAN NG KATARUNGAN</p><p class="title">TANGGAPAN NG MANANANGGOL PAMBAYAN</p><p class="title">(PUBLIC ATTORNEY'S OFFICE)</p><p class="title">Regional Office No. XI</p><p class="title">Panabo City District Office</p><p class="title">YEAR-END INVENTORY OF CASES</p><p class="title">As of ${htmlCell(formatAsOfDate())}</p><table><thead><tr>${headers.map((header) => `<th>${htmlCell(header)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></body></html>`;
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

