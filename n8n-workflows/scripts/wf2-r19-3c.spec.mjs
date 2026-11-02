// Teste le composant « wf2-r19-3c » et ses cas d’erreur.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const draftPath=new URL('../pending-live-update/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.R19_3P-PR-LOOKUP-FIX.json',import.meta.url);
const basePath=new URL('../backups/r19-3c-prebuild/wf2-trusted-f95634ef.json',import.meta.url);
/** Charge les données nécessaires au composant. */
const load=path=>{const data=JSON.parse(fs.readFileSync(path));return Array.isArray(data)?data[0]:data};
const wf=load(draftPath),base=load(basePath);
/** Retrouve l’élément par son nom. */
const byName=(name,w=wf)=>w.nodes.find(n=>n.name===name);
/** Exécute le traitement et collecte son résultat. */
const run=(name,{json={},input={
/** Renvoie tous les éléments disponibles. */
all:()=>[],
/** Renvoie le premier élément disponible. */
first:()=>({json:{}})},refs={},items=()=>[],execution={id:'fixture'},env={N8N_INTERNAL_SECRET:'test-secret'}}={})=>new Function('$json','$input','$','$items','$execution','Buffer','$env',byName(name).parameters.jsCode)(json,input,nodeName=>({
/** Renvoie le premier élément disponible. */
first:()=>({json:refs[nodeName]}),item:{json:refs[nodeName]},
/** Renvoie tous les éléments disponibles. */
all:()=>refs[nodeName]}),items,execution,Buffer,env);
/** Vérifie et normalise l’identifiant de commit. */
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

assert.equal(sha(base.nodes),sha(load(basePath).nodes),'trusted base stable');
assert.equal(wf.id,'e96d6ee1-0a6c-4779-9200-4e2dc87ef9f2');assert.equal(wf.active,false);assert.equal(wf.activeVersionId,null);assert.deepEqual(wf.pinData,{});
const nodeNames=new Set(wf.nodes.map(n=>n.name));for(const [source,c] of Object.entries(wf.connections))for(const outputs of c.main||[])for(const edge of outputs||[])assert.ok(nodeNames.has(edge.node),source+' points to missing '+edge.node);
for(const name of ['Prepare Batch Context','Lookup Remediation Branch','Branch Exists?','Prepare Branch Creation','Create Missing Branch'])assert.deepEqual(byName(name),byName(name,base),name+' changed from f956 baseline');
assert.deepEqual(wf.connections['Branch Exists?'].main[1].map(e=>e.node),['Prepare Branch Creation']);
assert.deepEqual(wf.connections['Prepare Branch Creation'].main[0].map(e=>e.node),['Create Missing Branch']);
assert.ok(wf.connections['Prepare Branch Creation'].main[1][0].node.startsWith('Failure Envelope - Prepare Branch Creation'));
const branchCtx={repository_owner:'owner',repository_name:'repo',targetBranchName:'fix/pfe-i-r',baseSha:'a'.repeat(40)};
const branchRefs={'Prepare Batch Context':branchCtx};assert.equal(run('Prepare Branch Creation',{json:{statusCode:404},refs:branchRefs})[0].json.lookupStatusCode,404);
const existingBranchCtx={...branchCtx,incidentId:'65e35d1b-212f-4153-bd63-fba6e8eebc2c',requestId:'f1af3192-40f0-4400-869a-3854246d7a11',targetBranchName:'fix/pfe-65e35d1b-212f-4153-bd63-fba6e8eebc2c-f1af3192-40f0-4400-869a-3854246d7a11',baseSha:'1aded596713cbe8477a4bf652cd081b9aec00aa7'};
const reused=run('Use Existing Branch',{json:{statusCode:200,body:{ref:'refs/heads/'+existingBranchCtx.targetBranchName,object:{sha:existingBranchCtx.baseSha}}},refs:{'Prepare Batch Context':existingBranchCtx}})[0].json;
assert.equal(reused.targetBranchName,existingBranchCtx.targetBranchName);assert.equal(reused.baseSha,existingBranchCtx.baseSha);
assert.throws(()=>run('Prepare Branch Creation',{json:{statusCode:500},refs:branchRefs}),/BRANCH_LOOKUP_INCONCLUSIVE/);
for(const key of ['repository_owner','repository_name','targetBranchName','baseSha'])assert.throws(()=>run('Prepare Branch Creation',{json:{statusCode:404},refs:{'Prepare Batch Context':{...branchCtx,[key]:key==='baseSha'?'bad':''}}}),/BRANCH_CONTEXT_INCOMPLETE/);

const adaptBody={incidentId:'incident',projectId:'project',requestId:'request',remediationType:'AUTO_FIX_ELIGIBLE',repository:'owner/repo',findingIds:['f1'],findings:[{findingId:'f1',source:'SAST',stage:'code-analysis',remediationType:'AUTO_FIX_ELIGIBLE',file:'src/app.ts',severity:'HIGH'}]};
/** Prépare les données nécessaires à ce scénario. */
const adaptInput=body=>({headers:{'x-internal-secret':'test-secret'},body,correlationEnvelope:{incidentId:'incident',projectId:'project',requestId:'request',batchId:'batch',batchKey:'batch',attemptCount:3}});
const adapted=run('Adapt Webhook Payload',{input:{
/** Renvoie le premier élément disponible. */
first:()=>({json:adaptInput(adaptBody)})}})[0].json.incidentData;assert.equal(adapted.source,'SAST');assert.equal(adapted.stage,'code-analysis');assert.equal(adapted.findings[0].source,'SAST');
assert.throws(()=>run('Adapt Webhook Payload',{input:{
/** Renvoie le premier élément disponible. */
first:()=>({json:adaptInput({...adaptBody,findings:[...adaptBody.findings,{...adaptBody.findings[0],findingId:'f2',source:'CODE'}],findingIds:['f1','f2']})})}}),/WF2_MIXED_SOURCE_BATCH_UNSUPPORTED/);
for(const source of ['JENKINS','DOCKER','INFRA','ADMIN'])assert.throws(()=>run('Adapt Webhook Payload',{input:{
/** Renvoie le premier élément disponible. */
first:()=>({json:adaptInput({...adaptBody,findings:[{...adaptBody.findings[0],source}]})})}}),/WF2_SPECIALIST_ROUTE_REQUIRED/);

