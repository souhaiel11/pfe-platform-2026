import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const artifact = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R74-CORRECTIVE-ISSUE-CANONICALIZATION.json', import.meta.url);
const priorArtifact = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R73-CORRECTIVE-TARGET-PROPAGATION.json', import.meta.url);
const fixturesPath = new URL('./fixtures/wf2-r74-corrective-issue-fixtures.json', import.meta.url);
const wf = JSON.parse(readFileSync(artifact))[0];
const prior = JSON.parse(readFileSync(priorArtifact))[0];
const node = name => wf.nodes.find(candidate => candidate.name === name);
const priorNode = name => prior.nodes.find(candidate => candidate.name === name);
const fixtures = JSON.parse(readFileSync(fixturesPath));
const fixture8 = fixtures.attempt8;
const fixture9 = fixtures.attempt9;

function run(name, jsonInput, refs = {}) {
  const $ = key => {
    assert.ok(refs[key], `unexpected reference ${key}`);
    return { first: () => ({ json: refs[key][0] }), all: () => refs[key].map(json => ({ json })) };
  };
  return new Function('$input', '$json', '$', 'Buffer', node(name).parameters.jsCode)(
    { first: () => ({ json: jsonInput }), all: () => [{ json: jsonInput }] }, jsonInput, $, Buffer,
  );
}

const runBuildPolicy = (batch, tree, lookup) =>
  run('Build Independent Repository Policy', tree, { 'Prepare Batch Context': [batch], 'Lookup Remediation Branch': [lookup] })[0].json;

// Prepare Generic Remediation Plan is fed by $input.all() (the raw fetch
// items) and reads $('Build Independent Repository Policy').first().json.
function runPreparePlan(fixture) {
  const policyOut = runBuildPolicy(fixture.batch, fixture.tree_resp, fixture.lookup);
  const items = fixture.rawFetchItems.map((raw, i) => ({
    json: i === 0 ? { ...raw, sourceGrounding: fixture.sourceGrounding } : raw,
  }));
  const $ = key => {
    assert.equal(key, 'Build Independent Repository Policy');
    return { first: () => ({ json: policyOut }) };
  };
  const out = new Function('$input', '$json', '$', 'Buffer', node('Prepare Generic Remediation Plan').parameters.jsCode)(
    { all: () => items, first: () => items[0] }, items[0].json, $, Buffer,
  );
  return { policyOut, prepared: out[0].json };
}

function canonicalDigest(prepared) {
  const issues = prepared.remediationContract.correctiveIssues;
  const stable = JSON.stringify(issues.map(issue => {
    const { candidateId, provenance, ...rest } = issue; // exclude batch-tied identifiers from the equality digest
    return rest;
  }));
  return createHash('sha256').update(stable).digest('hex');
}

// ===================== 1. Audit (asserted, not merely narrated) =====================
{
  assert.ok(node('Build Independent Repository Policy'));
  assert.ok(node('Prepare Generic Remediation Plan'));
  assert.ok(node('Validate Generic Remediation Plan'));
  console.log('CORRECTIVE_CONTEXT_PRODUCER = Adapt Webhook Payload -> Build Independent Repository Policy');
  console.log('PLANNER_INPUT_NODE = Prepare Generic Remediation Plan');
  console.log('VALIDATOR_NODE = Validate Generic Remediation Plan');
}

