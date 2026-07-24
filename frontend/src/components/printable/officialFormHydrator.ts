import type { ClientRecord, CriminalCaseRecord } from "../../types";

export type PrintableFormLanguage = "english" | "filipino";

export interface PrintableFormData {
  client: ClientRecord;
  selectedCase: CriminalCaseRecord;
  cases: CriminalCaseRecord[];
}

const get = (value: unknown) => (value === null || value === undefined ? "" : String(value));

function setInput(inputs: HTMLInputElement[], index: number, value: unknown) {
  const input = inputs[index];
  if (!input) return;
  input.setAttribute("value", get(value));
  input.value = get(value);
}

function setTextarea(textareas: HTMLTextAreaElement[], index: number, value: unknown) {
  const textarea = textareas[index];
  if (!textarea) return;
  textarea.textContent = get(value);
  textarea.value = get(value);
}

function checkNearText(doc: Document, text: string, checked: boolean) {
  if (!checked) return;
  const normalized = text.toLowerCase();
  const candidates = Array.from(doc.querySelectorAll("label, .checkbox-item, span"));
  const target = candidates.find((candidate) =>
    (candidate.textContent ?? "").toLowerCase().includes(normalized) &&
    candidate.querySelector("input[type='checkbox']")
  );
  const input = target?.querySelector("input[type='checkbox']") as HTMLInputElement | null;
  if (input) input.setAttribute("checked", "checked");
}

function injectPrintSafety(doc: Document) {
  const style = doc.createElement("style");
  style.textContent = `
    @media print {
      .jurisguard-print-toolbar, .no-print { display: none !important; }
      html, body { background: #fff !important; }
    }
    input, textarea { color: #000 !important; }
  `;
  doc.head.appendChild(style);
}

function normalizeTemplateAssets(doc: Document) {
  const header = doc.querySelector("img[src='/paoheader.png']") as HTMLImageElement | null;
  if (header) {
    header.src = `${window.location.origin}/paoheader.png`;
  }
}

function removeUntilNextGreenBar(start: Element) {
  let current = start.nextElementSibling;
  start.remove();
  while (current && !current.classList.contains("green-bar") && !current.classList.contains("form-footer-code")) {
    const next = current.nextElementSibling;
    current.remove();
    current = next;
  }
}

function removeGreenBarWithContent(doc: Document, matcher: (text: string) => boolean) {
  Array.from(doc.querySelectorAll(".green-bar")).forEach((bar) => {
    const text = (bar.textContent ?? "").toLowerCase();
    if (!matcher(text)) return;
    removeUntilNextGreenBar(bar);
  });
}

function removeObsoleteOfficialSections(doc: Document) {
  removeGreenBarWithContent(doc, (text) =>
    text.includes("conflict-of-interest") || text.includes("conflict of interest"),
  );
  removeGreenBarWithContent(doc, (text) =>
    text.includes("viii-a") && text.includes("adverse"),
  );
  removeGreenBarWithContent(doc, (text) =>
    text.includes("viii-a") && text.includes("katunggali"),
  );
}

