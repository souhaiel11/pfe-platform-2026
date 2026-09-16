import fs from 'node:fs';
import crypto from 'node:crypto';

const input=process.argv[2], output=process.argv[3]||input;
if(!input) throw new Error('usage: node harden-wf2-cross-file-compile-gate.mjs <input.json> [output.json]');
const root=JSON.parse(fs.readFileSync(input,'utf8'));const wf=Array.isArray(root)?root[0]:root;
const byName=name=>{const n=wf.nodes.find(x=>x.name===name);if(!n)throw new Error('missing node '+name);return n};
const protectedNames=['Independent Semantic Review','Enforce Independent Review','Call Candidate Verification','Call Write Guard','Write Guard Passed?','Create Missing Branch','Update File in Branch'];
const protectedBefore=Object.fromEntries(protectedNames.map(n=>[n,crypto.createHash('sha256').update(JSON.stringify(byName(n))).digest('hex')]));
const add=node=>{if(!wf.nodes.some(n=>n.name===node.name))wf.nodes.push(node)};
const pos=(x,y)=>[x,y];
const code=(name,id,jsCode,position)=>({parameters:{mode:'runOnceForAllItems',jsCode},id,name,type:'n8n-nodes-base.code',typeVersion:2,position,onError:'continueErrorOutput'});
const http=(name,id,position,body)=>({parameters:{method:'POST',url:'=http://backend:3001/api/candidate-verification/verify',sendHeaders:true,headerParameters:{parameters:[{name:'X-Internal-Secret',value:'={{ $env.N8N_INTERNAL_SECRET }}'}]},sendBody:true,specifyBody:'json',jsonBody:body,options:{timeout:300000}},id,name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position,onError:'continueErrorOutput'});
const classifier={parameters:{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:3},conditions:[{id:'cross-file-count',leftValue:'={{ $json.files.length }}',rightValue:2,operator:{type:'number',operation:'gte'}}],combinator:'and'},options:{}},id:'wf2-cross-file-route',name:'Classify Candidate Coordination Scope',type:'n8n-nodes-base.if',typeVersion:2.2,position:pos(7600,1960)};
add(classifier);
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

const failureTemplate=byName('Failure Envelope - Enforce Independent Review');
const failureNodes=[];
for(const name of stages.flatMap(([m])=>[`Prepare Cross-File ${m}`,`Call Cross-File ${m}`,`Enforce Cross-File ${m}`]).concat(['Prepare Cross-File Review','Independent Cross-File Semantic Review','Enforce Cross-File Review'])){
  const id='wf2-cross-failure-'+crypto.createHash('sha1').update(name).digest('hex').slice(0,12);const failureName='Failure Envelope - '+name;
  let js=failureTemplate.parameters.jsCode.replace('failedNode:"Enforce Independent Review"',`failedNode:${JSON.stringify(name)}`);
  add({...structuredClone(failureTemplate),id,name:failureName,position:pos(10600,2200+failureNodes.length*80),parameters:{...structuredClone(failureTemplate.parameters),jsCode:js}});failureNodes.push(failureName);
}
const set=(from,outputs)=>{wf.connections[from]={main:outputs}};
set('Prepare Candidate Manifest',[[{node:'Classify Candidate Coordination Scope',type:'main',index:0}],[{node:'Failure Envelope - Assemble Candidate Manifest',type:'main',index:0}]]);
set('Classify Candidate Coordination Scope',[[{node:'Prepare Cross-File COMPILE_MAIN',type:'main',index:0}],[{node:'Independent Semantic Review',type:'main',index:0}]]);
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
