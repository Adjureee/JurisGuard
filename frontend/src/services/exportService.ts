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

const PAO_EXPORT_COLUMN_COUNT = 24;

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
  "FEMALE",
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

function normalizeSex(value: string | null | undefined): "Male" | "Female" | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "m" || normalized === "male") return "Male";
  if (normalized === "f" || normalized === "female") return "Female";
  return null;
}

export function filterCriminalCaseRows(
  rows: CriminalCaseRow[],
  filters: CriminalCaseRowFilterDto
) {
  const normalized = (filters.search ?? "").trim().toLowerCase();
  const status = filters.status ?? "All";
  const locationType = filters.location_type ?? "All";

  return rows.filter(({ record, clientName, client }) => {
    const participantSexValues = new Set(
      [...(record.participants ?? []).map((participant) => participant.sex), client?.client.sex]
        .map(normalizeSex)
        .filter((sex): sex is "Male" | "Female" => sex !== null),
    );
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
      (tableFilter === "male" && participantSexValues.has("Male")) ||
      (tableFilter === "female" && participantSexValues.has("Female")) ||
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
    const matchesGender = gender === "All" || participantSexValues.has(gender);
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

function officeHeading(rows: CriminalCaseRow[], field: "region" | "district_office") {
  const values = new Set(rows.map(({ record }) => record.intake_record[field]?.trim()).filter((value): value is string => Boolean(value)));
  return values.size === 1 ? [...values][0] : "";
}

function boolFlag(value: boolean | null | undefined) {
  return value ? 1 : 0;
}

function reviewedFlagCell(value: boolean | null | undefined) {
  return value === true ? 1 : value === false ? 0 : "";
}

function classificationForExport(
  locationType: string | undefined,
  existing?: Partial<ClientClassification>,
): Partial<ClientClassification> {
  return {
    ...existing,
    flag_female: existing?.flags_reviewed === true ? existing.flag_female ?? null : null,
    flag_senior: existing?.flags_reviewed === true ? existing.flag_senior ?? null : null,
    flag_cicl: existing?.flags_reviewed === true ? existing.flag_cicl ?? null : null,
    flag_urban: locationType === "Urban",
    flag_rural: locationType === "Rural",
  };
}

function partyRole(applicantRole: string, applicantRoleOther: string, fallback: string) {
  return applicantRole === "Others"
    ? applicantRoleOther || fallback
    : applicantRole || fallback;
}

function participantInvolvement(participant: CaseParticipant) {
  return partyRole(
    participant.applicant_role,
    participant.applicant_role_other,
    participant.party_represented,
  );
}

function intakeInvolvement(record: CriminalCaseRecord) {
  return partyRole(
    record.intake_record.applicant_role,
    record.intake_record.applicant_role_other,
    record.intake_record.party_represented,
  );
}

function primaryParticipant(record: CriminalCaseRecord) {
  return record.participants?.find((participant) => participant.client_id === record.client_id)
    ?? record.participants?.[0];
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
    officeHeading(filteredRows, "region"),
    officeHeading(filteredRows, "district_office"),
    "YEAR-END INVENTORY OF CASES",
    `As of ${formatAsOfDate()}`,
  ];

  const lines = filteredRows.map(({ record, client }) => {
    const classification = classificationForExport(
      record.cases.location_type,
      client?.client_classification,
    );
    return csvRow([
      record.intake_record.control_no,
      intakeInvolvement(record),
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
      boolFlag(classification.flag_urban),
      boolFlag(classification.flag_rural),
      boolFlag(classification.flag_drugs),
      reviewedFlagCell(classification.flag_female),
      reviewedFlagCell(classification.flag_senior),
      reviewedFlagCell(classification.flag_cicl),
      record.cases.date_of_confinement,
      record.cases.place_of_detention,
      record.intake_record.form_date,
      client?.client_details.address,
      client?.client_details.contact_no,
      record.representative.relationship_to_applicant ||
        client?.client_details.representative_relationship,
    ]);
  });

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
  filters: CriminalCaseExportFilterDto,
) {
  const parsedFilters = criminalCaseExportFilterSchema.parse(filters);
  const filteredRows = filterCriminalCaseRows(rows, parsedFilters);
  const widths = [150, 150, 100, 240, 140, 120, 200, 140, 220, 200, 130, 70,
    70, 70, 70, 70, 70, 70, 140, 200, 130, 260, 150, 200];
  const classificationTotals = { urban: 0, rural: 0, drugs: 0, female: 0, senior: 0, cicl: 0 };
  const body = filteredRows.map(({ record, client }) => {
    const participant = primaryParticipant(record);
    const classification = classificationForExport(
      record.cases.location_type,
      participant?.classification ?? client?.client_classification,
    );
    const values = [
      record.intake_record.control_no,
      participant ? participantInvolvement(participant) : intakeInvolvement(record),
      participant?.sex || client?.client.sex,
      record.cases.title_of_case,
      record.cases.court_body,
      record.cases.case_no,
      record.cases.cause_of_action,
      record.cases.status_of_case,
      record.cases.last_action_taken,
      record.cases.cause_of_termination,
      record.cases.date_of_termination,
      participant?.age ?? client?.client.age,
      boolFlag(classification.flag_urban),
      boolFlag(classification.flag_rural),
      boolFlag(classification.flag_drugs),
      reviewedFlagCell(classification.flag_female),
      reviewedFlagCell(classification.flag_senior),
      reviewedFlagCell(classification.flag_cicl),
      record.cases.date_of_confinement,
      record.cases.place_of_detention,
      record.intake_record.form_date,
      participant?.address || client?.client_details.address,
      participant?.contact_no || client?.client_details.contact_no,
      participant?.relationship_to_applicant ||
        participant?.representative?.relationship_to_applicant ||
        client?.client_details.representative_relationship ||
        record.representative.relationship_to_applicant,
    ];
    classificationTotals.urban += boolFlag(classification.flag_urban);
    classificationTotals.rural += boolFlag(classification.flag_rural);
    classificationTotals.drugs += boolFlag(classification.flag_drugs);
    classificationTotals.female += classification.flag_female === true ? 1 : 0;
    classificationTotals.senior += classification.flag_senior === true ? 1 : 0;
    classificationTotals.cicl += classification.flag_cicl === true ? 1 : 0;
    return `<tr>${values.map((value) => `<td>${htmlCell(value)}</td>`).join("")}</tr>`;
  }).join("");
  const totalValues = [
    `TOTAL CASES: ${filteredRows.length}`, "", "", "", "", "", "", "", "", "", "", "",
    classificationTotals.urban, classificationTotals.rural, classificationTotals.drugs,
    classificationTotals.female, classificationTotals.senior, classificationTotals.cicl,
    "", "", "", "", "", "",
  ];
  const titles = [
    "REPUBLIKA NG PILIPINAS",
    "KAGAWARAN NG KATARUNGAN",
    "TANGGAPAN NG MANANANGGOL PAMBAYAN",
    "(PUBLIC ATTORNEY'S OFFICE)",
    "Panabo City Public Attorney's Office",
    "YEAR-END INVENTORY OF CASES",
    `As of ${formatAsOfDate()}`,
  ].map((title, index) =>
    `<tr><td colspan="${PAO_INVENTORY_HEADERS.length}" class="title${index === 5 ? " report-title" : ""}">${htmlCell(title)}</td></tr>`,
  ).join("");
  const header = `<tr>${PAO_INVENTORY_HEADERS.map((name) => `<th>${htmlCell(name)}</th>`).join("")}</tr>`;
  const totalRow = `<tr class="total">${totalValues.map((value) => `<td>${htmlCell(value)}</td>`).join("")}</tr>`;

  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    @page{size:landscape}body{font-family:Arial,sans-serif;color:#000}
    table{border-collapse:collapse;table-layout:fixed}
    th,td{border:1px solid #000;padding:6px;font-size:11px;vertical-align:middle;white-space:normal;word-wrap:break-word}
    th{height:48px;text-align:center;font-weight:bold;background:#fff}
    .title{text-align:center;font-weight:bold;border:0;height:22px}
    .report-title{background:#D9E8FC;border:1px solid #8AAFE0}
    .total td{font-weight:bold}td{mso-number-format:"\\@"}
</style></head><body><table><colgroup>${widths.map((width) => `<col width="${width}" style="width:${width}px" />`).join("")}</colgroup><tbody>${titles}<tr class="spacer"><td colspan="${PAO_INVENTORY_HEADERS.length}"></td></tr>${header}${body}${totalRow}</tbody></table></body></html>`;
}

export async function downloadInventoryWorkbook(filename: string, html: string) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  const sheet = workbook.addWorksheet("Inventory", {
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const reportDocument = new DOMParser().parseFromString(html, "text/html");
  const columnWidths = Array.from(reportDocument.querySelectorAll("colgroup col"));
  const columnCount = columnWidths.length;
  const headers = Array.from(reportDocument.querySelectorAll("tr th")).map((cell) => cell.textContent?.trim() ?? "");
  const dateColumns = new Set(["DATE OF TERMINATION", "DATE OF CONFINEMENT", "CASE RECEIVED"]);
  const classificationColumns = new Set(["URBAN", "RURAL", "DRUGS", "FEMALE", "SENIOR", "CICL"]);
  sheet.columns = columnWidths.map((col) => ({ width: Math.max(7, Number(col.getAttribute("width")) / 7) }));
  const rows = Array.from(reportDocument.querySelectorAll("table > tbody > tr"));
  const occupied = new Set<string>();
  rows.forEach((row, rowIndex) => {
    const r = rowIndex + 1;
    // Full-width headings keep the report centered independently of the seal.
    if (rowIndex < 7) {
      sheet.mergeCells(r, 1, r, columnCount);
      const cell = sheet.getCell(r, 1);
      cell.value = row.querySelector(".title")?.textContent ?? "";
      cell.font = { name: "Arial", size: rowIndex === 5 ? 12 : 11, bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      sheet.getRow(r).height = rowIndex === 5 ? 24 : 20;
      return;
    }
    let column = 1;
    for (const element of Array.from(row.children)) {
      while (occupied.has(`${r}:${column}`)) column++;
      const colspan = Number(element.getAttribute("colspan") || 1);
      const rowspan = Number(element.getAttribute("rowspan") || 1);
      const cell = sheet.getCell(r, column);
      const value = element.textContent?.trim() ?? "";
      const header = headers[column - 1];
      if (dateColumns.has(header) && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [, year, month, day] = value.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
        cell.value = new Date(Number(year), Number(month) - 1, Number(day));
        cell.numFmt = "dd-mmm-yyyy";
      } else if ((header === "AGE" || classificationColumns.has(header)) && value !== "" && /^\d+$/.test(value)) {
        cell.value = Number(value);
        cell.numFmt = "0";
      } else {
        cell.value = value;
        cell.numFmt = "@";
      }
      cell.font = { name: "Arial", size: 11, bold: element.tagName === "TH" || row.classList.contains("total") };
      cell.alignment = {
        vertical: "middle",
        horizontal: element.tagName === "TH" || classificationColumns.has(header) || header === "AGE" || dateColumns.has(header) ? "center" : "left",
        wrapText: true,
      };
      if (colspan === 1) cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      if (colspan > 1 || rowspan > 1) sheet.mergeCells(r, column, r + rowspan - 1, column + colspan - 1);
      for (let rr = r; rr < r + rowspan; rr++) for (let cc = column; cc < column + colspan; cc++) occupied.add(`${rr}:${cc}`);
      column += colspan;
    }
    sheet.getRow(r).height = row.classList.contains("spacer") ? 10 : row.querySelector("th") ? 44 : 56;
  });
  sheet.views = [{ state: "frozen", ySplit: 9 }];
  sheet.pageSetup.printTitlesRow = "1:9";
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(columnCount).letter}${rows.length}`;
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/\.xls$/i, ".xlsx");
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

