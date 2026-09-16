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
assert.equal(wf.connections['Classify Candidate Coordination Scope'].main[0][0].node,'Prepare Cross-File COMPILE_MAIN');
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
const cross=reachable('Prepare Cross-File COMPILE_MAIN');
for(const x of ['Call Cross-File COMPILE_MAIN','Call Cross-File COMPILE_TESTS','Call Cross-File FULL_TEST','Independent Cross-File Semantic Review','Call Candidate Verification','Call Write Guard','Update File in Branch'])assert.ok(cross.has(x),'cross route reaches '+x);
assert.ok(cross.has('Call Candidate Verification'),'historical final FULL_TEST deliberately retained');
console.log('WF2 cross-file routing, sandbox syntax, S6813 byte identity: PASS');
