const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('../../frontend/node_modules/typescript');

const source = path.resolve(__dirname, '../../frontend/src/features/dashboard/activityPresentation.ts');
const loaded = new Module(source, module);
loaded.filename = source;
loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, source);
const { presentActivity } = loaded.exports;

test('dashboard activity formats ID-array audit events without exposing payloads', () => {
  assert.equal(presentActivity({
    id: '1', timestamp: '', user: 'Attorney', action: 'Read Clients',
    description: '{"client_ids":[1,2,3]}', entity_type: 'client',
  }), 'Attorney viewed client records');
  assert.equal(presentActivity({
    id: '2', timestamp: '', user: 'Attorney', action: 'Read Cases',
    description: '{"case_ids":[1,2,3]}', entity_type: 'case',
  }), 'Attorney viewed case records');
});

test('dashboard activity preserves useful scan description and hides unknown payloads', () => {
  assert.equal(presentActivity({
    id: '3', timestamp: '', user: 'Attorney', action: 'OCR Scan',
    description: 'Attorney scanned document #78', entity_id: '78',
  }), 'Attorney scanned document #78');
  assert.equal(presentActivity({
    id: '4', timestamp: '', user: 'Attorney', action: 'Legacy Event',
    description: '{"client_ids":[1,2,3]}',
  }), 'Attorney recorded an account activity');
});
