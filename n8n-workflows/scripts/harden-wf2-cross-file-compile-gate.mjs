import fs from 'node:fs';
import crypto from 'node:crypto';

const input=process.argv[2], output=process.argv[3]||input;
if(!input) throw new Error('usage: node harden-wf2-cross-file-compile-gate.mjs <input.json> [output.json]');
const root=JSON.parse(fs.readFileSync(input,'utf8'));const wf=Array.isArray(root)?root[0]:root;
const byName=name=>{const n=wf.nodes.find(x=>x.name===name);if(!n)throw new Error('missing node '+name);return n};
const protectedNames=['Parse - Code Patch Output','Generic Candidate Preflight','Independent Semantic Review','Enforce Independent Review','Build File Result','Build Reconciled File Result','Call Candidate Verification','Call Write Guard','Write Guard Passed?','Create Missing Branch','Create File in Branch','Update File in Branch'];
const protectedBefore=Object.fromEntries(protectedNames.map(n=>[n,crypto.createHash('sha256').update(JSON.stringify(byName(n))).digest('hex')]));
const add=node=>{if(!wf.nodes.some(n=>n.name===node.name))wf.nodes.push(node)};
const pos=(x,y)=>[x,y];
const code=(name,id,jsCode,position)=>({parameters:{mode:'runOnceForAllItems',jsCode},id,name,type:'n8n-nodes-base.code',typeVersion:2,position,onError:'continueErrorOutput'});
const http=(name,id,position,body)=>({parameters:{method:'POST',url:'=http://backend:3001/api/candidate-verification/verify',sendHeaders:true,headerParameters:{parameters:[{name:'X-Internal-Secret',value:'={{ $env.N8N_INTERNAL_SECRET }}'}]},sendBody:true,specifyBody:'json',jsonBody:body,options:{timeout:300000}},id,name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position,onError:'continueErrorOutput'});
const classifier={parameters:{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:3},conditions:[{id:'cross-file-count',leftValue:'={{ $json.files.length }}',rightValue:2,operator:{type:'number',operation:'gte'}}],combinator:'and'},options:{}},id:'wf2-cross-file-route',name:'Classify Candidate Coordination Scope',type:'n8n-nodes-base.if',typeVersion:2.2,position:pos(7600,1960)};
add(classifier);
// Prepare Candidate Manifest deliberately owns the one canonical serialization
// (_canonicalJson); hashing remains a native Crypto-node responsibility because
// Code nodes do not have crypto in the n8n sandbox.  The cross-file route needs
// the digest before its progressive verifier calls, while the historical route
// hashes after semantic review.  Reuse the exact same native SHA-256 contract
// without reimplementing or weakening the canonicalization.
const crossHash={...structuredClone(byName('Hash Candidate Manifest')),id:'wf2-cross-hash-candidate-manifest',name:'Hash Cross-File Candidate Manifest',position:pos(7800,1780),onError:'continueErrorOutput'};
add(crossHash);
add(code('Validate Cross-File Candidate Manifest','wf2-cross-validate-candidate-manifest',`
const m={...$json};
if(!Array.isArray(m.files)||m.files.length<2)throw new Error('CROSS_FILE_ROUTE_INVALID');
if(!/^[a-f0-9]{40}$/.test(String(m.candidateBaseSha||'')))throw new Error('CANDIDATE_MANIFEST_INVALID:candidateBaseSha missing/invalid');
if(!/^[a-f0-9]{64}$/.test(String(m.candidateDigest||'')))throw new Error('CANDIDATE_MANIFEST_INVALID:candidateDigest missing/invalid');
if(typeof m._canonicalJson!=='string'||!m._canonicalJson)throw new Error('CANDIDATE_MANIFEST_INVALID:canonical serialization missing');
return [{json:m}];`,pos(7900,1780)));
const prepare=(mode,seq,phase,previous,position)=>code(`Prepare Cross-File ${mode}`,`wf2-cross-prepare-${seq}`,`
const source=${previous?`$('${previous}').first().json`:'$input.first().json'};
const manifest=source.candidateManifest||source;
if(!Array.isArray(manifest.files)||manifest.files.length<2)throw new Error('CROSS_FILE_ROUTE_INVALID');
const digest=String(manifest.candidateDigest||'');if(!/^[a-f0-9]{64}$/.test(digest))throw new Error('CANDIDATE_MANIFEST_INVALID');
const verificationStep={sequence:${seq},phase:'${phase}',stateDigest:digest};
const verificationRequest={manifest,allowedPaths:manifest.files.map(f=>f.path),options:{mode:'${mode}',timeoutMs:300000},verificationStep};
return [{json:{candidateManifest:manifest,candidateDigest:digest,coordinationScope:'CROSS_FILE_REPAIR',verificationEvidence:source.verificationEvidence||{},verificationStep,verificationRequest}}];`,position);
const enforce=(mode,seq,prepareName,position)=>code(`Enforce Cross-File ${mode}`,`wf2-cross-enforce-${seq}`,`
const prepared=$('${prepareName}').first().json;const result=$input.first().json||{};
const infra=new Set(['VERIFIER_UNAVAILABLE','VERIFIER_TIMEOUT','VERIFIER_PROTOCOL_ERROR','WORKSPACE_CREATION_FAILED','WORKSPACE_SHA_MISMATCH','WORKSPACE_INFRA_FAILURE','WORKSPACE_TIMEOUT','BUILD_TYPE_UNSUPPORTED','VERIFICATION_MODE_UNSUPPORTED']);
if(result.overall==='INCONCLUSIVE'||infra.has(result.failureClass))throw new Error('WF2_VERIFIER_INFRASTRUCTURE_FAILURE:'+JSON.stringify({failureClass:result.failureClass,diagnostics:result.diagnostics||null}));
if(result.overall!=='PASS')throw new Error(String(result.failureClass||'CANDIDATE_VERIFICATION_FAILED')+':'+JSON.stringify(result.diagnostics||{}));
if(result.mode!=='${mode}'||result.identity?.candidateDigest!==prepared.candidateDigest||result.identity?.stateDigest!==prepared.candidateDigest||result.identity?.verificationStep!==${seq})throw new Error('PROGRESSIVE_VERIFICATION_IDENTITY_MISMATCH');
return [{json:{...prepared,verificationEvidence:{...prepared.verificationEvidence,['${mode}']:result}}}];`,position);
const stages=[
  ['COMPILE_MAIN',1,'INITIAL_COMPILE',null,8000],
  ['COMPILE_TESTS',2,'TEST_COMPILE','Enforce Cross-File COMPILE_MAIN',8600],
  ['FULL_TEST',3,'FULL_TEST','Enforce Cross-File COMPILE_TESTS',9200],
];
for(const [mode,seq,phase,prev,x] of stages){add(prepare(mode,seq,phase,prev,pos(x,1780)));add(http(`Call Cross-File ${mode}`,`wf2-cross-call-${seq}`,pos(x+200,1780),'={{ JSON.stringify($json.verificationRequest) }}'));add(enforce(mode,seq,`Prepare Cross-File ${mode}`,pos(x+400,1780)))}
add(code('Prepare Cross-File Review','wf2-cross-review-prepare',`
const state=$input.first().json;const manifest=state.candidateManifest;const proofs=state.verificationEvidence;
for(const mode of ['COMPILE_MAIN','COMPILE_TESTS','FULL_TEST'])if(proofs?.[mode]?.overall!=='PASS'||proofs[mode].identity?.candidateDigest!==state.candidateDigest)throw new Error('CROSS_FILE_DETERMINISTIC_PROOF_INCOMPLETE');
const template=manifest.llmRequestBody;if(!template?.system||!Array.isArray(template.messages))throw new Error('LLM_REQUEST_BODY_INVALID');
const evidence={candidateDigest:state.candidateDigest,compileMain:proofs.COMPILE_MAIN,compileTests:proofs.COMPILE_TESTS,fullTest:proofs.FULL_TEST};
const llmRequestBody={...template,system:template.system+' Deterministic verification for this exact candidate digest is supplied. Do not speculate that compilation or tests fail when the matching evidence says PASS; continue to assess semantic contracts not proven by compilation.',messages:[{role:'user',content:JSON.stringify({candidateManifest:manifest,deterministicVerification:evidence})}]};
return [{json:{candidateManifest:manifest,candidateDigest:state.candidateDigest,verificationEvidence:proofs,llmRequestBody}}];`,pos(9800,1780)));
const historicalReview=byName('Independent Semantic Review');
add({...structuredClone(historicalReview),id:'wf2-cross-review-http',name:'Independent Cross-File Semantic Review',position:pos(10000,1780),parameters:{...structuredClone(historicalReview.parameters),jsonBody:'={{ $json.llmRequestBody }}'}});
let reviewCode=byName('Enforce Independent Review').parameters.jsCode;
reviewCode=reviewCode.replace("const candidate=$('Prepare Candidate Manifest').first().json;", "const envelope=$('Prepare Cross-File Review').first().json;const candidate=envelope.candidateManifest;")
  .replace("return {json:{...manifest,files:manifest.files.map", "return {json:{...manifest,progressiveVerificationEvidence:envelope.verificationEvidence,files:manifest.files.map");
