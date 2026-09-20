import fs from 'node:fs';
import assert from 'node:assert/strict';

const workflowPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R78-FINAL-BRANCH-HEAD.json', import.meta.url);
const r77Path = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R77-CORRECTIVE-PLAN-CANONICALIZATION.json', import.meta.url);
const fixturePath = new URL('./fixtures/wf2-r78-execution-2038-final-head.json', import.meta.url);

const workflow = (json => Array.isArray(json) ? json[0] : json)(JSON.parse(fs.readFileSync(workflowPath)));
const r77Workflow = (json => Array.isArray(json) ? json[0] : json)(JSON.parse(fs.readFileSync(r77Path)));
const fixture = JSON.parse(fs.readFileSync(fixturePath));

const node = (wf, name) => {
  const found = wf.nodes.find(n => n.name === name);
  if (!found) throw new Error('NODE_NOT_FOUND:' + name);
  return found;
};

// ---- sandbox helpers -------------------------------------------------
// The real jsCode reads `$json` (the incoming HTTP response from `Update
// File in Branch`), `$runIndex` (n8n's built-in loop-pass index), and
// `$('Expand Manifest Files').item.json` (the candidate for this pass).
function runBuildFileResult(httpResponse, runIndex, candidateJson) {
  const code = node(workflow, 'Build File Result (Pass 2)').parameters.jsCode;
  const $ = () => ({ item: { json: candidateJson } });
  const wrapped = new Function('$json', '$runIndex', '$', code);
  return wrapped(httpResponse, runIndex, $).json;
}

function runValidateBatchCompleteness({ ctx, manifest, incomingResults }) {
  const code = node(workflow, 'Validate Batch Completeness').parameters.jsCode;
  const $ = (name) => {
    if (name === 'Prepare Batch Context') return { first: () => ({ json: ctx }) };
    if (name === 'Assemble Candidate Manifest') return { first: () => ({ json: manifest }) };
    throw new Error('UNEXPECTED_$_CALL:' + name);
  };
  const $input = { all: () => incomingResults.map(json => ({ json })) };
  const wrapped = new Function('$', '$input', code);
  return wrapped($, $input)[0].json;
}

function runSaveResultBodyExpression(validateBatchOutput) {
  const raw = node(workflow, 'Save Execution Result to Backend').parameters.jsonBody;
  assert.ok(raw.includes("$('Validate Batch Completeness').first().json.finalBranchHead"),
    'Save Execution Result to Backend must read finalBranchHead from Validate Batch Completeness');
  // Extract just the prHeadSha sub-expression and evaluate it in isolation
  // (the full jsonBody references many other nodes we don't need to mock).
  const match = raw.match(/prHeadSha: (\$\('Validate Batch Completeness'\)\.first\(\)\.json\.finalBranchHead \|\| '')/);
  assert.ok(match, 'prHeadSha expression not found verbatim');
  const $ = (name) => {
    if (name !== 'Validate Batch Completeness') throw new Error('UNEXPECTED_$_CALL:' + name);
    return { first: () => ({ json: validateBatchOutput }) };
  };
  return new Function('$', `return ${match[1]};`)($);
}

// ---- syntax / graph integrity -----------------------------------------
let syntaxPass = 0, syntaxFail = 0;
for (const n of workflow.nodes) {
  const code = n.parameters && n.parameters.jsCode;
  if (typeof code !== 'string') continue;
  try { new Function(code); syntaxPass++; } catch (e) { syntaxFail++; console.log('SYNTAX_FAIL:', n.name, '-', e.message); }
}
console.log('R78_SYNTAX_PASS =', syntaxPass);
console.log('R78_SYNTAX_FAIL =', syntaxFail);
assert.equal(syntaxFail, 0);

assert.equal(workflow.nodes.length, 186, 'node count must stay 186');
assert.equal(new Set(workflow.nodes.map(n => n.id)).size, 186, 'node ids must stay unique');
console.log('R78_NODE_COUNT_UNCHANGED: PASS');

