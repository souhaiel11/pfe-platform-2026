#!/usr/bin/env node
// Execute the actual generated graph, expressions and Code-node bodies.
// Only HTTP transport is stubbed. No independent copy of business routing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { test } from 'node:test';
const [w] = JSON.parse(readFileSync(new URL('../pending-live-update/wf6-security-remediation-maven.OFFLINE-DRAFT.json', import.meta.url)));
const nodes = new Map(w.nodes.map(n => [n.name, n]));
const start = 'Webhook - Security Remediation Request';
const digest = s => createHash('sha1').update(s).digest('hex');
const blobSha = s => digest(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(s)}\0`), Buffer.from(s)]));
const evaluated = 'a'.repeat(40), tip = 'b'.repeat(40), securityHead = 'c'.repeat(40);
const baseTreeSha = 'd'.repeat(40), branchTreeSha = 'e'.repeat(40);
const content = '<project>authorized</project>\n', oldContent = '<project>old</project>\n';
const candidate = {
 status: 'CANDIDATE_READY', repository: 'trusted/repository', branchName: 'security/fix/111111111111-222222222222',
 candidateIdentity: '2'.repeat(64), decision: { evaluatedSha: evaluated },
 candidateManifest: { files: [{ path: 'pom.xml', operation: 'MODIFY', originalBlobSha: blobSha(oldContent), content }] },
 commitMessage: 'fix(security): safe metadata', prTitle: 'fix(security): safe metadata', prBody: 'Security remediation candidate',
};
const envelope = (body, statusCode = 200) => ({ statusCode, body, headers: {} });
const branch = (name, sha) => ({ ref: `refs/heads/${name}`, object: { type: 'commit', sha } });
const pr = state => ({ number:12, state, html_url: 'https://github.com/trusted/repository/pull/12', merged_at: null,
 head: { ref: candidate.branchName, sha:securityHead, repo: { full_name: candidate.repository } },
 base: { ref: 'release/stable', repo: { full_name: candidate.repository } } });
const tree = (sha, fileSha) => ({sha, truncated: false, tree: [
 {path:'pom.xml',mode:'100644',type:'blob',sha:fileSha},
 {path:'README.md',mode:'100644',type:'blob',sha:'f'.repeat(40)},
]});
function fixtures(existing = false) {
 const f = {
  'Evaluate Security Remediation': envelope(structuredClone(candidate), 201),
  'Verify Base Commit Still Exists': envelope({sha:evaluated,commit:{tree:{sha:baseTreeSha}}}),
  'Initial Repository Metadata': envelope({default_branch:'release/stable', repository: 'evil/overwrite', candidateManifest: 'not authority'}),
  'Final Repository Metadata': envelope({default_branch:'release/stable'}),
  'Initial Default Branch Head': envelope(branch('release/stable',tip)),
  'Final Default Branch Head': envelope(branch('release/stable',tip)),
  'Initial Compare Ancestry': envelope({status:'ahead',base_commit:{sha:evaluated},merge_base_commit:{sha:evaluated}}),
  'Final Compare Ancestry': envelope({status:'ahead',base_commit:{sha:evaluated},merge_base_commit:{sha:evaluated}}),
  'Get Branch Ref': existing ? envelope(branch(candidate.branchName,securityHead)) : envelope({message:'not found'},404),
  'Revalidate Before Write (New Branch)': envelope({...structuredClone(candidate),status:'WRITE_AUTHORIZED'},201),
  'Revalidate Before Write (Reuse)': envelope({...structuredClone(candidate),status:'WRITE_AUTHORIZED'},201),
  'Revalidate Before Write (PR)': envelope({...structuredClone(candidate),status:'WRITE_AUTHORIZED'},201),
  'Create Missing Branch': envelope(branch(candidate.branchName,evaluated),201),
  'Write File To Branch': envelope({content:{sha:blobSha(content)},commit:{sha:securityHead}}),
  'Authorized Branch Snapshot': envelope(branch(candidate.branchName,securityHead)),
  'Authorized Branch Commit': envelope({sha:securityHead,tree:{sha:branchTreeSha}}),
  'Evaluated Base Tree': envelope(tree(baseTreeSha,blobSha(oldContent))),
  'Authorized Branch Tree': envelope(tree(branchTreeSha,blobSha(content))),
  'Authorized Candidate Blob': envelope({sha:blobSha(content),encoding:'base64',size:Buffer.byteLength(content),content:Buffer.from(content).toString('base64')}),
  'Early Historical PR Lookup': envelope([]),
  'Final PR Lookup': envelope([]),
  'Final Security Branch Ref': envelope(branch(candidate.branchName,securityHead)),
  'Create Pull Request': envelope(pr('open'),201),
  'Recheck Historical PR': envelope(pr('open')),
  'Close Drifted Created PR': envelope(pr('closed')),
  'Verify Drifted PR Closed': envelope(pr('closed')),
 };
 for(const name of ['Authorized Branch Commit','Evaluated Base Tree','Authorized Branch Tree','Authorized Candidate Blob'])f['Historical '+name]=structuredClone(f[name]);
 return f;
}
function historical(state='open', merged=false) {
 const f=fixtures(false),p=pr(state);if(merged)p.merged_at='2026-01-01T00:00:00Z';
 f['Early Historical PR Lookup']=envelope([structuredClone(p)]);f['Recheck Historical PR']=envelope(structuredClone(p));return f;
}
function cleanupFixture() {const f=fixtures();f['Create Pull Request'].body.head.sha='9'.repeat(40);return f;}

const isWrite = n => n.type.endsWith('.httpRequest') && n.parameters.method !== 'GET' && n.parameters.url.includes('api.github.com');
function run(responses = fixtures(), caller = {}) {
 let name = start, json = {body:{projectId:'project',findingTaskId:'finding', ...caller}};
 const history = new Map(), visited = [], writes = [], calls = [], output = [];
 const context = vm.createContext({Buffer, $env:{BACKEND_INTERNAL_URL:'http://offline-backend:3001',N8N_INTERNAL_SECRET:'TEST_INTERNAL_SECRET'},
  $: key => ({first:() => ({json:history.get(key)})})});
 const ev = text => { context.$json = json; return vm.runInContext('(' + text.slice(3,-2) + ')', context, {timeout:1000}); };
 while(name) {
  assert.ok(visited.length < 200, 'acyclic bounded execution');
  const n = nodes.get(name); assert.ok(n, name); visited.push(name); let port = 0;
  if (n.type.endsWith('.httpRequest')) {
   const url = ev(n.parameters.url), body = n.parameters.jsonBody ? ev(n.parameters.jsonBody) : undefined;
   calls.push({name,url,body}); if(isWrite(n)) writes.push(name);
   assert.ok(Object.hasOwn(responses,name), `missing fixture ${name}`);
   json = structuredClone(responses[name]);
  } else if(n.type.endsWith('.code')) {
   context.$json = json;
   const result = vm.runInContext('(function(){' + n.parameters.jsCode + '\n})()',context,{timeout:1000});
   assert.equal(result.length,1); json=result[0].json;
  } else if(n.type.endsWith('.if')) {
   const c = n.parameters.conditions.conditions[0];
   assert.equal(c.operator.type,'boolean'); assert.equal(c.operator.operation,'true');
   port = ev(c.leftValue) === true ? 0 : 1;
  } else if(n.type.endsWith('.respondToWebhook')) output.push(ev(n.parameters.responseBody));
  else assert.equal(n.type,'n8n-nodes-base.webhook');
  history.set(name,json);
  const edges = w.connections[name]?.main[port] || [];
  assert.ok(edges.length <= 1, 'no fan-out / duplicate response'); name=edges[0]?.node;
 }
 assert.equal(output.length,1, `exactly one response: ${visited.join(' -> ')}`);
 assert.doesNotMatch(JSON.stringify(output), /TEST_INTERNAL_SECRET|TEST_GITHUB_TOKEN|authorized<|Authorization|candidateManifest/);
 return {response:output[0],writes,calls,history,visited};
}
function expect(responses, state, writeCount = undefined) {
 const result = run(responses); assert.equal(result.response.state,state);
 if (writeCount !== undefined) assert.equal(result.writes.length,writeCount);
 return result;
}
function zeroPr(result) {assert.ok(!result.writes.includes('Create Pull Request'));}

test('A/G: eligible ancestor reaches exact authorized PR; trusted release/stable base, no main fallback', () => {
 const r=expect(fixtures(),'PR_CREATED',3);
 const create=r.calls.find(c=>c.name==='Create Pull Request');
 assert.equal(create.body.base,'release/stable'); assert.equal(create.body.head,candidate.branchName);
 assert.equal(r.calls.find(c=>c.name==='Create Missing Branch').body.sha,evaluated);
 assert.equal(Buffer.from(r.calls.find(c=>c.name==='Write File To Branch').body.content,'base64').toString(),content);
 for(const prefix of ['Initial','Final']) {
  assert.ok(r.calls.find(c=>c.name===`${prefix} Compare Ancestry`).url.endsWith(`/compare/${evaluated}...${tip}`));
  assert.equal(r.history.get(`${prefix} Ancestry Evidence`).ANCESTRY_VALID,'YES');
 }
});
for (const [label,status,state] of [['B','NOT_ELIGIBLE','NOT_ELIGIBLE'],['C','TECHNICAL_FAILURE','TECHNICAL_FAILURE'],['B2','REJECTED','NOT_ELIGIBLE']]) {
 test(`${label}: ${status} responds without write`,()=>{const f=fixtures();f['Evaluate Security Remediation']=envelope({status});expect(f,state,0);});
}
test('D: revalidation failure responds, zero write',()=>{const f=fixtures();f['Revalidate Before Write (New Branch)']=envelope({status:'CANDIDATE_DRIFTED'});expect(f,'CANDIDATE_DRIFTED',0);});
test('E: unresolvable SHA responds, zero write',()=>{const f=fixtures();f['Verify Base Commit Still Exists']=envelope({},404);expect(f,'BASE_SHA_UNRESOLVABLE',0);});
for(const value of [undefined,'',null,'bad\nbranch']) test(`F: unavailable/invalid default branch ${JSON.stringify(value)}`,()=>{
 const f=fixtures();f['Initial Repository Metadata']=envelope({default_branch:value});zeroPr(expect(f,'TECHNICAL_FAILURE',0));
});
for(const status of ['diverged','behind','unknown',undefined]) test(`H/I: compare evaluated...tip rejects ${status}`,()=>{
 const f=fixtures();f['Initial Compare Ancestry'].body.status=status;zeroPr(expect(f,'TECHNICAL_FAILURE',0));
});
test('G: identical evaluated and default tip accepted',()=>{
 const f=fixtures();for(const p of ['Initial','Final']){f[`${p} Default Branch Head`]=envelope(branch('release/stable',evaluated));f[`${p} Compare Ancestry`].body.status='identical';}expect(f,'PR_CREATED');
});
test('J: exact existing branch reused without branch/content write',()=>expect(fixtures(true),'PR_CREATED',1));
test('K: conflicting blob fails closed and responds',()=>{const f=fixtures(true);f['Authorized Candidate Blob'].body.content=Buffer.from('malicious').toString('base64');expect(f,'BRANCH_CONTENT_CONFLICT',0);});
test('K: unrelated changed tree entry fails closed',()=>{const f=fixtures(true);f['Authorized Branch Tree'].body.tree[1].sha='9'.repeat(40);expect(f,'BRANCH_CONTENT_CONFLICT',0);});
test('K: truncated tree fails closed',()=>{const f=fixtures(true);f['Authorized Branch Tree'].body.truncated=true;expect(f,'BRANCH_CONTENT_CONFLICT',0);});
test('L: write conflict responds, no PR or retry',()=>{const f=fixtures();f['Write File To Branch']=envelope({},409);zeroPr(expect(f,'WRITE_CONFLICT',2));});
for(const [label,state,merged,response] of [['M','open',false,'PR_REUSED'],['N','closed',true,'ALREADY_MERGED'],['O','closed',false,'CLOSED_NOT_MERGED']]) test(`${label}: exact existing PR lifecycle`,()=>{
 expect(historical(state,merged),response,0);
});
test('Q: hostile caller has no repo, branch, path, version or patch authority',()=>{
 const r=run(fixtures(),{repository:'evil/repo',branchName:'main',path:'other',targetVersion:'evil',content:'evil',default_branch:'evil'});
 assert.equal(r.response.state,'PR_CREATED');
 for(const c of r.calls){assert.doesNotMatch(c.url, /evil/);if(c.body)assert.doesNotMatch(JSON.stringify(c.body),/evil/);}
 assert.deepEqual(Object.keys(r.calls[0].body).sort(),['findingTaskId','projectId']);
});
test('R: no LLM or shell authority',()=>{for(const n of w.nodes)assert.doesNotMatch(n.type,/langchain|openai|anthropic|executeCommand|ssh/i);});
test('S/T: builder writes only WF6; no WF2 identity or routing mutation',()=>{
 const source=readFileSync(new URL('./build-wf6-security-remediation.mjs',import.meta.url),'utf8');
 assert.equal((source.match(/writeFileSync\(/g)||[]).length,1);
 assert.doesNotMatch(source,/u3eeMwTuhCsetfcS|remediationWorkflowFor/);
 assert.equal(w.active,false);
});
test('U: exhaustive structural traversal, every terminal has exactly one response',()=>{
 let terminal=0,withResponse=0,without=0,multiple=0;const reached=new Set();
 function walk(name,count,path=[]) {
  assert.ok(!path.includes(name),'no cycles');const n=nodes.get(name);assert.ok(n,`dangling ${name}`);reached.add(name);
  count+=Number(n.type.endsWith('.respondToWebhook'));
  const edges=w.connections[name]?.main;
  if(n.type.endsWith('.if')){assert.equal(edges?.length,2);for(const port of edges)assert.equal(port.length,1);}
  if(!edges?.flat().length){terminal++;if(count===1)withResponse++;else if(count===0)without++;else multiple++;return;}
  assert.ok(!n.type.endsWith('.respondToWebhook'),'response must terminate');
  for(const port of edges)for(const edge of port)walk(edge.node,count,[...path,name]);
 }
 walk(start,0);assert.equal(without,0);assert.equal(multiple,0);assert.equal(reached.size,nodes.size,'no unreachable nodes');
 console.log(`REACHABLE_TERMINAL_COUNT = ${terminal}\nTERMINALS_WITH_RESPONSE = ${withResponse}\nTERMINALS_WITHOUT_RESPONSE = ${without}\nMULTIPLE_RESPONSE_PATHS = ${multiple}`);
});
test('all HTTP errors have explicit safe continuation; credentials confined; no redirects/retries',()=>{
 for(const n of w.nodes.filter(n=>n.type.endsWith('.httpRequest'))) {
  assert.equal(n.continueOnFail,true);assert.equal(n.retryOnFail,false);
  assert.equal(n.parameters.options.response.response.fullResponse,true);assert.equal(n.parameters.options.response.response.neverError,true);
  assert.equal(n.parameters.options.redirect.redirect.followRedirects,false);
  const h=n.parameters.headerParameters.parameters.map(h=>h.name.toLowerCase());
  if(n.parameters.url.includes('api.github.com')){assert.equal(n.parameters.authentication,'predefinedCredentialType');assert.equal(n.parameters.nodeCredentialType,'githubApi');assert.ok(n.credentials.githubApi.id);assert.ok(!h.includes('authorization'));assert.ok(!h.includes('x-internal-secret'));}
  else{assert.ok(h.includes('x-internal-secret'));assert.ok(!h.includes('authorization'));}
 }
});
for(const name of Object.keys(fixtures())) test(`transport failure at ${name}: one response, no later PR write`,()=>{
 const f=name.startsWith('Historical ')||name==='Recheck Historical PR'?historical():['Close Drifted Created PR','Verify Drifted PR Closed'].includes(name)?cleanupFixture():fixtures(name==='Revalidate Before Write (Reuse)');f[name]={error:'secret or raw arbitrary transport detail'};
 if(name==='Close Drifted Created PR')f['Verify Drifted PR Closed']={error:'readback unavailable'};
 const r=run(f);assert.notEqual(r.response.state,'PR_CREATED');
 assert.doesNotMatch(JSON.stringify(r.response),/secret or raw/);
 assert.equal(r.calls.filter(c=>c.name===name).length,1);
 if(!['Create Pull Request','Close Drifted Created PR','Verify Drifted PR Closed'].includes(name))zeroPr(r);
});
for(const field of ['repository','branchName','candidateIdentity','decision','candidateManifest']) test(`revalidation cannot change ${field}`,()=>{
 const f=fixtures();f['Revalidate Before Write (New Branch)'].body[field]=field==='candidateManifest'?{files:[{...candidate.candidateManifest.files[0],content:'different'}]}:'different';
 expect(f,'CANDIDATE_DRIFTED',0);
});
test('concurrent branch create 422 is a clean failure, no retry or content write',()=>{
 const f=fixtures();f['Create Missing Branch']=envelope({},422);const r=expect(f,'TECHNICAL_FAILURE',1);assert.equal(r.response.failureClass,'BRANCH_CREATE_FAILED');
});
test('default branch name drift never silently changes PR base',()=>{const f=fixtures();f['Final Repository Metadata'].body.default_branch='other';zeroPr(expect(f,'TECHNICAL_FAILURE'));});
test('default tip advances safely while evaluated SHA stays ancestor',()=>{const f=fixtures();f['Final Default Branch Head'].body.object.sha='9'.repeat(40);expect(f,'PR_CREATED');});
test('default history rewritten after initial evidence fails closed',()=>{const f=fixtures();f['Final Compare Ancestry'].body.status='diverged';zeroPr(expect(f,'TECHNICAL_FAILURE'));});
test('security branch changes after exact content proof: no PR',()=>{const f=fixtures();f['Final Security Branch Ref'].body.object.sha='9'.repeat(40);zeroPr(expect(f,'BRANCH_CONTENT_CONFLICT'));});
test('wrong PR base or head repository never reused',()=>{const f=fixtures(true),p=pr('open');p.base.ref='other';f['Final PR Lookup']=envelope([p]);expect(f,'TECHNICAL_FAILURE',0);});
test('non-array PR lookup is not interpreted as absent',()=>{const f=fixtures();f['Final PR Lookup']=envelope({message:'bad'});zeroPr(expect(f,'TECHNICAL_FAILURE'));});
test('missing evaluated SHA fails closed before any GitHub write',()=>{const f=fixtures();delete f['Evaluate Security Remediation'].body.decision.evaluatedSha;expect(f,'TECHNICAL_FAILURE',0);});
test('missing/wrong merge base fails ancestry proof',()=>{const f=fixtures();delete f['Initial Compare Ancestry'].body.merge_base_commit;expect(f,'TECHNICAL_FAILURE',0);});

test('P: actual backend sanitizer output is forwarded safely by generated commit/PR nodes', async()=>{
 const {createRequire}=await import('node:module');
 const require=createRequire(import.meta.url);
 const ts=require('../../backend/node_modules/typescript');
 const source=readFileSync(new URL('../../backend/src/security-remediation/security-remediation-git-metadata.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
 const sandbox=vm.createContext({exports:{}});vm.runInContext(compiled,sandbox);
 const meta=sandbox.exports;
 for(const attack of ['org.example:lib\nSigned-off-by: attacker','org.example:lib|spoof|row','1.0.0\r\nInjected: true','1.0.1\n# fake heading','\x00\x1b\x7f','x'.repeat(10000),'1.0.1\n']) {
  const input={cveId:'CVE-2023-6378',package:attack,installedVersion:attack,targetVersion:attack,source:'TRIVY',provenanceKind:'DIRECT_EXPLICIT',evaluatedSha:evaluated,candidateIdentity:candidate.candidateIdentity};
  const f=fixtures();Object.assign(f['Evaluate Security Remediation'].body,{
   commitMessage:meta.computeSecurityCommitMessage(input),prTitle:meta.computeSecurityPrTitle(input),prBody:meta.computeSecurityPrBody(input),
  });
  const r=expect(f,'PR_CREATED');
  const commit=r.calls.find(c=>c.name==='Write File To Branch').body.message;
  const pr=r.calls.find(c=>c.name==='Create Pull Request').body;
  assert.doesNotMatch(commit,/[\r\n\x00-\x1f\x7f]|Signed-off-by:|Injected:|fake heading/);
  assert.doesNotMatch(pr.title,/[\r\n]/);assert.ok(commit.length<=350);assert.ok(pr.body.length<=2000);
  assert.match(pr.body,/Security remediation candidate/);assert.doesNotMatch(pr.body,/Vulnerability fixed|Signed-off-by:|Injected:|fake heading/);
  for(const row of pr.body.split('\n').filter(r=>r.startsWith('|')))assert.equal(row.split('|').length,4);
  assert.equal(input.package,attack,'authoritative value unchanged');
 }
});
test('invalid UTF-8 bytes cannot pass via lossy string decoding',()=>{
 const f=fixtures(true);f['Authorized Candidate Blob'].body.content=Buffer.from([255]).toString('base64');f['Authorized Candidate Blob'].body.size=1;
 expect(f,'BRANCH_CONTENT_CONFLICT',0);
});
test('pre-write original blob SHA conflict cannot lead to PR',()=>{
 const f=fixtures();f['Write File To Branch']=envelope({message:'sha mismatch'},422);zeroPr(expect(f,'WRITE_CONFLICT'));
});

// V1.6: managed auth and lifecycle/race containment, all HTTP stubbed.
test('managed inbound header credential is the established WF1 pattern, no anonymous artifact',()=>{
 const hook=nodes.get(start);assert.equal(hook.parameters.authentication,'headerAuth');
 assert.deepEqual(hook.credentials,{httpHeaderAuth:{id:'c94e1a451dec86a4a7a351d4',name:'Jenkins WF1 Callback'}});
 assert.deepEqual(Object.keys(hook.credentials.httpHeaderAuth).sort(),['id','name']);
 const source=readFileSync(new URL('./build-wf6-security-remediation.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/GITHUB_TOKEN/);assert.doesNotMatch(JSON.stringify(w),/GITHUB_TOKEN/);
 for(const n of w.nodes.filter(n=>n.parameters.url?.includes('api.github.com'))){assert.deepEqual(n.credentials,{githubApi:{id:'YBO0vWrPlyoYx4Kr',name:'GitHub n8n'}});assert.equal(n.parameters.nodeCredentialType,'githubApi');}
});
test('early NONE is required before every write; PR revalidation dominates create and cleanup',()=>{
 for(const f of [fixtures(),fixtures(true),cleanupFixture()]){
  const r=run(f);for(const name of r.writes){
   assert.ok(r.visited.indexOf('No Historical PR?')<r.visited.indexOf(name));
   const guard=['Create Missing Branch','Write File To Branch'].includes(name)?'Write Authorized? (New Branch)':'Write Authorized? (PR)';
   assert.ok(r.visited.indexOf(guard)>=0&&r.visited.indexOf(guard)<r.visited.indexOf(name));
  }
 }
});
test('two PR lookups remain on normal preparation path, in required order',()=>{
 const r=run();const at=n=>r.visited.indexOf(n);
 assert.ok(at('Early Historical PR Lookup')<at('Create Missing Branch'));
 assert.ok(at('Write File To Branch')<at('Final PR Lookup'));
 assert.ok(at('Final PR Lookup')<at('Create Pull Request'));
 assert.equal(r.history.get('Authorized Head').AUTHORIZED_HEAD_SHA,securityHead);
});
for(const state of ['open','closed','merged'])test(`historical ${state}, branch absent, exact immutable candidate: zero mutations`,()=>{
 const r=expect(historical(state==='open'?'open':'closed',state==='merged'),state==='open'?'PR_REUSED':state==='merged'?'ALREADY_MERGED':'CLOSED_NOT_MERGED',0);
 assert.ok(!r.visited.includes('Get Branch Ref'));assert.ok(!r.visited.includes('Revalidate Before Write (New Branch)'));
 assert.equal(r.history.get('Historical Authorized Head').AUTHORIZED_HEAD_SHA,securityHead);
});
for(const bad of [undefined,'bad','9'.repeat(39)])test(`historical invalid head SHA ${bad}: no write`,()=>{
 const f=historical();f['Early Historical PR Lookup'].body[0].head.sha=bad;expect(f,'PR_HEAD_SHA_MISMATCH',0);
});
test('historical immutable commit must equal the PR head requested',()=>{
 const f=historical();f['Historical Authorized Branch Commit'].body.sha='9'.repeat(40);expect(f,'BRANCH_CONTENT_CONFLICT',0);
});
for(const field of ['headRef','headRepo','baseRef','baseRepo','number','url','lifecycle'])test(`historical PR wrong ${field}: no write`,()=>{
 const f=historical(),p=f['Early Historical PR Lookup'].body[0];
 if(field==='headRef')p.head.ref='wrong';if(field==='headRepo')p.head.repo.full_name='other/repo';
 if(field==='baseRef')p.base.ref='wrong';if(field==='baseRepo')p.base.repo.full_name='other/repo';
 if(field==='number')p.number=0;if(field==='url')p.html_url='https://github.com/other/repo/pull/12';if(field==='lifecycle')p.merged_at='invalid';
 expect(f,'TECHNICAL_FAILURE',0);
});
test('historical candidate bytes mismatch: zero mutation',()=>{
 const f=historical();f['Historical Authorized Candidate Blob'].body.content=Buffer.from('unauthorized').toString('base64');expect(f,'BRANCH_CONTENT_CONFLICT',0);
});
test('historical unrelated tree change: zero mutation',()=>{
 const f=historical();f['Historical Authorized Branch Tree'].body.tree[1].sha='9'.repeat(40);expect(f,'BRANCH_CONTENT_CONFLICT',0);
});
test('historical truncated tree: zero mutation',()=>{
 const f=historical();f['Historical Authorized Branch Tree'].body.truncated=true;expect(f,'BRANCH_CONTENT_CONFLICT',0);
});
test('historical PR head changes while proving immutable content: no reuse/write',()=>{
 const f=historical();f['Recheck Historical PR'].body.head.sha='9'.repeat(40);expect(f,'PR_HEAD_SHA_MISMATCH',0);
});
test('concurrent PR appears between early/final lookups: reused without a second create',()=>{
 const f=fixtures();f['Final PR Lookup']=envelope([pr('open')]);const r=expect(f,'PR_REUSED',2);zeroPr(r);
});
test('final PR correct branch but wrong head SHA: no new PR',()=>{
 const f=fixtures(true),p=pr('open');p.head.sha='9'.repeat(40);f['Final PR Lookup']=envelope([p]);expect(f,'PR_HEAD_SHA_MISMATCH',0);
});
test('post-read head race: close only just-created drifted PR, verify closure, never retry',()=>{
 const r=expect(cleanupFixture(),'PR_HEAD_DRIFTED',4);
 assert.equal(r.calls.filter(c=>c.name==='Create Pull Request').length,1);
 const close=r.calls.find(c=>c.name==='Close Drifted Created PR');assert.equal(close.url,'https://api.github.com/repos/trusted/repository/pulls/12');assert.equal(close.body.state,'closed');
 assert.equal(r.calls.filter(c=>c.name==='Close Drifted Created PR').length,1);assert.ok(r.visited.includes('Verify Drifted PR Closed'));
});
for(const field of ['headRef','headRepo','headSha','baseRef','baseRepo'])test(`created PR wrong ${field} is never accepted and is closed`,()=>{
 const f=fixtures(),p=f['Create Pull Request'].body;
 if(field==='headRef')p.head.ref='wrong';if(field==='headRepo')p.head.repo.full_name='other/repo';if(field==='headSha')delete p.head.sha;
 if(field==='baseRef')p.base.ref='wrong';if(field==='baseRepo')p.base.repo.full_name='other/repo';expect(f,'PR_HEAD_DRIFTED',4);
});
test('unsafe create response identity cannot close an arbitrary PR',()=>{
 const f=cleanupFixture();f['Create Pull Request'].body.html_url='https://github.com/other/repo/pull/12';const r=expect(f,'TECHNICAL_FAILURE',3);
 assert.ok(!r.writes.includes('Close Drifted Created PR'));
});
for(const variant of ['patch500','get500','stillOpen','wrongNumber','wrongUrl','merged'])test(`drift cleanup ${variant}: bounded manual-intervention response`,()=>{
 const f=cleanupFixture();
 if(variant==='patch500'){f['Close Drifted Created PR']=envelope({},500);f['Verify Drifted PR Closed']=envelope(pr('open'));}
 if(variant==='get500')f['Verify Drifted PR Closed']=envelope({},500);
 if(variant==='stillOpen')f['Verify Drifted PR Closed']=envelope(pr('open'));
 if(variant==='wrongNumber')f['Verify Drifted PR Closed'].body.number=77;
 if(variant==='wrongUrl')f['Verify Drifted PR Closed'].body.html_url='https://github.com/other/repo/pull/12';
 if(variant==='merged')f['Verify Drifted PR Closed'].body.merged_at='2026-01-01T00:00:00Z';
 const r=expect(f,'PR_HEAD_DRIFT_CLEANUP_FAILED',4);assert.equal(r.response.pullRequestNumber,12);assert.equal(r.response.pullRequestUrl,'https://github.com/trusted/repository/pull/12');
});
test('ambiguous close transport is resolved ONLY by proven GET closure',()=>{
 const f=cleanupFixture();f['Close Drifted Created PR']={error:'transport uncertain'};expect(f,'PR_HEAD_DRIFTED',4);
});
test('identical replay with exact historical PR performs zero mutations',()=>{
 const first=expect(fixtures(),'PR_CREATED',3);assert.ok(first.response.pullRequestUrl);expect(historical(),'PR_REUSED',0);
});
for(const status of ['NOT_ELIGIBLE','TECHNICAL_FAILURE','CANDIDATE_DRIFTED','GUARD_REJECTED'])test(`fresh ${status} prevents first mutation`,()=>{
 const f=fixtures();f['Revalidate Before Write (New Branch)']=envelope({status});const r=run(f);assert.equal(r.writes.length,0);assert.notEqual(r.response.state,'PR_CREATED');
});
