const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('../../frontend/node_modules/typescript');

function loadTypeScript(relativePath, dependencies = {}) {
  const source = path.resolve(__dirname, '../../frontend/src', relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(source, module);
  loaded.filename = source;
  loaded.paths = module.paths;
  loaded.require = (name) => dependencies[name] ?? require(name);
  loaded._compile(compiled, source);
  return loaded.exports;
}

const coordinates = loadTypeScript('utils/panaboCoordinates.ts');
const dashboard = loadTypeScript('services/dashboardService.ts', {
  '../api/client': { apiClient: {} },
  '../utils/panaboCoordinates': coordinates,
});

test('unknown barangay does not become a Panabo City Hall coordinate', () => {
  assert.equal(coordinates.getPanaboCoordinate('Unknown Place'), null);
  assert.deepEqual(dashboard.enrichCasesWithCoordinates([
    { case_id: 1, incident_barangay: 'Unknown Place', case_status: 'Pending' },
  ]), []);
});

test('known barangay or explicit coordinates remain visible', () => {
  const result = dashboard.enrichCasesWithCoordinates([
    { case_id: 2, incident_barangay: 'Gredu', case_status: 'Pending' },
    { case_id: 3, incident_barangay: 'Unknown Place', latitude: 7.1, longitude: 125.1 },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].coordinate_source, 'local_barangay_dictionary');
  assert.equal(result[1].coordinate_source, 'case_coordinates');
  assert.equal(result[1].latitude, 7.1);
});