const diffNames = [];
const byName77 = new Map(r77Workflow.nodes.map(n => [n.name, JSON.stringify(n)]));
for (const n of workflow.nodes) if (byName77.get(n.name) !== JSON.stringify(n)) diffNames.push(n.name);
assert.deepEqual(diffNames.sort(), ['Build File Result (Pass 2)', 'Save Execution Result to Backend', 'Validate Batch Completeness'].sort());
console.log('R77_PRESERVED_ELSEWHERE: PASS (only the 3 intended nodes differ from R77)');

// ---- 5. REPLAY ATTEMPT 13 OFFLINE --------------------------------------
{
  const inputCommits = fixture.buildResults.map(r => r.commitSha);
  console.log('INPUT_COMMITS =', JSON.stringify(inputCommits));
  assert.deepEqual(inputCommits, [
    '53cbd28d2fc007eafa1c6c7872ae106ea4fc617b',
    '5ef66be30482042d9dd6802402692e3d03636c97',
  ]);

  const out = runValidateBatchCompleteness({
    ctx: fixture.prepareBatchContext,
    manifest: fixture.assembleManifest,
    incomingResults: fixture.buildResults,
  });
  console.log('EXPECTED_FINAL_HEAD =', fixture.expectedFinalBranchHead);
  assert.equal(out.finalBranchHead, fixture.expectedFinalBranchHead);
  assert.equal(out.completenessPassed, true);

  const persistedPrHeadSha = runSaveResultBodyExpression(out);
  console.log('PERSISTED_PR_HEAD_AFTER_FIX =', persistedPrHeadSha);
  assert.equal(persistedPrHeadSha, fixture.expectedFinalBranchHead);
  console.log('ATTEMPT_13_REPLAY = PASS');
}

// ---- 6. REGRESSION MATRIX ----------------------------------------------
function baseCtx() {
  return { correctiveAttempt: false, findingIds: ['finding-1', 'finding-2'] };
}
function baseManifest(files) {
  return {
    candidateDigest: 'd'.repeat(64),
    files: files.map(f => ({ path: f.path, operation: 'MODIFY', originalBlobSha: f.oldSha, contentSha256: f.contentSha256 })),
  };
}
function fileResult({ path, oldSha, newSha, commitSha, contentSha256, writeSequence, findingId = 'finding-1' }) {
  return {
    targetFile: path, approvedFindingIds: [findingId], processedFindingIds: [findingId],
    candidateAcceptedFindingIds: [findingId], validationEvidence: {}, outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION',
    candidateStateVerified: true, updateApplied: true, fileOperation: 'MODIFY', oldSha, newSha, commitSha, contentSha256,
    writeSequence,
  };
}
const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40), SHA_C = 'c'.repeat(40);
const OLD_A = '1'.repeat(40), OLD_B = '2'.repeat(40), OLD_C = '3'.repeat(40);
const NEW_A = '4'.repeat(40), NEW_B = '5'.repeat(40), NEW_C = '6'.repeat(40);
const DIGEST_A = 'e'.repeat(64), DIGEST_B = 'f'.repeat(64), DIGEST_C = '0'.repeat(64);
const findingIds1 = ['finding-1'];

// A. 1 write -> its SHA
{
  const files = [{ path: 'FileA.java', oldSha: OLD_A, contentSha256: DIGEST_A }];
  const ctx = { correctiveAttempt: false, findingIds: findingIds1 };
  const manifest = baseManifest(files);
  const incoming = [fileResult({ path: 'FileA.java', oldSha: OLD_A, newSha: NEW_A, commitSha: SHA_A, contentSha256: DIGEST_A, writeSequence: 0 })];
  const out = runValidateBatchCompleteness({ ctx, manifest, incomingResults: incoming });
  assert.equal(out.finalBranchHead, SHA_A);
  console.log('R78_A_SINGLE_WRITE: PASS');
}

