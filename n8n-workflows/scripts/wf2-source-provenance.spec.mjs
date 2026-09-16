import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SANDBOX_SHADOWED} from './wf2-code-node-sandbox.spec.mjs';

// Source-evidence provenance contract.
//
// The three source fetch nodes read at baseSha. What the grounding evidence
// DECLARES as its frozen source must therefore be baseSha too -- on a first pass
// and, critically, on a corrective second pass where a remediation branch already
// exists at a different HEAD. Declaring the branch tip while reading baseSha
// attributed content to a commit it never came from.
//
// Provenance is taken from the ref the GitHub contents response echoes back, never
// from `sha`: that field is a BLOB id, a different identity from a commit id, and
// comparing the two would be meaningless. Production node bodies are executed
// as-is from the promotion target; nothing is re-implemented here.
const wf=JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json',import.meta.url)))[0];
const fixture=JSON.parse(readFileSync(new URL('./fixtures/wf2-relationship-source-grounding.json',import.meta.url)));
const node=name=>{const n=wf.nodes.find(n=>n.name===name);assert.ok(n,name);return n;};

const A=fixture.sourceCommitSha;                                  // baseSha (frozen baseline)
const B='b'.repeat(40);                                           // remediation branch HEAD, != A
assert.notEqual(A,B);