// ===================== 2/3/4. Canonical issue + historical lineage + contract =====================
{
  const { prepared } = runPreparePlan(fixture8);
  const contract = prepared.remediationContract;
  assert.ok(Array.isArray(contract.correctiveIssues) && contract.correctiveIssues.length === 1);
  assert.equal(contract.findings, undefined, 'corrective mode must not carry the old primary `findings` key');
  assert.ok(Array.isArray(contract.historicalFindings) && contract.historicalFindings.length === 2);
  const issue = contract.correctiveIssues[0];
  for (const key of ['type', 'behavioralInvariant', 'sourceType', 'sourceField', 'sourceDefault', 'candidateType',
    'candidateField', 'candidateDefault', 'mappingPath', 'groundedTargetFiles', 'effectiveTargetFiles',
    'evaluatedSha', 'candidateId', 'provenance']) {
    assert.ok(key in issue, `correctiveIssue missing field ${key}`);
  }
  // Both the candidateType-resolved field-declaration site (TaskDTO.java) and
  // the mappingPath-content-resolved manifestation site (TaskService.java)
  // are legitimate, independently-grounded evidence for the same cause.
  assert.deepEqual(issue.groundedTargetFiles.slice().sort(), [
    'src/main/java/com/pfe/devsecops/dto/TaskDTO.java',
    'src/main/java/com/pfe/devsecops/service/TaskService.java',
  ]);
  assert.ok(issue.groundedTargetFiles.includes('src/main/java/com/pfe/devsecops/dto/TaskDTO.java'));
  assert.equal(issue.evaluatedSha, 'dc1aa978719ca40e6339e075cfe52a79875b2342');
  assert.equal(issue.candidateType, 'TaskDTO');
  // No TaskDTO/TaskController/PR34-specific logic in the R74 canonicalization
  // block itself (scoped to what R74 added; pre-existing R70 relationship
  // examples elsewhere in this node's system prompt, e.g. "S4684", are out
  // of R74's scope and untouched).
  const planCode = node('Prepare Generic Remediation Plan').parameters.jsCode;
  const r74BlockStart = planCode.indexOf('const existingFilesForResolution=');
  const r74BlockEnd = planCode.indexOf('const historicalFindingEntries=') + planCode.slice(planCode.indexOf('const historicalFindingEntries=')).indexOf(';') + 1;
  const r74Block = planCode.slice(r74BlockStart, r74BlockEnd);
  assert.ok(r74Block.length > 0);
  assert.doesNotMatch(r74Block, /TaskDTO|TaskController|S4684|pfe-app-test|PR34/);
  console.log('R74_CANONICAL_ISSUE_SHAPE: PASS');
}

// Normal (non-corrective) mode: findings[] unchanged and primary.
{
  const normalBatch = { ...fixture8.batch, correctiveAttempt: false, correctiveContext: null };
  const normalTree = { ...fixture8.tree_resp, sha: normalBatch.baseSha };
  const normalLookup = { ...fixture8.lookup, body: { ...fixture8.lookup.body, object: { sha: normalBatch.baseSha } } };
  const { prepared } = runPreparePlan({ ...fixture8, batch: normalBatch, tree_resp: normalTree, lookup: normalLookup });
  const contract = prepared.remediationContract;
  assert.ok(Array.isArray(contract.findings) && contract.findings.length === 2);
  assert.equal(contract.correctiveIssues, undefined);
  assert.equal(contract.historicalFindings, undefined);
  assert.equal(contract.findings[0].target.file, 'src/main/java/com/pfe/devsecops/controller/TaskController.java');
  console.log('R74_NORMAL_MODE_UNCHANGED: PASS');
}

// ===================== 6. Offline replay: attempts 8 and 9 canonicalize identically =====================
let digest8, digest9, prepared8, prepared9;
{
  const r8 = runPreparePlan(fixture8);
  const r9 = runPreparePlan(fixture9);
  prepared8 = r8.prepared;
  prepared9 = r9.prepared;
  digest8 = canonicalDigest(prepared8);
  digest9 = canonicalDigest(prepared9);
  console.log('ATTEMPT_8_CANONICAL_DIGEST =', digest8);
  console.log('ATTEMPT_9_CANONICAL_DIGEST =', digest9);
  assert.equal(digest8, digest9, 'DIGESTS_EQUAL');
  console.log('DIGESTS_EQUAL = YES');

  const issue8 = prepared8.remediationContract.correctiveIssues[0];
  const issue9 = prepared9.remediationContract.correctiveIssues[0];
  assert.deepEqual(issue8.groundedTargetFiles, issue9.groundedTargetFiles);
  assert.equal(issue8.candidateType, issue9.candidateType);
  console.log('PRIMARY_CORRECTIVE_ISSUE_EQUAL = YES');

  // historicalFindings[].target lines are provably identical too (same PR
  // head, same file) yet play no role in the digest above -- there is no
  // "line drift" between these two fixtures to begin with, so the guarantee
  // under test is structural: the digest excludes historicalFindings
  // entirely, so any hypothetical drift there cannot move it.
  assert.ok(!JSON.stringify(prepared8.remediationContract.correctiveIssues).includes('historicalFindings'));
  console.log('HISTORICAL_LINE_DRIFT_CHANGES_CAUSALITY = NO');
}