// B. 2 writes -> second/final SHA
{
  const files = [
    { path: 'FileA.java', oldSha: OLD_A, contentSha256: DIGEST_A },
    { path: 'FileB.java', oldSha: OLD_B, contentSha256: DIGEST_B },
  ];
  const ctx = { correctiveAttempt: false, findingIds: findingIds1 };
  const manifest = baseManifest(files);
  const incoming = [
    fileResult({ path: 'FileA.java', oldSha: OLD_A, newSha: NEW_A, commitSha: SHA_A, contentSha256: DIGEST_A, writeSequence: 0 }),
    fileResult({ path: 'FileB.java', oldSha: OLD_B, newSha: NEW_B, commitSha: SHA_B, contentSha256: DIGEST_B, writeSequence: 1 }),
  ];
  const out = runValidateBatchCompleteness({ ctx, manifest, incomingResults: incoming });
  assert.equal(out.finalBranchHead, SHA_B, 'must pick the SECOND write, not first-in-array/alphabetical');
  console.log('R78_B_TWO_WRITES_FINAL_SHA: PASS');
}

// B2. Same as B but file paths alphabetically REVERSED vs write order,
// proving the fix does not depend on path sort order.
{
  const files = [
    { path: 'ZFile.java', oldSha: OLD_A, contentSha256: DIGEST_A },
    { path: 'AFile.java', oldSha: OLD_B, contentSha256: DIGEST_B },
  ];
  const ctx = { correctiveAttempt: false, findingIds: findingIds1 };
  const manifest = baseManifest(files);
  const incoming = [
    fileResult({ path: 'ZFile.java', oldSha: OLD_A, newSha: NEW_A, commitSha: SHA_A, contentSha256: DIGEST_A, writeSequence: 0 }),
    fileResult({ path: 'AFile.java', oldSha: OLD_B, newSha: NEW_B, commitSha: SHA_B, contentSha256: DIGEST_B, writeSequence: 1 }),
  ];
  const out = runValidateBatchCompleteness({ ctx, manifest, incomingResults: incoming });
  assert.equal(out.finalBranchHead, SHA_B, 'ZFile.java was written FIRST (seq 0) despite sorting after AFile.java alphabetically; final head must still be the seq-1 write');
  console.log('R78_B2_ALPHABETICAL_ORDER_DOES_NOT_LEAK_INTO_FINAL_HEAD: PASS');
}

// C. 3 writes -> third/final SHA
{
  const files = [
    { path: 'FileA.java', oldSha: OLD_A, contentSha256: DIGEST_A },
    { path: 'FileB.java', oldSha: OLD_B, contentSha256: DIGEST_B },
    { path: 'FileC.java', oldSha: OLD_C, contentSha256: DIGEST_C },
  ];
  const ctx = { correctiveAttempt: false, findingIds: findingIds1 };
  const manifest = baseManifest(files);
  const incoming = [
    fileResult({ path: 'FileA.java', oldSha: OLD_A, newSha: NEW_A, commitSha: SHA_A, contentSha256: DIGEST_A, writeSequence: 0 }),
    fileResult({ path: 'FileB.java', oldSha: OLD_B, newSha: NEW_B, commitSha: SHA_B, contentSha256: DIGEST_B, writeSequence: 1 }),
    fileResult({ path: 'FileC.java', oldSha: OLD_C, newSha: NEW_C, commitSha: SHA_C, contentSha256: DIGEST_C, writeSequence: 2 }),
  ];
  const out = runValidateBatchCompleteness({ ctx, manifest, incomingResults: incoming });
  assert.equal(out.finalBranchHead, SHA_C);
  console.log('R78_C_THREE_WRITES_FINAL_SHA: PASS');
}

