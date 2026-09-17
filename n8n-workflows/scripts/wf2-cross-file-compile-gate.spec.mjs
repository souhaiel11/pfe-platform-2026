import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';

const path='n8n-workflows/pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json';
const wf=JSON.parse(fs.readFileSync(path))[0];
assert.equal(new Set(wf.nodes.map(node=>node.id)).size,wf.nodes.length,'all Phase 1 node ids remain unique');
const n=(w,name)=>{const x=w.nodes.find(v=>v.name===name);assert.ok(x,'missing '+name);return x};
const protectedNames=['Independent Semantic Review','Enforce Independent Review','Call Candidate Verification','Call Write Guard','Write Guard Passed?','Create Missing Branch','Update File in Branch'];
const expectedHashes={"Independent Semantic Review":"13989de167329fb90ba09269f6422eb80f3551d13532fef49ab2d47a14f86646","Enforce Independent Review":"7b6b96acc675d41872a56d5ff60b28eb3240038ce802f4be40a0a12b4b334a65","Call Candidate Verification":"0459e501a685105d7d271627f81e66d39a78517e1331084e07d585301e1f3455","Call Write Guard":"2cdcd7278ba5577ceac340db565d1277e607da97b578364c592e2e730d5b8e52","Write Guard Passed?":"013c56e41b5ad405713a72030daf89cc04dc6c5fb944f0481d8153f0442e0253","Create Missing Branch":"00ffe6b80098f5e3c20aefa176ea66ec6de6bbd8094d8f7840dbd61d44a75a1e","Update File in Branch":"88fb2574ac06496dddff619213f0a19c9a8a50e7ca934c7cb06b176be9a72524"};
for(const name of protectedNames)assert.equal(crypto.createHash('sha256').update(JSON.stringify(n(wf,name))).digest('hex'),expectedHashes[name],name+' must remain byte-identical');
const route=n(wf,'Classify Candidate Coordination Scope');
assert.equal(route.parameters.conditions.conditions[0].rightValue,2);
assert.equal(route.parameters.conditions.conditions[0].operator.operation,'gte');
assert.doesNotMatch(JSON.stringify(route),/S4684|S6813|rule/i);
assert.equal(wf.connections['Classify Candidate Coordination Scope'].main[1][0].node,'Independent Semantic Review');
assert.equal(wf.connections['Classify Candidate Coordination Scope'].main[0][0].node,'Hash Cross-File Candidate Manifest');
assert.equal(wf.connections['Hash Cross-File Candidate Manifest'].main[0][0].node,'Validate Cross-File Candidate Manifest');
assert.equal(wf.connections['Validate Cross-File Candidate Manifest'].main[0][0].node,'Prepare Cross-File COMPILE_MAIN');
const crossHash=n(wf,'Hash Cross-File Candidate Manifest');
assert.equal(crossHash.type,'n8n-nodes-base.crypto');
assert.deepEqual(crossHash.parameters,n(wf,'Hash Candidate Manifest').parameters,'cross-file pre-verification hash reuses the historical native Crypto contract exactly');
const crossNames=wf.nodes.filter(x=>/Cross-File/.test(x.name)).map(x=>x.name);
assert.ok(crossNames.includes('Independent Cross-File Semantic Review'));
for(const name of ['Prepare Cross-File COMPILE_MAIN','Enforce Cross-File COMPILE_MAIN','Prepare Cross-File COMPILE_TESTS','Enforce Cross-File COMPILE_TESTS','Prepare Cross-File FULL_TEST','Enforce Cross-File FULL_TEST','Prepare Cross-File Review','Enforce Cross-File Review']){
  const js=n(wf,name).parameters.jsCode;
  new vm.Script(`(async()=>{${js}})`,{filename:name});
  assert.doesNotMatch(js,/\brequire\s*\(|\bprocess\.|\bfetch\s*\(|\bnew\s+URL\s*\(/,name+' must remain sandbox compatible');
}
assert.match(fs.readFileSync('n8n-workflows/scripts/harden-wf2-cross-file-compile-gate.mjs','utf8'),/Deliberate double FULL_TEST/);
assert.match(fs.readFileSync('n8n-workflows/WF2-COMPILE-BEFORE-REVIEW-TARGET.md','utf8'),/deliberately runs `FULL_TEST` twice/);
// All cross-file compile gates must precede review, and all Git writes remain downstream of historical Write Guard.
const reachable=(start)=>{const seen=new Set(),q=[start];while(q.length){const x=q.shift();if(seen.has(x))continue;seen.add(x);for(const outs of wf.connections[x]?.main||[])for(const e of outs||[])q.push(e.node)}return seen};
const local=reachable('Independent Semantic Review');
assert.ok(!local.has('Prepare Cross-File COMPILE_MAIN'),'legacy route cannot enter cross-file path');
const cross=reachable('Hash Cross-File Candidate Manifest');
for(const x of ['Call Cross-File COMPILE_MAIN','Call Cross-File COMPILE_TESTS','Call Cross-File FULL_TEST','Independent Cross-File Semantic Review','Call Candidate Verification','Call Write Guard','Update File in Branch'])assert.ok(cross.has(x),'cross route reaches '+x);
assert.ok(cross.has('Call Candidate Verification'),'historical final FULL_TEST deliberately retained');

// Execution 2019 replay: exact manifest shape and file identities produced by
// Prepare Candidate Manifest.  The native Crypto node hashes _canonicalJson;
// the validation and all progressive stages must carry that one digest.
const execution2019={
  candidateId:'82ed71a860de1d8a58836b27de5d7bcf0e9f8c4f056996066d386c55c07f3c28-attempt-3',
  requestId:'72ddba06-2f94-462c-a806-cb3053636d74',batchId:'82ed71a860de1d8a58836b27de5d7bcf0e9f8c4f056996066d386c55c07f3c28',candidateAttempt:3,
  repository:'souhaiel11/pfe-app-test',candidateBaseSha:'6ed56ff791acbf3e111431285bef7b30c8076084',branchExists:false,
  targetBranchName:'fix/pfe-6edab0c8-64df-4bb7-ba9c-7dff9cbcd4f3-72ddba06-2f94-462c-a806-cb3053636d74',baseBranch:'main',
  files:[
    {path:'src/main/java/com/pfe/devsecops/controller/TaskController.java',operation:'MODIFY',contentSha256:'f5ea99bf2065a9b612f1947350507d50f288e4cc8ce6a0b7a7a4711a5646eff2'},
    {path:'src/main/java/com/pfe/devsecops/service/TaskService.java',operation:'MODIFY',contentSha256:'c87304a7c405019e3e133a692ab1dac1428994c2e6054809a9c96cfd201e19b1'},
    {path:'src/main/java/com/pfe/devsecops/dto/TaskDto.java',operation:'CREATE',contentSha256:'a6af24f8764d12a55deb488bd51745700ac94d68c9312fcc2e5542fefb97a6ad'},
  ],candidateSetComplete:true,llmRequestBody:{system:'review',messages:[{role:'user',content:'execution-2019'}]},
};
for(const file of execution2019.files){
  file.approvedFindingIds=['f11d4686-a7ba-4c0c-abbb-a12998c57220'];
  file.processedFindingIds=['f11d4686-a7ba-4c0c-abbb-a12998c57220'];
  file.validationEvidence={genericPreflight:['POLICY_AUTHORIZED_FILE','CREATE_MODIFY_STATE_CONFIRMED','NON_EMPTY_CHANGE','STRUCTURE_SANITY','NO_GENERIC_PROHIBITED_PROPERTY']};
}
const canonicalFiles=execution2019.files.map(({path,operation,contentSha256})=>({path,operation,contentSha256})).sort((a,b)=>a.path.localeCompare(b.path));
execution2019._canonicalJson=JSON.stringify({candidateBaseSha:execution2019.candidateBaseSha,files:canonicalFiles});
execution2019.candidateDigest=crypto.createHash('sha256').update(execution2019._canonicalJson).digest('hex');
assert.match(execution2019.candidateDigest,/^[a-f0-9]{64}$/);

const runCode=(name,current,mocks={})=>{
  const js=n(wf,name).parameters.jsCode;
  const $input={first:()=>({json:current})};
  const $=nodeName=>({first:()=>({json:mocks[nodeName]})});
  return new vm.Script(`(()=>{${js}})()`,{filename:name}).runInNewContext({$input,$,$json:current});
};
const [validated]=runCode('Validate Cross-File Candidate Manifest',execution2019);
assert.equal(validated.json.candidateDigest,execution2019.candidateDigest,'execution 2019 manifest gains a valid digest before COMPILE_MAIN');
let state=validated.json;
const stages2019=[['COMPILE_MAIN',1],['COMPILE_TESTS',2],['FULL_TEST',3]];
for(const [mode,sequence] of stages2019){
  const prepareName=`Prepare Cross-File ${mode}`;
  const previous=sequence===1?{}:{[`Enforce Cross-File ${stages2019[sequence-2][0]}`]:state};
  const [prepared]=runCode(prepareName,state,previous);
  assert.equal(prepared.json.candidateDigest,execution2019.candidateDigest,mode+' carries the execution 2019 digest');
  assert.equal(prepared.json.verificationRequest.manifest.candidateDigest,execution2019.candidateDigest,mode+' sends the same manifest digest');
  assert.equal(prepared.json.verificationStep.stateDigest,execution2019.candidateDigest,mode+' binds stateDigest to the same digest');
  const verifierResult={overall:'PASS',mode,identity:{candidateDigest:execution2019.candidateDigest,stateDigest:execution2019.candidateDigest,verificationStep:sequence}};
  const [enforced]=runCode(`Enforce Cross-File ${mode}`,verifierResult,{[prepareName]:prepared.json});
  state=enforced.json;
}
const [review]=runCode('Prepare Cross-File Review',state);
assert.equal(review.json.candidateDigest,execution2019.candidateDigest);
assert.equal(review.json.llmRequestBody.messages.length,1,'review accepts the complete manifest plus all deterministic proofs');
const acceptedReview={stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({verdict:'ACCEPTABLE_FOR_SCANNER_VALIDATION',findings:[]})}]};
const reviewed=runCode('Enforce Cross-File Review',acceptedReview,{'Prepare Cross-File Review':review.json});
assert.equal(reviewed.json.candidateDigest,execution2019.candidateDigest,'review preserves the pre-verified digest');
assert.equal(reviewed.json._canonicalJson,execution2019._canonicalJson,'review preserves the one canonical serialization for the historical final hash');
assert.ok(reviewed.json.files.every(file=>Array.isArray(file.candidateAcceptedFindingIds)),'review supplies every downstream per-file acceptance field');
const historicalDigest=crypto.createHash('sha256').update(reviewed.json._canonicalJson).digest('hex');
assert.equal(historicalDigest,execution2019.candidateDigest,'historical final hash / Write Guard digest is byte-identical to all progressive stages');
const [finalManifest]=runCode('Assemble Candidate Manifest',{...reviewed.json,candidateDigest:historicalDigest});
assert.equal(finalManifest.json.candidateDigest,execution2019.candidateDigest,'final frozen manifest keeps the progressive digest');
assert.equal(finalManifest.json._canonicalJson,undefined,'final manifest strips only the transient canonical serialization');
const expanded=runCode('Expand Manifest Files',{}, {'Assemble Candidate Manifest':finalManifest.json});
assert.equal(expanded.length,3,'the real execution 2019 manifest satisfies the complete downstream write expansion contract');
assert.ok(expanded.every(item=>item.json.contentSha256&&item.json.candidateAcceptedFindingIds),'all write-path fields are present after cross-file review');
assert.match(n(wf,'Call Write Guard').parameters.jsonBody,/Assemble Candidate Manifest/,'Write Guard consumes the same final frozen manifest');
console.log('WF2 cross-file routing, sandbox syntax, S6813 byte identity: PASS');