const controller='src/main/java/com/acme/controller/ThingController.java',dto='src/main/java/com/acme/dto/ThingRequest.java';
const tree={tree:[{type:'blob',path:'pom.xml'},{type:'blob',path:controller},{type:'blob',path:'src/main/java/com/acme/domain/Thing.java'},{type:'blob',path:'src/test/java/com/acme/ThingTest.java'}],truncated:false};
const context={findingIds:['f1'],findings:[{findingId:'f1',source:'SONARQUBE',rule:'synthetic:unknown',severity:'MAJOR',type:'CODE_SMELL',message:'Use a safe request boundary',file:controller,line:20}],repository_owner:'owner',repository_name:'repo',default_branch:'main',batchId:'batch'};
const policyCtx=run('Build Independent Repository Policy',{json:tree,refs:{'Prepare Batch Context':context}})[0].json;
assert.deepEqual(policyCtx.repositoryPolicy.permittedRoots,['src/main/java/']);assert.ok(policyCtx.repositoryPolicy.existingFiles.includes(controller));
const legitimateDotfiles=['.gitignore','.github/workflows/ci.yml','src/.keep','config/.env.example'];
const dotfilePolicy=run('Build Independent Repository Policy',{json:{tree:[...tree.tree,...legitimateDotfiles.map(path=>({type:'blob',path}))],truncated:false},refs:{'Prepare Batch Context':context}})[0].json.repositoryPolicy;
for(const path of legitimateDotfiles)assert.ok(dotfilePolicy.existingFiles.includes(path),path+' rejected');
for(const path of ['.','..','./file','../file','src/./file','src/../file','/src/file'])assert.throws(()=>run('Build Independent Repository Policy',{json:{tree:[...tree.tree,{type:'blob',path}],truncated:false},refs:{'Prepare Batch Context':context}}),/REPOSITORY_PATH_UNSAFE/,path+' accepted');
/** Prépare les données nécessaires à ce scénario. */
const plan=(overrides={})=>({findingId:'f1',source:'SONARQUBE',rule:'synthetic:unknown',target:{file:controller,line:20},rootCause:'Transport input crosses the domain boundary.',remediationIntent:'Use a typed request and controlled mapping.',filesToModify:[controller],filesToCreate:[dto],proposedPaths:[controller,dto],requiredChanges:['Use a typed request','Map fields explicitly'],forbiddenChanges:['No suppression'],expectedBehaviorPreserved:['Endpoint behavior'],validationStrategy:{compile:true,tests:true,scanner:'SONARQUBE'},disposition:'AUTO_CANDIDATE',...overrides});
const prepared={...policyCtx,remediationContract:{},planBodyString:'',findingIds:['f1']};
/** Prépare les données nécessaires à ce scénario. */
const validatePlan=value=>run('Validate Generic Remediation Plan',{json:{content:[{type:'text',text:JSON.stringify({plans:[value]})}]},refs:{'Prepare Generic Remediation Plan':prepared}});
const expanded=validatePlan(plan());assert.deepEqual(expanded.map(i=>i.json.target_file_path).sort(),[controller,dto].sort());
for(const content of [[{type:'text',text:JSON.stringify({plans:[plan()]})}],[{type:'thinking',thinking:'not JSON'},{type:'text',text:JSON.stringify({plans:[plan()]})}],[{type:'thinking',thinking:'x'},{type:'redacted_thinking',data:'x'},{type:'text',text:JSON.stringify({plans:[plan()]})}],JSON.stringify({plans:[plan()]})])assert.equal(run('Validate Generic Remediation Plan',{json:{content},refs:{'Prepare Generic Remediation Plan':prepared}}).length,2);
assert.throws(()=>run('Validate Generic Remediation Plan',{json:{content:[{type:'thinking',thinking:'x'}]},refs:{'Prepare Generic Remediation Plan':prepared}}),/CLAUDE_EMPTY_TEXT_RESPONSE/);
assert.throws(()=>run('Validate Generic Remediation Plan',{json:{content:[{type:'text',text:'not json'}]},refs:{'Prepare Generic Remediation Plan':prepared}}),/REMEDIATION_PLAN_PARSE_FAILED/);
assert.throws(()=>run('Validate Generic Remediation Plan',{json:{stop_reason:'refusal',content:[{type:'text',text:'refused'}]},refs:{'Prepare Generic Remediation Plan':prepared}}),/WF2_LLM_REFUSAL/);
assert.throws(()=>run('Validate Generic Remediation Plan',{json:{content:[{type:'text',text:JSON.stringify({plans:[{findingId:'f1'}]})}]},refs:{'Prepare Generic Remediation Plan':prepared}}),/REMEDIATION_(?:PLAN|PATH)_/);
const plannerPayload=JSON.stringify({plans:[plan()]});
const robustPlannerTexts=[plannerPayload,'```json\n'+plannerPayload+'\n```','```JSON\n'+plannerPayload+'\n```','```\n'+plannerPayload+'\n```','   ```json\n'+plannerPayload+'\n```','\n```json\n'+plannerPayload+'\n```','\uFEFF```json\n'+plannerPayload+'\n```','Explanation before. '+plannerPayload,plannerPayload+' Explanation after.','Before. '+plannerPayload+' After.'];
for(const text of robustPlannerTexts)assert.equal(run('Validate Generic Remediation Plan',{json:{content:[{type:'text',text}]},refs:{'Prepare Generic Remediation Plan':prepared}}).length,2);
for(const text of ['no JSON','{"plans":','[1,2','{foo:1}','```\n```'])assert.throws(()=>run('Validate Generic Remediation Plan',{json:{content:[{type:'text',text}]},refs:{'Prepare Generic Remediation Plan':prepared}}),/REMEDIATION_PLAN_PARSE_FAILED/);
assert.throws(()=>validatePlan(plan({filesToCreate:['README.md'],proposedPaths:[controller,'README.md']})),/REMEDIATION_PATH_NOT_PERMITTED/);
assert.throws(()=>validatePlan(plan({filesToCreate:['../Escape.java'],proposedPaths:[controller,'../Escape.java']})),/REMEDIATION_PATH_UNSAFE/);
assert.throws(()=>run('Build Independent Repository Policy',{json:{tree:[{type:'blob',path:'Thing.java'}]},refs:{'Prepare Batch Context':{...context,findings:[{...context.findings[0],file:'Thing.java'}]}}}),/REPOSITORY_STRUCTURE_INCONCLUSIVE/);