// D. second write fails -> batch fails, no misleading final success head
{
  const files = [
    { path: 'FileA.java', oldSha: OLD_A, contentSha256: DIGEST_A },
    { path: 'FileB.java', oldSha: OLD_B, contentSha256: DIGEST_B },
  ];
  const ctx = { correctiveAttempt: false, findingIds: findingIds1 };
  const manifest = baseManifest(files);
  // FileB never produced a result at all (its write failed upstream before
  // Build File Result (Pass 2) could run) -- this is how a real failed
  // write manifests: the loop iteration never emits an item for it.
  const incoming = [
    fileResult({ path: 'FileA.java', oldSha: OLD_A, newSha: NEW_A, commitSha: SHA_A, contentSha256: DIGEST_A, writeSequence: 0 }),
  ];
  assert.throws(() => runValidateBatchCompleteness({ ctx, manifest, incomingResults: incoming }), /WF2_BATCH_INCOMPLETE|PARTIAL_REMOTE_WRITE/);
  console.log('R78_D_FAILED_SECOND_WRITE_FAILS_BATCH: PASS');
}

// E. duplicate callback -> idempotent (same file result delivered twice, identical)
{
  const files = [{ path: 'FileA.java', oldSha: OLD_A, contentSha256: DIGEST_A }];
  const ctx = { correctiveAttempt: false, findingIds: findingIds1 };
  const manifest = baseManifest(files);
  const r = fileResult({ path: 'FileA.java', oldSha: OLD_A, newSha: NEW_A, commitSha: SHA_A, contentSha256: DIGEST_A, writeSequence: 0 });
  const out = runValidateBatchCompleteness({ ctx, manifest, incomingResults: [r, { ...r }] });
  assert.equal(out.finalBranchHead, SHA_A);
  console.log('R78_E_DUPLICATE_RESULT_IDEMPOTENT: PASS');
}

// F. contradictory duplicate (same file, different commitSha) -> fail closed
// (this is the existing CONTRADICTORY_WRITE_EVIDENCE guard, still intact --
// stands in for "a stale/conflicting write cannot silently override the
// real one"; genuine cross-attempt staleness is rejected earlier, at the
// backend's terminal-attempt callback gate, before prHeadSha is ever read).
{
  const files = [{ path: 'FileA.java', oldSha: OLD_A, contentSha256: DIGEST_A }];
  const ctx = { correctiveAttempt: false, findingIds: findingIds1 };
  const manifest = baseManifest(files);
  const r1 = fileResult({ path: 'FileA.java', oldSha: OLD_A, newSha: NEW_A, commitSha: SHA_A, contentSha256: DIGEST_A, writeSequence: 0 });
  const r2 = fileResult({ path: 'FileA.java', oldSha: OLD_A, newSha: NEW_B, commitSha: SHA_B, contentSha256: DIGEST_A, writeSequence: 1 });
  assert.throws(() => runValidateBatchCompleteness({ ctx, manifest, incomingResults: [r1, r2] }), /WF2_EFFECTIVE_RESULT_CONFLICT/);
  console.log('R78_F_CONTRADICTORY_DUPLICATE_REJECTED: PASS');
}

// G. malformed SHA -> reject/fail closed
{
  const files = [{ path: 'FileA.java', oldSha: OLD_A, contentSha256: DIGEST_A }];
  const ctx = { correctiveAttempt: false, findingIds: findingIds1 };
  const manifest = baseManifest(files);
  const bad = fileResult({ path: 'FileA.java', oldSha: OLD_A, newSha: NEW_A, commitSha: 'not-a-sha', contentSha256: DIGEST_A, writeSequence: 0 });
  assert.throws(() => runValidateBatchCompleteness({ ctx, manifest, incomingResults: [bad] }), /WF2_REMOTE_WRITE_EVIDENCE_INVALID/);
  console.log('R78_G_MALFORMED_SHA_REJECTED: PASS');
}

// G2. malformed / missing writeSequence -> reject/fail closed
{
  const files = [{ path: 'FileA.java', oldSha: OLD_A, contentSha256: DIGEST_A }];
  const ctx = { correctiveAttempt: false, findingIds: findingIds1 };
  const manifest = baseManifest(files);
  const bad = fileResult({ path: 'FileA.java', oldSha: OLD_A, newSha: NEW_A, commitSha: SHA_A, contentSha256: DIGEST_A, writeSequence: 'zero' });
  assert.throws(() => runValidateBatchCompleteness({ ctx, manifest, incomingResults: [bad] }), /WF2_EFFECTIVE_RESULT_INVALID|WF2_WRITE_SEQUENCE_INVALID/);
  console.log('R78_G2_MALFORMED_WRITE_SEQUENCE_REJECTED: PASS');
}

