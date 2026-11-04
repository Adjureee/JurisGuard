const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('../../frontend/node_modules/typescript');
const source = path.resolve(__dirname, '../../frontend/src/features/documentExtraction/scanGeometry.ts');
const loaded = new Module(source, module);
loaded._compile(ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, source);
const { fitScan } = loaded.exports;

test('fit keeps both portrait and landscape source images within the review viewport', () => {
  assert.equal(fitScan(1800, 1500, 600, 500, 0), 1 / 3);
  assert.equal(fitScan(800, 1200, 600, 500, 0), 500 / 1200);
});
test('quarter turns fit swapped dimensions without changing source coordinates', () => {
  for (const rotation of [90, 270, -90]) assert.equal(fitScan(1800, 1500, 600, 500, rotation), 500 / 1800);
  assert.equal(fitScan(1800, 1500, 600, 500, 180), 1 / 3);
});
test('hidden panes and unloaded image dimensions never produce invalid transforms', () => {
  assert.equal(fitScan(0, 0, 600, 500, 0), 1);
  assert.equal(fitScan(1800, 1500, 0, 0, 90), 1);
  assert.equal(fitScan(NaN, 1500, 600, 500, 0), 1);
});
