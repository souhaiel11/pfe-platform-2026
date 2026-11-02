// Prépare harden WF2 r19 3 pour les workflows n8n.
import fs from 'node:fs';
import crypto from 'node:crypto';

const sourcePath = new URL('../pending-live-update/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.R19_1-FIXED.json', import.meta.url);
const outputPath = new URL('../pending-live-update/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.R19_3-DYNAMIC-DRAFT.json', import.meta.url);
const exported = JSON.parse(fs.readFileSync(sourcePath));
const workflow = Array.isArray(exported) ? exported[0] : exported;
/** Retrouve ou construit le nœud du workflow demandé. */
const node = name => workflow.nodes.find(candidate => candidate.name === name);
/** Construit un nœud de code n8n. */
const codeNode = (name, jsCode, position) => ({
  id: crypto.randomUUID(), name, type: 'n8n-nodes-base.code', typeVersion: 2,
  position, onError: 'continueErrorOutput', parameters: { mode: 'runOnceForAllItems', jsCode },
});
/** Construit un nœud de requête HTTP n8n. */
const httpNode = (name, body, position) => ({
  id: crypto.randomUUID(), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
  position, onError: 'continueErrorOutput', credentials: node('de Patch - HTTP Request').credentials,
  parameters: { ...node('de Patch - HTTP Request').parameters, body },
});

// A plan is generated from evidence, not from a rule catalogue. Specialist routing
// is source/technology/risk based and remains fail-closed.
const preparePlan = codeNode('Prepare Generic Remediation Plan', String.raw`
const ctx=$('Prepare Batch Context').first().json;
const findings=Array.isArray(ctx.findings)?ctx.findings:[];
const supported=findings.filter(f=>['SONARQUBE','SONAR','CODE','SAST'].includes(String(f.source||'SONARQUBE').toUpperCase()));
if(supported.length!==findings.length)throw new Error('WF2_SPECIALIST_ROUTE_REQUIRED:'+JSON.stringify(findings.filter(f=>!supported.includes(f)).map(f=>({findingId:f.findingId,source:f.source}))));
const forbidden=['TODO/FIXME or placeholder implementation','scanner suppression or disabling security rules','deleting functionality merely to silence a scanner','unrelated source modifications','secrets','malformed or incomplete source','arbitrary dependency downgrade','configuration weakening'];
const sourceSnapshots=$input.all().map(item=>{const raw=item.json.content;const content=Buffer.from((Array.isArray(raw)?raw.join(''):String(raw||'')).replace(/\n/g,''),'base64').toString('utf8');return {file:String(item.json.path||item.json.target_file_path||''),sha:String(item.json.sha||''),content}});
const contract={schemaVersion:'1.0',batchId:ctx.batchId,repository:{owner:ctx.repository_owner,name:ctx.repository_name,defaultBranch:ctx.default_branch,technology:ctx.projectTechnology||ctx.technology||ctx.repositoryMetadata||{}},findings:findings.map(f=>({findingId:String(f.findingId||f.id||f.key),source:String(f.source||'SONARQUBE'),rule:String(f.rule||f.ruleKey||''),severity:String(f.severity||''),type:String(f.type||''),message:String(f.message||''),target:{file:String(f.file||f.component||''),line:Number(f.line)||null},scannerEvidence:f.evidence||f.scannerEvidence||f})),sourceSnapshots,forbiddenChanges:forbidden};
const body={model:'claude-haiku-4-5-20251001',max_tokens:8192,temperature:0,system:'You are a remediation planner, separate from patch generation. Return strict JSON only. Infer a minimal, generic plan from findings, scanner evidence, repository metadata and supplied surrounding source. Never decide that a finding is resolved. Never key behavior on a rule ID. New files are allowed only when necessary and must be explicitly declared.',messages:[{role:'user',content:'Create one plan per finding using this generic schema: {findingId,source,rule,target:{file,line},rootCause,remediationIntent,filesToModify,filesToCreate,allowedPaths,requiredChanges,forbiddenChanges,expectedBehaviorPreserved,validationStrategy:{compile,tests,scanner},confidence}. Paths must be repository-relative, normalized, minimal, and every target file must be included. Route high-risk/infra/admin/Jenkins/Docker work with disposition MANUAL_OR_SPECIALIST; otherwise disposition AUTO_CANDIDATE. Input: '+JSON.stringify(contract)}]};
return [{json:{...ctx,remediationContract:contract,planBodyString:JSON.stringify(body)}}];`, [-2500,3900]);

