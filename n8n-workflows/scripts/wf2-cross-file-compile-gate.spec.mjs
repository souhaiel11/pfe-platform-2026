import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';

const path='n8n-workflows/pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json';
const wf=JSON.parse(fs.readFileSync(path))[0];
assert.equal(new Set(wf.nodes.map(node=>node.id)).size,wf.nodes.length,'all Phase 1 node ids remain unique');
const n=(w,name)=>{const x=w.nodes.find(v=>v.name===name);assert.ok(x,'missing '+name);return x};
const protectedNames=['Independent Semantic Review','Enforce Independent Review','Call Candidate Verification','Call Write Guard','Write Guard Passed?','Create Missing Branch','Update File in Branch'];
const expectedHashes={"Parse - Code Patch Output":"ef836c4f63876d7a19fad78bfb44eed006c3a179ab6bfe5b7a7c4b9b3ea56d7a","Generic Candidate Preflight":"68fc966b9229f264384b61dc11f599b652a6832431d1c7def1aeddff1ef741a6","Independent Semantic Review":"13989de167329fb90ba09269f6422eb80f3551d13532fef49ab2d47a14f86646","Enforce Independent Review":"7b6b96acc675d41872a56d5ff60b28eb3240038ce802f4be40a0a12b4b334a65","Build File Result":"b7b1877e55c9e2a3ae3f14d5d9f3258d173de935094bcc3fd3a1023cc12826d5","Build Reconciled File Result":"728f927ccea4c254ce6a139bea894f6bd001cdf26beafd7e81393d19d854c78b","Call Candidate Verification":"0459e501a685105d7d271627f81e66d39a78517e1331084e07d585301e1f3455","Call Write Guard":"2cdcd7278ba5577ceac340db565d1277e607da97b578364c592e2e730d5b8e52","Write Guard Passed?":"013c56e41b5ad405713a72030daf89cc04dc6c5fb944f0481d8153f0442e0253","Create Missing Branch":"00ffe6b80098f5e3c20aefa176ea66ec6de6bbd8094d8f7840dbd61d44a75a1e","Create File in Branch":"6d3d0fc60f429fb490f74fa33cc3e616652830f8aa518cf5d9ebf5a745eb6de3","Update File in Branch":"88fb2574ac06496dddff619213f0a19c9a8a50e7ca934c7cb06b176be9a72524"};
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
    {path:'src/main/java/com/pfe/devsecops/controller/TaskController.java',operation:'MODIFY',originalBlobSha:'81619b128f913dd5fe36e3f02a88b0c2e1453e36',contentSha256:'f5ea99bf2065a9b612f1947350507d50f288e4cc8ce6a0b7a7a4711a5646eff2'},
    {path:'src/main/java/com/pfe/devsecops/service/TaskService.java',operation:'MODIFY',originalBlobSha:'9309b455f7d09b50ec039d1cf18bd068d1b21ef7',contentSha256:'c87304a7c405019e3e133a692ab1dac1428994c2e6054809a9c96cfd201e19b1'},
    {path:'src/main/java/com/pfe/devsecops/dto/TaskDto.java',operation:'CREATE',originalBlobSha:null,contentSha256:'a6af24f8764d12a55deb488bd51745700ac94d68c9312fcc2e5542fefb97a6ad'},
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
  const values=Array.isArray(current)?current:[current];
  const $input={first:()=>({json:values[0]}),all:()=>values.map(json=>({json}))};
  const $=nodeName=>({first:()=>({json:mocks[nodeName]}),item:{json:mocks[nodeName]}});
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
assert.ok(expanded.every(item=>Object.prototype.hasOwnProperty.call(item.json,'oldSha')),'Expand Manifest Files carries oldSha as an own property for every file');
assert.deepEqual(expanded.map(item=>item.json.oldSha),['81619b128f913dd5fe36e3f02a88b0c2e1453e36','9309b455f7d09b50ec039d1cf18bd068d1b21ef7',null],'oldSha matches the frozen manifest blob identity per file, null for CREATE');
assert.match(n(wf,'Call Write Guard').parameters.jsonBody,/Assemble Candidate Manifest/,'Write Guard consumes the same final frozen manifest');

