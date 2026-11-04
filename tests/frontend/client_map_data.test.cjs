const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('../../frontend/node_modules/typescript');
const source = path.resolve(__dirname, '../../frontend/src/components/dashboard/clientMapData.ts');
const loaded = new Module(source, module);
loaded.filename = source;
loaded.paths = Module._nodeModulePaths(path.dirname(source));
loaded._compile(ts.transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, source);
const {matchAddressCity, cityClientFeatures} = loaded.exports;
const boundary = (id, name) => ({type:'Feature', geometry:{type:'Polygon', coordinates:[]}, properties:{shapeID:id,shapeName:name}});
const boundaries = {type:'FeatureCollection',features:[boundary('mati','City of Mati'),boundary('a','San Isidro'),boundary('b','San Isidro')]};
test('matches explicit city text; rejects missing and ambiguous municipality names',()=>{
  assert.equal(matchAddressCity('Prk. 5 Brgy. Central Mati City',boundaries).properties.shapeID,'mati');
  assert.equal(matchAddressCity('San Isidro',boundaries),null);
  assert.equal(matchAddressCity('Address not provided',boundaries),null);
});
test('combines address groups by city and leaves unmapped clients out of city totals',()=>{
  const data=cityClientFeatures([{barangay:'Mati City',total_cases:2},{barangay:'Central City of Mati',total_cases:3},{barangay:'Unmatched',total_cases:7}],boundaries);
  assert.equal(data.features[0].properties.clientCount,5);
  assert.equal(data.features[1].properties.clientCount,0);
  assert.equal(boundaries.features[0].properties.clientCount,undefined);
});
