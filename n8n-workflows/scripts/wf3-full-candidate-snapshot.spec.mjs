// Offline validation of the native HTTP full-snapshot path and its pure
// consolidation node. No n8n execution or network access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const workflow = JSON.parse(readFileSync(new URL('../active/wf3-post-pr-validation-v4-4JiOKpyHhx1znTYw.json', import.meta.url)))[0];
const node = name => workflow.nodes.find(n => n.name === name);
const http = node('Get Full Candidate Sonar Snapshot');
const consolidate = node('Consolidate Full Candidate Sonar Snapshot');
assert.equal(http.type, 'n8n-nodes-base.httpRequest');
assert.equal(http.typeVersion, 4.2);
assert.deepEqual(http.credentials.httpHeaderAuth, { id: 'r60SonarDirectCred1', name: 'sonar-direct-token' });
assert.equal(http.parameters.url, 'http://sonarqube:9000/api/issues/search');
assert.equal(http.parameters.nodeCredentialType, 'httpHeaderAuth');
assert.equal(http.onError, 'continueErrorOutput');
assert.equal(http.parameters.options.pagination.pagination.maxRequests, 40);
assert.equal(http.parameters.options.pagination.pagination.parameters.parameters[0].name, 'p');
assert.doesNotMatch(JSON.stringify(http), /httpRequestWithAuthentication|requestWithAuthenticationPaginated/);
assert.doesNotMatch(JSON.stringify(consolidate), /httpRequestWithAuthentication|requestWithAuthenticationPaginated/);
const code = consolidate.parameters.jsCode;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const SHA = 'a'.repeat(40);
const ctx = { sonarAnalysisMode: 'COMMUNITY_EXACT_SHA', validationSonarProjectKey: 'proj-pr-25', checkoutSha: SHA };
const issue = i => ({ key: `k${i}`, rule: 'java:S1', component: 'proj-pr-25:A.java' });
async function run(pages, context = ctx) {
  const dollar = name => ({ first: () => ({ json: name === 'Extract Validation Context' ? context : undefined }) });
  const input = { all: () => pages.map(json => ({ json })) };
  return (await new AsyncFunction('$', '$input', code)(dollar, input))[0].json;
}
const page = (issues, total, p = 1) => ({ issues, total, paging: { total, pageIndex: p, pageSize: 500 } });
{
 const out = await run([page(Array.from({length:15},(_,i)=>issue(i)),15)]);
 assert.equal(out.candidateSnapshotComplete,true); assert.equal(out.collectedCount,15); assert.equal(out.total,15);
}
{
 const p1=Array.from({length:500},(_,i)=>issue(i)); const p2=Array.from({length:1},(_,i)=>issue(i+500));
 const out=await run([page(p1,501,1),page(p2,501,2)]);
 assert.equal(out.candidateSnapshotComplete,true); assert.equal(out.candidateFindingsSnapshot.length,501); assert.equal(out.candidateFindingsSnapshot[500].key,'k500');
}
for (const pages of [
 [{error:{name:'Error',code:'ECONNREFUSED',message:'connect failed'}}],
 [page(Array.from({length:500},(_,i)=>issue(i)),501),{error:{name:'Error',statusCode:503,message:'upstream'}}],
 [{issues:[],paging:{pageIndex:1,pageSize:500}}],
 [page(Array.from({length:500},(_,i)=>issue(i)),501),page([issue(500)],502,2)],
 [page(Array.from({length:10},(_,i)=>issue(i)),501)],
]) {
 const out=await run(pages); assert.equal(out.candidateSnapshotComplete,false); assert.match(String(out.candidateSnapshotError), /FETCH_FAILED|TOTAL|PAGING|PAGE_LENGTH|PAGES|LIMIT/);
}
{
 const out=await run([page([],0)]); assert.equal(out.candidateSnapshotComplete,true); assert.equal(out.collectedCount,0); assert.deepEqual(out.candidateFindingsSnapshot,[]);
}
{
 const out=await run([page([],0)]); assert.equal(out.candidateSha,SHA);
}
assert.equal(http.parameters.queryParameters.parameters.find(p=>p.name==='componentKeys').value.includes('validationSonarProjectKey'),true);
assert.equal(http.parameters.queryParameters.parameters.find(p=>p.name==='resolved').value,'false');
assert.equal(http.parameters.queryParameters.parameters.find(p=>p.name==='ps').value,'500');
assert.equal(http.parameters.queryParameters.parameters.find(p=>p.name==='p').value,'1');
console.log('WF3 full candidate snapshot native HTTP + pagination/consolidation safety: PASS');