// Execution 2020 replay: these are the exact six per-file identities and
// GitHub write receipts persisted by Build File Result (Pass 2).  CREATE has
// no pre-write blob, represented explicitly by oldSha:null; MODIFY must bind
// to the exact manifest blob SHA.
const findingId='f11d4686-a7ba-4c0c-abbb-a12998c57220';
const targetBranchName2020='fix/pfe-6edab0c8-64df-4bb7-ba9c-7dff9cbcd4f3-72ddba06-2f94-462c-a806-cb3053636d74';
// [path, operation, originalBlobSha, contentSha256, newSha, commitSha] -- the exact six
// pre-write blob identities and GitHub write receipts from execution 2020 (HEAD 9690613e).
const identities2020=[
  ['src/main/java/com/pfe/devsecops/controller/TaskController.java','MODIFY','81619b128f913dd5fe36e3f02a88b0c2e1453e36','ad164931054432c5d0cb80bd2ea99194ea09fa85b89001d70eb3455346d30dee','24a17ceae6a4d49c2b9cfa868922d3e47db0a975','c04ec8b69fd0fe97ce29eda9e97b7c61fb14d141'],
  ['src/main/java/com/pfe/devsecops/service/TaskService.java','MODIFY','9309b455f7d09b50ec039d1cf18bd068d1b21ef7','922a5745bb11ff445973c8ddcc494a79722de538a166aa9fd94dd7304ea13ba7','2fcfa0e0b10169aa51a66157d3581d5a6a3e6c38','97c45acc0291fa92ca427fafd0b6475e7a22926d'],
  ['src/main/java/com/pfe/devsecops/dto/TaskDTO.java','CREATE',null,'968e261cb41507b37aea4496482d8e88c94fd58ecbd3147973a4192e2f480b6e','77ff6bb10f942e6b2c5e8b1e34e9cae2f226494b','e5fa678182fcd8264dd95d81777ec02d69c5797b'],
  ['src/main/java/com/pfe/devsecops/dto/TaskCreateDTO.java','CREATE',null,'afa1f7884166665a559e91201a752bcc228040526fda9cd233a31411e40b7684','155b92ae5bedcbe682faf0ca5d78471d55608330','3cd7db1f818f2fc7b1a0d52960bb7fd66cd3e903'],
  ['src/main/java/com/pfe/devsecops/dto/TaskUpdateDTO.java','CREATE',null,'11c0bbcc6fb075dc844587882f245dbc66a410885f1d42903f73bcd2d951f5ad','7bd80b0a32484b1ef1a97e2414f755b90313b6e5','43d2e07dc3ff2f2f1e1975cdf5d666eb94f784b9'],
  ['src/main/java/com/pfe/devsecops/dto/TaskStatusDTO.java','CREATE',null,'05f0f034a8e1b1bb4375305db003ae782e9d8b1fac5707a1e59b21c8f52931e7','f8d577a8bae13bf1888d66770af324341719016f','9690613ecc5e87b33663ee8f82eea4f94d67bbfe'],
];
const execution2020Manifest={candidateDigest:'b51f63e1abfbe037f247ccbb37448433a39a638e56a9b39f94c7d5d85208a32c',files:identities2020.map(([path,operation,originalBlobSha,contentSha256])=>({
  path,operation,originalBlobSha,content:'placeholder',contentSha256,file_path:path,
  repository_owner:'souhaiel11',repository_name:'pfe-app-test',branchName:targetBranchName2020,
  commitMessage:'fix(security): candidate remediation for batch 82ed71a8',sourceContent:operation==='MODIFY'?'ORIGINAL':'',
  approvedFindingIds:[findingId],processedFindingIds:[findingId],candidateAcceptedFindingIds:[findingId],
  validationEvidence:{genericPreflight:['POLICY_AUTHORIZED_FILE']},
}))};