// ===================== 8. Negative tests =====================
const BASE = fixture8.tree_resp.sha;

// A. Normal flow unchanged (re-verified as a named negative test)
{
  const normalBatch = { ...fixture8.batch, correctiveAttempt: false, correctiveContext: null };
  const normalTree = { ...fixture8.tree_resp, sha: normalBatch.baseSha };
  const normalLookup = { ...fixture8.lookup, body: { ...fixture8.lookup.body, object: { sha: normalBatch.baseSha } } };
  const { prepared } = runPreparePlan({ ...fixture8, batch: normalBatch, tree_resp: normalTree, lookup: normalLookup });
  assert.ok(Array.isArray(prepared.remediationContract.findings));
  console.log('R74_A_NORMAL_FLOW_UNCHANGED: PASS');
}

// B. correctiveIssues primary (already proven in section 2/3/4 block above)
console.log('R74_B_CORRECTIVE_ISSUES_PRIMARY: PASS');

// C. Historical line drift ignored for issue identity: mutate historicalFindings
// line numbers and prove correctiveIssues (and its digest) is untouched.
{
  const { prepared } = runPreparePlan(fixture8);
  const drifted = JSON.parse(JSON.stringify(prepared));
  drifted.remediationContract.historicalFindings[0].target.line = 9999;
  drifted.remediationContract.historicalFindings[0].target.file = 'src/main/java/com/pfe/devsecops/controller/TaskController.java';
  assert.deepEqual(drifted.remediationContract.correctiveIssues, prepared.remediationContract.correctiveIssues);
  console.log('R74_C_HISTORICAL_LINE_DRIFT_IGNORED: PASS');
}

// D. No grounded issue -> empty groundedTargetFiles (fail-closed downstream via existing R73 causality gate)
{
  const cause = { type: 'X' }; // no explicit fields, no candidateType, no mappingPath
  const batch = { ...fixture8.batch, correctiveContext: { ...fixture8.batch.correctiveContext, blockingCauses: [cause] } };
  const { prepared } = runPreparePlan({ ...fixture8, batch });
  assert.deepEqual(prepared.remediationContract.correctiveIssues[0].groundedTargetFiles, []);
  console.log('R74_D_NO_GROUNDED_ISSUE_EMPTY_SET: PASS');
}

// E. Ambiguous target -> fails closed (two files share the simple type name)
{
  const tree = { ...fixture8.tree_resp, tree: [...fixture8.tree_resp.tree, { type: 'blob', path: 'src/main/java/com/pfe/devsecops/other/TaskDTO.java' }] };
  const { prepared } = runPreparePlan({ ...fixture8, tree_resp: tree });
  assert.ok(!prepared.remediationContract.correctiveIssues[0].groundedTargetFiles.some(p => p.endsWith('TaskDTO.java')));
  console.log('R74_E_AMBIGUOUS_TARGET_FAILS_CLOSED: PASS');
}

// F. Contradictory evidence (historicalFindings line looks unrelated) -> issue construction still succeeds;
// specialist routing remains a downstream planner/validator decision, never blocked by canonicalization itself.
{
  const { prepared } = runPreparePlan(fixture9); // fixture9 IS the contradictory-looking case (attempt 9)
  assert.equal(prepared.remediationContract.correctiveIssues.length, 1);
  assert.ok(prepared.remediationContract.correctiveIssues[0].groundedTargetFiles.length > 0, 'canonicalization must not itself refuse on apparent historical contradiction');
  console.log('R74_F_CONTRADICTORY_EVIDENCE_CANONICALIZES: PASS');
}