add(code('Enforce Cross-File Review','wf2-cross-review-enforce',reviewCode,pos(10200,1780)));

// Validate the pre-write blob identity according to the operation.  A MODIFY
// must carry the exact 40-hex blob SHA frozen in CandidateManifest.  A CREATE
// has no pre-existing blob by definition, so its explicit proof is oldSha:null.
// Presence and value are checked separately: null is valid only for CREATE and
// can no longer be confused with a dropped field.
byName('Validate Batch Completeness').parameters.jsCode=`
const ctx=$('Prepare Batch Context').first().json;
const manifest=$('Assemble Candidate Manifest').first().json;
const planned=manifest.files;
const incoming=$input.all().map(i=>i.json);
const norm=v=>[...new Set((v||[]).map(String))].sort();
const expectedFindingIds=norm(ctx.findingIds);
const expectedFiles=norm(planned.map(f=>f.path));
const expectedByFile=new Map(planned.map(f=>[f.path,f]));
const expectedSet=new Set(expectedFiles);
const required=['targetFile','approvedFindingIds','processedFindingIds','candidateAcceptedFindingIds','validationEvidence','outcome','candidateStateVerified','updateApplied','fileOperation','newSha','commitSha','contentSha256'];
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const sha=value=>/^[a-f0-9]{40}$/.test(String(value||''));
const digest=value=>/^[a-f0-9]{64}$/.test(String(value||''));
const byFile=new Map();
for(const result of incoming){
  const path=String(result.targetFile||'');
  if(!path||!expectedSet.has(path))throw new Error('WF2_BATCH_INCOMPLETE:'+JSON.stringify({unexpectedFiles:path?[path]:[],category:'UNEXPECTED_OR_EMPTY_FILE'}));
  const expected=expectedByFile.get(path);
  const missingContract=required.filter(key=>result[key]===undefined||result[key]===null);
  if(!own(result,'oldSha'))missingContract.push('oldSha');
  if(missingContract.length)throw new Error('WF2_EFFECTIVE_RESULT_INVALID:'+JSON.stringify({path,missingFields:missingContract}));
  if(result.fileOperation!==expected.operation)throw new Error('WF2_PREWRITE_STATE_INVALID:'+JSON.stringify({path,category:'OPERATION_MISMATCH',expected:expected.operation,actual:result.fileOperation}));
  if(expected.operation==='MODIFY'){
    if(!sha(expected.originalBlobSha)||!sha(result.oldSha)||result.oldSha!==expected.originalBlobSha)throw new Error('WF2_PREWRITE_STATE_INVALID:'+JSON.stringify({path,category:'MODIFY_OLD_SHA_MISMATCH',expected:expected.originalBlobSha||null,actual:result.oldSha??null}));
  }else if(expected.operation==='CREATE'){
    if(expected.originalBlobSha!==null||result.oldSha!==null)throw new Error('WF2_PREWRITE_STATE_INVALID:'+JSON.stringify({path,category:'CREATE_PREEXISTING_BLOB',expected:null,actual:result.oldSha??null}));
  }else throw new Error('WF2_PREWRITE_STATE_INVALID:'+JSON.stringify({path,category:'UNSUPPORTED_OPERATION',actual:expected.operation}));
  if(!digest(expected.contentSha256)||result.contentSha256!==expected.contentSha256)throw new Error('CANDIDATE_CONTENT_MISMATCH:'+JSON.stringify({path,expected:expected.contentSha256||null,actual:result.contentSha256||null}));
  if(!sha(result.newSha)||!sha(result.commitSha))throw new Error('WF2_REMOTE_WRITE_EVIDENCE_INVALID:'+JSON.stringify({path,invalidFields:[!sha(result.newSha)?'newSha':null,!sha(result.commitSha)?'commitSha':null].filter(Boolean)}));
  const previous=byFile.get(path);
  if(previous){
    const same=String(previous.newSha)===String(result.newSha)&&String(previous.commitSha)===String(result.commitSha)&&String(previous.oldSha)===String(result.oldSha)&&String(previous.contentSha256)===String(result.contentSha256)&&String(previous.fileOperation)===String(result.fileOperation)&&String(previous.outcome)===String(result.outcome)&&Boolean(previous.candidateStateVerified)===Boolean(result.candidateStateVerified);
    if(!same)throw new Error('WF2_EFFECTIVE_RESULT_CONFLICT:'+JSON.stringify({path,category:'CONTRADICTORY_WRITE_EVIDENCE'}));
    continue;
  }
  byFile.set(path,result);
}
const results=[...byFile.values()].sort((a,b)=>String(a.targetFile).localeCompare(String(b.targetFile)));
const resultFiles=norm(results.map(r=>r.targetFile));
const acceptedFindingIds=norm(results.flatMap(r=>r.candidateAcceptedFindingIds||[]));
const missingFindingIds=expectedFindingIds.filter(id=>!acceptedFindingIds.includes(id));
const unexpectedFindingIds=acceptedFindingIds.filter(id=>!expectedFindingIds.includes(id));
const missingFiles=expectedFiles.filter(file=>!byFile.has(file));
const failed=results.filter(r=>!r.candidateStateVerified||r.outcome!=='CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION'||r.updateApplied!==true).map(r=>r.targetFile);
if(missingFiles.length&&!failed.length&&!missingFindingIds.length&&!unexpectedFindingIds.length)throw new Error('PARTIAL_REMOTE_WRITE:'+JSON.stringify({missingFiles,expectedCount:expectedFiles.length,actualCount:results.length,note:'PR creation forbidden -- not every CandidateManifest file is confirmed remotely with its expected contentSha256'}));
if(missingFindingIds.length||unexpectedFindingIds.length||missingFiles.length||failed.length||results.length!==expectedFiles.length)throw new Error('WF2_BATCH_INCOMPLETE:'+JSON.stringify({missingFindingIds,unexpectedFindingIds,missingFiles,failed,expectedCount:expectedFiles.length,actualCount:results.length}));
return [{json:{completenessPassed:true,candidateDecision:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',scannerResolution:'UNKNOWN_UNTIL_WF3',expectedFindingIds,expectedTargetFiles:expectedFiles,processedFindingIds:acceptedFindingIds,candidateAcceptedFindingIds:acceptedFindingIds,candidateVerifiedFiles:resultFiles,updatedFiles:resultFiles,commitShas:norm(results.map(r=>r.commitSha).filter(Boolean)),fileResults:results,candidateDigest:manifest.candidateDigest}}];`;