const parsePlan = codeNode('Validate Generic Remediation Plan', String.raw`
const prepared=$('Prepare Generic Remediation Plan').first().json;const response=$json;
const text=response.content?.[0]?.text||response.content?.text||(typeof response.content==='string'?response.content:'');
let parsed;try{parsed=JSON.parse(String(text).replace(/^\x60\x60\x60json\s*/i,'').replace(/\x60\x60\x60\s*$/,'').trim())}catch{throw new Error('REMEDIATION_PLAN_PARSE_FAILED')}
const plans=Array.isArray(parsed)?parsed:(Array.isArray(parsed.plans)?parsed.plans:[]);const expected=[...new Set(prepared.findingIds.map(String))].sort();
const ids=[...new Set(plans.map(p=>String(p.findingId||'')))].sort();if(JSON.stringify(ids)!==JSON.stringify(expected))throw new Error('REMEDIATION_PLAN_INCOMPLETE');
const normalize=p=>{p=String(p||'').replace(/\\/g,'/').replace(/^\.\//,'');if(!p||p.startsWith('/')||p.includes('..')||p.includes('\0')||p.startsWith('.git/'))throw new Error('REMEDIATION_PATH_UNSAFE:'+p);return p};
const requiredText=(v,k)=>{if(!String(v||'').trim())throw new Error('REMEDIATION_PLAN_FIELD_MISSING:'+k);return String(v).trim()};
const normalized=plans.map(plan=>{if(plan.disposition&&plan.disposition!=='AUTO_CANDIDATE')throw new Error('WF2_SPECIALIST_ROUTE_REQUIRED:'+plan.findingId);const modify=[...new Set((plan.filesToModify||[]).map(normalize))];const create=[...new Set((plan.filesToCreate||[]).map(normalize))];if(modify.some(p=>create.includes(p)))throw new Error('REMEDIATION_PATH_OPERATION_CONFLICT');const allowed=[...new Set((plan.allowedPaths||[]).map(normalize))];const all=[...modify,...create];if(!all.length||all.some(p=>!allowed.includes(p)))throw new Error('REMEDIATION_SCOPE_INVALID');const target=normalize(plan.target?.file);if(!all.includes(target))throw new Error('REMEDIATION_TARGET_NOT_PLANNED');const required=(plan.requiredChanges||[]).map(String).filter(Boolean);const forbidden=(plan.forbiddenChanges||[]).map(String).filter(Boolean);const preserved=(plan.expectedBehaviorPreserved||[]).map(String).filter(Boolean);if(!required.length||!forbidden.length||!preserved.length)throw new Error('REMEDIATION_PLAN_INCOMPLETE');return {...plan,findingId:String(plan.findingId),target:{file:target,line:Number(plan.target?.line)||null},rootCause:requiredText(plan.rootCause,'rootCause'),remediationIntent:requiredText(plan.remediationIntent,'remediationIntent'),filesToModify:modify,filesToCreate:create,allowedPaths:allowed,requiredChanges:required,forbiddenChanges:forbidden,expectedBehaviorPreserved:preserved,validationStrategy:{compile:Boolean(plan.validationStrategy?.compile),tests:Boolean(plan.validationStrategy?.tests),scanner:String(plan.validationStrategy?.scanner||plan.source||'UNKNOWN')}}});
const fileMap=new Map();for(const plan of normalized){for(const path of plan.filesToModify)fileMap.set(path,{path,operation:'MODIFY'});for(const path of plan.filesToCreate)fileMap.set(path,{path,operation:'CREATE'});}
return [...fileMap.values()].map(file=>({json:{...prepared,remediationPlans:normalized,plannedFiles:[...fileMap.values()],target_file_path:file.path,fileOperation:file.operation}}));`, [-2100,3900]);

const expand = node('Expand Approved Target Files');
expand.name='Route Planned File Operation';
expand.parameters={conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:3},conditions:[{id:'planned-create',leftValue:'={{ $json.fileOperation }}',rightValue:'CREATE',operator:{type:'string',operation:'equals'}}],combinator:'and'},options:{}};
expand.type='n8n-nodes-base.if';expand.typeVersion=2.2;

const seedCreate = codeNode('Seed New Planned File', String.raw`
const input=$json;return [{json:{...input,path:input.target_file_path,sha:'',content:Buffer.from('').toString('base64'),plannedCreation:true}}];`, [-1500,3750]);