// Replay the real write loop -- Expand Manifest Files -> (Recompute Content Hash, native
// Crypto, additive) -> Verify Content Hash Before Send -> Create/Update File in Branch
// (GitHub) -> Build File Result (Pass 2) -- once per file, exactly as "Loop Over Manifest
// Files" (batchSize 1) drives it, so any field the write loop drops is caught here instead
// of at Validate Batch Completeness after all six commits have already landed.
const expanded2020=runCode('Expand Manifest Files',{},{'Assemble Candidate Manifest':execution2020Manifest}).map(i=>i.json);
assert.equal(expanded2020.length,6);
const receipts2020=expanded2020.map((item,index)=>{
  const [,,,,newSha,commitSha]=identities2020[index];
  const afterRecompute={...item,_recomputedContentSha256:item.contentSha256}; // native Crypto node result
  const verifiedResult=runCode('Verify Content Hash Before Send',afterRecompute);
  const verified=Array.isArray(verifiedResult)?verifiedResult[0]:verifiedResult;
  const githubWriteResponse={content:{sha:newSha},commit:{sha:commitSha}}; // real GitHub Contents API shape
  const builtResult=runCode('Build File Result (Pass 2)',githubWriteResponse,{'Expand Manifest Files':verified.json});
  const built=Array.isArray(builtResult)?builtResult[0]:builtResult;
  return built.json;
});
assert.ok(receipts2020.every(r=>Object.prototype.hasOwnProperty.call(r,'oldSha')),'Build File Result (Pass 2) carries oldSha as an own property for every real 2020 receipt');
assert.deepEqual(receipts2020.map(r=>r.oldSha),identities2020.map(([,,originalBlobSha])=>originalBlobSha),'oldSha on every write receipt matches the frozen manifest blob identity, null for CREATE');

const batchContext={findingIds:[findingId],targetBranchName:targetBranchName2020,baseBranch:'main',githubRepo:'souhaiel11/pfe-app-test',correctiveAttempt:false};
const [complete2020]=runCode('Validate Batch Completeness',receipts2020,{'Prepare Batch Context':batchContext,'Assemble Candidate Manifest':execution2020Manifest});
assert.equal(complete2020.json.completenessPassed,true,'execution 2020 passes the post-write completeness barrier');
assert.equal(complete2020.json.fileResults.length,6);
assert.equal(complete2020.json.commitShas.at(-1),'e5fa678182fcd8264dd95d81777ec02d69c5797b','commit evidence is complete and normalized, not reduced to branch HEAD order');
assert.equal(complete2020.json.fileResults.filter(file=>file.fileOperation==='CREATE').every(file=>file.oldSha===null),true,'CREATE retains explicit no-prior-blob evidence');
assert.throws(()=>runCode('Validate Batch Completeness',[{...receipts2020[0],oldSha:'0'.repeat(40)},...receipts2020.slice(1)],{'Prepare Batch Context':batchContext,'Assemble Candidate Manifest':execution2020Manifest}),/MODIFY_OLD_SHA_MISMATCH/,'drift evidence remains fail closed');
assert.throws(()=>{const broken=receipts2020.map(x=>({...x}));delete broken[2].oldSha;runCode('Validate Batch Completeness',broken,{'Prepare Batch Context':batchContext,'Assemble Candidate Manifest':execution2020Manifest})},/missingFields.*oldSha/,'a dropped oldSha field is still rejected');

// Point-mutation matrix (cases A-G): the corrected validator must require oldSha as
// an own property, accept canonical null strictly for CREATE, accept a 40-hex blob
// SHA strictly for MODIFY, and reject every other combination -- independent of any
// other field being valid. Index 0 = TaskController.java (MODIFY), index 2 =
// TaskDTO.java (the real first CREATE file execution 2020 failed on).
const mutateReceipt=(index,patch)=>receipts2020.map((r,i)=>i===index?{...r,...patch}:{...r});
const dropOldSha=(index)=>receipts2020.map((r,i)=>{if(i!==index)return {...r};const {oldSha,...rest}=r;return rest;});
const runVBC=items=>runCode('Validate Batch Completeness',items,{'Prepare Batch Context':batchContext,'Assemble Candidate Manifest':execution2020Manifest});
// A. CREATE receipt with own oldSha:null -> PASS.
assert.equal(runVBC(receipts2020)[0].json.completenessPassed,true,'A: CREATE with own oldSha:null passes');
// B. CREATE receipt missing oldSha property -> BLOCK.
assert.throws(()=>runVBC(dropOldSha(2)),/missingFields.*oldSha/,'B: CREATE missing oldSha is blocked');
// C. CREATE receipt oldSha = "" -> BLOCK.
assert.throws(()=>runVBC(mutateReceipt(2,{oldSha:''})),/CREATE_PREEXISTING_BLOB/,'C: CREATE oldSha="" is blocked');
// D. CREATE receipt oldSha = 40-hex -> BLOCK.
assert.throws(()=>runVBC(mutateReceipt(2,{oldSha:'a'.repeat(40)})),/CREATE_PREEXISTING_BLOB/,'D: CREATE oldSha=40-hex is blocked');
// E. MODIFY receipt with correct 40-hex -> PASS.
assert.equal(runVBC(receipts2020)[0].json.fileResults.find(f=>f.targetFile.endsWith('TaskController.java')).oldSha,identities2020[0][2],'E: MODIFY with correct 40-hex passes');
// F. MODIFY receipt oldSha = null -> BLOCK.
assert.throws(()=>runVBC(mutateReceipt(0,{oldSha:null})),/MODIFY_OLD_SHA_MISMATCH/,'F: MODIFY oldSha=null is blocked');
// G. MODIFY receipt missing oldSha -> BLOCK.
assert.throws(()=>runVBC(dropOldSha(0)),/missingFields.*oldSha/,'G: MODIFY missing oldSha is blocked');
console.log('WF2 execution-2020 point-mutation matrix (cases A-G): PASS');