// H. incomplete receipts -> reject
{
  const files = [
    { path: 'FileA.java', oldSha: OLD_A, contentSha256: DIGEST_A },
    { path: 'FileB.java', oldSha: OLD_B, contentSha256: DIGEST_B },
    { path: 'FileC.java', oldSha: OLD_C, contentSha256: DIGEST_C },
  ];
  const ctx = { correctiveAttempt: false, findingIds: findingIds1 };
  const manifest = baseManifest(files);
  const incoming = [
    fileResult({ path: 'FileA.java', oldSha: OLD_A, newSha: NEW_A, commitSha: SHA_A, contentSha256: DIGEST_A, writeSequence: 0 }),
    fileResult({ path: 'FileB.java', oldSha: OLD_B, newSha: NEW_B, commitSha: SHA_B, contentSha256: DIGEST_B, writeSequence: 1 }),
  ];
  assert.throws(() => runValidateBatchCompleteness({ ctx, manifest, incomingResults: incoming }), /WF2_BATCH_INCOMPLETE|PARTIAL_REMOTE_WRITE/);
  console.log('R78_H_INCOMPLETE_RECEIPTS_REJECTED: PASS');
}

// I. ambiguous / tied write sequence -> fail closed, never silently pick one
// (stands in for "remote head mismatch/uncertainty must never resolve to a
// silent guess" -- since prHeadSha is no longer sourced from any live
// remote re-fetch at all, the only way this batch's own bookkeeping could
// become internally inconsistent is a sequence collision, which this
// proves fails closed rather than picking arbitrarily.)
{
  const files = [
    { path: 'FileA.java', oldSha: OLD_A, contentSha256: DIGEST_A },
    { path: 'FileB.java', oldSha: OLD_B, contentSha256: DIGEST_B },
  ];
  const ctx = { correctiveAttempt: false, findingIds: findingIds1 };
  const manifest = baseManifest(files);
  const incoming = [
    fileResult({ path: 'FileA.java', oldSha: OLD_A, newSha: NEW_A, commitSha: SHA_A, contentSha256: DIGEST_A, writeSequence: 0 }),
    fileResult({ path: 'FileB.java', oldSha: OLD_B, newSha: NEW_B, commitSha: SHA_B, contentSha256: DIGEST_B, writeSequence: 0 }),
  ];
  assert.throws(() => runValidateBatchCompleteness({ ctx, manifest, incomingResults: incoming }), /WF2_FINAL_BRANCH_HEAD_AMBIGUOUS/);
  console.log('R78_I_AMBIGUOUS_WRITE_SEQUENCE_FAILS_CLOSED: PASS');
}

// Mono-file path through the real Build File Result (Pass 2) node code,
// proving writeSequence stamping itself (not just the completeness node)
// works unchanged for a single-file batch at $runIndex=0.
{
  const candidate = {
    target_file_path: 'FileA.java', fileOperation: 'MODIFY', oldSha: OLD_A, contentSha256: DIGEST_A,
    approvedFindingIds: ['finding-1'], processedFindingIds: ['finding-1'], candidateAcceptedFindingIds: ['finding-1'],
    validationEvidence: {},
  };
  const httpResponse = { commit: { sha: SHA_A }, content: { sha: NEW_A } };
  const out = runBuildFileResult(httpResponse, 0, candidate);
  assert.equal(out.writeSequence, 0);
  assert.equal(out.commitSha, SHA_A);
  console.log('R78_MONO_FILE_WRITE_SEQUENCE_STAMPED: PASS');
}

console.log('wf2-r78-final-branch-head: PASS');