node('Prepare - Code Patch Body').parameters.jsCode = String.raw`
const input=$json;const gate=$('Prepare Batch Context').first().json;const fileName=String(input.path||input.target_file_path||'');
const operation=String(input.fileOperation|| (input.plannedCreation?'CREATE':'MODIFY'));let sourceContent='';try{sourceContent=Buffer.from(String(input.content||'').replace(/\n/g,''),'base64').toString('utf8')}catch{throw new Error('SOURCE_DECODE_FAILED')}
if(operation==='MODIFY'&&!sourceContent)throw new Error('PLANNED_MODIFY_FILE_MISSING:'+fileName);if(operation==='CREATE'&&sourceContent)throw new Error('PLANNED_CREATE_FILE_ALREADY_EXISTS:'+fileName);
const plans=(input.remediationPlans||[]).filter(p=>[...(p.filesToModify||[]),...(p.filesToCreate||[])].includes(fileName));if(!plans.length)throw new Error('FILE_WITHOUT_REMEDIATION_PLAN:'+fileName);
const approvedFindingIds=[...new Set(plans.map(p=>p.findingId))].sort();const completePlan={batchId:gate.batchId,file:{path:fileName,operation,originalContent:sourceContent},plans,allPlannedFiles:input.plannedFiles,globalForbidden:['TODO','FIXME','placeholder implementation','scanner suppression','disabled security rule','unrelated changes','secrets','dependency downgrade','configuration weakening']};
const body={model:'claude-haiku-4-5-20251001',max_tokens:8192,temperature:0,system:'You generate a candidate patch from a complete remediation plan. Return strict JSON only. Touch only the current planned file. Implement every applicable requiredChange, preserve stated behavior, obey forbiddenChanges, and never claim scanner resolution. Do not add TODO/FIXME, suppression, incomplete code, unsafe casts, dependency downgrades, or unrelated edits.',messages:[{role:'user',content:'Produce {targetFile,processedFindingIds,patchedCode,patchDescription,conformanceEvidence}. Complete plan: '+JSON.stringify(completePlan)}]};
return [{json:{...input,requiresPatch:true,claudeBodyString:JSON.stringify(body),sourceContent,file_sha:String(input.sha||''),file_path:fileName,targetFile:fileName,fileOperation:operation,approvedFindingIdsForFile:approvedFindingIds,approvedFindingsForFile:plans.map(p=>({findingId:p.findingId,source:p.source,rule:p.rule,file:p.target.file,line:p.target.line,message:p.remediationIntent})),applicablePlans:plans,completePlan,branchName:gate.targetBranchName,commitMessage:'fix(security): candidate remediation for batch '+gate.batchId,repository_owner:gate.repository_owner,repository_name:gate.repository_name,default_branch:gate.default_branch,incidentId:gate.incidentId}}];`;

node('Parse - Code Patch Output').parameters.jsCode = String.raw`
const response=$json;const prepared=$('Prepare - Code Patch Body').item.json;const text=response.content?.[0]?.text||response.content?.text||(typeof response.content==='string'?response.content:'');let parsed;try{parsed=JSON.parse(String(text).replace(/^\x60\x60\x60json\s*/i,'').replace(/\x60\x60\x60\s*$/,'').trim())}catch{throw new Error('PATCH_PARSE_FAILED')}
const targetFile=String(parsed.targetFile||'');const ids=[...new Set((parsed.processedFindingIds||[]).map(String))].sort();const expected=[...prepared.approvedFindingIdsForFile].sort();if(targetFile!==prepared.targetFile)throw new Error('PATCH_TARGET_FILE_MISMATCH');if(JSON.stringify(ids)!==JSON.stringify(expected))throw new Error('PATCH_FINDING_SET_MISMATCH');if(typeof parsed.patchedCode!=='string'||parsed.patchedCode.length<1)throw new Error('PATCH_EMPTY_CANDIDATE');
return [{json:{...prepared,patchedCode:parsed.patchedCode,patchDescription:String(parsed.patchDescription||''),conformanceEvidence:parsed.conformanceEvidence||[],processedFindingIds:ids,approvedFindingIds:expected,oldSha:prepared.file_sha}}];`;

