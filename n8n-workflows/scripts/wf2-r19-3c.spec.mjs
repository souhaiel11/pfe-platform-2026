import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const draftPath=new URL('../pending-live-update/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.R19_3C-TRUSTED-DRAFT.json',import.meta.url);
const basePath=new URL('../backups/r19-3c-prebuild/wf2-trusted-f95634ef.json',import.meta.url);
const load=path=>{const data=JSON.parse(fs.readFileSync(path));return Array.isArray(data)?data[0]:data};
const wf=load(draftPath),base=load(basePath);const byName=(name,w=wf)=>w.nodes.find(n=>n.name===name);
const run=(name,{json={},input={all:()=>[],first:()=>({json:{}})},refs={},items=()=>[],execution={id:'fixture'},env={N8N_INTERNAL_SECRET:'test-secret'}}={})=>new Function('$json','$input','$','$items','$execution','Buffer','$env',byName(name).parameters.jsCode)(json,input,nodeName=>({first:()=>({json:refs[nodeName]}),item:{json:refs[nodeName]},all:()=>refs[nodeName]}),items,execution,Buffer,env);
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
const adaptInput=body=>({headers:{'x-internal-secret':'test-secret'},body,correlationEnvelope:{incidentId:'incident',projectId:'project',requestId:'request',batchId:'batch',batchKey:'batch',attemptCount:3}});
const adapted=run('Adapt Webhook Payload',{input:{first:()=>({json:adaptInput(adaptBody)})}})[0].json.incidentData;assert.equal(adapted.source,'SAST');assert.equal(adapted.stage,'code-analysis');assert.equal(adapted.findings[0].source,'SAST');
assert.throws(()=>run('Adapt Webhook Payload',{input:{first:()=>({json:adaptInput({...adaptBody,findings:[...adaptBody.findings,{...adaptBody.findings[0],findingId:'f2',source:'CODE'}],findingIds:['f1','f2']})})}}),/WF2_MIXED_SOURCE_BATCH_UNSUPPORTED/);
for(const source of ['JENKINS','DOCKER','INFRA','ADMIN'])assert.throws(()=>run('Adapt Webhook Payload',{input:{first:()=>({json:adaptInput({...adaptBody,findings:[{...adaptBody.findings[0],source}]})})}}),/WF2_SPECIALIST_ROUTE_REQUIRED/);