function hydrateEnglish(doc: Document, data: PrintableFormData) {
  const inputs = Array.from(doc.querySelectorAll("input[type='text'], input[type='email'], input[type='number'], input[type='date']")) as HTMLInputElement[];
  const textareas = Array.from(doc.querySelectorAll("textarea")) as HTMLTextAreaElement[];
  const { client, selectedCase: record } = data;
  const details = client.client_details;
  const classification = client.client_classification;
  const caseDetails = record.cases;

  setInput(inputs, 3, record.intake_record.region);
  setInput(inputs, 4, record.intake_record.district_office);
  setInput(inputs, 5, record.intake_record.form_date);
  setInput(inputs, 6, record.intake_record.control_no);
  setInput(inputs, 9, caseDetails.assigned_pao);
  setInput(inputs, 13, record.intake_record.nature_of_request);
  setInput(inputs, 14, client.client.name);
  setInput(inputs, 15, client.client.religion);
  setInput(inputs, 16, client.client.citizenship);
  setInput(inputs, 17, details.address);
  setInput(inputs, 18, details.email);
  setInput(inputs, 19, details.individual_monthly_income);
  setInput(inputs, 20, details.detained_since);
  setInput(inputs, 21, client.client.age);
  setInput(inputs, 22, client.client.sex);
  setInput(inputs, 23, client.client.civil_status);
  setInput(inputs, 24, client.client.educational_attainment);
  setInput(inputs, 25, client.client.language_dialect);
  setInput(inputs, 26, details.contact_no);
  setInput(inputs, 27, details.spouse);
  setInput(inputs, 28, details.address_of_spouse);
  setInput(inputs, 29, details.contact_no_of_spouse);
  setInput(inputs, 30, details.place_of_detention);
  setInput(inputs, 31, details.representative_name);
  setInput(inputs, 32, details.representative_address);
  setInput(inputs, 33, details.representative_relationship);
  setInput(inputs, 34, details.representative_age);
  setInput(inputs, 35, details.representative_sex);
  setInput(inputs, 36, details.representative_civil_status);
  setInput(inputs, 37, details.representative_contact_no);
  setInput(inputs, 38, details.representative_email);
  setInput(inputs, 39, classification.flag_foreign_national ? "Yes" : "");
  setInput(inputs, 40, classification.flag_urban ? "Yes" : "");
  setInput(inputs, 41, classification.flag_rural ? "Yes" : "");
  setInput(inputs, 42, classification.flag_indigenous_people ? "Yes" : "");
  setInput(inputs, 43, classification.flag_pwd ? "PWD" : "");
  setInput(inputs, 44, client.client.citizenship || "Philippines");
  setInput(inputs, 45, client.client.name);
  setInput(inputs, 46, details.spouse);
  setInput(inputs, 47, details.address);
  setInput(inputs, 48, details.individual_monthly_income);
  setInput(inputs, 61, record.intake_record.applicant_role_other);

  setTextarea(textareas, 0, caseDetails.facts_of_case);
  setTextarea(textareas, 1, caseDetails.cause_of_action);
  setTextarea(textareas, 2, `${caseDetails.title_of_case} ${caseDetails.case_no}`.trim());
  setTextarea(textareas, 3, caseDetails.court_body);

  checkNearText(doc, "Yes", Boolean(details.detained));
  checkNearText(doc, "No", !details.detained);
  checkNearText(doc, "Criminal", record.intake_record.nature_of_case.toLowerCase().includes("criminal"));
  checkNearText(doc, "Civil", record.intake_record.nature_of_case.toLowerCase().includes("civil"));
  checkNearText(doc, "Labor", record.intake_record.nature_of_case.toLowerCase().includes("labor"));
  checkNearText(doc, "Administrative", record.intake_record.nature_of_case.toLowerCase().includes("admin"));
  checkNearText(doc, "Senior Citizen", classification.flag_senior);
  checkNearText(doc, "Child in Conflict", classification.flag_cicl);
  checkNearText(doc, "Woman", classification.flag_female);
  checkNearText(doc, "VAWC", classification.flag_vawc_victim);
  checkNearText(doc, "Urban Poor", classification.flag_urban);
  checkNearText(doc, "Rural Poor", classification.flag_rural);
  checkNearText(doc, "Plaintiff", record.intake_record.applicant_role === "Plaintiff");
  checkNearText(doc, "Defendant", record.intake_record.applicant_role === "Defendant");
  checkNearText(doc, "Respondent", record.intake_record.applicant_role === "Respondent");
  checkNearText(doc, "Complainant", record.intake_record.applicant_role === "Complainant");
  checkNearText(doc, "Accused", record.intake_record.applicant_role === "Accused");
}

