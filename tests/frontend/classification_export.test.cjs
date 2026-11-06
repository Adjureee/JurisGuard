const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('../../frontend/node_modules/typescript');

const source = path.resolve(__dirname, '../../frontend/src/services/exportService.ts');
const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(source, module);
loaded.filename = source;
loaded.paths = Module._nodeModulePaths(path.dirname(source));
loaded._compile(compiled, source);

function row(flags) {
  return {
    clientName: 'Synthetic Test Client',
    client: {
      client: { age: 67, sex: 'Female' },
      client_details: { address: 'Synthetic address', contact_no: '0000' },
      client_classification: flags,
    },
    record: {
      case_id: 'TEST-CASE', created_by_user_id: null, last_updated: '2026-01-01',
      client_id: 'PRIMARY',
      intake_record: { control_no: 'TEST-CONTROL', form_date: '2026-01-01', party_represented: 'Synthetic party' },
      cases: {
        title_of_case: 'Synthetic case', court_body: 'Branch 4', case_no: 'TEST-1',
        cause_of_action: 'Synthetic cause', status_of_case: 'Pending', last_action_taken: 'Synthetic action',
        cause_of_termination: '', date_of_termination: '', date_of_confinement: '2026-02-03',
        place_of_detention: 'Synthetic place', location_type: 'Urban',
      },
      representative: {},
    },
  };
}

const filters = { status: 'All', location_type: 'All', gender: 'All' };
function values(flags) {
  const csv = loaded.exports.buildCriminalCasesCsv([row(flags)], filters);
  const line = csv.split(/\r?\n/).find((entry) => entry.includes('TEST-CONTROL'));
  return [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((match) => match[1]);
}

test('unreviewed legacy values and absent evidence stay blank in inventory export', () => {
  const cells = values({ flags_reviewed: false, flag_female: true, flag_senior: true, flag_cicl: false });
  assert.deepEqual(cells.slice(15, 18), ['', '', '']);
  const missing = values({});
  assert.deepEqual(missing.slice(15, 18), ['', '', '']);
});

test('explicit reviewed yes and no retain their meaning', () => {
  const cells = values({ flags_reviewed: true, flag_female: true, flag_senior: false, flag_cicl: null });
  assert.deepEqual(cells.slice(15, 18), ['1', '0', '']);
});

test('CSV retains its office headings while the Excel inventory uses the supplied Panabo heading', () => {
  const first = row({ flags_reviewed: true, flag_female: null, flag_senior: null, flag_cicl: null });
  first.record.intake_record.region = 'Synthetic Region';
  first.record.intake_record.district_office = 'Synthetic District';
  const csv = loaded.exports.buildCriminalCasesCsv([first], filters);
  assert.match(csv.split('\n')[4], /Synthetic Region/);
  assert.match(csv.split('\n')[5], /Synthetic District/);
  const html = loaded.exports.buildCriminalCasesExcelHtml([first], filters);
  assert.match(html, /Panabo City Public Attorney's Office/);
  assert.doesNotMatch(html, /Synthetic Region|Synthetic District/);

  const second = row({});
  second.record.intake_record.region = 'Another Region';
  second.record.intake_record.district_office = 'Another District';
  const mixed = loaded.exports.buildCriminalCasesCsv([first, second], filters).split('\n');
  assert.doesNotMatch(mixed[4], /Synthetic Region|Another Region/);
  assert.doesNotMatch(mixed[5], /Synthetic District|Another District/);
});

test('Excel inventory has the fixed 24-column PAO format and one row per case', () => {
  const first = row({ flags_reviewed: true, flag_urban: false, flag_rural: false, flag_drugs: true, flag_female: true, flag_senior: false, flag_cicl: true });
  first.record.intake_record.control_no = '0007';
  first.client.client_details = { address: 'Client address', contact_no: '0000123' };
  first.client.client_classification = {
    flags_reviewed: true, flag_drugs: true, flag_female: true, flag_senior: false, flag_cicl: true,
  };
  first.record.participants = [
    {
      client_id: 'PRIMARY', applicant_role: 'Accused', applicant_role_other: '', party_represented: '',
      sex: 'Female', age: 67, address: 'Primary address', contact_no: '0000123',
      relationship_to_applicant: 'Mother', representative: { relationship_to_applicant: 'Mother' },
      classification: { flags_reviewed: true, flag_drugs: true, flag_female: true, flag_senior: false, flag_cicl: true },
    },
    {
      client_id: 'SECONDARY', applicant_role: 'Witness', applicant_role_other: '', party_represented: '',
      sex: 'Male', age: 40, address: 'Secondary address', contact_no: '9999999',
      relationship_to_applicant: '', classification: { flag_drugs: false },
    },
  ];
  const html = loaded.exports.buildCriminalCasesExcelHtml([first], filters);
  const headings = [...html.matchAll(/<tr><td colspan="24" class="title(?: report-title)?">([^<]*)<\/td><\/tr>/g)].map((match) => match[1]);
  assert.deepEqual(headings.slice(0, 6), [
    'REPUBLIKA NG PILIPINAS',
    'KAGAWARAN NG KATARUNGAN',
    'TANGGAPAN NG MANANANGGOL PAMBAYAN',
    "(PUBLIC ATTORNEY'S OFFICE)",
    "Panabo City Public Attorney's Office",
    'YEAR-END INVENTORY OF CASES',
  ]);
  assert.match(headings[6], /^As of [A-Z][a-z]+ \d{1,2}, \d{4}$/);

  const headers = [...html.matchAll(/<th>([^<]*)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(headers, [
    'CONTROL NUMBER', 'PARTY REPRESENTED', 'GENDER / SEX', 'TITLE OF THE CASE', 'COURT / BODY',
    'CASE NO.', 'CAUSE OF ACTION', 'STATUS OF THE CASE', 'LAST ACTION TAKEN', 'CAUSE OF TERMINATION',
    'DATE OF TERMINATION', 'AGE', 'URBAN', 'RURAL', 'DRUGS', 'FEMALE', 'SENIOR', 'CICL',
    'DATE OF CONFINEMENT', 'PLACE OF DETENTION', 'CASE RECEIVED', 'ADDRESS', 'CONTACT NUMBER',
    'RELATIONSHIP TO APPLICANT',
  ]);
  assert.equal(headers.length, 24);
  assert.doesNotMatch(html, /Item No\.|A\. CRIMINAL|B\. CIVIL/);
  assert.equal((html.match(/<tr><td>0007<\/td>/g) ?? []).length, 1);
  assert.match(html, /<tr><td>0007<\/td><td>Accused<\/td><td>Female<\/td>/);
  assert.match(html, /<td>Primary address<\/td><td>0000123<\/td><td>Mother<\/td>/);
  assert.match(html, /TOTAL CASES: 1/);
  assert.match(html, /<tr class="total"><td>TOTAL CASES: 1<\/td>(?:<td><\/td>){11}<td>1<\/td><td>0<\/td><td>1<\/td><td>1<\/td><td>0<\/td><td>1<\/td>/);
});
