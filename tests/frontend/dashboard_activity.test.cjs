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

const auditServiceSource = path.resolve(__dirname, '../../frontend/src/services/auditService.ts');
const auditStub = fs.readFileSync(auditServiceSource, 'utf8')
  .replace('import { apiClient } from "../api/client";', 'const apiClient = { get: async () => ({ data: [] }), post: async () => ({ data: {} }) };');
const auditModule = new Module(auditServiceSource, module);
auditModule.filename = auditServiceSource;
auditModule.paths = module.paths;
auditModule._compile(ts.transpileModule(auditStub, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, auditServiceSource);
const {
  AUDIT_LOG_PAGE_SIZE,
  resolveAuditDateRange,
  buildAuditLogQueryParams,
} = auditModule.exports;

test('audit service resolves preset and explicit date ranges and scopes non-admin filters', () => {
  assert.equal(AUDIT_LOG_PAGE_SIZE, 25);
  const refDate = new Date(2026, 3, 15, 14, 30, 0);
  assert.deepEqual(resolveAuditDateRange('today', '', '', refDate), {
    date_from: '2026-04-15',
    date_to: '2026-04-15',
  });
  assert.deepEqual(resolveAuditDateRange('month', '2026-04-05', '2026-04-12', refDate), {
    date_from: '2026-04-05',
    date_to: '2026-04-12',
  });

  const staffParams = buildAuditLogQueryParams({
    page: 2,
    pageSize: 25,
    action: 'Create Case',
    userId: '10',
    userRole: 'admin',
    search: '  synthetic  ',
    currentUser: { user_id: 20, role: 'staff', username: 'staff', email: 's@local', full_name: 'Staff' },
  });
  assert.equal(staffParams.page, 2);
  assert.equal(staffParams.page_size, 25);
  assert.equal(staffParams.action, 'Create Case');
  assert.equal(staffParams.user_id, undefined);
  assert.equal(staffParams.user_role, undefined);
  assert.equal(staffParams.search, 'synthetic');

  const adminParams = buildAuditLogQueryParams({
    page: 1,
    pageSize: 25,
    action: 'all',
    userId: '10',
    userRole: 'staff',
    currentUser: { user_id: 1, role: 'admin', username: 'admin', email: 'a@local', full_name: 'Admin' },
  });
  assert.equal(adminParams.action, undefined);
  assert.equal(adminParams.user_id, 10);
  assert.equal(adminParams.user_role, 'staff');
});