const preflight = node('Validate Candidate Remediation');
preflight.name='Generic Candidate Preflight';
preflight.parameters.jsCode = String.raw`
const patch=$json;const code=String(patch.patchedCode||'');const source=String(patch.sourceContent||'');const path=String(patch.targetFile||'');const planned=(patch.completePlan?.allPlannedFiles||[]).map(f=>f.path);if(!planned.includes(path))throw new Error('WF2_PATCH_SCOPE_VIOLATION:'+path);if(patch.fileOperation==='MODIFY'&&code===source)throw new Error('WF2_PATCH_NOT_EFFECTIVE:'+path);if(!code.trim())throw new Error('WF2_EMPTY_REPLACEMENT:'+path);
const violations=[];const checks=[[/\b(?:TODO|FIXME)\b/i,'PLACEHOLDER_MARKER'],[/\b(?:NOSONAR|SuppressWarnings|sonar\.issue\.ignore|eslint-disable|noinspection)\b/i,'SCANNER_SUPPRESSION'],[/\bObject\s+\w+[\s\S]{0,500}\([A-Za-z_$][\w$<>., ?]*\)\s*\w+/,'OBVIOUS_INVALID_CAST_WORKAROUND'],[/\b(?:password|secret|api[_-]?key|token)\s*[=:]\s*["'][^"']+["']/i,'POSSIBLE_SECRET'],[/^\s*\/\/\s*(?:if|for|while|return|throw|[\w.]+\s*\()/m,'COMMENTED_OUT_EXECUTABLE']];for(const [re,label] of checks)if(re.test(code))violations.push(label);if(/placeholder|not implemented|implement later/i.test(code))violations.push('PLACEHOLDER_IMPLEMENTATION');if(violations.length)throw new Error('WF2_CANDIDATE_QUALITY_REJECTED:'+JSON.stringify({path,violations}));
const body={model:'claude-haiku-4-5-20251001',max_tokens:4096,temperature:0,system:'You are an independent candidate validator, separate from the patch generator. Judge generic plan conformance, safety, source coherence, likely buildability and testability. Do not decide scanner resolution and do not use rule-specific logic. Return strict JSON only with verdict ACCEPTABLE_FOR_SCANNER_VALIDATION, REJECTED, or INCONCLUSIVE plus evidence array.',messages:[{role:'user',content:JSON.stringify({originalFindings:patch.approvedFindingsForFile,originalCode:source,remediationPlans:patch.applicablePlans,candidateCode:code,file:{path,operation:patch.fileOperation}})}]};return [{json:{...patch,genericPreflightPassed:true,reviewBodyString:JSON.stringify(body),preflightEvidence:['AUTHORIZED_FILE','NON_EMPTY_CHANGE','NO_GENERIC_PROHIBITED_PROPERTY']}}];`;

const reviewHttp=httpNode('Independent Semantic Review','={{ $json.reviewBodyString }}',[-300,3850]);
const parseReview=codeNode('Enforce Independent Review',String.raw`
const candidate=$('Generic Candidate Preflight').item.json;const response=$json;const text=response.content?.[0]?.text||response.content?.text||(typeof response.content==='string'?response.content:'');let review;try{review=JSON.parse(String(text).replace(/^\x60\x60\x60json\s*/i,'').replace(/\x60\x60\x60\s*$/,'').trim())}catch{throw new Error('INDEPENDENT_REVIEW_INCONCLUSIVE')};const verdict=String(review.verdict||'INCONCLUSIVE').toUpperCase();if(verdict==='REJECTED')throw new Error('WF2_CANDIDATE_REJECTED:'+JSON.stringify(review.evidence||[]));if(verdict!=='ACCEPTABLE_FOR_SCANNER_VALIDATION')throw new Error('WF2_MANUAL_REVIEW_REQUIRED:'+JSON.stringify(review.evidence||[]));return [{json:{...candidate,candidateValidationStatus:'ACCEPTABLE_FOR_SCANNER_VALIDATION',candidateValidationPassed:true,validationEvidence:{genericPreflight:candidate.preflightEvidence,independentReview:review.evidence||[],scannerResolution:'UNKNOWN_UNTIL_WF3'},effectiveRemediatedFindingIds:candidate.approvedFindingIds,finalStateVerified:true}}];`,[100,3850]);

