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
loaded._compile(ts.transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, esModuleInterop: true}}).outputText, source);
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

const realBoundaries=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../frontend/public/maps/philippines-cities.geojson'),'utf8'));
const resolve=address=>matchAddressCity(address,realBoundaries);
test('province text never competes with an explicit city or creates a city selection',()=>{
  assert.equal(resolve('Purok 3, Brgy. Aplaya, Digos City, Davao del Sur').properties.shapeName,'City of Digos');
  assert.equal(resolve('Prk. 2, Brgy. Apokon, Tagum City, Davao del Norte').properties.shapeName,'City of Tagum');
  assert.equal(resolve('Davao del Norte'),null);
  assert.equal(resolve('Province of Davao del Sur'),null);
  assert.equal(resolve('City of Davao').properties.shapeName,'Davao City');
  assert.equal(resolve('Davao City, Davao del Norte'),null);
  assert.equal(resolve('Mati City Davao del Norte'),null);
  assert.equal(resolve('Tagum City Davao del Norte').properties.shapeName,'City of Tagum');
});
test('duplicate municipality names require the correct province, including renamed provinces',()=>{
  assert.equal(resolve('Purok 2, Brgy. Poblacion, Santa Maria, Davao Occidental').properties.shapeID,'30758251B76454533552151');
  assert.equal(resolve('Sta. Maria, Bulacan').properties.shapeID,'30758251B94770277751528');
  assert.equal(resolve('Santa Maria'),null);
  assert.equal(resolve('Santa Maria, Davao del Norte'),null);
  assert.equal(resolve('Cabinuangan, New Bataan, Davao de Oro').properties.shapeName,'New Bataan');
});
test('barangay names, conflicting localities and conflicting provinces stay unconfirmed',()=>{
  assert.equal(resolve('Purok 1, Brgy. Mabini, Panabo City, Davao del Norte').properties.shapeName,'City of Panabo');
  assert.equal(resolve('Purok 1, Brgy. Quezon, Panabo City, Davao del Norte').properties.shapeName,'City of Panabo');
  assert.equal(resolve('Quezon, Bukidnon').properties.shapeName,'Quezon');
  assert.equal(resolve('Brgy. Panabo'),null);
  assert.equal(resolve('Mati City, Tagum City'),null);
  assert.equal(resolve('Mati City, Davao Oriental, Davao del Norte'),null);
  assert.equal(resolve('City of San Jose del Monte').properties.shapeName,'City of San Jose del Monte');
});

test('bundled parent index matches the exact offline boundary edition',()=>{
  const crypto=require('node:crypto');
  const data=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../frontend/src/components/dashboard/cityProvinceIndex.json'),'utf8'));
  const file=fs.readFileSync(path.resolve(__dirname,'../../frontend/public/maps/philippines-cities.geojson'));
  assert.equal(data.cityBoundarySha256,crypto.createHash('sha256').update(file).digest('hex'));
  for(const feature of realBoundaries.features) assert.ok(data.parents[feature.properties.shapeID]);
});
test('structured group city is preserved for Panabo barangays and selected groups',()=>{
  const data=cityClientFeatures([{barangay:'New Visayas',city:'Panabo City',total_cases:7},
    {barangay:'Dawan, Mati City, Davao Oriental',city:'',total_cases:3}],realBoundaries);
  assert.equal(data.features.find(f=>f.properties.shapeName==='City of Panabo').properties.clientCount,7);
  assert.equal(data.features.find(f=>f.properties.shapeName==='City of Mati').properties.clientCount,3);
  assert.equal(matchAddressCity('Mati City',realBoundaries,'Tagum City'),null);
  assert.equal(matchAddressCity('Quezon',realBoundaries,'Panabo City').properties.shapeName,'City of Panabo');
});
test('all verified demo geography combinations resolve without modifying source addresses',()=>{
  const pairs=[['New Visayas','Panabo City','Davao del Norte'],['Mabunao','Panabo City','Davao del Norte'],
    ['Apokon','Tagum City','Davao del Norte'],['Bincungan','Tagum City','Davao del Norte'],
    ['Aplaya','Digos City','Davao del Sur'],['Balabag','Digos City','Davao del Sur'],
    ['Camanchiles','Matanao','Davao del Sur'],['Asbang','Matanao','Davao del Sur'],
    ['Dahican','Mati City','Davao Oriental'],['Dawan','Mati City','Davao Oriental'],
    ['Cabinuangan','New Bataan','Davao de Oro'],['Kahayag','New Bataan','Davao de Oro'],
    ['Poblacion','Santa Maria','Davao Occidental'],['Ogpao','Santa Maria','Davao Occidental'],
    ['Tibungco','Davao City',''],['Tawan-tawan','Davao City','']];
  for(let i=0;i<100;i++){
    const [barangay,city,province]=pairs[i%pairs.length];
    const address=`Purok ${Math.floor(i/16)+1}, Brgy. ${barangay}, ${city}${province?', '+province:''}`;
    assert.ok(resolve(address),address);
  }
});
