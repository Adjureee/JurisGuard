import { z } from "zod";
import paoLogo from "../assets/pao-logo.jpg?inline";
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
        participant.party_represented || participantInvolvement(participant) || "Unknown party",
      sex: participant.sex,
      age: participant.age,
      address: participant.address,
      contactNo: participant.contact_no,
      relationshipToApplicant: participant.relationship_to_applicant,
      classification: classificationForExport(
        record.cases.location_type,
        participant.classification,
      ),
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
        client?.client_details.representative_relationship ||
        record.representative.relationship_to_applicant,
      classification: classificationForExport(
        record.cases.location_type,
        client?.client_classification,
      ),
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
    reviewedFlagCell(participant.classification?.flag_female),
    reviewedFlagCell(participant.classification?.flag_senior),
    reviewedFlagCell(participant.classification?.flag_cicl),
    participant.address,
    participant.contactNo,
    participant.relationshipToApplicant ||
      ((record.participants?.length ?? 0) > 1
        ? ""
        : record.representative.relationship_to_applicant),
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
  includeAdditionalFields = true,
) {
  const parsedFilters = criminalCaseExportFilterSchema.parse(filters);
  const filteredRows = filterCriminalCaseRows(rows, parsedFilters);
  // Match the supplied inventory report, including its item-number column.
  const inventoryColumns = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ...(includeAdditionalFields ? [11, 12, 13, 18, 19, 20, 21, 22, 23] : [])];
  const headers = ["Item No.", ...inventoryColumns.map((index) => PAO_INVENTORY_HEADERS[index])];
  const widths = [48, 150, 130, 85, 230, 110, 130, 220, 130, 200, 190, 130,
    ...(includeAdditionalFields ? [65, 65, 65, 140, 200, 140, 250, 150, 180] : [])];
  let itemNumber = 0;
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
  const totals = participantRows.reduce(
    (current, { participant }) => ({
      urban:
        current.urban + boolFlag(participant.classification?.flag_urban),
      rural:
        current.rural + boolFlag(participant.classification?.flag_rural),
      drugs:
        current.drugs + boolFlag(participant.classification?.flag_drugs),
      female:
        current.female + boolFlag(participant.classification?.flag_female),
      senior:
        current.senior + boolFlag(participant.classification?.flag_senior),
      cicl:
        current.cicl + boolFlag(participant.classification?.flag_cicl),
    }),
    { urban: 0, rural: 0, drugs: 0, female: 0, senior: 0, cicl: 0 },
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
            `<td>${htmlCell(participantData[8])}</td>`,
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[9])}</td>` : "",
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[10])}</td>` : "",
            index === 0 ? `<td${rowSpan}>${htmlCell(sharedValues[11])}</td>` : "",
            `<td>${htmlCell(participantData[9])}</td>`,
            `<td>${htmlCell(participantData[10])}</td>`,
            `<td>${htmlCell(participantData[11])}</td>`,
          ];
          return `<tr>${index === 0 ? `<td${rowSpan}>${++itemNumber}</td>` : ""}${inventoryColumns.map((column) => cells[column]).join("")}</tr>`;
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
    "",
    totals.urban,
    totals.rural,
    totals.drugs,
    totals.female,
    totals.senior,
    totals.cicl,
    "",
    "",
    "",
    "",
    "",
    "",
  ];
  const totalRow = `<tr class="total"><td></td>${inventoryColumns.map((column) => `<td>${htmlCell(totalValues[column])}</td>`).join("")}</tr>`;

  const titles = [
    "Republika ng Pilipinas", "Kagawaran ng Katarungan",
    "TANGGAPAN NG MANANANGGOL PAMBAYAN", "(PUBLIC ATTORNEY'S OFFICE)",
    officeHeading(filteredRows, "region"), officeHeading(filteredRows, "district_office"),
    "", "YEAR-END INVENTORY OF CASES", `As of ${formatAsOfDate()}`,
  ].map((title, index) => {
    const logoCell = index === 0
      ? `<td colspan="3" rowspan="6" style="border:0;text-align:center;vertical-align:middle"><img src="${paoLogo}" alt="Public Attorney's Office seal" width="110" height="110" /></td>`
      : "";
    const span = index < 6 ? headers.length - 3 : headers.length;
    return `<tr>${logoCell}<td colspan="${span}" class="title${index === 7 ? " report-title" : ""}">${htmlCell(title)}</td></tr>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    @page{size:landscape}body{font-family:Arial,sans-serif;color:#000}
    table{border-collapse:collapse;table-layout:fixed}
    th,td{border:1px solid #000;padding:6px;font-size:11px;vertical-align:middle;white-space:normal;word-wrap:break-word}
    th{height:48px;text-align:center;font-weight:bold;background:#fff}
    .title{text-align:center;font-weight:bold;border:0;height:22px}
    .report-title{background:#D9E8FC;border:1px solid #8AAFE0}
    .total td{font-weight:bold}td{mso-number-format:"\\@"}
</style></head><body><table><colgroup>${widths.map((width) => `<col width="${width}" style="width:${width}px" />`).join("")}</colgroup><tbody>${titles}<tr><td colspan="${headers.length}" style="border:0;height:28px">${filteredRows[0]?.record.case_type === "Civil" ? "B. CIVIL" : "A. CRIMINAL"}</td></tr><tr>${headers.map((header, index) => `<th width="${widths[index]}" style="width:${widths[index]}px">${htmlCell(header)}</th>`).join("")}</tr>${body}${totalRow}</tbody></table></body></html>`;
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
  sheet.columns = columnWidths.map((col) => ({ width: Math.max(7, Number(col.getAttribute("width")) / 7) }));
  const rows = Array.from(reportDocument.querySelectorAll("table > tbody > tr"));
  const occupied = new Set<string>();
  rows.forEach((row, rowIndex) => {
    const r = rowIndex + 1;
    // Full-width headings keep the report centered independently of the seal.
    if (rowIndex < 9) {
      sheet.mergeCells(r, 1, r, columnCount);
      const cell = sheet.getCell(r, 1);
      cell.value = row.querySelector(".title")?.textContent ?? "";
      cell.font = { name: "Arial", size: 11, bold: rowIndex === 3 || rowIndex === 7 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      sheet.getRow(r).height = 20;
      return;
    }
    let column = 1;
    for (const element of Array.from(row.children)) {
      while (occupied.has(`${r}:${column}`)) column++;
      const colspan = Number(element.getAttribute("colspan") || 1);
      const rowspan = Number(element.getAttribute("rowspan") || 1);
      const cell = sheet.getCell(r, column);
      cell.value = element.textContent ?? "";
      cell.numFmt = "@";
      cell.font = { name: "Arial", size: 11, bold: element.tagName === "TH" || row.classList.contains("total") };
      cell.alignment = { vertical: "middle", horizontal: element.tagName === "TH" ? "center" : "left", wrapText: true };
      if (colspan === 1) cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      if (colspan > 1 || rowspan > 1) sheet.mergeCells(r, column, r + rowspan - 1, column + colspan - 1);
      for (let rr = r; rr < r + rowspan; rr++) for (let cc = column; cc < column + colspan; cc++) occupied.add(`${rr}:${cc}`);
      column += colspan;
    }
    sheet.getRow(r).height = row.querySelector("th") ? 44 : 56;
  });
  const logo = workbook.addImage({ base64: paoLogo, extension: "jpeg" });
  sheet.addImage(logo, { tl: { col: 3, row: 1 }, ext: { width: 104, height: 104 } });
  sheet.views = [{ state: "frozen", ySplit: 11 }];
  sheet.pageSetup.printTitlesRow = "1:11";
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

