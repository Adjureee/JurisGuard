// Test the production TypeScript helper using the existing compiler; no extra packages.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('../../frontend/node_modules/typescript');
const source = path.resolve(__dirname, '../../frontend/src/features/documentExtraction/requestDeadline.ts');
const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = new Module(source, module); loaded.filename = source; loaded.paths = module.paths; loaded._compile(compiled, source);
const { withExtractionDeadline, ExtractionRequestStopped } = loaded.exports;

test('a hung request rejects at deadline and aborts the upload', async () => {
  let uploadSignal;
  await assert.rejects(withExtractionDeadline(signal => {
    uploadSignal = signal; return new Promise(() => {});
  }, 20), error => error instanceof ExtractionRequestStopped && error.reason === 'timeout');
  assert.equal(uploadSignal.aborted, true);
});

test('user cancellation rejects an upload that never resolves', async () => {
  const request = new AbortController();
  let uploadSignal;
  const pending = withExtractionDeadline(signal => {
    uploadSignal = signal; return new Promise(() => {});
  }, 5000, request.signal);
  request.abort();
  await assert.rejects(pending, error => error.reason === 'cancelled');
  assert.equal(uploadSignal.aborted, true);
});

test('a closed form cannot start another upload', async () => {
  const request = new AbortController(); request.abort();
  let calls = 0;
  await assert.rejects(withExtractionDeadline(async () => { calls++; }, 20, request.signal));
  assert.equal(calls, 0);
});

test('success and backend rejection clear the deadline', async () => {
  let firstSignal;
  assert.equal(await withExtractionDeadline(async signal => { firstSignal = signal; return 21; }, 20), 21);
  const failure = new Error('503 busy');
  await assert.rejects(withExtractionDeadline(async () => { throw failure; }, 20), failure);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(firstSignal.aborted, false);
});
