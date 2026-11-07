import { apiClient } from "../api/client";

export type TransferStatus = "Draft" | "Pending Receipt" | "Returned for Correction" | "Completed";
export type TransferSection = "Criminal" | "Civil" | "ADMIN 1" | "ADMIN 2" | "ADMIN 3";

export interface TransferAttorney { user_id: number; full_name: string; }
export interface TransferCase {
  case_id: number;
  case_type: "Criminal" | "Civil";
  control_no: string;
  title_of_case: string;
  case_no: string;
  date_received: string;
  status_of_case: string;
  cause_of_action: string;
  assigned_pao: string;
}
export interface TransferAdminEntry {
  entry_id?: number;
  section: "ADMIN 1" | "ADMIN 2" | "ADMIN 3";
  row_number: number;
  control_no: string;
  title_of_case: string;
  docket_no: string;
  date_received: string;
  status_of_case: string;
  cause_of_action: string;
}
export interface TransferItem { item_id: number; case_id: number; section: "Criminal" | "Civil"; snapshot: TransferCase; }
export interface CaseTransfer {
  report_id: number;
  title: string;
  report_date: string;
  date_received: string | null;
  status: TransferStatus;
  remarks: string;
  version: number;
  from_user_id: number;
  from_user_name: string;
  to_user_id: number;
  to_user_name: string;
  initiated_by_user_id: number | null;
  initiated_by_user_name: string | null;
  submitted_at: string | null;
  returned_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  items: TransferItem[];
  administrative_entries: TransferAdminEntry[];
}
export interface TransferPayload {
  title: string;
  report_date: string;
  from_user_id?: number;
  to_user_id: number;
  case_ids: number[];
  administrative_entries: TransferAdminEntry[];
  remarks?: string;
}

export async function listTransferAttorneys() {
  return (await apiClient.get<TransferAttorney[]>("/case-transfers/attorneys")).data;
}
export async function listTransferCases(caseType: "Criminal" | "Civil", search = "", sourceUserId?: number) {
  return (await apiClient.get<TransferCase[]>("/case-transfers/cases", { params: { case_type: caseType, search: search || undefined, source_user_id: sourceUserId } })).data;
}
export async function listCaseTransfers() {
  return (await apiClient.get<CaseTransfer[]>("/case-transfers")).data;
}
export async function getCaseTransfer(id: number) {
  return (await apiClient.get<CaseTransfer>(`/case-transfers/${id}`)).data;
}
export async function createCaseTransfer(payload: TransferPayload) {
  return (await apiClient.post<CaseTransfer>("/case-transfers", payload)).data;
}
export async function updateCaseTransfer(id: number, payload: TransferPayload) {
  return (await apiClient.patch<CaseTransfer>(`/case-transfers/${id}`, payload)).data;
}
export async function submitCaseTransfer(id: number) {
  return (await apiClient.post<CaseTransfer>(`/case-transfers/${id}/submit`)).data;
}
export async function returnCaseTransfer(id: number, remarks: string) {
  return (await apiClient.post<CaseTransfer>(`/case-transfers/${id}/return`, { remarks })).data;
}
export async function confirmCaseTransfer(id: number) {
  return (await apiClient.post<CaseTransfer>(`/case-transfers/${id}/confirm`)).data;
}

function formatTransferDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

async function loadImage(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to load transfer report logo.");
  return response.arrayBuffer();
}