const createFile={...structuredClone(node('Update File in Branch')),id:crypto.randomUUID(),name:'Create File in Branch',position:[500,3740]};createFile.parameters.operation='create';delete createFile.parameters.fileContent;createFile.parameters.fileContent='={{ $json.patchedCode }}';
const writeRoute={...structuredClone(expand),id:crypto.randomUUID(),name:'Candidate Creates File?',position:[300,3850]};writeRoute.parameters.conditions.conditions[0].leftValue='={{ $json.fileOperation }}';
const expandPlanning=codeNode('Expand Finding Source Files',String.raw`const ctx=$('Prepare Batch Context').first().json;const paths=[...new Set((ctx.findings||[]).map(f=>String(f.file||f.component||'')).filter(Boolean))];if(!paths.length)throw new Error('NO_FINDING_SOURCE_FILES');return paths.map(target_file_path=>({json:{...ctx,target_file_path}}));`,[-2900,3900]);
const fetchPlanning={...structuredClone(node('Fetch Repository Files')),id:crypto.randomUUID(),name:'Fetch Finding Source Context',position:[-2700,3900]};
workflow.nodes.push(preparePlan,parsePlan,seedCreate,reviewHttp,parseReview,writeRoute,createFile,expandPlanning,fetchPlanning);

node('Build File Result').parameters.jsCode=node('Build File Result').parameters.jsCode.replace("$('Validate Candidate Remediation')","$('Enforce Independent Review')");
node('Build File Result').parameters.jsCode=node('Build File Result').parameters.jsCode.replace("outcome:'MODIFIED_AND_REMEDIATED'","outcome:'CANDIDATE_ACCEPTABLE_FOR_VALIDATION'");
node('Validate Batch Completeness').parameters.jsCode=String.raw`
const ctx=$('Prepare Batch Context').first().json;const planned=$('Validate Generic Remediation Plan').all().map(i=>i.json.plannedFiles||[]).flat();const results=$input.all().map(i=>i.json);const norm=v=>[...new Set((v||[]).map(String))].sort();const expectedFindingIds=norm(ctx.findingIds);const expectedFiles=norm(planned.map(f=>f.path));const resultFiles=norm(results.map(r=>r.targetFile));const acceptedFindingIds=norm(results.flatMap(r=>r.effectiveRemediatedFindingIds||[]));const missingFindingIds=expectedFindingIds.filter(id=>!acceptedFindingIds.includes(id));const unexpectedFindingIds=acceptedFindingIds.filter(id=>!expectedFindingIds.includes(id));const missingFiles=expectedFiles.filter(file=>!resultFiles.includes(file));const unauthorizedFiles=resultFiles.filter(file=>!expectedFiles.includes(file));const failed=results.filter(r=>!r.finalStateVerified).map(r=>r.targetFile);if(missingFindingIds.length||unexpectedFindingIds.length||missingFiles.length||unauthorizedFiles.length||failed.length||results.length!==expectedFiles.length)throw new Error('WF2_BATCH_INCOMPLETE:'+JSON.stringify({missingFindingIds,unexpectedFindingIds,missingFiles,unauthorizedFiles,failed}));return [{json:{completenessPassed:true,candidateStatus:'CANDIDATE_ACCEPTABLE_FOR_VALIDATION',scannerResolution:'UNKNOWN_UNTIL_WF3',expectedFindingIds,expectedTargetFiles:expectedFiles,processedFindingIds:acceptedFindingIds,effectiveRemediatedFindingIds:acceptedFindingIds,verifiedFiles:resultFiles,updatedFiles:resultFiles,commitShas:norm(results.map(r=>r.commitSha).filter(Boolean)),fileResults:results}}];`;
node('Prepare WF2 Failure Status').parameters.jsCode=String.raw`
const input=$input.first().json||{};const captured=$items('Capture Correlation Envelope',0,0);const ctx=captured?.[0]?.json?.correlationEnvelope||{};const raw=input.error??input;const err=typeof raw==='string'?{message:raw}:raw||{};const rawSummary=String(input.failureSummary||err.message||input.message||input.reason||raw||'workflow execution error');const summary=rawSummary.replace(/[\r\n]+/g,' ').replace(/(?:token|password|secret|authorization)\s*[=:]\s*[^ ,;]+/ig,'$1=[REDACTED]').slice(0,500);const embedded=rawSummary.match(/^([A-Z][A-Z0-9_]+)(?::|$)/)?.[1];const failureCode=String(input.failureCode||embedded||'WF2_EXECUTION_ERROR').slice(0,120);const failedNode=String(input.failedNode||input.failureNode||err.node?.name||err.context?.nodeCause||input.node?.name||'WF2').slice(0,120);const required=['incidentId','requestId','batchId','batchKey','attemptCount'];const missing=required.filter(k=>ctx[k]===undefined||ctx[k]===null||ctx[k]==='');if(missing.length)throw new Error('FAILURE_CORRELATION_MISSING:'+missing.join(','));return [{json:{status:'FAILED',manualReviewRequired:failureCode==='WF2_MANUAL_REVIEW_REQUIRED',workflowId:ctx.workflowId,executionId:String($execution.id),incidentId:ctx.incidentId,requestId:ctx.requestId,batchId:ctx.batchId,batchKey:ctx.batchKey,attemptCount:ctx.attemptCount,errorCode:failureCode,failureCode,failedNode,failureNode:failedNode,failureSummary:summary}}];`;