const controller='src/main/java/com/acme/controller/ThingController.java',dto='src/main/java/com/acme/dto/ThingRequest.java';
const tree={tree:[{type:'blob',path:'pom.xml'},{type:'blob',path:controller},{type:'blob',path:'src/main/java/com/acme/domain/Thing.java'},{type:'blob',path:'src/test/java/com/acme/ThingTest.java'}],truncated:false};
const context={findingIds:['f1'],findings:[{findingId:'f1',source:'SONARQUBE',rule:'synthetic:unknown',severity:'MAJOR',type:'CODE_SMELL',message:'Use a safe request boundary',file:controller,line:20}],repository_owner:'owner',repository_name:'repo',default_branch:'main',batchId:'batch'};
const policyCtx=run('Build Independent Repository Policy',{json:tree,refs:{'Prepare Batch Context':context}})[0].json;
assert.deepEqual(policyCtx.repositoryPolicy.permittedRoots,['src/main/java/']);assert.ok(policyCtx.repositoryPolicy.existingFiles.includes(controller));
const plan=(overrides={})=>({findingId:'f1',source:'SONARQUBE',rule:'synthetic:unknown',target:{file:controller,line:20},rootCause:'Transport input crosses the domain boundary.',remediationIntent:'Use a typed request and controlled mapping.',filesToModify:[controller],filesToCreate:[dto],proposedPaths:[controller,dto],requiredChanges:['Use a typed request','Map fields explicitly'],forbiddenChanges:['No suppression'],expectedBehaviorPreserved:['Endpoint behavior'],validationStrategy:{compile:true,tests:true,scanner:'SONARQUBE'},disposition:'AUTO_CANDIDATE',...overrides});
const prepared={...policyCtx,remediationContract:{},planBodyString:'',findingIds:['f1']};
const validatePlan=value=>run('Validate Generic Remediation Plan',{json:{content:[{text:JSON.stringify({plans:[value]})}]},refs:{'Prepare Generic Remediation Plan':prepared}});
const expanded=validatePlan(plan());assert.deepEqual(expanded.map(i=>i.json.target_file_path).sort(),[controller,dto].sort());
assert.throws(()=>validatePlan(plan({filesToCreate:['README.md'],proposedPaths:[controller,'README.md']})),/REMEDIATION_PATH_NOT_PERMITTED/);
assert.throws(()=>validatePlan(plan({filesToCreate:['../Escape.java'],proposedPaths:[controller,'../Escape.java']})),/REMEDIATION_PATH_UNSAFE/);
assert.throws(()=>validatePlan(plan({filesToCreate:[controller],filesToModify:[]})),/PLANNED_CREATE_FILE_ALREADY_EXISTS/);
assert.throws(()=>validatePlan(plan({filesToModify:['src/main/java/com/acme/Missing.java'],filesToCreate:[],target:{file:controller,line:20}})),/REMEDIATION_TARGET_NOT_PLANNED|PLANNED_MODIFY_FILE_MISSING/);
assert.throws(()=>run('Build Independent Repository Policy',{json:{tree:[{type:'blob',path:'Thing.java'}]},refs:{'Prepare Batch Context':{...context,findings:[{...context.findings[0],file:'Thing.java'}]}}}),/REPOSITORY_STRUCTURE_INCONCLUSIVE/);

const applicablePlan=plan();const repositoryPolicy=policyCtx.repositoryPolicy;
const candidate=(code,rule='synthetic:unknown',operation='MODIFY',path=controller)=>({targetFile:path,fileOperation:operation,patchedCode:code,sourceContent:'class Before {}',approvedFindingIds:['f1'],approvedFindingsForFile:[{findingId:'f1',rule,scannerEvidence:'evidence'}],applicablePlans:[{...applicablePlan,rule}],completePlan:{allPlannedFiles:[{path:controller,operation:'MODIFY'},{path:dto,operation:'CREATE'}]},repositoryPolicy});
for(const fixture of [candidate('class ThingService { void active() {} }','java:S1068'),candidate('class SecurityConfig { void configure() {} }','java:S125'),candidate('class ThingController { Thing create(ThingRequest request) { Thing thing=new Thing(); thing.setName(request.name()); return thing; } }','java:S4684'),candidate('class UnknownSafe { String normalize(String value) { return value == null ? "" : value.trim(); } }')])assert.equal(run('Generic Candidate Preflight',{json:fixture})[0].json.genericPreflightPassed,true);
assert.throws(()=>run('Generic Candidate Preflight',{json:candidate('@RequestBody Object taskDto\nTask task=(Task) taskDto;\n// TODO map safely','java:S4684')}),/WF2_CANDIDATE_QUALITY_REJECTED/);
assert.throws(()=>run('Generic Candidate Preflight',{json:candidate('class X { // NOSONAR\n}')}),/SCANNER_SUPPRESSION/);
assert.throws(()=>run('Generic Candidate Preflight',{json:{...candidate('class X {}'),targetFile:'src/main/java/com/acme/Other.java'}}),/WF2_PATCH_SCOPE_VIOLATION/);

