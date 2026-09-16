import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

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
  html_url:'https://github.com/souhaiel11/pfe-app-test/blob/'+ref+'/'+path});
const item=(source,ref)=>({json:{path:source.path,sha:source.sha,
  content:Buffer.from(source.content).toString('base64'),...atRef(source.path,ref)}});
const ctx={repository_owner:'souhaiel11',repository_name:'pfe-app-test',baseSha:A,
  repositoryPolicy:{existingFiles:fixture.repositoryTree},findings:[]};
// branchStatus 404 = first pass (no remediation branch); 200 = corrective second pass at B.
function expand(branchStatus) {
  const lookup=branchStatus===200?{statusCode:200,body:{object:{sha:B}}}:{statusCode:404};
  const values={'Build Independent Repository Policy':[ctx],'Prepare Batch Context':[ctx],'Lookup Remediation Branch':[lookup]};
  const $=k=>({first:()=>({json:values[k][0]}),all:()=>values[k].map(json=>({json}))});
  const initial=fixture.sources.filter(s=>fixture.initialPaths.includes(s.path)).map(s=>item(s,A));
  return new Function('$input','$json','$','Buffer',node('Expand Required Dependency Sources').parameters.jsCode)(
    {all:()=>initial,first:()=>initial[0]},initial[0].json,$,Buffer);
}
const gate=(requests,items)=>new Function('$input','$json','$','Buffer',node('Validate Required Dependency Sources').parameters.jsCode)(
  {all:()=>items,first:()=>items[0]},items[0]?.json,()=>({all:()=>requests}),Buffer);

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

console.log('PASS source provenance: fetch/frozen SHA aligned on baseSha for first and corrective passes, '
  +'provenance taken from the requested-ref echo, blob sha never compared to a commit sha, '
  +'real contradictions and unattributable content fail closed, remediation-branch writes unchanged');
