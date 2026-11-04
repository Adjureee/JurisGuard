const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('../../frontend/node_modules/typescript');

const schemaSource = path.resolve(__dirname, '../../frontend/src/features/criminalCases/schemas.ts');
const loaded = new Module(schemaSource, module);
loaded.filename = schemaSource;
loaded.paths = Module._nodeModulePaths(path.dirname(schemaSource));
loaded._compile(ts.transpileModule(fs.readFileSync(schemaSource, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, schemaSource);

function payload(caseType = 'Criminal') {
  return {
    client_id: '1', client_ids: ['1'], case_type: caseType,
    intake_record: {
      control_no: 'SYNTHETIC-001', form_date: '2026-01-20', region: 'Regional Office No. XI',
      district_office: 'Panabo City District Office', party_represented: '', applicant_role: 'Accused',
      applicant_role_other: '', nature_of_request: '', nature_of_case: '', coi_agree_different_office: false,
      coi_agree_same_dept_appeal: false, coi_waive_right_to_complain: false, coi_trust_assigned_counsel: false,
      proof_submission_deadline: '', proof_submission_satisfied: false, proof_itr_satisfied: false,
      proof_itr_date: '', proof_brgy_satisfied: false, proof_brgy_date: '', proof_dswd_satisfied: false,
      proof_dswd_date: '', proof_others_satisfied: false, proof_others_details: '', proof_others_date: '',
      inv_plaintiff: false, inv_defendant: false, inv_oppositor: false, inv_petitioner: false,
      inv_respondent: false, inv_complainant: false, inv_accused: false, inv_others: '',
    },
    representative: { rep_name: '', rep_age: 0, rep_sex: '', civil_status: '', rep_address: '', rep_contact_no: '', relationship_to_applicant: '' },
    adverse_party: { role: '', name: '', address: '' },
    cases: {
      title_of_case: '', case_no: 'SYNTHETIC-CASE', court_body: 'RTC-34', status_of_case: 'Pending',
      case_status: 'Pending', incident_barangay: '', incident_city: '', incident_address: '', latitude: '', longitude: '',
      last_action_taken: '', detained: false, date_of_confinement: '', place_of_detention: '', location_type: 'Urban',
      cause_of_action: 'Synthetic offense', facts_of_case: '', pending_in_court: true, cause_of_termination: '',
      date_of_termination: '', assigned_pao: '', filing_date: '', hearing_schedule: '', remarks: '',
    },
  };
}

test('criminal inventory entry does not require duplicate interview-sheet or OCR-only fields', () => {
  assert.equal(loaded.exports.caseFormSchema.safeParse(payload()).success, true);
});

test('criminal inventory entry still requires fields used by the inventory export', () => {
  const value = payload();
  value.cases.cause_of_action = '';
  assert.equal(loaded.exports.caseFormSchema.safeParse(value).success, false);
});

test('civil case workflow retains its existing additional requirements', () => {
  const value = payload('Civil');
  assert.equal(loaded.exports.caseFormSchema.safeParse(value).success, false);
  value.intake_record.nature_of_request = 'Legal Advice';
  value.intake_record.nature_of_case = 'Civil';
  value.cases.last_action_taken = 'Synthetic action';
  value.cases.facts_of_case = 'Synthetic facts';
  value.representative.civil_status = 'None';
  assert.equal(loaded.exports.caseFormSchema.safeParse(value).success, true);
});

test('criminal case wizard has no document-scanning method step', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/modals/CaseWorkflow.tsx'), 'utf8');
  assert.doesNotMatch(source, /Encoding Method|Document Camera|Upload Document|CameraCapture|extractCaseFromDocument/);
  assert.match(source, /Inventory Details/);
  assert.match(source, /Case Received/);
});

test('criminal inventory entry follows the Excel report column order', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/modals/CaseWorkflow.tsx'), 'utf8');
  const start = source.indexOf('data-testid="criminal-inventory-fields"');
  const end = source.indexOf('Report heading', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const inventoryFields = source.slice(start, end);
  const labels = [
    'Control Number',
    'Party Represented',
    'Gender / Sex',
    'Title of the Case',
    'Court / Body',
    'Case No.',
    'Cause of Action',
    'Status of Case',
    'Last Action Taken',
    'Cause of Termination',
    'Date of Termination',
    'Urban / Rural',
    'Date of Confinement',
    'Place of Detention',
    'Case Received',
    'Address',
    'Contact Number',
  ];
  let previousIndex = -1;
  for (const label of labels) {
    const currentIndex = inventoryFields.indexOf(label);
    assert.ok(currentIndex > previousIndex, `${label} is out of order`);
    previousIndex = currentIndex;
  }
  assert.doesNotMatch(inventoryFields, /Regional Office|District Office/);
});

test('scanned Part II and II-A can be reopened for correction from inventory details', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/modals/CaseWorkflow.tsx'), 'utf8');
  const clientModal = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/modals/ClientInformationModal.tsx'), 'utf8');
  assert.match(workflow, /Edit scanned Parts II and II-A/);
  assert.match(workflow, /onClientUpdated/);
  assert.match(clientModal, /Edit scanned Parts II and II-A/);
  assert.match(clientModal, /clientId=\{onSaved \? client\.client_id : undefined\}/);
  assert.match(clientModal, /Discard unsaved corrections/);
});