const failureTemplate=byName('Failure Envelope - Enforce Independent Review');
const failureNodes=[];
for(const name of ['Hash Cross-File Candidate Manifest','Validate Cross-File Candidate Manifest'].concat(stages.flatMap(([m])=>[`Prepare Cross-File ${m}`,`Call Cross-File ${m}`,`Enforce Cross-File ${m}`]),['Prepare Cross-File Review','Independent Cross-File Semantic Review','Enforce Cross-File Review'])){
  const id='wf2-cross-failure-'+crypto.createHash('sha1').update(name).digest('hex').slice(0,12);const failureName='Failure Envelope - '+name;
  let js=failureTemplate.parameters.jsCode.replace('failedNode:"Enforce Independent Review"',`failedNode:${JSON.stringify(name)}`);
  add({...structuredClone(failureTemplate),id,name:failureName,position:pos(10600,2200+failureNodes.length*80),parameters:{...structuredClone(failureTemplate.parameters),jsCode:js}});failureNodes.push(failureName);
}
const set=(from,outputs)=>{wf.connections[from]={main:outputs}};
set('Prepare Candidate Manifest',[[{node:'Classify Candidate Coordination Scope',type:'main',index:0}],[{node:'Failure Envelope - Assemble Candidate Manifest',type:'main',index:0}]]);
set('Classify Candidate Coordination Scope',[[{node:'Hash Cross-File Candidate Manifest',type:'main',index:0}],[{node:'Independent Semantic Review',type:'main',index:0}]]);
set('Hash Cross-File Candidate Manifest',[[{node:'Validate Cross-File Candidate Manifest',type:'main',index:0}],[{node:'Failure Envelope - Hash Cross-File Candidate Manifest',type:'main',index:0}]]);
set('Validate Cross-File Candidate Manifest',[[{node:'Prepare Cross-File COMPILE_MAIN',type:'main',index:0}],[{node:'Failure Envelope - Validate Cross-File Candidate Manifest',type:'main',index:0}]]);
for(let i=0;i<stages.length;i++){const [mode]=stages[i];const prep=`Prepare Cross-File ${mode}`,call=`Call Cross-File ${mode}`,enf=`Enforce Cross-File ${mode}`;const next=i+1<stages.length?`Prepare Cross-File ${stages[i+1][0]}`:'Prepare Cross-File Review';set(prep,[[{node:call,type:'main',index:0}],[{node:'Failure Envelope - '+prep,type:'main',index:0}]]);set(call,[[{node:enf,type:'main',index:0}],[{node:'Failure Envelope - '+call,type:'main',index:0}]]);set(enf,[[{node:next,type:'main',index:0}],[{node:'Failure Envelope - '+enf,type:'main',index:0}]]);}
set('Prepare Cross-File Review',[[{node:'Independent Cross-File Semantic Review',type:'main',index:0}],[{node:'Failure Envelope - Prepare Cross-File Review',type:'main',index:0}]]);
set('Independent Cross-File Semantic Review',[[{node:'Enforce Cross-File Review',type:'main',index:0}],[{node:'Failure Envelope - Independent Cross-File Semantic Review',type:'main',index:0}]]);
set('Enforce Cross-File Review',[[{node:'Hash Candidate Manifest',type:'main',index:0}],[{node:'Failure Envelope - Enforce Cross-File Review',type:'main',index:0}]]);
for(const n of failureNodes)set(n,[[{node:'Prepare WF2 Failure Status',type:'main',index:0}]]);

// Deliberate double FULL_TEST: after the cross-file pre-review FULL_TEST, the
// historical Call Candidate Verification runs FULL_TEST again. This preserves
// one byte-identical Git authorization path and binds Write Guard to the exact
// final digest; it is not an accidental duplicate.
const protectedAfter=Object.fromEntries(protectedNames.map(n=>[n,crypto.createHash('sha256').update(JSON.stringify(byName(n))).digest('hex')]));
if(JSON.stringify(protectedBefore)!==JSON.stringify(protectedAfter))throw new Error('PROTECTED_NODE_CHANGED');
fs.writeFileSync(output,JSON.stringify(root,null,2)+'\n');
