// Teste le composant « wf2-r19-3-dynamic » et ses cas d’erreur.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const path=new URL('../pending-live-update/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.R19_3-DYNAMIC-DRAFT.json',import.meta.url);
const wf=JSON.parse(fs.readFileSync(path))[0];
/** Retrouve l’élément par son nom. */
const byName=name=>wf.nodes.find(n=>n.name===name);
/** Exécute le traitement et collecte son résultat. */
const run=(name,json,refs={})=>new Function('$json','$','Buffer',byName(name).parameters.jsCode)(json,(nodeName)=>({
/** Renvoie le premier élément disponible. */
first:()=>({json:refs[nodeName]}),item:{json:refs[nodeName]},
/** Renvoie tous les éléments disponibles. */
all:()=>refs[nodeName]}),Buffer);

assert.equal(wf.active,false);
assert.equal(wf.id,'9adcV31eaIgJyMR0');
assert.ok(!JSON.stringify(wf).includes('NO_DETERMINISTIC_VERIFIER'));
assert.ok(!JSON.stringify(wf).includes("rule==='java:S1068'"));
assert.ok(!JSON.stringify(wf).includes("rule==='java:S125'"));
assert.ok(JSON.stringify(byName('Generic Candidate Preflight')).includes('ACCEPTABLE_FOR_SCANNER_VALIDATION'));

const controller='src/main/java/com/pfe/devsecops/controller/TaskController.java';
const dto='src/main/java/com/pfe/devsecops/dto/TaskRequest.java';
/** Prépare les données nécessaires à ce scénario. */
const basePlan=(findingId,rule=undefined)=>({findingId,source:'SONARQUBE',rule,target:{file:controller,line:36},rootCause:'Untrusted transport data crosses into the domain model.',remediationIntent:'Use a typed request boundary and controlled mapping.',filesToModify:[controller],filesToCreate:[dto],allowedPaths:[controller,dto],requiredChanges:['Use an explicit typed request contract','Map allowed fields explicitly'],forbiddenChanges:['Do not bind a persistence entity directly','Do not suppress scanner findings'],expectedBehaviorPreserved:['The endpoint creates the same task data'],validationStrategy:{compile:true,tests:true,scanner:'SONARQUBE'},disposition:'AUTO_CANDIDATE'});
const prepared={findingIds:['unknown-1'],batchId:'batch',repository_owner:'o',repository_name:'r',default_branch:'main'};
const unknownResponse={content:[{text:JSON.stringify({plans:[basePlan('unknown-1','synthetic:never-seen')]})}]};
const expanded=run('Validate Generic Remediation Plan',unknownResponse,{'Prepare Generic Remediation Plan':prepared});
assert.deepEqual(expanded.map(i=>i.json.target_file_path).sort(),[controller,dto].sort(),'unknown rule expands dynamically');

/** Prépare les données nécessaires à ce scénario. */
const candidate=(code,rule='synthetic:never-seen',operation='MODIFY',path=controller)=>({targetFile:path,fileOperation:operation,patchedCode:code,sourceContent:'class Before {}',approvedFindingIds:['f1'],approvedFindingsForFile:[{findingId:'f1',rule}],applicablePlans:[basePlan('f1',rule)],completePlan:{allPlannedFiles:[{path:controller,operation:'MODIFY'},{path:dto,operation:'CREATE'}]}});
for(const fixture of [
  candidate('class TaskService { void active() {} }','java:S1068'),
  candidate('class SecurityConfig { void configure() {} }','java:S125'),
  candidate('class TaskController { Task create(TaskRequest request) { Task task=new Task(); task.setTitle(request.title()); return task; } }','java:S4684'),
  candidate('class UnknownSafe { String normalized(String value) { return value == null ? "" : value.trim(); } }','synthetic:never-seen'),
]) assert.equal(run('Generic Candidate Preflight',fixture)[0].json.genericPreflightPassed,true);

assert.throws(()=>run('Generic Candidate Preflight',candidate('@RequestBody Object taskDto\nTask task = (Task) taskDto;\n// TODO map safely','java:S4684')),/WF2_CANDIDATE_QUALITY_REJECTED/,'attempt-3 candidate must be rejected without rule logic');
assert.throws(()=>run('Generic Candidate Preflight',candidate('class X { // NOSONAR\n}','synthetic:never-seen')),/SCANNER_SUPPRESSION/);
assert.throws(()=>run('Generic Candidate Preflight',{...candidate('class X {}'),targetFile:'src/Unauthorized.java'}),/WF2_PATCH_SCOPE_VIOLATION/);

const reviewCandidate=run('Generic Candidate Preflight',candidate('class Good {}'))[0].json;
const accepted=run('Enforce Independent Review',{content:[{text:JSON.stringify({verdict:'ACCEPTABLE_FOR_SCANNER_VALIDATION',evidence:['plan conformance']})}]},{'Generic Candidate Preflight':reviewCandidate});
assert.equal(accepted[0].json.candidateValidationStatus,'ACCEPTABLE_FOR_SCANNER_VALIDATION');
assert.equal(accepted[0].json.validationEvidence.scannerResolution,'UNKNOWN_UNTIL_WF3');
assert.throws(()=>run('Enforce Independent Review',{content:[{text:JSON.stringify({verdict:'INCONCLUSIVE',evidence:['compile unavailable']})}]},{'Generic Candidate Preflight':reviewCandidate}),/WF2_MANUAL_REVIEW_REQUIRED/);

const incomplete={content:[{text:JSON.stringify({plans:[]})}]};
assert.throws(()=>run('Validate Generic Remediation Plan',incomplete,{'Prepare Generic Remediation Plan':prepared}),/REMEDIATION_PLAN_INCOMPLETE/);
const unsafePlan=basePlan('unknown-1');unsafePlan.filesToCreate=['../escape.java'];unsafePlan.allowedPaths.push('../escape.java');
assert.throws(()=>run('Validate Generic Remediation Plan',{content:[{text:JSON.stringify({plans:[unsafePlan]})}]},{'Prepare Generic Remediation Plan':prepared}),/REMEDIATION_PATH_UNSAFE/);

const telemetry=byName('Prepare WF2 Failure Status').parameters.jsCode;
assert.ok(telemetry.includes("typeof raw==='string'"));assert.ok(telemetry.includes('errorCode'));assert.ok(telemetry.includes('failedNode'));
for(const preserved of ['Lookup Remediation Branch','Prepare Branch Creation','Lookup Existing Batch PR','Existing PR?','Create Pull Request1'])assert.ok(byName(preserved),preserved+' preserved');
console.log('WF2 R19.3 isolated acceptance: PASS');