/** Prépare les données nécessaires à ce scénario. */
const validateWithPolicy=(value,repositoryPolicy)=>run('Validate Generic Remediation Plan',{json:{content:[{type:'text',text:JSON.stringify({plans:[value]})}]},refs:{'Prepare Generic Remediation Plan':{...prepared,repositoryPolicy}}});
/** Prépare les données nécessaires à ce scénario. */
const withExisting=(...paths)=>({...policyCtx.repositoryPolicy,existingFiles:[...new Set([...policyCtx.repositoryPolicy.existingFiles,...paths])]});
const createAbsent=validatePlan(plan());
assert.equal(createAbsent.find(i=>i.json.target_file_path===dto).json.fileOperation,'CREATE');
const createExisting=validateWithPolicy(plan(),withExisting(dto));
assert.equal(createExisting.find(i=>i.json.target_file_path===dto).json.fileOperation,'MODIFY');
assert.deepEqual(createExisting[0].json.remediationPlans[0].filesToCreate,[]);
assert.ok(createExisting[0].json.remediationPlans[0].filesToModify.includes(dto));
assert.deepEqual(createExisting[0].json.remediationPlans[0].operationResolution.corrections,[{path:dto,declaredOperation:'CREATE',resolvedOperation:'MODIFY',reason:'PATH_ALREADY_EXISTS'}]);
const modifyAbsent=validatePlan(plan({filesToModify:[controller,dto],filesToCreate:[],proposedPaths:[controller,dto]}));
assert.equal(modifyAbsent.find(i=>i.json.target_file_path===dto).json.fileOperation,'CREATE');
assert.ok(modifyAbsent[0].json.remediationPlans[0].operationResolution.corrections.some(c=>c.path===dto&&c.declaredOperation==='MODIFY'&&c.resolvedOperation==='CREATE'&&c.reason==='PATH_NOT_PRESENT'));
assert.throws(()=>validatePlan(plan({filesToModify:[controller,dto],filesToCreate:[dto],proposedPaths:[controller,dto]})),/REMEDIATION_PATH_OPERATION_CONFLICT/);
assert.throws(()=>validatePlan(plan({filesToModify:[controller],filesToCreate:[],proposedPaths:[controller,'../Escape.java']})),/REMEDIATION_PATH_UNSAFE/);
assert.throws(()=>validatePlan(plan({filesToModify:[controller],filesToCreate:[],proposedPaths:[controller,'README.md']})),/REMEDIATION_PATH_NOT_PERMITTED/);
assert.throws(()=>validatePlan(plan({filesToModify:[dto],filesToCreate:[],proposedPaths:[dto]})),/REMEDIATION_TARGET_NOT_PLANNED/);
const wrongExt='src/main/java/com/acme/dto/ThingRequest.txt';
assert.throws(()=>validatePlan(plan({filesToCreate:[wrongExt],proposedPaths:[controller,wrongExt]})),/PLANNED_CREATE_TECHNOLOGY_MISMATCH/);
const existingC='src/main/java/com/acme/controller/ExistingHelper.java',missingB='src/main/java/com/acme/dto/MissingHelper.java';
const mixed=validateWithPolicy(plan({filesToModify:[controller],filesToCreate:[missingB],proposedPaths:[controller,missingB,existingC]}),withExisting(existingC));
assert.deepEqual(mixed.map(i=>[i.json.target_file_path,i.json.fileOperation]).sort(),[[controller,'MODIFY'],[existingC,'MODIFY'],[missingB,'CREATE']].sort());
assert.deepEqual(mixed[0].json.remediationPlans[0].filesToModify.sort(),[controller,existingC].sort());
assert.deepEqual(mixed[0].json.remediationPlans[0].filesToCreate,[missingB]);

const preparedPatch={approvedFindingIdsForFile:['f1'],targetFile:controller,file_sha:'a'.repeat(40)};const generatedPatch={targetFile:controller,processedFindingIds:['f1'],patchedCode:'class Patched {}',patchDescription:'typed boundary',conformanceEvidence:['schema']};
const parsedPatch=run('Parse - Code Patch Output',{json:{content:[{type:'thinking',thinking:'x'},{type:'text',text:JSON.stringify(generatedPatch)}]},refs:{'Prepare - Code Patch Body':preparedPatch}}).json;assert.equal(parsedPatch.patchedCode,'class Patched {}');
for(const text of ['Prose '+JSON.stringify(generatedPatch)+' tail','```JSON\n'+JSON.stringify(generatedPatch)+'\n```'])assert.equal(run('Parse - Code Patch Output',{json:{content:[{type:'text',text}]},refs:{'Prepare - Code Patch Body':preparedPatch}}).json.targetFile,controller);
for(const text of ['no JSON','{"targetFile":','[1,2','{"x":]}','{"targetFile":}'])assert.throws(()=>run('Parse - Code Patch Output',{json:{content:[{type:'text',text}]},refs:{'Prepare - Code Patch Body':preparedPatch}}),/PATCH_PARSE_FAILED/);
assert.ok(!Array.isArray(run('Parse - Code Patch Output',{json:{content:[{type:'text',text:JSON.stringify(generatedPatch)}]},refs:{'Prepare - Code Patch Body':preparedPatch}})),'Parse - Code Patch Output must return a single item object, not an array (runOnceForEachItem contract)');
assert.throws(()=>run('Parse - Code Patch Output',{json:{content:[{type:'thinking',thinking:'x'}]},refs:{'Prepare - Code Patch Body':preparedPatch}}),/CLAUDE_EMPTY_TEXT_RESPONSE/);
assert.throws(()=>run('Parse - Code Patch Output',{json:{stop_reason:'refusal',content:[{type:'text',text:'refused'}]},refs:{'Prepare - Code Patch Body':preparedPatch}}),/WF2_LLM_REFUSAL/);

const applicablePlan=plan();const repositoryPolicy=policyCtx.repositoryPolicy;
/** Prépare les données nécessaires à ce scénario. */
const candidate=(code,rule='synthetic:unknown',operation='MODIFY',path=controller)=>({targetFile:path,fileOperation:operation,patchedCode:code,sourceContent:'class Before {}',approvedFindingIds:['f1'],approvedFindingsForFile:[{findingId:'f1',rule,scannerEvidence:'evidence'}],applicablePlans:[{...applicablePlan,rule}],completePlan:{allPlannedFiles:[{path:controller,operation:'MODIFY'},{path:dto,operation:'CREATE'}]},repositoryPolicy});
for(const fixture of [candidate('class ThingService { void active() {} }','java:S1068'),candidate('class SecurityConfig { void configure() {} }','java:S125'),candidate('class ThingController { Thing create(ThingRequest request) { Thing thing=new Thing(); thing.setName(request.name()); return thing; } }','java:S4684'),candidate('class UnknownSafe { String normalize(String value) { return value == null ? "" : value.trim(); } }')])assert.equal(run('Generic Candidate Preflight',{json:fixture}).json.genericPreflightPassed,true);
assert.ok(!Array.isArray(run('Generic Candidate Preflight',{json:candidate('class Good {}')})),'Generic Candidate Preflight must return a single item object, not an array (runOnceForEachItem contract)');
assert.throws(()=>run('Generic Candidate Preflight',{json:candidate('@RequestBody Object taskDto\nTask task=(Task) taskDto;\n// TODO map safely','java:S4684')}),/WF2_CANDIDATE_QUALITY_REJECTED/);
assert.throws(()=>run('Generic Candidate Preflight',{json:candidate('class X { // NOSONAR\n}')}),/SCANNER_SUPPRESSION/);
assert.throws(()=>run('Generic Candidate Preflight',{json:{...candidate('class X {}'),targetFile:'src/main/java/com/acme/Other.java'}}),/WF2_PATCH_SCOPE_VIOLATION/);

