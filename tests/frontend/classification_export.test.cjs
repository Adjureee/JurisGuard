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
      intake_record: { control_no: 'TEST-CONTROL', form_date: '2026-01-01', party_represented: 'Synthetic party' },
      cases: { title_of_case: 'Synthetic case', case_no: 'TEST-1', status_of_case: 'Pending', location_type: '' },
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

test('export headings use recorded office values rather than a fixed location', () => {
  const first = row({ flags_reviewed: true, flag_female: null, flag_senior: null, flag_cicl: null });
  first.record.intake_record.region = 'Synthetic Region';
  first.record.intake_record.district_office = 'Synthetic District';
  const csv = loaded.exports.buildCriminalCasesCsv([first], filters);
  assert.match(csv.split('\n')[4], /Synthetic Region/);
  assert.match(csv.split('\n')[5], /Synthetic District/);
  const html = loaded.exports.buildCriminalCasesExcelHtml([first], filters);
  assert.match(html, /Synthetic Region/);
  assert.match(html, /Synthetic District/);

  const second = row({});
  second.record.intake_record.region = 'Another Region';
  second.record.intake_record.district_office = 'Another District';
  const mixed = loaded.exports.buildCriminalCasesCsv([first, second], filters).split('\n');
  assert.doesNotMatch(mixed[4], /Synthetic Region|Another Region/);
  assert.doesNotMatch(mixed[5], /Synthetic District|Another District/);
});