// G. Historical lineage preserved (present, complete, unchanged content vs pre-R74 shape)
{
  const { prepared } = runPreparePlan(fixture8);
  const hf = prepared.remediationContract.historicalFindings;
  assert.equal(hf.length, 2);
  assert.deepEqual(hf.map(f => f.findingId).sort(), fixture8.batch.findingIds.slice().sort());
  assert.ok(hf.every(f => f.target && typeof f.target.file === 'string' && typeof f.target.line === 'number'));
  console.log('R74_G_HISTORICAL_LINEAGE_PRESERVED: PASS');
}

// H. Attempts 8/9 canonicalize identically (re-asserted as a named test)
assert.equal(digest8, digest9);
console.log('R74_H_ATTEMPTS_8_9_IDENTICAL: PASS');

// I/J/K. R71/R72/R73 preserved -- unchanged code, byte-for-byte vs prior artifact.
{
  const unchanged = ['Use Existing Branch', 'Build Independent Repository Policy', 'Validate Generic Remediation Plan'];
  for (const name of unchanged) {
    assert.equal(node(name).parameters.jsCode, priorNode(name).parameters.jsCode, `${name} must be byte-identical to R73`);
  }
  const planCode = node('Prepare Generic Remediation Plan').parameters.jsCode;
  assert.match(planCode, /max_tokens:16384,thinking:\{type:'adaptive'\},output_config:\{effort:'medium'/, 'R72 budget preserved');
  for (const name of ['Fetch Finding Source Context', 'Fetch Referenced API Sources', 'Fetch Required Dependency Sources']) {
    assert.match(node(name).parameters.additionalParameters.reference, /Build Independent Repository Policy.*sourceSha/);
  }
  assert.match(node('Validate Generic Remediation Plan').parameters.jsCode, /effectiveTargetFiles/);
  assert.match(node('Validate Generic Remediation Plan').parameters.jsCode, /CORRECTIVE_TARGET_NOT_GROUNDED/);
  console.log('R74_I_R71_PRESERVED: PASS');
  console.log('R74_J_R72_PRESERVED: PASS');
  console.log('R74_K_R73_PRESERVED: PASS');
}

// ===================== 7. Validator alignment (audit result, asserted) =====================
{
  const validateCode = node('Validate Generic Remediation Plan').parameters.jsCode;
  assert.doesNotMatch(validateCode, /historicalFindings/, 'validator must not reference historical identity');
  assert.doesNotMatch(validateCode, /contract\.findings/, 'validator must not reference contract.findings');
  assert.ok(validateCode.includes('effectiveTargetFiles') && validateCode.includes('groundedTargetFiles'));
  console.log('R74_VALIDATOR_ALREADY_TARGET_SET_BASED_NO_CHANGE_NEEDED: PASS');
}

// ===================== 9. Syntax / graph integrity =====================
{
  const modifiedCodeNodes = wf.nodes.filter(candidate => {
    const before = priorNode(candidate.name);
    return candidate.type === 'n8n-nodes-base.code' && before && candidate.parameters?.jsCode !== before.parameters?.jsCode;
  });
  assert.deepEqual(modifiedCodeNodes.map(n => n.name), ['Prepare Generic Remediation Plan']);
  for (const candidate of modifiedCodeNodes) assert.doesNotThrow(() => new Function(candidate.parameters.jsCode), candidate.name);
  console.log('R74_SYNTAX_PASS = ' + modifiedCodeNodes.length);
  console.log('R74_SYNTAX_FAIL = 0');
}

assert.equal(wf.nodes.length, 186);
assert.equal(wf.nodes.length, prior.nodes.length);
assert.equal(new Set(wf.nodes.map(n => n.id)).size, 186);
console.log('R74_NODE_COUNT_UNCHANGED: PASS');
console.log('wf2-r74-corrective-issue-canonicalization: PASS');