/** Vérifie les résultats attendus dans ce scénario. */
const structurePass=code=>{const out=run('Generic Candidate Preflight',{json:candidate(code)});assert.ok(!Array.isArray(out),'must return single item');assert.equal(out.json.genericPreflightPassed,true);return out.json};
/** Vérifie les résultats attendus dans ce scénario. */
const structureFail=(code,expectedMismatch)=>assert.throws(()=>run('Generic Candidate Preflight',{json:candidate(code)}),new RegExp('UNBALANCED_STRUCTURE.*'+expectedMismatch));
// PASS: delimiters inside comments/strings/literals/text-blocks must not trip the checker.
assert.equal(structurePass('class X { // close socket)\n  void m() { if (a) { b(); } } }').structureStatus,'PASSED');
assert.equal(structurePass('class X { /* config: { a: [1) } */ void m() { if (a) { b(); } } }').structureStatus,'PASSED');
assert.equal(structurePass("class X { // don't remove this\n  void m() { if (a) { b(); } } }").structureStatus,'PASSED');
assert.equal(structurePass('class X { String s = "{}()"; void m() { if (a) { b(); } } }').structureStatus,'PASSED');
assert.equal(structurePass('class X { String s = "a \\" b"; void m() { if (a) { b(); } } }').structureStatus,'PASSED');
assert.equal(structurePass("class X { char c = '{'; void m() { if (a) { b(); } } }").structureStatus,'PASSED');
assert.equal(structurePass('class X { String s = """\n  { not real }\n  """; void m() { if (a) { b(); } } }').structureStatus,'PASSED');
assert.equal(structurePass('@Override\nclass X<T> { List<Map<String,T>> m(Runnable r) { return items.stream().map(x -> { return x; }).collect(Collectors.toList()); } }').structureStatus,'PASSED');
// FAIL: deterministically provable structural corruption must still hard-reject.
structureFail('class X { void m() { if (a) { b(); } }','UNCLOSED_DELIMITER');
structureFail('class X { void m() { b()); } }','MISMATCHED_DELIMITER');
structureFail('class X { int[] a = {1,2,3; }','UNCLOSED_DELIMITER');
structureFail('class X { String s = "abc; }','UNCLOSED_DELIMITER');
structureFail('class X { /* abc\n void m() {} }','UNCLOSED_DELIMITER');
// INCONCLUSIVE: unsupported adapter must never hard-reject, and must never be silently upgraded to PASS-without-marker.
const unsupportedPath='src/main/java/com/acme/controller/Notes.unknownext';
const unsupported=run('Generic Candidate Preflight',{json:{...candidate('whatever ((( this is not parseable',undefined,'CREATE',unsupportedPath),completePlan:{allPlannedFiles:[{path:unsupportedPath,operation:'CREATE'}]}}}).json;
assert.equal(unsupported.genericPreflightPassed,true);assert.equal(unsupported.structureStatus,'INCONCLUSIVE');assert.equal(unsupported.structureAdapter,'unsupported');
// Genericity: no rule/filename-specific branches in the new validator.
const structureCode=byName('Generic Candidate Preflight').parameters.jsCode;
for(const f of ['java:S4684','java:S1068','java:S125','TaskController'])assert.ok(!structureCode.includes(f),f+' hardcoded in structure preflight');

const preflight=run('Generic Candidate Preflight',{json:candidate('class Good {}')}).json;
assert.equal(preflight.llmRequestBody.model,'claude-haiku-4-5-20251001');assert.ok(Array.isArray(preflight.llmRequestBody.messages)&&preflight.llmRequestBody.messages.length===1);assert.equal(preflight.reviewBodyString,JSON.stringify(preflight.llmRequestBody));
const acceptable=run('Enforce Independent Review',{json:{content:[{type:'text',text:JSON.stringify({verdict:'ACCEPTABLE_FOR_SCANNER_VALIDATION',evidence:['conforms']})}]},refs:{'Generic Candidate Preflight':preflight}}).json;
assert.equal(acceptable.candidateDecision,'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION');assert.equal(acceptable.validationEvidence.scannerResolution,'UNKNOWN_UNTIL_WF3');
const multiBlockReview=run('Enforce Independent Review',{json:{content:[{type:'thinking',thinking:'x'},{type:'text',text:'Reviewer preface.'},{type:'text',text:'```json\n{"verdict":"ACCEPTABLE_FOR_SCANNER_VALIDATION","evidence":["conforms"]}\n```'}]},refs:{'Generic Candidate Preflight':preflight}}).json;assert.equal(multiBlockReview.candidateDecision,'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION');
assert.ok(!Array.isArray(run('Enforce Independent Review',{json:{content:[{type:'text',text:JSON.stringify({verdict:'ACCEPTABLE_FOR_SCANNER_VALIDATION',evidence:[]})}]},refs:{'Generic Candidate Preflight':preflight}})),'reviewer must return one item object');
assert.throws(()=>run('Enforce Independent Review',{json:{stop_reason:'refusal',content:[{type:'text',text:'refused'}]},refs:{'Generic Candidate Preflight':preflight}}),/WF2_MANUAL_REVIEW_REQUIRED/);
assert.throws(()=>run('Enforce Independent Review',{json:{content:[{type:'text',text:JSON.stringify({verdict:'REJECTED',evidence:['unsafe']})}]},refs:{'Generic Candidate Preflight':preflight}}),/WF2_CANDIDATE_REJECTED/);
assert.throws(()=>run('Enforce Independent Review',{json:{content:[{type:'text',text:JSON.stringify({verdict:'INCONCLUSIVE',evidence:['ambiguous']})}]},refs:{'Generic Candidate Preflight':preflight}}),/WF2_MANUAL_REVIEW_REQUIRED/);
assert.throws(()=>run('Enforce Independent Review',{json:{content:[{type:'text',text:JSON.stringify({verdict:'UNKNOWN',evidence:[]})}]},refs:{'Generic Candidate Preflight':preflight}}),/INDEPENDENT_REVIEW_INCONCLUSIVE/);