// ── All three source fetches must be pinned to baseSha, not the branch tip ─────
const FETCH_REFERENCE="={{ $('Prepare Batch Context').first().json.baseSha }}";
for (const name of ['Fetch Finding Source Context','Fetch Referenced API Sources','Fetch Required Dependency Sources']) {
  assert.equal(node(name).parameters.additionalParameters.reference,FETCH_REFERENCE,
    name+' reads the frozen baseline, never the remediation branch tip');
}
// The expansion node must not re-introduce a branch-tip conditional for provenance.
const expandCode=node('Expand Required Dependency Sources').parameters.jsCode;
const frozenLine=expandCode.split('\n').find(l=>l.includes('const frozenSourceSha'));
assert.match(frozenLine,/Prepare Batch Context'\)\.first\(\)\.json\.baseSha/,'frozenSourceSha is baseSha');
assert.doesNotMatch(frozenLine,/Lookup Remediation Branch/,'frozenSourceSha no longer follows the remediation branch tip');
assert.match(expandCode,/SOURCE_SHA_FROZEN_REQUIRED/,'frozen SHA is still mandatory');

// ── Harness ───────────────────────────────────────────────────────────────────
const atRef=(path,ref)=>({url:'https://api.github.com/repos/souhaiel11/pfe-app-test/contents/'+path+'?ref='+ref,
  download_url:'https://raw.githubusercontent.com/souhaiel11/pfe-app-test/'+ref+'/'+path,
  html_url:'https://github.com/souhaiel11/pfe-app-test/blob/'+ref+'/'+path,
  git_url:'https://api.github.com/repos/souhaiel11/pfe-app-test/git/blobs/'+'c'.repeat(40)});
const item=(source,ref)=>({json:{path:source.path,sha:source.sha,
  content:Buffer.from(source.content).toString('base64'),...atRef(source.path,ref)}});
const ctx={repository_owner:'souhaiel11',repository_name:'pfe-app-test',baseSha:A,
  repositoryPolicy:{existingFiles:fixture.repositoryTree},findings:[]};
// Node bodies run with the sandbox-unavailable globals REMOVED, so this suite
// reproduces the n8n Code-node contract instead of full Node. Running under plain
// Node is what let execution 2008 through: `new URL(...)` resolved here and threw
// there. See wf2-code-node-sandbox.spec.mjs for the deny-list and the static scan.
const runNode=(name,$input,$json,$)=>{
  const args=['$input','$json','$','Buffer',...SANDBOX_SHADOWED];
  return new Function(...args,node(name).parameters.jsCode)(
    $input,$json,$,Buffer,...SANDBOX_SHADOWED.map(()=>undefined));
};
// branchStatus 404 = first pass (no remediation branch); 200 = corrective second pass at B.
function expand(branchStatus) {
  const lookup=branchStatus===200?{statusCode:200,body:{object:{sha:B}}}:{statusCode:404};
  const values={'Build Independent Repository Policy':[ctx],'Prepare Batch Context':[ctx],'Lookup Remediation Branch':[lookup]};
  const $=k=>({first:()=>({json:values[k][0]}),all:()=>values[k].map(json=>({json}))});
  const initial=fixture.sources.filter(s=>fixture.initialPaths.includes(s.path)).map(s=>item(s,A));
  return runNode('Expand Required Dependency Sources',{all:()=>initial,first:()=>initial[0]},initial[0].json,$);
}
const gate=(requests,items)=>runNode('Validate Required Dependency Sources',
  {all:()=>items,first:()=>items[0]},items[0]?.json,()=>({all:()=>requests}));

// ── 5. First pass: no remediation branch ──────────────────────────────────────
const firstPass=expand(404);
assert.ok(firstPass.every(i=>i.json.sourceGroundingRequest.frozenSourceSha===A),'first pass declares baseSha');
const firstGrounded=gate(firstPass,fixture.sources.map(s=>item(s,A)));
assert.equal(firstGrounded.length,6);
assert.ok(firstGrounded.every(i=>i.json.sourceGrounding.frozenSourceSha===A));
assert.ok(firstGrounded[0].json.sourceGrounding.groundedRelationshipApis.every(p=>p.sourceCommitSha===A),
  'relationship proofs are attributed to the SHA actually read');

// ── 6. Corrective second pass: branch exists at B, sources still read at A ────
const secondPass=expand(200);
assert.ok(secondPass.every(i=>i.json.sourceGroundingRequest.frozenSourceSha===A),
  'corrective pass must NOT declare the branch tip as source provenance');
assert.ok(secondPass.every(i=>i.json.sourceGroundingRequest.frozenSourceSha!==B));
const secondGrounded=gate(secondPass,fixture.sources.map(s=>item(s,A)));
assert.equal(secondGrounded.length,6,'corrective pass grounds the same evidence set');
assert.ok(secondGrounded.every(i=>i.json.sourceGrounding.frozenSourceSha===A));

// ── 4. Real contradiction fails closed, in both directions ────────────────────
// Content fetched at B while A is declared frozen.
assert.throws(()=>gate(firstPass,fixture.sources.map(s=>item(s,B))),/SOURCE_API_CONTEXT_INCOMPLETE/,
  'content read at another commit cannot be accepted as frozen evidence');
// A single contradicting source in an otherwise consistent set.
const oneWrong=fixture.sources.map((s,i)=>item(s,i===3?B:A));
assert.throws(()=>gate(firstPass,oneWrong),/SOURCE_API_CONTEXT_INCOMPLETE/,'one contradictory source invalidates the set');
// Explicit requestedCommitSha disagreeing with the frozen source.
const declaredWrong=fixture.sources.map(s=>{const it=item(s,A);it.json.requestedCommitSha=B;return it;});
assert.throws(()=>gate(firstPass,declaredWrong),/SOURCE_API_CONTEXT_INCOMPLETE/,'declared provenance must match the frozen source');
// Unattributable content (no ref echo at all) must not be silently accepted.
const unattributable=fixture.sources.map(s=>({json:{path:s.path,sha:s.sha,content:Buffer.from(s.content).toString('base64')}}));
assert.throws(()=>gate(firstPass,unattributable),/SOURCE_API_CONTEXT_INCOMPLETE/,'content with no provenance fails closed');

// ── 5b. Blob sha is never treated as commit provenance ────────────────────────
const validateCode=node('Validate Required Dependency Sources').parameters.jsCode;
assert.doesNotMatch(validateCode,/source\.sha\s*(?:===|!==)\s*request\.frozenSourceSha/,'blob sha is never compared to a commit sha');
// A blob sha that happens to be 40-hex must not stand in for provenance: the refs
// echoed by the response are A, so a mismatched blob sha changes nothing.
const blobs=fixture.sources.map(s=>{const it=item(s,A);it.json.sha='c'.repeat(40);return it;});
assert.equal(gate(firstPass,blobs).length,6,'blob sha is irrelevant to provenance when the read ref is correct');
// ...and a correct blob sha cannot rescue content read at the wrong commit.
const blobRescue=fixture.sources.map(s=>{const it=item(s,B);it.json.sha=s.sha;return it;});
assert.throws(()=>gate(firstPass,blobRescue),/SOURCE_API_CONTEXT_INCOMPLETE/,'matching blob sha cannot launder wrong-commit content');

// ── Fix E matrix: typed commit provenance vs Git blob identity ───────────────
const withAllUrls=(ref,blob='c'.repeat(40),download='d'.repeat(40),html='e'.repeat(40))=>fixture.sources.map(s=>{
  const it=item(s,ref);it.json.sha=blob;it.json.git_url='https://api.github.com/repos/o/r/git/blobs/'+blob;
  it.json.download_url='https://raw.githubusercontent.com/o/r/'+download+'/'+s.path;
  it.json.html_url='https://github.com/o/r/blob/'+html+'/'+s.path;return it;
});
assert.equal(gate(firstPass,withAllUrls(A,B)).length,6,'case 1: correct Contents ref with different blob passes');
const explicitMatch=withAllUrls(A,B);explicitMatch.forEach(it=>it.json.requestedCommitSha=A);
assert.equal(gate(firstPass,explicitMatch).length,6,'case 2: matching explicit and Contents refs pass');
assert.throws(()=>gate(firstPass,withAllUrls(B,'c'.repeat(40))),/SOURCE_API_CONTEXT_INCOMPLETE/,'case 3: wrong Contents ref blocks');
const explicitWrong=withAllUrls(A,B);explicitWrong.forEach(it=>it.json.requestedCommitSha=B);
assert.throws(()=>gate(firstPass,explicitWrong),/SOURCE_API_CONTEXT_INCOMPLETE/,'case 4: contradictory explicit ref blocks');
const refsContradict=withAllUrls(B,'c'.repeat(40));refsContradict.forEach(it=>it.json.requestedCommitSha=A);
assert.throws(()=>gate(firstPass,refsContradict),/SOURCE_API_CONTEXT_INCOMPLETE/,'case 5: explicit and URL contradiction blocks');
const blobOnly=fixture.sources.map(s=>({json:{path:s.path,sha:A,git_url:'https://api.github.com/repos/o/r/git/blobs/'+A,content:Buffer.from(s.content).toString('base64')}}));
assert.throws(()=>gate(firstPass,blobOnly),/SOURCE_API_CONTEXT_INCOMPLETE/,'case 6: blob identity cannot replace missing commit provenance');
const wrongRefMatchingBlob=withAllUrls(B,A);
assert.throws(()=>gate(firstPass,wrongRefMatchingBlob),/SOURCE_API_CONTEXT_INCOMPLETE/,'case 7: matching blob cannot launder wrong ref');
assert.equal(gate(firstPass,withAllUrls(A,B,'c'.repeat(40),'d'.repeat(40))).length,6,
  'case 8: arbitrary SHA-like values in non-Contents URLs are ignored');

// Exact execution-2007 response semantics: source.url carries frozen ?ref=A;
// source.sha and git_url carry a different Git blob identity.
const execution2007=withAllUrls(A,'9309b455f7d09b50ec039d1cf18bd068d1b21ef7');
assert.equal(gate(firstPass,execution2007).length,6,'execution 2007 provenance replay passes');

// ── 7. Remediation-branch mechanics stay untouched ────────────────────────────
// Provenance is about evidence; writes/lookups/PRs still follow the branch.
assert.match(String(node('Lookup Remediation Branch').parameters.url),/git\/ref\/heads\/\{\{ encodeURIComponent\(\$json\.targetBranchName\) \}\}/,
  'branch lookup still resolves the remediation branch by name');
for (const name of ['Re-lookup Baseline Ref Before Creation','Re-lookup Remediation Branch Before Create',
  'Call Remote Head Drift Guard','Create Missing Branch','Update File in Branch']) {
  assert.ok(wf.nodes.some(n=>n.name===name),name+' git mechanism still present');
}
const writeRefs=JSON.stringify(wf.nodes.find(n=>n.name==='Update File in Branch').parameters);
assert.match(writeRefs,/\$json\.branchName/,'writes still target the remediation branch');
assert.doesNotMatch(writeRefs,/baseSha/,'writes are never redirected at the evidence baseline');

assert.doesNotMatch(validateCode,/download_url,source\.html_url,source\.git_url/,'arbitrary URL SHA scan removed');
assert.doesNotMatch(validateCode,/source\.git_url/,'git_url blob identity excluded from commit provenance');
// The Contents ref must be parsed explicitly from the url query -- but NOT via the
// WHATWG URL parser, which is unavailable in the Code-node sandbox (execution 2008).
assert.match(validateCode,/source\.url\|\|''\)[\s\S]{0,80}match\(\/\[\?&\]ref=/,'Contents URL ref is parsed explicitly from the query');
assert.doesNotMatch(validateCode,/new URL\(/,'WHATWG URL is not usable in the Code-node sandbox');

console.log('PASS source provenance: fetch/frozen SHA aligned on baseSha for first and corrective passes, '
  +'provenance taken from the requested-ref echo, blob sha never compared to a commit sha, '
  +'real contradictions and unattributable content fail closed, remediation-branch writes unchanged');