export async function buildCaseTransferExcel(report: CaseTransfer, logo1Url: string, logo2Url: string) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "JurisGuard";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Transfer of Cases", { views: [{ showGridLines: false }] });
  const headings = ["NO.", "CONTROL NO.", "TITLE OF THE CASE", "DOCKET NO.", "DATE RECEIVED", "STATUS OF THE CASE", "CAUSE OF ACTION"];
  sheet.columns = [
    { key: "no", width: 5 }, { key: "control", width: 14 }, { key: "title", width: 25 },
    { key: "docket", width: 12 }, { key: "date", width: 13 }, { key: "status", width: 15 }, { key: "cause", width: 26 },
  ];
  sheet.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, scale: 90, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }, horizontalDpi: 300, verticalDpi: 300 };
  const border = { style: "thin" as const, color: { argb: "FF000000" } };
  const allBorders = { top: border, left: border, bottom: border, right: border };
  const center = { horizontal: "center" as const, vertical: "middle" as const, wrapText: true };
  const left = { horizontal: "left" as const, vertical: "top" as const, wrapText: true };
  const blackFont = { name: "Arial", size: 9, color: { argb: "FF000000" } };

  ["A4:G4", "A5:G5", "A6:G6", "A8:G8", "A9:G9", "A12:G12", "A13:G13"].forEach((range) => sheet.mergeCells(range));
  const headingRows: Array<[number, string, number, boolean]> = [
    [4, "Republic of the Philippines", 11, false],
    [5, "Department of Justice", 11, false],
    [6, "PUBLIC ATTORNEY'S OFFICE", 12, true],
    [8, "Regional Office No. XI", 10, false],
    [9, "District Office: Panabo City", 10, false],
    [12, "TRANSFER OF CASES", 14, true],
    [13, `As of ${formatTransferDate(report.report_date)}`, 10, false],
  ];
  headingRows.forEach(([number, value, size, bold]) => {
    const cell = sheet.getCell(`A${number}`);
    cell.value = value;
    cell.font = { ...blackFont, size, bold };
    cell.alignment = center;
  });
  for (const number of [4, 5, 6, 7, 8, 9, 13]) sheet.getRow(number).height = 16.05;
  sheet.getRow(10).height = 6;
  sheet.getRow(11).height = 6;
  sheet.getRow(12).height = 22.05;
  sheet.getRow(18).height = 7.95;

  const details = [
    ["A15", `FROM: ${report.from_user_name}`],
    ["A16", `Date Transferred: ${formatTransferDate(report.submitted_at || report.report_date)}`],
    ["A17", "Signature: ______________________________"],
    ["E15", `TO: ${report.to_user_name}`],
    ["E16", `Date Received: ${formatTransferDate(report.date_received)}`],
    ["E17", "Signature: ______________________________"],
  ] as const;
  ["A15:C15", "A16:C16", "A17:C17", "E15:G15", "E16:G16", "E17:G17"].forEach((range) => sheet.mergeCells(range));
  details.forEach(([address, value]) => { const cell = sheet.getCell(address); cell.value = value; cell.font = blackFont; cell.alignment = left; });

  const sections: Array<{ title: string; rows: Array<TransferCase | TransferAdminEntry> }> = [
    { title: "A. CRIMINAL CASES", rows: report.items.filter((item) => item.section === "Criminal").map((item) => item.snapshot) },
    { title: "B. CIVIL CASES", rows: report.items.filter((item) => item.section === "Civil").map((item) => item.snapshot) },
    ...(["ADMIN 1", "ADMIN 2", "ADMIN 3"] as const).map((section) => ({ title: section, rows: report.administrative_entries.filter((entry) => entry.section === section) })),
  ];
  let rowNumber = 20;
  sections.forEach((section, sectionIndex) => {
    sheet.mergeCells(rowNumber, 1, rowNumber, 7);
    const sectionCell = sheet.getCell(rowNumber, 1); sectionCell.value = section.title; sectionCell.font = { ...blackFont, bold: true, size: 10 }; sectionCell.alignment = left; sectionCell.border = allBorders; sheet.getRow(rowNumber).height = 18; rowNumber += 1;
    const headerRow = sheet.getRow(rowNumber); headings.forEach((heading, index) => { const cell = headerRow.getCell(index + 1); cell.value = heading; cell.font = { ...blackFont, bold: true, size: 8 }; cell.alignment = center; cell.border = allBorders; }); headerRow.height = 28.05; rowNumber += 1;
    if (!section.rows.length) {
      const emptyRow = sheet.getRow(rowNumber); emptyRow.getCell(3).value = "No entries"; for (let index = 1; index <= 7; index += 1) { const cell = emptyRow.getCell(index); cell.font = blackFont; cell.alignment = center; cell.border = allBorders; } emptyRow.height = 19.95; rowNumber += 1;
    } else {
      section.rows.forEach((row, index) => {
        const values = row as unknown as Record<string, unknown>;
        const number = "row_number" in row ? row.row_number : index + 1;
        const data = [number, values.control_no ?? "", values.title_of_case ?? "", values.case_no ?? values.docket_no ?? "", formatTransferDate(String(values.date_received || "")), values.status_of_case ?? "", values.cause_of_action ?? ""];
        const dataRow = sheet.getRow(rowNumber); data.forEach((value, columnIndex) => { const cell = dataRow.getCell(columnIndex + 1); cell.value = value as string | number; cell.font = blackFont; cell.alignment = columnIndex === 0 ? center : left; cell.border = allBorders; }); dataRow.height = Math.max(18, Math.min(72, 18 * Math.max(1, String(data[2]).length / 42, String(data[6]).length / 44))); rowNumber += 1;
      });
    }
    if (sectionIndex < sections.length - 1) rowNumber += 1;
  });
  sheet.pageSetup.printArea = `A1:G${rowNumber - 1}`;
  sheet.pageSetup.printTitlesRow = "20:21";
  sheet.headerFooter.oddFooter = "&CPage &P of &N";
  const [logo1Buffer, logo2Buffer] = await Promise.all([loadImage(logo1Url), loadImage(logo2Url)]);
  const logo1Id = workbook.addImage({ buffer: logo1Buffer, extension: "png" });
  const logo2Id = workbook.addImage({ buffer: logo2Buffer, extension: "png" });
  // Native anchors and extents preserve the reference's image placement and dimensions in EMUs.
  const paoAnchor = { col: 1, row: 2, nativeCol: 1, nativeRow: 2, nativeColOff: 224980, nativeRowOff: 168779 };
  const bagongPilipinasAnchor = { col: 5, row: 3, nativeCol: 5, nativeRow: 3, nativeColOff: 483313, nativeRowOff: 15240 };
  sheet.addImage(logo1Id, { tl: paoAnchor, ext: { width: 250.5527, height: 152.6805 } });
  sheet.addImage(logo2Id, { tl: bagongPilipinasAnchor, ext: { width: 144.161, height: 134.4 } });
  return workbook.xlsx.writeBuffer();
}