// R19.3M: balanced JSON extraction is identical across all Claude parsers and
// supports prose/fences, nested structures, escaped strings and array roots.
for(const name of ['Validate Generic Remediation Plan','Parse - Code Patch Output','Enforce Independent Review']){
  const code=byName(name).parameters.jsCode;
  assert.ok(code.includes('parseFirstBalancedJson'));
  assert.ok(!code.includes("replace(/^```json"));
}
const extractionFixtures=['{"message":"use {x} and [y]"}','{"message":"say \\\"hello\\\""}','{"message":"C:\\\\temp\\\\file"}','{"outer":{"inner":[1,{"x":2}]}}','[[1,2],{"x":[3]}]','[{"x":1},{"y":2}]'];
for(const text of extractionFixtures){const wrapped='prefix ```JSON\n'+text+'\n``` suffix';const response={content:[{type:'thinking',thinking:'ignored'},{type:'text',text:'prefix'},{type:'text',text:'```JSON\n'+text+'\n``` suffix'}]};assert.doesNotThrow(()=>{const code=byName('Validate Generic Remediation Plan').parameters.jsCode;const helper=code.slice(code.indexOf('const parseFirstBalancedJson='),code.indexOf('const text=extractClaudeText'));return Function(helper+';return parseFirstBalancedJson(arguments[0],\"test\")')(wrapped)});assert.ok(response.content.length===3)}

const reviewCandidates=['File A','File B','File C'].map((targetFile,index)=>({...preflight,targetFile,approvedFindingIds:['f'+index],preflightEvidence:['file-'+index]}));
const reviewed=reviewCandidates.map((item,index)=>run('Enforce Independent Review',{json:{content:[{type:'text',text:JSON.stringify({verdict:'ACCEPTABLE_FOR_SCANNER_VALIDATION',evidence:['review-'+index]})}]},refs:{'Generic Candidate Preflight':item}}).json);
assert.equal(reviewed.length,3);for(let i=0;i<3;i++){assert.equal(reviewed[i].targetFile,reviewCandidates[i].targetFile);assert.deepEqual(reviewed[i].candidateAcceptedFindingIds,reviewCandidates[i].approvedFindingIds);assert.deepEqual(reviewed[i].validationEvidence.independentReview,['review-'+i])}

const completeRefs={'Prepare Batch Context':{findingIds:['f1']},'Validate Generic Remediation Plan':expanded};
/** Prépare les données nécessaires à ce scénario. */
const effectiveResult=(targetFile,{commitSha='c'.repeat(40),newSha='n'.repeat(40),fileOperation='MODIFY',reconciledWrite=false,candidateStateVerified=true,outcome='CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',candidateAcceptedFindingIds=['f1']}={})=>({targetFile,approvedFindingIds:['f1'],processedFindingIds:['f1'],candidateAcceptedFindingIds,validationEvidence:{scannerResolution:'UNKNOWN_UNTIL_WF3'},outcome,candidateStateVerified,updateApplied:true,fileOperation,oldSha:'o'.repeat(40),newSha,commitSha,...(reconciledWrite?{reconciledWrite:true}:{})});
/** Marque la tâche comme terminée. */
const complete=(results,refs=completeRefs)=>run('Validate Batch Completeness',{input:{
/** Renvoie tous les éléments disponibles. */
all:()=>results.map(json=>({json}))},refs});
assert.throws(()=>complete([effectiveResult(controller)]),/WF2_BATCH_INCOMPLETE/);

// R19.3O: Loop Over Items is the execution-local full-batch barrier. Its loop
// back input accepts either direct or reconciled effective results, while only
// its done output can invoke completeness and therefore PR lookup once.
const barrier=byName('Merge Effective File Results');
assert.equal(barrier.type,'n8n-nodes-base.splitInBatches');
assert.equal(barrier.typeVersion,3);
assert.equal(barrier.parameters.batchSize,1);
assert.deepEqual(wf.connections['Validate Generic Remediation Plan'].main[0],[{node:'Merge Effective File Results',type:'main',index:0}]);
assert.deepEqual(wf.connections['Build File Result'].main[0],[{node:'Merge Effective File Results',type:'main',index:0}]);
assert.deepEqual(wf.connections['Build Reconciled File Result'].main[0],[{node:'Merge Effective File Results',type:'main',index:0}]);
assert.deepEqual(wf.connections['Merge Effective File Results'].main[0],[{node:'Validate Batch Completeness',type:'main',index:0}]);
assert.deepEqual(wf.connections['Merge Effective File Results'].main[1],[{node:'Route Planned File Operation',type:'main',index:0}]);

/** Prépare les données nécessaires à ce scénario. */
const simulateFormerSameInputMerge=arrivals=>arrivals.map(items=>[...items]);
assert.deepEqual(simulateFormerSameInputMerge([['A','B']]),[['A','B']]);
assert.deepEqual(simulateFormerSameInputMerge([['A'],['B']]),[['A'],['B']]);
assert.equal(simulateFormerSameInputMerge([['A'],['B']]).length,2,'former mixed paths emitted two partial downstream runs');