const preflight=run('Generic Candidate Preflight',{json:candidate('class Good {}')})[0].json;
const acceptable=run('Enforce Independent Review',{json:{content:[{text:JSON.stringify({verdict:'ACCEPTABLE_FOR_SCANNER_VALIDATION',evidence:['conforms']})}]},refs:{'Generic Candidate Preflight':preflight}})[0].json;
assert.equal(acceptable.candidateDecision,'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION');assert.equal(acceptable.validationEvidence.scannerResolution,'UNKNOWN_UNTIL_WF3');
assert.throws(()=>run('Enforce Independent Review',{json:{content:[{text:JSON.stringify({verdict:'REJECTED',evidence:['unsafe']})}]},refs:{'Generic Candidate Preflight':preflight}}),/WF2_CANDIDATE_REJECTED/);
assert.throws(()=>run('Enforce Independent Review',{json:{content:[{text:JSON.stringify({verdict:'INCONCLUSIVE',evidence:['ambiguous']})}]},refs:{'Generic Candidate Preflight':preflight}}),/WF2_MANUAL_REVIEW_REQUIRED/);

const completeRefs={'Prepare Batch Context':{findingIds:['f1']},'Validate Generic Remediation Plan':expanded};
assert.throws(()=>run('Validate Batch Completeness',{input:{all:()=>[{json:{targetFile:controller,candidateAcceptedFindingIds:['f1'],candidateStateVerified:true,outcome:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION'}}]},refs:completeRefs}),/WF2_BATCH_INCOMPLETE/);

const nodesText=JSON.stringify(wf.nodes);for(const forbidden of ['ALREADY_REMEDIATED','effectiveRemediatedFindingIds','finalStateVerified','MODIFIED_AND_REMEDIATED'])assert.ok(!nodesText.includes(forbidden),forbidden+' remains');
for(const rule of ['java:S1068','java:S125','java:S4684'])assert.ok(!nodesText.includes(rule),rule+' controls runtime');
assert.ok(byName('Prepare Generic Remediation Plan').parameters.jsCode.includes("model:'claude-sonnet-5'"));assert.ok(byName('Prepare - Code Patch Body').parameters.jsCode.includes("model:'claude-sonnet-5'"));assert.ok(byName('Generic Candidate Preflight').parameters.jsCode.includes("model:'claude-haiku-4-5-20251001'"));
assert.ok(byName('Generic Candidate Preflight').parameters.jsCode.includes('buildTestEvidence'));

const envelopeName='Failure Envelope - Generic Candidate Preflight';const corr={workflowId:'9adcV31eaIgJyMR0',incidentId:'incident',requestId:'request',batchId:'batch',batchKey:'batch',attemptCount:3};
const envelope=run(envelopeName,{input:{first:()=>({json:{error:'WF2_PATCH_NOT_EFFECTIVE:example'}})},items:()=>[{json:{correlationEnvelope:corr}}],execution:{id:'execution'}})[0].json;
assert.deepEqual({failureCode:envelope.failureCode,failedNode:envelope.failedNode,failureSummary:envelope.failureSummary},{failureCode:'WF2_PATCH_NOT_EFFECTIVE',failedNode:'Generic Candidate Preflight',failureSummary:'WF2_PATCH_NOT_EFFECTIVE:example'});
const failure=run('Prepare WF2 Failure Status',{input:{first:()=>({json:envelope})},execution:{id:'execution'}})[0].json;assert.equal(failure.failureNode,'Generic Candidate Preflight');assert.equal(failure.failureCode,'WF2_PATCH_NOT_EFFECTIVE');
for(const [source,c] of Object.entries(wf.connections))for(const outputs of c.main||[])for(const edge of outputs||[])if(edge.node==='Prepare WF2 Failure Status')assert.ok(source.startsWith('Failure Envelope - '),'untagged failure edge from '+source);

for(const name of ['Lookup Existing Batch PR','Select Existing PR','Existing PR?','Use Existing PR','Create Pull Request1','Capture Correlation Envelope'])assert.deepEqual(byName(name),byName(name,base),name+' regression');
const adaptCode=byName('Adapt Webhook Payload').parameters.jsCode;assert.ok(!adaptCode.includes("stage:'sonar'"));assert.ok(!adaptCode.includes("source:'SONARQUBE'"));
assert.ok(!JSON.stringify(wf.connections.Webhook).includes('Create Pull Request1'));
console.log('PFE R19.3C exact-draft acceptance matrix: PASS');