function hydrateFilipino(doc: Document, data: PrintableFormData) {
  const inputs = Array.from(doc.querySelectorAll("input[type='text'], input[type='email'], input[type='number'], input[type='date']")) as HTMLInputElement[];
  const textareas = Array.from(doc.querySelectorAll("textarea")) as HTMLTextAreaElement[];
  const { client, selectedCase: record } = data;
  const details = client.client_details;
  const classification = client.client_classification;
  const caseDetails = record.cases;

  setInput(inputs, 3, record.intake_record.region);
  setInput(inputs, 4, record.intake_record.district_office);
  setInput(inputs, 5, record.intake_record.form_date);
  setInput(inputs, 6, record.intake_record.control_no);
  setInput(inputs, 9, caseDetails.assigned_pao);
  setInput(inputs, 13, record.intake_record.nature_of_request);
  setInput(inputs, 14, client.client.name);
  setInput(inputs, 15, client.client.religion);
  setInput(inputs, 16, client.client.citizenship);
  setInput(inputs, 17, details.address);
  setInput(inputs, 18, details.email);
  setInput(inputs, 19, details.individual_monthly_income);
  setInput(inputs, 20, details.detained_since);
  setInput(inputs, 21, client.client.age);
  setInput(inputs, 22, client.client.sex);
  setInput(inputs, 23, client.client.civil_status);
  setInput(inputs, 24, client.client.educational_attainment);
  setInput(inputs, 25, client.client.language_dialect);
  setInput(inputs, 26, details.contact_no);
  setInput(inputs, 27, details.spouse);
  setInput(inputs, 28, details.address_of_spouse);
  setInput(inputs, 29, details.contact_no_of_spouse);
  setInput(inputs, 30, details.place_of_detention);
  setInput(inputs, 31, details.representative_name);
  setInput(inputs, 32, details.representative_address);
  setInput(inputs, 33, details.representative_relationship);
  setInput(inputs, 34, details.representative_age);
  setInput(inputs, 35, details.representative_sex);
  setInput(inputs, 36, details.representative_civil_status);
  setInput(inputs, 37, details.representative_contact_no);
  setInput(inputs, 38, details.representative_email);
  setInput(inputs, 39, classification.flag_foreign_national ? "Yes" : "");
  setInput(inputs, 40, classification.flag_urban ? "Yes" : "");
  setInput(inputs, 41, classification.flag_rural ? "Yes" : "");
  setInput(inputs, 42, classification.flag_indigenous_people ? "Yes" : "");
  setInput(inputs, 43, classification.flag_pwd ? "PWD" : "");
  setInput(inputs, 44, client.client.citizenship || "Philippines");
  setInput(inputs, 45, client.client.name);
  setInput(inputs, 46, details.spouse);
  setInput(inputs, 47, details.address);
  setInput(inputs, 48, details.individual_monthly_income);
  setInput(inputs, 61, record.intake_record.applicant_role_other);

  setTextarea(textareas, 0, caseDetails.facts_of_case);
  setTextarea(textareas, 1, caseDetails.cause_of_action);
  setTextarea(textareas, 2, `${caseDetails.title_of_case} ${caseDetails.case_no}`.trim());
  setTextarea(textareas, 3, caseDetails.court_body);

  checkNearText(doc, "Oo", Boolean(details.detained));
  checkNearText(doc, "Hindi", !details.detained);
  checkNearText(doc, "Criminal", record.intake_record.nature_of_case.toLowerCase().includes("criminal"));
  checkNearText(doc, "Civil", record.intake_record.nature_of_case.toLowerCase().includes("civil"));
  checkNearText(doc, "Labor", record.intake_record.nature_of_case.toLowerCase().includes("labor"));
  checkNearText(doc, "Administrative", record.intake_record.nature_of_case.toLowerCase().includes("admin"));
  checkNearText(doc, "Senior Citizen", classification.flag_senior);
  checkNearText(doc, "Children in Conflict", classification.flag_cicl);
  checkNearText(doc, "Woman", classification.flag_female);
  checkNearText(doc, "VAWC", classification.flag_vawc_victim);
  checkNearText(doc, "Urban Poor", classification.flag_urban);
  checkNearText(doc, "Rural Poor", classification.flag_rural);
  checkNearText(doc, "Plaintiff", record.intake_record.applicant_role === "Plaintiff");
  checkNearText(doc, "Defendant", record.intake_record.applicant_role === "Defendant");
  checkNearText(doc, "Respondent", record.intake_record.applicant_role === "Respondent");
  checkNearText(doc, "Complainant", record.intake_record.applicant_role === "Complainant");
  checkNearText(doc, "Accused", record.intake_record.applicant_role === "Accused");
}

export function hydrateOfficialTemplate(
  template: string,
  data: PrintableFormData,
  language: PrintableFormLanguage
) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(template, "text/html");
  normalizeTemplateAssets(doc);
  injectPrintSafety(doc);
  if (language === "english") hydrateEnglish(doc, data);
  else hydrateFilipino(doc, data);
  removeObsoleteOfficialSections(doc);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