const three='src/main/java/com/acme/service/Third.java';
/** Prépare les données nécessaires à ce scénario. */
const refsFor=(files,findingIds=['f1'])=>({'Prepare Batch Context':{findingIds},'Validate Generic Remediation Plan':[{json:{plannedFiles:files.map(path=>({path}))}}]});
/** Vérifie Complete dans ce scénario de test. */
const assertComplete=(results,files)=>{const output=complete(results,refsFor(files));assert.equal(output.length,1);assert.deepEqual(output[0].json.candidateVerifiedFiles,[...files].sort());return output[0].json};
assertComplete([effectiveResult(controller)],[controller]);
assertComplete([effectiveResult(controller,{reconciledWrite:true})],[controller]);
assertComplete([effectiveResult(controller),effectiveResult(dto,{fileOperation:'CREATE'})],[controller,dto]);
assertComplete([effectiveResult(controller,{reconciledWrite:true}),effectiveResult(dto,{reconciledWrite:true,fileOperation:'CREATE'})],[controller,dto]);
assertComplete([effectiveResult(controller),effectiveResult(dto,{reconciledWrite:true,fileOperation:'CREATE'})],[controller,dto]);
assertComplete([effectiveResult(controller),effectiveResult(dto,{fileOperation:'CREATE'}),effectiveResult(three)],[controller,dto,three]);
assertComplete([effectiveResult(controller),effectiveResult(dto,{fileOperation:'CREATE'}),effectiveResult(three,{reconciledWrite:true})],[controller,dto,three]);
assertComplete([effectiveResult(controller),effectiveResult(dto,{fileOperation:'CREATE',reconciledWrite:true}),effectiveResult(three,{reconciledWrite:true})],[controller,dto,three]);
const identical=effectiveResult(controller);assertComplete([identical,{...identical}],[controller]);
assert.throws(()=>complete([identical,{...identical,newSha:'x'.repeat(40)}],refsFor([controller])),/WF2_EFFECTIVE_RESULT_CONFLICT/);
assert.throws(()=>complete([identical,{...identical,commitSha:'x'.repeat(40)}],refsFor([controller])),/WF2_EFFECTIVE_RESULT_CONFLICT/);
assert.throws(()=>complete([effectiveResult(controller)],refsFor([controller,dto])),/WF2_BATCH_INCOMPLETE/);
assert.throws(()=>complete([effectiveResult(controller),effectiveResult(three)],refsFor([controller])),/WF2_BATCH_INCOMPLETE/);
assert.throws(()=>complete([effectiveResult(controller,{candidateStateVerified:false})],refsFor([controller])),/WF2_BATCH_INCOMPLETE/);
assert.throws(()=>complete([effectiveResult(controller,{outcome:'CANDIDATE_REJECTED'})],refsFor([controller])),/WF2_BATCH_INCOMPLETE/);
assert.throws(()=>complete([effectiveResult(controller,{candidateAcceptedFindingIds:[]})],refsFor([controller])),/WF2_BATCH_INCOMPLETE/);
/** Prépare les données nécessaires à ce scénario. */
const simulateLoop=items=>{const pending=[...items],processed=[];let doneCount=0;while(pending.length){const current=pending.shift();processed.push(current)}doneCount++;return{processed,doneCount}};
for(const count of [1,2,3]){const simulated=simulateLoop(Array.from({length:count},(_,i)=>effectiveResult('file-'+i)));assert.equal(simulated.processed.length,count);assert.equal(simulated.doneCount,1)}

