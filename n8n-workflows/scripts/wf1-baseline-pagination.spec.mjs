// Offline contract tests for WF1's native HTTP baseline pagination and pure
// consolidation node. No n8n execution, network or business action.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const wf = JSON.parse(readFileSync(new URL('../active/wf1-incident-intake-analysis-v5-1-vNOQiEgnXg9Zqn2q.json', import.meta.url)))[0];
const http = wf.nodes.find(n => n.name === 'Fetch SonarQube Issues');
const node = wf.nodes.find(n => n.name === 'Consolidate Baseline Sonar Snapshot');
assert.equal(http.type, 'n8n-nodes-base.httpRequest');
assert.equal(http.parameters.nodeCredentialType, 'httpHeaderAuth');
assert.deepEqual(http.credentials.httpHeaderAuth, { id: 'r60SonarDirectCred1', name: 'sonar-direct-token' });
assert.equal(http.parameters.url, 'http://sonarqube:9000/api/issues/search');
assert.equal(http.parameters.options.pagination.pagination.maxRequests, 40);
assert.doesNotMatch(JSON.stringify(http), /httpRequestWithAuthentication|requestWithAuthenticationPaginated/);
assert.doesNotMatch(JSON.stringify(node), /httpRequestWithAuthentication|requestWithAuthenticationPaginated/);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const issue = i => ({ key:`k${i}`, rule:'x', component:`p:F${i}.java`, status:'OPEN' });
const page = (issues,total,p=1) => ({issues,total,paging:{total,pageIndex:p,pageSize:500}});
async function run(pages) {
 const fn = new AsyncFunction('$input', node.parameters.jsCode);
 return (await fn({ all: () => pages.map(json => ({json})) }))[0].json;
}
let out = await run([page(Array.from({length:16},(_,i)=>issue(i)),16)]);
assert.equal(out.complete,true); assert.equal(out.collectedCount,16); assert.equal(out.total,16); assert.equal(out.issues.length,16);
out = await run([page(Array.from({length:500},(_,i)=>issue(i)),501),page([issue(500)],501,2)]);
assert.equal(out.complete,true); assert.equal(out.collectedCount,501); assert.ok(out.issues.some(i=>i.key==='k500'));
for (const pages of [
 [{error:{name:'Error',code:'ECONNREFUSED',message:'connect failed'}}],
 [page(Array.from({length:500},(_,i)=>issue(i)),501),{error:{statusCode:503,message:'upstream'}}],
 [{issues:[issue(1)]}],
 [page(Array.from({length:500},(_,i)=>issue(i)),501),page([issue(500)],502,2)],
 [page(Array.from({length:10},(_,i)=>issue(i)),501)],
]) { out=await run(pages); assert.equal(out.complete,false); assert.match(String(out.snapshotError),/FETCH_FAILED|TOTAL|PAGING|PAGE_LENGTH|PAGES/); }
out=await run([page([],0)]); assert.equal(out.complete,true); assert.equal(out.collectedCount,0); assert.deepEqual(out.issues,[]);
out=await run(Array.from({length:40},(_,i)=>page(Array.from({length:500},(_,j)=>issue(i*500+j)),20001,i+1))); assert.equal(out.complete,false); assert.equal(out.snapshotError,'PAGE_LIMIT_EXCEEDED');
const q=http.parameters.queryParameters.parameters;
assert.equal(q.find(p=>p.name==='componentKeys').value,'={{ $json.projectConfig.sonarqubeKey }}');
assert.equal(q.find(p=>p.name==='resolved').value,'false'); assert.equal(q.find(p=>p.name==='ps').value,'500'); assert.equal(q.find(p=>p.name==='p').value,'1');
console.log('WF1 baseline native HTTP pagination/completeness: PASS');