// Rewire only the remediation lane. Branch creation/reuse, correlation and PR
// idempotency connections are preserved byte-for-byte.
workflow.connections['Use Existing Branch'].main[0]=[{node:'Expand Finding Source Files',type:'main',index:0}];
workflow.connections['Create Missing Branch'].main[0]=[{node:'Expand Finding Source Files',type:'main',index:0}];
workflow.connections['Expand Finding Source Files']={main:[[{node:'Fetch Finding Source Context',type:'main',index:0}],[{node:'Prepare WF2 Failure Status',type:'main',index:0}]]};
workflow.connections['Fetch Finding Source Context']={main:[[{node:'Prepare Generic Remediation Plan',type:'main',index:0}],[{node:'Prepare WF2 Failure Status',type:'main',index:0}]]};
workflow.connections['Prepare Generic Remediation Plan']={main:[[{node:'Generate Remediation Plan',type:'main',index:0}],[{node:'Prepare WF2 Failure Status',type:'main',index:0}]]};
workflow.nodes.push(httpNode('Generate Remediation Plan','={{ $json.planBodyString }}',[-2300,3900]));
workflow.connections['Generate Remediation Plan']={main:[[{node:'Validate Generic Remediation Plan',type:'main',index:0}],[{node:'Prepare WF2 Failure Status',type:'main',index:0}]]};
workflow.connections['Validate Generic Remediation Plan']={main:[[{node:'Route Planned File Operation',type:'main',index:0}],[{node:'Prepare WF2 Failure Status',type:'main',index:0}]]};
workflow.connections['Route Planned File Operation']={main:[[{node:'Seed New Planned File',type:'main',index:0}],[{node:'Fetch Repository Files',type:'main',index:0}]]};
workflow.connections['Seed New Planned File']={main:[[{node:'Prepare - Code Patch Body',type:'main',index:0}],[{node:'Prepare WF2 Failure Status',type:'main',index:0}]]};
workflow.connections['Generic Candidate Preflight']={main:[[{node:'Independent Semantic Review',type:'main',index:0}],[{node:'Prepare WF2 Failure Status',type:'main',index:0}]]};
workflow.connections['Independent Semantic Review']={main:[[{node:'Enforce Independent Review',type:'main',index:0}],[{node:'Prepare WF2 Failure Status',type:'main',index:0}]]};
workflow.connections['Enforce Independent Review']={main:[[{node:'Candidate Creates File?',type:'main',index:0}],[{node:'Prepare WF2 Failure Status',type:'main',index:0}]]};
workflow.connections['Candidate Creates File?']={main:[[{node:'Create File in Branch',type:'main',index:0}],[{node:'Update File in Branch',type:'main',index:0}]]};
workflow.connections['Create File in Branch']={main:[[{node:'Build File Result',type:'main',index:0}],[{node:'Prepare WF2 Failure Status',type:'main',index:0}]]};
delete workflow.connections['Expand Approved Target Files'];delete workflow.connections['Validate Candidate Remediation'];
workflow.connections['Parse - Code Patch Output'].main[0]=[{node:'Generic Candidate Preflight',type:'main',index:0}];

// R18 reconciliation nodes referred to the former validator by name.
for (const candidate of workflow.nodes) {
  const serialized=JSON.stringify(candidate.parameters)
    .replaceAll("Validate Candidate Remediation","Enforce Independent Review");
  candidate.parameters=JSON.parse(serialized);
}

workflow.name='WF2 - Git Patch & PR v4.1 — R19.3 Dynamic Draft';workflow.active=false;workflow.versionId=crypto.randomUUID();workflow.updatedAt=new Date().toISOString();
fs.writeFileSync(outputPath,JSON.stringify([workflow],null,2)+'\n');
console.log(JSON.stringify({output:new URL(outputPath).pathname,id:workflow.id,versionId:workflow.versionId,nodes:workflow.nodes.length},null,2));