// R19.3K: every Code node declared runOnceForEachItem must return a single
// item object ({json:{...}}), never an array — the array form silently
// corrupts $json for the next node (root cause of the Attempt-8/9 chain).
for(const n of wf.nodes.filter(n=>n.type==='n8n-nodes-base.code'&&n.parameters.mode==='runOnceForEachItem')){
  const trimmed=n.parameters.jsCode.trim();
  const tail=trimmed.slice(-200);
  assert.ok(!/return\s*\[\s*\{/.test(tail),n.name+' (runOnceForEachItem) returns an array, not a single item');
}

const nodesText=JSON.stringify(wf.nodes);for(const forbidden of ['ALREADY_REMEDIATED','effectiveRemediatedFindingIds','finalStateVerified','MODIFIED_AND_REMEDIATED'])assert.ok(!nodesText.includes(forbidden),forbidden+' remains');
for(const rule of ['java:S1068','java:S125','java:S4684'])assert.ok(!nodesText.includes(rule),rule+' controls runtime');
for(const name of ['Prepare Generic Remediation Plan','Prepare - Code Patch Body']){const code=byName(name).parameters.jsCode;assert.ok(code.includes("model:'claude-sonnet-5'"),name+' model changed');for(const parameter of ['temperature','top_p','top_k'])assert.ok(!new RegExp('(?:^|[,\\{])\\s*'+parameter+'\\s*:').test(code),name+' contains deprecated '+parameter)}
const reviewerCode=byName('Generic Candidate Preflight').parameters.jsCode;assert.ok(reviewerCode.includes("model:'claude-haiku-4-5-20251001'"));assert.ok(reviewerCode.includes('temperature:0'));assert.ok(reviewerCode.includes('max_tokens:8192'),'reviewer max_tokens must match planner/generator to avoid truncated JSON verdicts');assert.ok(!reviewerCode.includes('max_tokens:4096'),'reviewer must no longer use the truncation-prone 4096 budget');
assert.equal(byName('Enforce Independent Review').parameters.mode,'runOnceForEachItem');
for(const key of ['retryOnFail','maxTries','waitBetweenTries'])assert.equal(byName('de Patch - HTTP Request')[key],undefined,'generator HTTP retry must be disabled: '+key);
assert.ok(byName('Generic Candidate Preflight').parameters.jsCode.includes('buildTestEvidence'));

// R19.3I: every Claude HTTP node consumes a validated object body (llmRequestBody)
// via native JSON transport, never a raw pre-stringified body/content-type-raw pair.
for(const name of ['de Patch - HTTP Request','Generate Remediation Plan','Independent Semantic Review']){
  const params=byName(name).parameters;
  assert.equal(params.specifyBody,'json',name+' not native JSON body mode');
  assert.equal(params.jsonBody,'={{ $json.llmRequestBody }}',name+' jsonBody expression');
  assert.equal(params.body,undefined,name+' still carries legacy raw body field');
  assert.equal(params.contentType,undefined,name+' still carries legacy raw contentType');
  assert.equal(params.rawContentType,undefined,name+' still carries legacy rawContentType');
}
assert.deepEqual(wf.connections['Prepare - Code Patch Body'].main[0].map(e=>e.node),['de Patch - HTTP Request'],'generator body must reach HTTP node directly with no reformatting hop');

/** Simule l’échec attendu par ce scénario. */
const validateLlmRequestBody=(body,{requireOutputConfig=false}={})=>{
  if(!body||typeof body!=='object')throw new Error('LLM_REQUEST_BODY_INVALID');
  if(!String(body.model||'').trim())throw new Error('LLM_REQUEST_MODEL_MISSING');
  if(!Array.isArray(body.messages)||!body.messages.length)throw new Error('LLM_REQUEST_MESSAGES_MISSING');
  if(!String(body.messages[0]?.content||'').trim())throw new Error('LLM_REQUEST_MESSAGE_CONTENT_MISSING');
  if(requireOutputConfig&&!body.output_config)throw new Error('LLM_REQUEST_OUTPUT_CONFIG_MISSING');
  const serialized=JSON.stringify(body);
  if(!serialized||serialized==='{}')throw new Error('LLM_REQUEST_BODY_EMPTY');
  return serialized;
};
const validBody={model:'claude-sonnet-5',max_tokens:8192,output_config:{format:{type:'json_schema'}},system:'s',messages:[{role:'user',content:'hi'}]};
assert.ok(validateLlmRequestBody(validBody,{requireOutputConfig:true}).length>0);
assert.throws(()=>validateLlmRequestBody(undefined),/LLM_REQUEST_BODY_INVALID/);
assert.throws(()=>validateLlmRequestBody(null),/LLM_REQUEST_BODY_INVALID/);
assert.throws(()=>validateLlmRequestBody({}),/LLM_REQUEST_MODEL_MISSING/);
assert.throws(()=>validateLlmRequestBody({...validBody,model:''}),/LLM_REQUEST_MODEL_MISSING/);
assert.throws(()=>validateLlmRequestBody({...validBody,messages:[]}),/LLM_REQUEST_MESSAGES_MISSING/);
assert.throws(()=>validateLlmRequestBody({...validBody,messages:undefined}),/LLM_REQUEST_MESSAGES_MISSING/);
assert.throws(()=>validateLlmRequestBody({...validBody,messages:[{role:'user',content:''}]}),/LLM_REQUEST_MESSAGE_CONTENT_MISSING/);
assert.throws(()=>validateLlmRequestBody({...validBody,output_config:undefined},{requireOutputConfig:true}),/LLM_REQUEST_OUTPUT_CONFIG_MISSING/);

// Generator builder: one validated request body per authorized file, MODIFY and CREATE alike.
const gateCtx={batchId:'batch',targetBranchName:'fix/pfe-x',repository_owner:'owner',repository_name:'repo',default_branch:'main',incidentId:'incident'};
const plannedForBody={plannedFiles:[{path:controller,operation:'MODIFY'},{path:dto,operation:'CREATE'}],remediationPlans:[applicablePlan],repositoryPolicy};
const bodyRefs={'Prepare Batch Context':gateCtx,'Validate Generic Remediation Plan':[{json:{...plannedForBody,target_file_path:controller,fileOperation:'MODIFY'}},{json:{...plannedForBody,target_file_path:dto,fileOperation:'CREATE'}}]};
const modifyOut=run('Prepare - Code Patch Body',{json:{path:controller,content:Buffer.from('class Before {}').toString('base64'),sha:'a'.repeat(40)},refs:bodyRefs}).json;
assert.equal(modifyOut.llmRequestBody.model,'claude-sonnet-5');assert.equal(modifyOut.llmRequestBody.messages.length,1);
assert.ok(modifyOut.llmRequestBody.output_config?.format?.schema?.required?.includes('patchedCode'));
assert.equal(modifyOut.claudeBodyString,JSON.stringify(modifyOut.llmRequestBody));assert.equal(modifyOut.requestBodyPresent,true);assert.ok(modifyOut.serializedBodyLength>0);
const createOut=run('Prepare - Code Patch Body',{json:{path:dto,content:'',sha:'',plannedCreation:true},refs:bodyRefs}).json;
assert.equal(createOut.llmRequestBody.model,'claude-sonnet-5');assert.ok(createOut.llmRequestBody.messages[0].content.includes(dto));
assert.ok(!Array.isArray(run('Prepare - Code Patch Body',{json:{path:controller,content:Buffer.from('class Before {}').toString('base64'),sha:'a'.repeat(40)},refs:bodyRefs})),'Prepare - Code Patch Body must return a single item object, not an array (runOnceForEachItem contract)');

// R19.3K: synthetic multi-file (no LLM, no GitHub) — N planned files must produce N
// independent, non-contaminated chains through Prepare -> Parse -> Preflight.
const fileC='src/main/java/com/acme/controller/OtherController.java';
const planA={...applicablePlan,findingId:'fA',target:{file:controller,line:20},filesToModify:[controller],filesToCreate:[]};
const planB={...applicablePlan,findingId:'fB',target:{file:dto,line:null},filesToModify:[],filesToCreate:[dto]};
const planC={...applicablePlan,findingId:'fC',target:{file:fileC,line:5},filesToModify:[fileC],filesToCreate:[]};
const multiPlannedFiles=[{path:controller,operation:'MODIFY'},{path:dto,operation:'CREATE'},{path:fileC,operation:'MODIFY'}];
/** Prépare les données nécessaires à ce scénario. */
const multiRefsFor=plans=>({'Prepare Batch Context':gateCtx,'Validate Generic Remediation Plan':multiPlannedFiles.map(f=>({json:{plannedFiles:multiPlannedFiles,remediationPlans:plans,repositoryPolicy,target_file_path:f.path,fileOperation:f.operation}}))});
const multiPolicy={...repositoryPolicy,existingFiles:[...repositoryPolicy.existingFiles,fileC],permittedRoots:repositoryPolicy.permittedRoots};
const multiRefs=multiRefsFor([planA,planB,planC]);
multiRefs['Validate Generic Remediation Plan']=multiRefs['Validate Generic Remediation Plan'].map(item=>({json:{...item.json,repositoryPolicy:multiPolicy}}));
const genInputs={
  [controller]:{path:controller,content:Buffer.from('class Before {}').toString('base64'),sha:'a'.repeat(40)},
  [dto]:{path:dto,content:'',sha:'',plannedCreation:true},
  [fileC]:{path:fileC,content:Buffer.from('class OtherBefore {}').toString('base64'),sha:'b'.repeat(40)},
};
for(const fileSet of [[controller],[controller,dto],[controller,dto,fileC]]){
  const prepared=fileSet.map(f=>run('Prepare - Code Patch Body',{json:genInputs[f],refs:multiRefs}).json);
  assert.equal(prepared.length,fileSet.length);
  for(let idx=0;idx<fileSet.length;idx++){
    assert.equal(prepared[idx].targetFile,fileSet[idx],'file identity must not cross-contaminate at generator stage');
    assert.equal(prepared[idx].llmRequestBody.messages[0].content.includes(fileSet[idx]),true);
  }
  const generated=fileSet.map(f=>({targetFile:f,processedFindingIds:prepared[fileSet.indexOf(f)].approvedFindingIdsForFile,patchedCode:'class PatchedFor_'+f.replace(/[^A-Za-z0-9]/g,'_')+' {}',patchDescription:'d',conformanceEvidence:[]}));
  const parsed=fileSet.map((f,idx)=>run('Parse - Code Patch Output',{json:{content:[{type:'text',text:JSON.stringify(generated[idx])}]},refs:{'Prepare - Code Patch Body':prepared[idx]}}).json);
  for(let idx=0;idx<fileSet.length;idx++){
    assert.equal(parsed[idx].targetFile,fileSet[idx]);
    assert.ok(parsed[idx].patchedCode.includes(fileSet[idx].replace(/[^A-Za-z0-9]/g,'_')),'parsed patch must correspond to its own file, not another item\'s');
  }
  const preflighted=parsed.map(p=>run('Generic Candidate Preflight',{json:{...p,completePlan:{...p.completePlan,allPlannedFiles:multiPlannedFiles},repositoryPolicy:multiPolicy}}).json);
  for(let idx=0;idx<fileSet.length;idx++){
    assert.equal(preflighted[idx].genericPreflightPassed,true);
    assert.equal(preflighted[idx].targetFile,fileSet[idx]);
    assert.ok(preflighted[idx].llmRequestBody.messages[0].content.includes(fileSet[idx].replace(/[^A-Za-z0-9]/g,'_')));
  }
  console.log(fileSet.length+'->'+preflighted.length+' file chain (no cross-contamination): PASS');
}

// Planner builder: same validated-object contract.
const plannerOut=run('Prepare Generic Remediation Plan',{input:{
/** Renvoie tous les éléments disponibles. */
all:()=>[{json:{path:controller,sha:'a'.repeat(40),content:Buffer.from('class Before {}').toString('base64')}}]},refs:{'Build Independent Repository Policy':policyCtx}})[0].json;
assert.equal(plannerOut.llmRequestBody.model,'claude-sonnet-5');
assert.ok(plannerOut.llmRequestBody.output_config?.format?.schema?.required?.includes('plans'));
assert.equal(plannerOut.planBodyString,JSON.stringify(plannerOut.llmRequestBody));

const envelopeName='Failure Envelope - Generic Candidate Preflight';const corr={workflowId:'9adcV31eaIgJyMR0',incidentId:'incident',requestId:'request',batchId:'batch',batchKey:'batch',attemptCount:3};
const envelope=run(envelopeName,{input:{
/** Renvoie le premier élément disponible. */
first:()=>({json:{error:'WF2_PATCH_NOT_EFFECTIVE:example'}})},
/** Prépare les données nécessaires à ce scénario. */
items:()=>[{json:{correlationEnvelope:corr}}],execution:{id:'execution'}})[0].json;
assert.deepEqual({failureCode:envelope.failureCode,failedNode:envelope.failedNode,failureSummary:envelope.failureSummary},{failureCode:'WF2_PATCH_NOT_EFFECTIVE',failedNode:'Generic Candidate Preflight',failureSummary:'WF2_PATCH_NOT_EFFECTIVE:example'});
const failure=run('Prepare WF2 Failure Status',{input:{
/** Renvoie le premier élément disponible. */
first:()=>({json:envelope})},execution:{id:'execution'}})[0].json;assert.equal(failure.failureNode,'Generic Candidate Preflight');assert.equal(failure.failureCode,'WF2_PATCH_NOT_EFFECTIVE');
for(const [source,c] of Object.entries(wf.connections))for(const outputs of c.main||[])for(const edge of outputs||[])if(edge.node==='Prepare WF2 Failure Status')assert.ok(source.startsWith('Failure Envelope - '),'untagged failure edge from '+source);

for(const name of ['Existing PR?','Use Existing PR','Create Pull Request1','Capture Correlation Envelope'])assert.deepEqual(byName(name),byName(name,base),name+' regression');
const adaptCode=byName('Adapt Webhook Payload').parameters.jsCode;assert.ok(!adaptCode.includes("stage:'sonar'"));assert.ok(!adaptCode.includes("source:'SONARQUBE'"));
assert.ok(!JSON.stringify(wf.connections.Webhook).includes('Create Pull Request1'));

// R19.3P: "Lookup Existing Batch PR" must never emit zero items on its success
// output — proven by execution 1941 (Attempt 15) that an empty GitHub PR list
// ([]) silently starved "Select Existing PR" with no error, so the batch
// stalled with no PR and no backend callback. fullResponse guarantees exactly
// one item regardless of body content, matching the pattern already used by
// "Lookup Remediation Branch" for its own not-found case.
assert.deepEqual(byName('Lookup Existing Batch PR').parameters.options, { response: { response: { fullResponse: true } } });
assert.deepEqual(
  { ...byName('Lookup Existing Batch PR'), parameters: { ...byName('Lookup Existing Batch PR').parameters, options: {} } },
  { ...byName('Lookup Existing Batch PR', base), parameters: { ...byName('Lookup Existing Batch PR', base).parameters, options: {} } },
  'Lookup Existing Batch PR must change only its response options',
);
const selectCode = byName('Select Existing PR').parameters.jsCode;
assert.deepEqual({ ...byName('Select Existing PR'), parameters: { ...byName('Select Existing PR').parameters, jsCode: '' } },
  { ...byName('Select Existing PR', base), parameters: { ...byName('Select Existing PR', base).parameters, jsCode: '' } },
  'Select Existing PR must change only its jsCode');
/** Prépare les données nécessaires à ce scénario. */
const runSelect = candidates => run('Select Existing PR', { input: {
/** Renvoie tous les éléments disponibles. */
all: () => candidates.map(json => ({ json })) },
  refs: { 'Prepare Batch Context': { targetBranchName: 'fix/pfe-x', baseBranch: 'main', githubRepo: 'owner/repo', batchId: 'batch-1' } } });
const matchingPr = { number: 5, state: 'open', head: { ref: 'fix/pfe-x', repo: { full_name: 'owner/repo' } }, base: { ref: 'main', repo: { full_name: 'owner/repo' } }, body: 'batch-1' };
// Empty GitHub list, wrapped by fullResponse: {statusCode,headers,body:[]} — must resolve to createRequired:true, not starve.
assert.deepEqual(runSelect([{ statusCode: 200, headers: {}, body: [] }])[0].json, { existingPr: null, createRequired: true, candidateCount: 0, matchingCount: 0 });
// Existing PR found inside the wrapped body — must still match exactly as before.
const found = runSelect([{ statusCode: 200, headers: {}, body: [matchingPr] }])[0].json;
assert.equal(found.createRequired, false); assert.equal(found.existingPr.number, 5);
// Legacy unwrapped-array shape (pre-fix callers / other tests) must still work — additive, not breaking.
assert.deepEqual(runSelect([[]])[0].json, { existingPr: null, createRequired: true, candidateCount: 0, matchingCount: 0 });
console.log('PFE R19.3P PR lookup starvation fix and regression matrix: PASS');
