const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('../../frontend/node_modules/typescript');

const source = path.resolve(__dirname, '../../frontend/src/features/documentExtraction/cameraAccess.ts');
const compiled = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(source, module);
loaded.filename = source;
loaded.paths = module.paths;
loaded._compile(compiled, source);
const { CameraStartTimeout, encodeJpegFrame, requestCameraStream } = loaded.exports;

test('camera permission that never settles reports a timeout', async () => {
  await assert.rejects(
    requestCameraStream(() => new Promise(() => {}), { video: true }, 10),
    CameraStartTimeout,
  );
});

test('a stream granted after timeout is stopped', async () => {
  let grant;
  let stopped = false;
  const request = requestCameraStream(() => new Promise(resolve => { grant = resolve; }), { video: true }, 10);
  await assert.rejects(request, CameraStartTimeout);
  grant({ getTracks: () => [{ stop: () => { stopped = true; } }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, true);
});

test('a successful camera stream stays active until the caller stops it', async () => {
  let stopped = false;
  const stream = { getTracks: () => [{ stop: () => { stopped = true; } }] };
  assert.equal(await requestCameraStream(async () => stream, { video: true }, 20), stream);
  assert.equal(stopped, false);
});

test('still capture resolves a valid JPEG blob', async () => {
  const blob = new Blob(['jpeg bytes'], { type: 'image/jpeg' });
  const canvas = { toBlob: callback => callback(blob) };
  assert.equal(await encodeJpegFrame(canvas, 20), blob);
});

test('failed image encoding reports an error without waiting forever', async () => {
  await assert.rejects(encodeJpegFrame({ toBlob: callback => callback(null) }, 20), /Could not encode/);
  await assert.rejects(encodeJpegFrame({ toBlob: () => {} }, 10), /took too long/);
});
