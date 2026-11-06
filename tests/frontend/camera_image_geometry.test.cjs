const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('../../frontend/node_modules/typescript');
const source=path.resolve(__dirname,'../../frontend/src/features/documentExtraction/cameraImagePreparation.ts');
const loaded=new Module(source,module);loaded.filename=source;loaded.paths=Module._nodeModulePaths(path.dirname(source));
loaded._compile(ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,source);
const {validImageCorners,projectivePoint,defaultImageAdjustments}=loaded.exports;
test('full capture and perspective quadrilaterals map all four corners correctly',()=>{
  for(const points of [defaultImageAdjustments().corners,[[.1,.2],[.9,.1],[.8,.9],[.2,.8]]]){
    assert.ok(validImageCorners(points));
    [[0,0],[1,0],[1,1],[0,1]].forEach(([u,v],i)=>{
      const output=projectivePoint(points,u,v);
      assert.ok(Math.abs(output[0]-points[i][0])<1e-8);
      assert.ok(Math.abs(output[1]-points[i][1])<1e-8);
    });
  }
});
test('crossed, empty, tiny and out-of-bounds crops are rejected',()=>{
  for(const points of [[],[[0,0],[1,1],[1,0],[0,1]],[[0,0],[0,0],[0,0],[0,0]],
    [[0,0],[.01,0],[.01,.01],[0,.01]],[[0,0],[2,0],[1,1],[0,1]]]) assert.equal(validImageCorners(points),false);
});
