const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('../../frontend/node_modules/typescript');
const source = path.resolve(__dirname, '../../frontend/src/features/documentExtraction/paperReviewState.ts');
const loaded = new Module(source, module);
loaded.filename = source;
loaded.paths = Module._nodeModulePaths(path.dirname(source));
loaded._compile(ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, source);
const { representativeIsEmpty, reviewLabels } = loaded.exports;
const A = 'applicant_personal_circumstances', R = 'representative_personal_circumstances';

test('blank representative section is optional, including whitespace-only OCR entries', () => {
  const sections = { [A]: { name: 'SYNTHETIC Ana', detained: '' }, [R]: { name: '', age: '  ' } };
  assert.equal(representativeIsEmpty(sections), true);
  sections[R].name = 'N/A';
  assert.equal(representativeIsEmpty(sections), false);
});

test('historical status labels retain distinct meanings without a save gate', () => {
  assert.notEqual(reviewLabels.blank, reviewLabels.unreadable);
  assert.notEqual(reviewLabels.unreadable, reviewLabels.ocr_failed);
});

const { unknownBoxes, detainedSummary, checkboxPrefix: P } = loaded.exports;
test('unknown boxes stay unknown and only an exclusive reviewed pair supplies a summary', () => {
  assert.equal(unknownBoxes()[P+'oo'], 'unknown');
  assert.equal(detainedSummary(unknownBoxes()), '');
  assert.equal(detainedSummary({[P+'oo']: 'checked', [P+'hindi']: 'unchecked'}), 'Oo');
  assert.equal(detainedSummary({[P+'oo']: 'unchecked', [P+'hindi']: 'checked'}), 'Hindi');
  for (const pair of [['checked','unknown'], ['unchecked','unchecked'], ['checked','checked']]) {
    assert.equal(detainedSummary({[P+'oo']: pair[0], [P+'hindi']: pair[1]}), '');
  }
});
