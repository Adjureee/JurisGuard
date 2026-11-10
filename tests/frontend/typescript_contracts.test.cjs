const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('../../frontend/node_modules/typescript');
function load(relative,source){
  const filename=path.resolve(__dirname,'../../frontend',relative);
  const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(ts.transpileModule(source??fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  return loaded.exports;
}
const {criminalAddCaseFormSchema,addCaseFormSchema}=load('src/features/criminalCases/schemas.ts');
function fictionalInput(){
  const representative={rep_name:'',rep_age:'',rep_sex:'',civil_status:'',rep_address:'',rep_contact_no:'',relationship_to_applicant:'',rep_email:''};
  return {client_id:'SYN-1',client_ids:['SYN-1'],case_type:'Criminal',representative,client_representatives:[{client_id:'SYN-1',representative}],adverse_party:{role:'',name:'',address:''},
    intake_record:{control_no:'00000000001',form_date:'2026-01-10',region:'Region XI',district_office:'Fictional office',applicant_role:'Accused',applicant_role_other:''},
    cases:{title_of_case:'',case_no:'FICTIONAL-CASE',court_body:'Fictional court',status_of_case:'Pending',incident_barangay:'',incident_city:'',last_action_taken:'Reviewed fictional record',detained:false,date_of_confinement:'',place_of_detention:'',location_type:'',cause_of_action:'Fictional cause'}};
}
test('control number validates numeric input up to 11 digits and preserves leading zeros',()=>{
  const input=fictionalInput();
  input.intake_record.control_no='00123456789';
  const result=criminalAddCaseFormSchema.parse(input);
  assert.equal(result.intake_record.control_no,'00123456789');

  // Rejects letters/symbols
  input.intake_record.control_no='12345A';
  assert.equal(criminalAddCaseFormSchema.safeParse(input).success,false);

  // Rejects spaces
  input.intake_record.control_no='123 456';
  assert.equal(criminalAddCaseFormSchema.safeParse(input).success,false);

  // Rejects > 11 digits
  input.intake_record.control_no='123456789012';
  assert.equal(criminalAddCaseFormSchema.safeParse(input).success,false);

  // Rejects empty
  input.intake_record.control_no='';
  assert.equal(criminalAddCaseFormSchema.safeParse(input).success,false);
});
test('criminal form normalizes raw representative ages and omits civil-only fields',()=>{
  const input=fictionalInput();input.cases.facts_of_case='Not part of criminal intake';input.intake_record.nature_of_case='Civil-only field';
  const result=criminalAddCaseFormSchema.parse(input);
  assert.equal(result.representative.rep_age,0);
  assert.equal(result.client_representatives[0].representative.rep_age,0);
  assert.equal(result.client_id,'SYN-1');
  assert.equal('facts_of_case' in result.cases,false);
  assert.equal('nature_of_case' in result.intake_record,false);
});
test('civil form retains its required detail validation',()=>{
  const input=fictionalInput();input.case_type='Civil';
  Object.assign(input.intake_record,{party_represented:'Petitioner',nature_of_case:'Fictional civil matter',proof_submission_deadline:'',proof_itr_date:'',proof_brgy_date:'',proof_dswd_date:'',proof_others_details:'',proof_others_date:'',inv_others:''});
  for(const key of ['coi_agree_different_office','coi_agree_same_dept_appeal','coi_waive_right_to_complain','coi_trust_assigned_counsel','inv_plaintiff','inv_defendant','inv_oppositor','inv_petitioner','inv_respondent','inv_complainant','inv_accused'])input.intake_record[key]=false;
  Object.assign(input.cases,{case_status:'Pending',incident_address:'',latitude:'',longitude:'',facts_of_case:'Fictional facts',pending_in_court:true,cause_of_termination:'',date_of_termination:'',assigned_pao:'',filing_date:'',hearing_schedule:'',remarks:''});
  assert.equal(addCaseFormSchema.parse(input).cases.facts_of_case,'Fictional facts');
  input.intake_record.nature_of_case='';input.cases.facts_of_case='';
  const result=addCaseFormSchema.safeParse(input);assert.equal(result.success,false);
  const paths=result.error.issues.map(issue=>issue.path.join('.'));
  assert.ok(paths.includes('intake_record.nature_of_case'));assert.ok(paths.includes('cases.facts_of_case'));
});
const hookPath=path.resolve(__dirname,'../../frontend/src/pages/dashboard/useDashboardAnalytics.ts');
const source=fs.readFileSync(hookPath,'utf8');
const ast=ts.createSourceFile(hookPath,source,ts.ScriptTarget.Latest,true);
const selected=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&['safeArray','safeOcrAnalytics'].includes(node.name?.text)||ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(ast)==='emptyOcrAnalytics'));
const {safeOcrAnalytics}=load('src/pages/dashboard/ocr-contract-test.ts',selected.map(node=>node.getText(ast)).join('\n')+'\nexports.safeOcrAnalytics=safeOcrAnalytics;');
test('OCR status totals survive analytics normalization',()=>{
  const statuses=[{status:'COMPLETED',total_scans:3},{status:'FAILED',total_scans:1}];
  assert.deepEqual(safeOcrAnalytics({total_scans:4,status_breakdown:statuses}).status_breakdown,statuses);
});
test('missing OCR analytics has an empty status breakdown',()=>{
  for(const input of [null,undefined,{}, {status_breakdown:null}])assert.deepEqual(safeOcrAnalytics(input).status_breakdown,[]);
});