// H + I. Historical-vs-corrected regression, against the exact six receipts persisted
// by n8n for execution 2020 (execution_data row, executionId=2020, workflowId
// u3eeMwTuhCsetfcS, read directly from n8n's own SQLite store and unflattened with
// n8n's bundled `flatted` library -- not reconstructed). The OLD jsCode below is the
// Validate Batch Completeness body that was actually live in n8n when execution 2020
// ran (captured from execution_data.workflowData for the same execution, byte for
// byte) -- frozen here so a future regression to "oldSha in a flat required[] list"
// is caught even if nobody remembers execution 2020.
const realExecution2020Receipts=[
  {targetFile:'src/main/java/com/pfe/devsecops/controller/TaskController.java',approvedFindingIds:[findingId],processedFindingIds:[findingId],candidateAcceptedFindingIds:[findingId],validationEvidence:{},outcome:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',candidateStateVerified:true,updateApplied:true,fileOperation:'MODIFY',oldSha:'81619b128f913dd5fe36e3f02a88b0c2e1453e36',newSha:'24a17ceae6a4d49c2b9cfa868922d3e47db0a975',commitSha:'c04ec8b69fd0fe97ce29eda9e97b7c61fb14d141',contentSha256:'ad164931054432c5d0cb80bd2ea99194ea09fa85b89001d70eb3455346d30dee'},
  {targetFile:'src/main/java/com/pfe/devsecops/service/TaskService.java',approvedFindingIds:[findingId],processedFindingIds:[findingId],candidateAcceptedFindingIds:[findingId],validationEvidence:{},outcome:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',candidateStateVerified:true,updateApplied:true,fileOperation:'MODIFY',oldSha:'9309b455f7d09b50ec039d1cf18bd068d1b21ef7',newSha:'2fcfa0e0b10169aa51a66157d3581d5a6a3e6c38',commitSha:'97c45acc0291fa92ca427fafd0b6475e7a22926d',contentSha256:'922a5745bb11ff445973c8ddcc494a79722de538a166aa9fd94dd7304ea13ba7'},
  {targetFile:'src/main/java/com/pfe/devsecops/dto/TaskDTO.java',approvedFindingIds:[findingId],processedFindingIds:[findingId],candidateAcceptedFindingIds:[findingId],validationEvidence:{},outcome:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',candidateStateVerified:true,updateApplied:true,fileOperation:'CREATE',oldSha:null,newSha:'77ff6bb10f942e6b2c5e8b1e34e9cae2f226494b',commitSha:'e5fa678182fcd8264dd95d81777ec02d69c5797b',contentSha256:'968e261cb41507b37aea4496482d8e88c94fd58ecbd3147973a4192e2f480b6e'},
  {targetFile:'src/main/java/com/pfe/devsecops/dto/TaskCreateDTO.java',approvedFindingIds:[findingId],processedFindingIds:[findingId],candidateAcceptedFindingIds:[findingId],validationEvidence:{},outcome:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',candidateStateVerified:true,updateApplied:true,fileOperation:'CREATE',oldSha:null,newSha:'155b92ae5bedcbe682faf0ca5d78471d55608330',commitSha:'3cd7db1f818f2fc7b1a0d52960bb7fd66cd3e903',contentSha256:'afa1f7884166665a559e91201a752bcc228040526fda9cd233a31411e40b7684'},
  {targetFile:'src/main/java/com/pfe/devsecops/dto/TaskUpdateDTO.java',approvedFindingIds:[findingId],processedFindingIds:[findingId],candidateAcceptedFindingIds:[findingId],validationEvidence:{},outcome:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',candidateStateVerified:true,updateApplied:true,fileOperation:'CREATE',oldSha:null,newSha:'7bd80b0a32484b1ef1a97e2414f755b90313b6e5',commitSha:'43d2e07dc3ff2f2f1e1975cdf5d666eb94f784b9',contentSha256:'11c0bbcc6fb075dc844587882f245dbc66a410885f1d42903f73bcd2d951f5ad'},
  {targetFile:'src/main/java/com/pfe/devsecops/dto/TaskStatusDTO.java',approvedFindingIds:[findingId],processedFindingIds:[findingId],candidateAcceptedFindingIds:[findingId],validationEvidence:{},outcome:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',candidateStateVerified:true,updateApplied:true,fileOperation:'CREATE',oldSha:null,newSha:'f8d577a8bae13bf1888d66770af324341719016f',commitSha:'9690613ecc5e87b33663ee8f82eea4f94d67bbfe',contentSha256:'05f0f034a8e1b1bb4375305db003ae782e9d8b1fac5707a1e59b21c8f52931e7'},
];
const realExecution2020BatchContext={findingIds:[findingId],targetBranchName:targetBranchName2020,baseBranch:'main',repository_owner:'souhaiel11',repository_name:'pfe-app-test'};
const historicalLiveJsCode="\nconst ctx=$('Prepare Batch Context').first().json;const manifest=$('Assemble Candidate Manifest').first().json;const planned=manifest.files;const incoming=$input.all().map(i=>i.json);const norm=v=>[...new Set((v||[]).map(String))].sort();const expectedFindingIds=norm(ctx.findingIds);const expectedFiles=norm(planned.map(f=>f.path));const expectedContentByFile=new Map(planned.map(f=>[f.path,f.contentSha256]));const expectedSet=new Set(expectedFiles);const required=['targetFile','approvedFindingIds','processedFindingIds','candidateAcceptedFindingIds','validationEvidence','outcome','candidateStateVerified','updateApplied','fileOperation','oldSha','newSha','commitSha'];const byFile=new Map();for(const result of incoming){const path=String(result.targetFile||'');if(!path||!expectedSet.has(path))throw new Error('WF2_BATCH_INCOMPLETE:'+JSON.stringify({unexpectedFiles:path?[path]:[],category:'UNEXPECTED_OR_EMPTY_FILE'}));const missingContract=required.filter(key=>result[key]===undefined||result[key]===null);if(missingContract.length)throw new Error('WF2_EFFECTIVE_RESULT_INVALID:'+JSON.stringify({path,missingFields:missingContract}));if(result.contentSha256&&expectedContentByFile.get(path)&&result.contentSha256!==expectedContentByFile.get(path))throw new Error('CANDIDATE_CONTENT_MISMATCH:'+JSON.stringify({path,expected:expectedContentByFile.get(path),actual:result.contentSha256}));const previous=byFile.get(path);if(previous){const same=String(previous.newSha)===String(result.newSha)&&String(previous.commitSha)===String(result.commitSha)&&String(previous.outcome)===String(result.outcome)&&Boolean(previous.candidateStateVerified)===Boolean(result.candidateStateVerified);if(!same)throw new Error('WF2_EFFECTIVE_RESULT_CONFLICT:'+JSON.stringify({path,category:'CONTRADICTORY_WRITE_EVIDENCE'}));continue}byFile.set(path,result)}const results=[...byFile.values()].sort((a,b)=>String(a.targetFile).localeCompare(String(b.targetFile)));const resultFiles=norm(results.map(r=>r.targetFile));const acceptedFindingIds=norm(results.flatMap(r=>r.candidateAcceptedFindingIds||[]));const missingFindingIds=expectedFindingIds.filter(id=>!acceptedFindingIds.includes(id));const unexpectedFindingIds=acceptedFindingIds.filter(id=>!expectedFindingIds.includes(id));const missingFiles=expectedFiles.filter(file=>!byFile.has(file));const failed=results.filter(r=>!r.candidateStateVerified||r.outcome!=='CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION'||r.updateApplied!==true).map(r=>r.targetFile);\nif(missingFiles.length&&!failed.length&&!missingFindingIds.length&&!unexpectedFindingIds.length){throw new Error('PARTIAL_REMOTE_WRITE:'+JSON.stringify({missingFiles,expectedCount:expectedFiles.length,actualCount:results.length,note:'PR creation forbidden -- not every CandidateManifest file is confirmed remotely with its expected contentSha256'}));}\nif(missingFindingIds.length||unexpectedFindingIds.length||missingFiles.length||failed.length||results.length!==expectedFiles.length)throw new Error('WF2_BATCH_INCOMPLETE:'+JSON.stringify({missingFindingIds,unexpectedFindingIds,missingFiles,failed,expectedCount:expectedFiles.length,actualCount:results.length}));\nreturn [{json:{completenessPassed:true,candidateDecision:'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',scannerResolution:'UNKNOWN_UNTIL_WF3',expectedFindingIds,expectedTargetFiles:expectedFiles,processedFindingIds:acceptedFindingIds,candidateAcceptedFindingIds:acceptedFindingIds,candidateVerifiedFiles:resultFiles,updatedFiles:resultFiles,commitShas:norm(results.map(r=>r.commitSha).filter(Boolean)),fileResults:results,candidateDigest:manifest.candidateDigest}}];";
const runRawCode=(jsCode,current,mocks={})=>{
  const values=Array.isArray(current)?current:[current];
  const $input={first:()=>({json:values[0]}),all:()=>values.map(json=>({json}))};
  const $=nodeName=>({first:()=>({json:mocks[nodeName]}),item:{json:mocks[nodeName]}});
  return new vm.Script(`(()=>{${jsCode}})()`,{filename:'historical-live-validator'}).runInNewContext({$input,$,$json:current});
};
// H. The exact execution-2020 six receipts, run through the CURRENT (corrected) node -> PASS.
const [realComplete2020]=runCode('Validate Batch Completeness',realExecution2020Receipts,{'Prepare Batch Context':realExecution2020BatchContext,'Assemble Candidate Manifest':execution2020Manifest});
assert.equal(realComplete2020.json.completenessPassed,true,'H: the exact persisted execution-2020 receipts pass the corrected validator');
// I. The exact jsCode that was actually live in n8n when execution 2020 ran throws the
// exact historical failure on those same six receipts; the current node does not.
assert.throws(()=>runRawCode(historicalLiveJsCode,realExecution2020Receipts,{'Prepare Batch Context':realExecution2020BatchContext,'Assemble Candidate Manifest':execution2020Manifest}),/WF2_EFFECTIVE_RESULT_INVALID:.*"missingFields":\["oldSha"\]/,'I: the historical live validator is reproducibly documented as a failure on the exact 2020 receipts');
assert.doesNotThrow(()=>runCode('Validate Batch Completeness',realExecution2020Receipts,{'Prepare Batch Context':realExecution2020BatchContext,'Assemble Candidate Manifest':execution2020Manifest}),'I: the corrected production validator does not reproduce the historical failure');
console.log('WF2 execution-2020 historical-vs-corrected regression (cases H, I): PASS');

// Simulate every local decision after the barrier.  With no matching open PR,
// the exact 2020 batch reaches Create Pull Request1 and its status payload has
// every completeness field it consumes.
const [prSelection]=runCode('Select Existing PR',[],{'Prepare Batch Context':batchContext});
assert.equal(prSelection.json.createRequired,true);
assert.equal(wf.connections['Existing PR?'].main[1][0].node,'Create Pull Request1');
const prBody=n(wf,'Create Pull Request1').parameters.jsonBody;
for(const field of ['targetBranchName','baseBranch','batchId'])assert.match(prBody,new RegExp(field),'Create PR consumes '+field);
const statusBody=n(wf,'Save Execution Result to Backend').parameters.jsonBody;
for(const field of ['completenessPassed','processedFindingIds','candidateAcceptedFindingIds','candidateVerifiedFiles','expectedTargetFiles','fileResults','updatedFiles','commitShas'])assert.ok(Object.hasOwn(complete2020.json,field),'execution 2020 supplies downstream status field '+field);
assert.match(statusBody,/status: 'PR_CREATED'/);

// Build Reconciled File Result: this node is not on the execution-2020 causal path
// (reconciliation never ran that execution -- confirmed by replaying persisted
// runData), but its own reference bug (plain $json instead of named-node refs) is a
// real, independent defect fixed in the same artifact. It has no other deterministic
// test anywhere in this suite, so cover its corrected behavior directly here.
const reconciledCandidateModify={target_file_path:'src/main/java/com/pfe/devsecops/controller/TaskController.java',fileOperation:'MODIFY',oldSha:'81619b128f913dd5fe36e3f02a88b0c2e1453e36',contentSha256:'ad164931054432c5d0cb80bd2ea99194ea09fa85b89001d70eb3455346d30dee',approvedFindingIds:[findingId],processedFindingIds:[findingId],candidateAcceptedFindingIds:[findingId],validationEvidence:{}};
const reconciledCandidateCreate={target_file_path:'src/main/java/com/pfe/devsecops/dto/TaskDTO.java',fileOperation:'CREATE',oldSha:null,contentSha256:'968e261cb41507b37aea4496482d8e88c94fd58ecbd3147973a4192e2f480b6e',approvedFindingIds:[findingId],processedFindingIds:[findingId],candidateAcceptedFindingIds:[findingId],validationEvidence:{}};
const reconciledEvaluated={newSha:'24a17ceae6a4d49c2b9cfa868922d3e47db0a975'};
const headLookupResponse={statusCode:200,body:{ref:'refs/heads/'+targetBranchName2020,object:{sha:'c04ec8b69fd0fe97ce29eda9e97b7c61fb14d141'}}};
let reconciledResultModify=runCode('Build Reconciled File Result',headLookupResponse,{'Expand Manifest Files':reconciledCandidateModify,'Evaluate GitHub Write Reconciliation (Pass 2)':reconciledEvaluated});
if(Array.isArray(reconciledResultModify))reconciledResultModify=reconciledResultModify[0];
assert.equal(reconciledResultModify.json.oldSha,'81619b128f913dd5fe36e3f02a88b0c2e1453e36','reconciled MODIFY result carries the real candidate oldSha, not a field off the raw ref lookup');
assert.equal(reconciledResultModify.json.targetFile,'src/main/java/com/pfe/devsecops/controller/TaskController.java','reconciled result reads target_file_path from Expand Manifest Files, not the nonexistent targetFile key');
assert.equal(reconciledResultModify.json.commitSha,'c04ec8b69fd0fe97ce29eda9e97b7c61fb14d141','commitSha comes from the ref lookup head, not the candidate');
assert.equal(reconciledResultModify.json.newSha,'24a17ceae6a4d49c2b9cfa868922d3e47db0a975','newSha comes from the reconciliation evaluation step');
assert.equal(reconciledResultModify.json.contentSha256,'ad164931054432c5d0cb80bd2ea99194ea09fa85b89001d70eb3455346d30dee','contentSha256 is present -- absent entirely before this fix');
let reconciledResultCreate=runCode('Build Reconciled File Result',headLookupResponse,{'Expand Manifest Files':reconciledCandidateCreate,'Evaluate GitHub Write Reconciliation (Pass 2)':reconciledEvaluated});
if(Array.isArray(reconciledResultCreate))reconciledResultCreate=reconciledResultCreate[0];
assert.equal(reconciledResultCreate.json.oldSha,null,'reconciled CREATE result keeps canonical null oldSha');
assert.throws(()=>runCode('Build Reconciled File Result',headLookupResponse,{'Expand Manifest Files':{...reconciledCandidateModify,oldSha:undefined},'Evaluate GitHub Write Reconciliation (Pass 2)':reconciledEvaluated}),/CANDIDATE_OLDSHA_UNRESOLVED/,'reconciled MODIFY with no oldSha is blocked, not silently forwarded');
assert.throws(()=>runCode('Build Reconciled File Result',{statusCode:200,body:{}},{'Expand Manifest Files':reconciledCandidateModify,'Evaluate GitHub Write Reconciliation (Pass 2)':{}}),/RECONCILED_UPDATE_EVIDENCE_MISSING/,'reconciled result with no head SHA / no evaluated newSha is blocked');
console.log('WF2 Build Reconciled File Result (independent hardening, not execution-2020 causal): PASS');

console.log('WF2 cross-file routing, sandbox syntax, S6813 byte identity: PASS');
