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
      intake_record: {
        control_no: 'TEST-CONTROL', form_date: '2026-01-01', party_represented: 'Synthetic party',
        applicant_role: 'Accused', applicant_role_other: '',
      },
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
  assert.match(html, /Regional Office No\. XI/);
  assert.match(html, /Panabo City District Office/);
  assert.doesNotMatch(html, /Synthetic Region|Synthetic District/);

  const second = row({});
  second.record.intake_record.region = 'Another Region';
  second.record.intake_record.district_office = 'Another District';
  const mixed = loaded.exports.buildCriminalCasesCsv([first, second], filters).split('\n');
  assert.doesNotMatch(mixed[4], /Synthetic Region|Another Region/);
  assert.doesNotMatch(mixed[5], /Synthetic District|Another District/);
});

test('Excel inventory follows the attorney template and includes supplemental fields by default', () => {
  const first = row({ flags_reviewed: true, flag_urban: false, flag_rural: false, flag_drugs: true, flag_female: true, flag_senior: false, flag_cicl: true });
  first.record.intake_record.control_no = '0007';
  first.client.client_details = { address: 'Primary address', contact_no: '0000123', representative_relationship: 'Mother' };
  first.record.representative.relationship_to_applicant = 'Mother';
  first.record.participants = [participant('PRIMARY', {
    role: 'Accused', sex: 'Female', age: 67, address: 'Participant address', contact: '0000123',
    relation: 'Mother', flags: { flags_reviewed: true, flag_drugs: true, flag_female: true, flag_senior: false, flag_cicl: true },
  })];
  const html = loaded.exports.buildCriminalCasesExcelHtml([first], filters);
  const headings = [...html.matchAll(/<tr><td colspan="25" class="title(?: report-title)?">([^<]*)<\/td><\/tr>/g)].map((match) => match[1]);
  assert.deepEqual(headings.slice(0, 6), [
    'REPUBLIKA NG PILIPINAS',
    'KAGAWARAN NG KATARUNGAN',
    'TANGGAPAN NG MANANANGGOL PAMBAYAN',
    "(PUBLIC ATTORNEY'S OFFICE)",
    'Regional Office No. XI',
    'Panabo City District Office',
  ]);
  assert.equal(headings[6], 'YEAR-END INVENTORY OF CASES');
  assert.match(headings[7], /^As of [A-Z][a-z]+ \d{1,2}, \d{4}$/);

  const headers = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(headers, [
    'Item No.', 'CONTROL NUMBER', 'PARTY REPRESENTED', 'GENDER/SEX', 'TITLE OF THE CASE', 'COURT/BODY',
    'CASE NO.', 'CAUSE OF ACTION', 'STATUS OF THE CASE', 'LAST ACTION TAKEN', 'CAUSE OF TERMINATION',
    'DATE OF TERMINATION', '', '', 'urban', 'rural', 'drugs', 'female', 'SENIOR', 'CICL',
    'Date of Confinement/ arrest', 'place of detention', 'case received', 'address', 'contact number',
  ]);
  assert.equal(headers.length, 25);
  assert.match(html, /<th data-field="TEMPLATE_SPACER"><\/th><th data-field="AGE"><\/th>/);
  const widths = [...html.matchAll(/<col width="(\d+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(widths.slice(12, 15), [85, 77, 38]);
  assert.doesNotMatch(html, /RELATIONSHIP TO APPLICANT|A\. CRIMINAL|B\. CIVIL/);
  const bodyRows = caseRows(html);
  assert.equal(bodyRows.length, 1);
  assert.match(bodyRows[0], /<td>1<\/td><td>0007<\/td><td>Accused<\/td><td>Female<\/td>/);
  const cells = [...bodyRows[0].matchAll(/<td(?: [^>]*)?>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
  assert.equal(cells[12], '');
  assert.equal(cells[13], '67');
  assert.deepEqual(cells.slice(14, 20), ['1', '0', '1', '1', '0', '1']);
  assert.deepEqual(cells.slice(20), ['2026-02-03', 'Synthetic place', '2026-01-01', 'Primary address', '0000123']);
  assert.match(html, /TOTAL CASES: 1/);
  const totalCells = [...html.match(/<tr class="total">([\s\S]*?)<\/tr>/)[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
  assert.equal(totalCells.length, 25);
  assert.equal(totalCells[0], '');
  assert.equal(totalCells[1], 'TOTAL CASES: 1');
  assert.deepEqual(totalCells.slice(14, 20), ['1', '0', '1', '1', '0', '1']);
});

test('excluding supplemental fields also removes the blank-header columns and age data', () => {
  const html = loaded.exports.buildCriminalCasesExcelHtml([row({})], filters, { includeSupplementalFields: false });
  const headers = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(headers, [
    'Item No.', 'CONTROL NUMBER', 'PARTY REPRESENTED', 'GENDER/SEX', 'TITLE OF THE CASE', 'COURT/BODY',
    'CASE NO.', 'CAUSE OF ACTION', 'STATUS OF THE CASE', 'LAST ACTION TAKEN', 'CAUSE OF TERMINATION',
    'DATE OF TERMINATION',
  ]);
  const cells = [...caseRows(html)[0].matchAll(/<td(?: [^>]*)?>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
  assert.equal(cells.length, 12);
  assert.equal(cells[0], '1');
  assert.equal(cells[11], '');
  assert.ok(!cells.includes('67'));
  assert.doesNotMatch(html, /Date of Confinement\/ arrest|place of detention|case received|contact number/);
  const totalCells = [...html.match(/<tr class="total">([\s\S]*?)<\/tr>/)[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
  assert.equal(totalCells.length, 12);
  assert.equal(totalCells[1], 'TOTAL CASES: 1');
});

function participant(clientId, { role, sex, age, address, contact, relation, flags }) {
  return {
    client_id: clientId,
    applicant_role: role,
    applicant_role_other: role === 'Others' ? 'Others' : '',
    party_represented: '',
    sex,
    age,
    address,
    contact_no: contact,
    relationship_to_applicant: relation,
    classification: flags,
  };
}

function caseRows(html) {
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((match) => match[1])
    .filter((rowHtml) => rowHtml.includes('<td') && !rowHtml.includes('class='));
}

test('one case with three clients emits three grouped rows and counts one case', () => {
  const record = row({});
  record.record.intake_record.control_no = '0009';
  record.record.participants = [
    participant('PRIMARY', { role: 'Accused', sex: 'Female', age: 17, address: 'Address A', contact: '000111', relation: 'Mother', flags: { flags_reviewed: true, flag_drugs: true, flag_female: true, flag_senior: false, flag_cicl: true } }),
    participant('CLIENT-2', { role: 'Petitioner', sex: 'Male', age: 45, address: 'Address B', contact: '000222', relation: 'Father', flags: { flags_reviewed: true, flag_drugs: false, flag_female: false, flag_senior: false, flag_cicl: false } }),
    participant('CLIENT-3', { role: 'Others', sex: 'Female', age: 65, address: 'Address C', contact: '000333', relation: 'Guardian', flags: { flags_reviewed: false, flag_drugs: true, flag_female: true, flag_senior: true, flag_cicl: true } }),
  ];

  const html = loaded.exports.buildCriminalCasesExcelHtml([record], filters);
  const rows = caseRows(html);
  assert.equal(rows.length, 3);
  assert.equal((rows[0].match(/rowspan="3"/g) ?? []).length, 12);
  assert.match(rows[0], /<td>1<\/td><td rowspan="3">0009<\/td><td>Accused<\/td><td>Female<\/td>/);
  assert.match(rows[0], /<td>Address A<\/td><td>000111<\/td>$/);
  assert.match(rows[1], /<td>Petitioner<\/td><td>Male<\/td>/);
  assert.match(rows[1], /<td>2<\/td><td>Petitioner/);
  assert.match(rows[1], /<td>Address B<\/td><td>000222<\/td>$/);
  assert.match(rows[2], /<td>Others<\/td><td>Female<\/td>/);
  assert.match(rows[2], /<td>3<\/td><td>Others/);
  assert.match(rows[2], /<td>Address C<\/td><td>000333<\/td>$/);

  const total = html.match(/<tr class="total">([\s\S]*?)<\/tr>/)?.[1] ?? '';
  const totalCells = [...total.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
  assert.equal(totalCells.length, 25);
  assert.equal(totalCells[0], '');
  assert.equal(totalCells[1], 'TOTAL CASES: 1');
  assert.equal(totalCells[12], '');
  assert.equal(totalCells[11], '');
  assert.deepEqual(totalCells.slice(14, 20), ['3', '0', '2', '1', '0', '1']);
  assert.ok(totalCells.slice(20).every((value) => value === ''));
});

test('multiple cases keep participant groups and count unique cases', () => {
  const first = row({ flags_reviewed: true, flag_female: true, flag_senior: false, flag_cicl: null });
  first.record.participants = [
    participant('PRIMARY', { role: 'Accused', sex: 'Female', age: 20, address: '', contact: '', relation: '', flags: { flags_reviewed: true, flag_drugs: false, flag_female: true, flag_senior: false, flag_cicl: null } }),
    participant('CLIENT-2', { role: 'Accused', sex: 'Male', age: 30, address: '', contact: '', relation: '', flags: { flags_reviewed: false, flag_drugs: false, flag_female: true, flag_senior: false, flag_cicl: true } }),
  ];
  const second = row({ flags_reviewed: true, flag_female: false, flag_senior: true, flag_cicl: false });
  second.record.case_id = 'TEST-CASE-2';
  second.record.intake_record.control_no = 'TEST-CONTROL-2';
  second.record.participants = [participant('SECONDARY-CASE-CLIENT', {
    role: 'Respondent', sex: 'Female', age: 60, address: '', contact: '', relation: '',
    flags: { flags_reviewed: true, flag_drugs: false, flag_female: false, flag_senior: true, flag_cicl: false },
  })];

  const html = loaded.exports.buildCriminalCasesExcelHtml([first, second], filters);
  assert.equal(caseRows(html).length, 3);
  assert.match(html, /TOTAL CASES: 2/);
  const total = html.match(/<tr class="total">([\s\S]*?)<\/tr>/)?.[1] ?? '';
  const cells = [...total.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
  assert.equal(cells[12], '');
  assert.deepEqual(cells.slice(14, 20), ['3', '0', '0', '1', '1', '0']);
  assert.match(html, /<td><\/td><td><\/td><td><\/td>/);
});

test('missing optional values keep the case row and exported text is HTML escaped', () => {
  const record = row({});
  record.record.cases.title_of_case = '<Synthetic & reviewed>';
  record.record.participants = [participant('PRIMARY', {
    role: 'Accused', sex: 'Female', age: 25, address: '', contact: '', relation: '',
    flags: { flags_reviewed: false, flag_drugs: false, flag_female: true, flag_senior: false, flag_cicl: false },
  })];

  const html = loaded.exports.buildCriminalCasesExcelHtml([record], filters);
  assert.equal(caseRows(html).length, 1);
  assert.match(html, /&lt;Synthetic &amp; reviewed&gt;/);
  assert.match(html, /<td><\/td><td><\/td><td><\/td>/);
  assert.match(html, /TOTAL CASES: 1/);
  const cells = [...caseRows(html)[0].matchAll(/<td(?: [^>]*)?>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
  assert.deepEqual(cells.slice(17, 20), ['', '', '']);
});
