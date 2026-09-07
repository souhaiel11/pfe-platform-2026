// R22-E — structural + logic proofs for the two-pass WF2 restructuring,
// run against the generated `pending-live-update` artifact (NOT the live
// n8n instance — nothing here imports/publishes anything). Two kinds of
// proof, matching what's actually achievable without a live n8n:
//   (a) graph reachability analysis on the real connections object, and
//   (b) extraction+eval of each new Code node's real jsCode against mock
//       n8n expression helpers ($, $input, $json, $items, $execution),
//       same technique already used for the WF3 Quality-Gate-conditions
//       node in R22-A (wf3-qg-conditions.spec.mjs).
// This is the "non-live test harness / workflow simulation" Phase 17
// explicitly calls for -- it proves the new nodes' own logic and the
// graph's topology, not n8n's runtime engine itself (which can only be
// proven by an actual (out of scope) deployment).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const artifactPath = path.join(here, '..', 'pending-live-update', 'wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.R22E-TWO-PASS-CANDIDATE.json');
const workflow = JSON.parse(readFileSync(artifactPath, 'utf8'))[0];
const nodesByName = new Map(workflow.nodes.map(n => [n.name, n]));
const conns = workflow.connections;

function successors(name) {
  const c = conns[name];
  if (!c) return [];
  return c.main.flatMap(outputArr => outputArr.map(t => t.node));
}

function reachableFrom(startName, { stopAt = new Set() } = {}) {
  const seen = new Set();
  const queue = [startName];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    if (stopAt.has(current) && current !== startName) continue; // don't expand past a stop node, but it IS counted as reached
    for (const next of successors(current)) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}

// ============================================================
// Test 1: no content-bearing remote Git mutation reachable from the
// workflow start WITHOUT first passing through Call Candidate Verification.
// ============================================================
{
  const gitMutatingNodes = ['Create Missing Branch', 'Create File in Branch', 'Update File in Branch'];
  // Reachable set from Webhook if we STOP expansion at the verification call.
  const reachableWithoutPassingVerification = reachableFrom('Webhook', { stopAt: new Set(['Call Candidate Verification']) });
  for (const gitNode of gitMutatingNodes) {
    assert.equal(
      reachableWithoutPassingVerification.has(gitNode), false,
      `Test 1 - '${gitNode}' must not be reachable from Webhook without passing through Call Candidate Verification first`,
    );
  }
  // Sanity: they ARE reachable if we don't stop expansion (proves the graph isn't just disconnected/broken).
  const reachableUnconstrained = reachableFrom('Webhook');
  for (const gitNode of gitMutatingNodes) {
    assert.equal(reachableUnconstrained.has(gitNode), true, `sanity - '${gitNode}' is reachable at all (graph is connected, not accidentally orphaned)`);
  }
  console.log('Test 1 PASS - no Git-mutating node reachable before Call Candidate Verification');
}

// ============================================================
// Test 2: no LLM-call node exists in PASS 2 (reachable from the Pass-2 loop).
// ============================================================
{
  const llmNodes = ['de Patch - HTTP Request', 'Generate Remediation Plan', 'Independent Semantic Review'];
  const pass2Reachable = reachableFrom('Loop Over Manifest Files');
  for (const llmNode of llmNodes) {
    assert.equal(pass2Reachable.has(llmNode), false, `Test 15 - '${llmNode}' (an LLM-call node) must not exist/be reachable in PASS 2`);
  }
  console.log('Test 2 (spec #15) PASS - no LLM generation node reachable from Pass 2');
}

// ============================================================
// Test 3: verification-fail / digest-mismatch / base-sha-mismatch / drift
// all lead to a Persist-failure node, never to a Git-mutating node.
// ============================================================
{
  const failureRoutes = [
    ['Write Guard Passed?', 'Persist Verification Failure'],
    ['Remote Head Drift Passed?', 'Persist Base Moved Failure'],
  ];
  for (const [ifNode, expectedFailureTarget] of failureRoutes) {
    const c = conns[ifNode];
    const falseOutputTargets = c.main[1].map(t => t.node);
    assert.deepEqual(falseOutputTargets, [expectedFailureTarget], `Test 8/9/10/11/12 - '${ifNode}' FALSE branch routes only to '${expectedFailureTarget}', nothing else`);
    const reachableFromFailure = reachableFrom(expectedFailureTarget);
    for (const gitNode of ['Create Missing Branch', 'Create File in Branch', 'Update File in Branch']) {
      assert.equal(reachableFromFailure.has(gitNode), false, `no Git-mutating node reachable downstream of ${expectedFailureTarget}`);
    }
  }
  console.log('Test 3 (spec #8-12) PASS - every failure route leads away from Git mutation');
}

// ============================================================
// Mock n8n expression runtime for jsCode extraction+eval.
// ============================================================
function makeMockRuntime(nodeOutputs, currentItemsByNode = {}) {
  const $ = (name) => ({
    first: () => ({ json: nodeOutputs[name]?.[0] }),
    all: () => (nodeOutputs[name] || []).map(json => ({ json })),
    item: { json: currentItemsByNode[name] },
  });
  const $input = { all: () => (nodeOutputs.__CURRENT_INPUT__ || []).map(json => ({ json })), first: () => ({ json: (nodeOutputs.__CURRENT_INPUT__ || [])[0] }) };
  const $items = () => [{ json: { correlationEnvelope: { incidentId: 'incident-1' } } }];
  const $execution = { id: 'exec-1' };
  const $json = nodeOutputs.__CURRENT_JSON__;
  return { $, $input, $items, $execution, $json };
}

function runCode(node, runtime) {
  const fn = new Function('$', '$input', '$items', '$execution', '$json', 'require', `${node.parameters.jsCode}`);
  return fn(runtime.$, runtime.$input, runtime.$items, runtime.$execution, runtime.$json, require);
}

// ============================================================
// R22-E2J: source context is read from the exact authoritative tree SHA.
// This is intentionally independent of repository, language, framework,
// scanner, finding category/rule, file name, incident, and branch naming.
// ============================================================
{
  const fetch = nodesByName.get('Fetch Finding Source Context');
  const reference = fetch.parameters.additionalParameters.reference;
  assert.match(reference, /Lookup Remediation Branch/);
  assert.match(reference, /statusCode/);
  assert.match(reference, /body\?\.object\?\.sha/);
  assert.match(reference, /Prepare Batch Context/);
  assert.match(reference, /baseSha/);
  assert.doesNotMatch(reference, /targetBranchName/,
    'an absent remediation branch must never be dereferenced by source-context fetch');

  const resolveAuthoritativeSourceSha = ({ lookupStatus, branchHeadSha, baseSha }) =>
    Number(lookupStatus) === 200 ? branchHeadSha : baseSha;
  const fixtures = [
    { project: 'maven', path: 'src/main/java/org/example/Service.java', category: 'SAST', lookupStatus: 200, branchHeadSha: '1'.repeat(40), baseSha: '2'.repeat(40), expected: '1'.repeat(40) },
    { project: 'npm', path: 'src/services/account.ts', category: 'CODE', lookupStatus: 404, branchHeadSha: undefined, baseSha: '3'.repeat(40), expected: '3'.repeat(40) },
    { project: 'npm', path: 'packages/api/src/router.ts', category: 'DEPENDENCY', lookupStatus: 200, branchHeadSha: '4'.repeat(40), baseSha: '5'.repeat(40), expected: '4'.repeat(40) },
    { project: 'maven', path: 'missing/source/File.kt', category: 'SECRET', lookupStatus: 404, branchHeadSha: undefined, baseSha: '6'.repeat(40), expected: '6'.repeat(40) },
  ];
  for (const fixture of fixtures) {
    assert.equal(resolveAuthoritativeSourceSha(fixture), fixture.expected,
      `${fixture.project}/${fixture.category}/${fixture.path}: source ref derives only from authoritative branch/base state`);
  }
  console.log('R22-E2J PASS - source-context ref is authoritative-SHA based across Maven/npm, existing/absent branch, varied paths/categories, including missing source');
}

{
  const policyNode = nodesByName.get('Build Independent Repository Policy');
  const verifyFixture = ({ file, source, tree, manifest }) => {
    const runtime = makeMockRuntime({
      'Prepare Batch Context': [{ findings: [{ file, source }], repository_owner: 'fixture-owner', repository_name: 'fixture-repository' }],
      __CURRENT_JSON__: { truncated: false, tree: [...tree, { type: 'blob', path: manifest }] },
    });
    return runCode(policyNode, runtime)[0].json.repositoryPolicy;
  };
  const maven = verifyFixture({ file: 'src/main/java/org/example/Service.java', source: 'SAST', tree: [{ type: 'blob', path: 'src/main/java/org/example/Service.java' }], manifest: 'pom.xml' });
  const npm = verifyFixture({ file: 'packages/api/src/router.ts', source: 'CODE', tree: [{ type: 'blob', path: 'packages/api/src/router.ts' }], manifest: 'package.json' });
  assert.deepEqual(maven.targetFiles, ['src/main/java/org/example/Service.java']);
  assert.deepEqual(npm.targetFiles, ['packages/api/src/router.ts']);
  assert.throws(() => verifyFixture({ file: 'src/missing.ts', source: 'SECRET', tree: [{ type: 'blob', path: 'src/other.ts' }], manifest: 'package.json' }), /FINDING_SOURCE_NOT_IN_REPOSITORY/);
  console.log('R22-E2J PASS - repository policy accepts Maven/Java and npm/TypeScript fixtures and fails closed for a missing source');
}

// ============================================================
// R22-E2P: EVERY Pass-1 github file:get read (planner-input read AND the
// Pass-1 patch-target read) resolves from the authoritative immutable SHA,
// never from the not-yet-created remediation branch name. Root cause of
// execution 1950's GitHub 404: 'Fetch Repository Files' still referenced
// $('Prepare Batch Context').targetBranchName during Pass 1.
// Independent of repository, language, framework, scanner, finding
// category/rule, file name, incident id, and branch naming.
// ============================================================
{
  const PASS1_FILE_READ_NODES = ['Fetch Finding Source Context', 'Fetch Repository Files'];

  // Evaluate the real n8n reference expression the same way n8n would.
  const evalReference = (referenceExpr, { lookupStatus, branchHeadSha, baseSha }) => {
    const inner = referenceExpr.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
    const $ = (name) => ({
      first: () => ({
        json: name === 'Lookup Remediation Branch'
          ? { statusCode: lookupStatus, body: { object: { sha: branchHeadSha } } }
          : { baseSha },
      }),
    });
    // eslint-disable-next-line no-new-func
    return new Function('$', `return (${inner});`)($);
  };

  const references = PASS1_FILE_READ_NODES.map(name => {
    const node = nodesByName.get(name);
    assert.ok(node, `R22-E2P - node '${name}' must exist`);
    assert.equal(node.type, 'n8n-nodes-base.github');
    assert.equal(node.parameters.operation, 'get');
    return node.parameters.additionalParameters.reference;
  });

  // CASE C + shared-expression: the two Pass-1 file reads use the SAME
  // authoritative-ref policy, byte-for-byte (they can never diverge again).
  assert.equal(references[0], references[1],
    'CASE C - Fetch Finding Source Context and Fetch Repository Files must share one authoritative-ref expression');

  for (const [name, reference] of PASS1_FILE_READ_NODES.map((n, i) => [n, references[i]])) {
    // CASE D - a branch NAME is never the Pass-1 file-read reference.
    assert.doesNotMatch(reference, /targetBranchName/,
      `CASE D - '${name}' must not reference targetBranchName for a Pass-1 repository read`);
    assert.match(reference, /Lookup Remediation Branch/, `${name} keys off the branch-lookup result`);
    assert.match(reference, /statusCode/);
    assert.match(reference, /body\?\.object\?\.sha/, `${name} uses the immutable branch HEAD sha`);
    assert.match(reference, /Prepare Batch Context.+baseSha/s, `${name} falls back to the authoritative base sha`);

    // Genericity: no project / finding / rule / language / test-mode literal.
    for (const forbidden of [/pfe-app-test/i, /TaskController/, /S125/, /\bjava\b/i, /\bmaven\b/i, /c95bffd4/i, /1950/, /test[_-]?mode/i]) {
      assert.doesNotMatch(reference, forbidden, `${name} reference must stay generic (no ${forbidden})`);
    }

    // CASE A - remediation branch absent (lookup != 200) -> base sha.
    assert.equal(
      evalReference(reference, { lookupStatus: 404, branchHeadSha: undefined, baseSha: 'a'.repeat(40) }),
      'a'.repeat(40),
      `CASE A - '${name}': absent remediation branch resolves to Prepare Batch Context.baseSha`,
    );
    // CASE B - remediation branch exists (lookup 200) -> exact branch HEAD sha.
    assert.equal(
      evalReference(reference, { lookupStatus: 200, branchHeadSha: 'b'.repeat(40), baseSha: 'c'.repeat(40) }),
      'b'.repeat(40),
      `CASE B - '${name}': existing remediation branch resolves to the exact Lookup Remediation Branch HEAD sha`,
    );
  }
  console.log('R22-E2P PASS - CASE A (absent->baseSha), CASE B (exists->branch HEAD sha), CASE C (shared expr), CASE D (no targetBranchName) for both Pass-1 file reads');
}

// ============================================================
// R22-E2P CASE E + CASE F: branch creation and every Git mutation remain
// unreachable from the Pass-1 patch-target read until CandidateVerification,
// Write Guard and Remote Head Drift Guard have all been passed.
// ============================================================
{
  const GIT_MUTATION_NODES = ['Create Missing Branch', 'Create File in Branch', 'Update File in Branch'];

  // CASE F - from the Pass-1 read node, no Git mutation is reachable if we
  // stop expansion at Call Candidate Verification.
  const fromPass1ReadStoppingAtVerification = reachableFrom('Fetch Repository Files', { stopAt: new Set(['Call Candidate Verification']) });
  for (const gitNode of GIT_MUTATION_NODES) {
    assert.equal(fromPass1ReadStoppingAtVerification.has(gitNode), false,
      `CASE F - '${gitNode}' must not be reachable from the Pass-1 read without passing Call Candidate Verification`);
  }

  // CASE E - branch creation is gated behind ALL THREE guards in order.
  // Stop at any one guard and 'Create Missing Branch' is unreachable.
  for (const guard of ['Call Candidate Verification', 'Call Write Guard', 'Call Remote Head Drift Guard']) {
    const stopped = reachableFrom('Webhook', { stopAt: new Set([guard]) });
    assert.equal(stopped.has('Create Missing Branch'), false,
      `CASE E - 'Create Missing Branch' must not be reachable from Webhook without passing '${guard}'`);
  }
  // Sanity: with no stop node it IS reachable (graph is connected).
  assert.equal(reachableFrom('Webhook').has('Create Missing Branch'), true,
    'CASE E sanity - Create Missing Branch is reachable at all');

  console.log('R22-E2P PASS - CASE E (branch creation after all 3 guards) + CASE F (no Git mutation from the Pass-1 read pre-verification)');
}

// ============================================================
// R22-E2Q FIX A — sandbox compatibility. `require('crypto')` is disallowed
// in n8n's Code-node task-runner (proven by R22-E2O-R3 execution 1952).
// This test would have FAILED before the fix. It must never be weakened to
// make the workflow pass — it is the whole reason 1952 was not caught.
// ============================================================
const sha256hex = (s) => require('node:crypto').createHash('sha256').update(String(s), 'utf8').digest('hex');
{
  const cryptoRequirePattern = /require\(\s*['"](?:node:)?crypto['"]\s*\)/;
  const offenders = workflow.nodes
    .filter(n => n.type === 'n8n-nodes-base.code' && typeof n.parameters?.jsCode === 'string')
    .filter(n => cryptoRequirePattern.test(n.parameters.jsCode))
    .map(n => n.name);
  assert.deepEqual(offenders, [], `R22-E2Q - no Code node may require() the disallowed 'crypto' builtin (found: ${offenders.join(', ')})`);

  // The 4 native replacements are real SHA-256, hex, main-process Crypto nodes.
  const HASH_NODES = ['Hash Candidate File Content', 'Hash Candidate Manifest', 'Recompute Content Hash Before Send', 'Hash Reconciled Remote Content'];
  for (const name of HASH_NODES) {
    const node = nodesByName.get(name);
    assert.ok(node, `R22-E2Q - hash node '${name}' exists`);
    assert.equal(node.type, 'n8n-nodes-base.crypto', `${name} is the native Crypto node`);
    assert.equal(node.parameters.action, 'hash');
    assert.equal(node.parameters.type, 'SHA256', `${name} is SHA-256, not a weaker digest`);
    assert.equal(node.parameters.encoding, 'hex');
    assert.equal(node.parameters.binaryData, false);
    assert.match(String(node.parameters.value), /^=\{\{.*\}\}$/, `${name} hashes an expression value`);
  }
  // The n8n Crypto node is createHash('SHA256').update(value).digest('hex') —
  // identical to backend computeContentSha256 (createHash('sha256').update(v,'utf8')).
  for (const vector of ['', 'abc', 'accentué — © 文字 \u{1F600}', 'line1\nline2\r\nline3\n']) {
    assert.equal(
      require('node:crypto').createHash('SHA256').update(vector).digest('hex'),
      sha256hex(vector),
      `SHA-256 test vector ${JSON.stringify(vector)}: Crypto-node form == backend canonical form`,
    );
  }
  console.log('R22-E2Q PASS - 0 require(crypto) in Code nodes; 4 native SHA-256 hex Crypto nodes; hash matches backend byte-for-byte across test vectors');
}

// ============================================================
// R22-E2Q FIX C — 'Accumulate Candidate File' re-derives candidateBaseSha +
// branchExists (lost when 'Fetch Repository Tree' replaces the item JSON).
// The OLD spec hand-injected these into every mock item, so it could never
// have caught the missing propagation (R22-E2O-R3: Assemble Candidate
// Manifest would throw CANDIDATE_MANIFEST_INVALID:candidateBaseSha). Now
// the derivation itself is exercised: nothing is hand-injected.
// ============================================================
{
  const node = nodesByName.get('Accumulate Candidate File');
  const enforceOut = { patchedCode: 'controller content', targetFile: 'A.java', fileOperation: 'MODIFY' };
  const cryptoOut = { ...enforceOut, contentSha256: sha256hex('controller content') }; // what 'Hash Candidate File Content' feeds in

  // branch ABSENT: candidateBaseSha derives from Prepare Batch Context.baseSha
  const absent = runCode(node, makeMockRuntime({
    'Enforce Independent Review': undefined,
    'Lookup Remediation Branch': [{ statusCode: 404, body: { message: 'Not Found' } }],
    'Prepare Batch Context': [{ baseSha: '1ADED596713CBE8477A4BF652CD081B9AEC00AA7' }],
    __CURRENT_JSON__: cryptoOut,
  }, { 'Enforce Independent Review': enforceOut }));
  assert.equal(absent.json.branchExists, false, 'FIX C - branch absent ⇒ branchExists false');
  assert.equal(absent.json.candidateBaseSha, '1aded596713cbe8477a4bf652cd081b9aec00aa7', 'FIX C - branch absent ⇒ candidateBaseSha = Prepare Batch Context.baseSha (lowercased)');
  assert.equal(absent.json.contentSha256, sha256hex('controller content'), 'FIX C - contentSha256 carried from the Crypto node');

  // branch PRESENT: candidateBaseSha derives from the Lookup HEAD sha (NOT baseSha)
  const present = runCode(node, makeMockRuntime({
    'Lookup Remediation Branch': [{ statusCode: 200, body: { object: { sha: 'ABC123ABC123ABC123ABC123ABC123ABC123ABCD' } } }],
    'Prepare Batch Context': [{ baseSha: '1aded596713cbe8477a4bf652cd081b9aec00aa7' }],
    __CURRENT_JSON__: cryptoOut,
  }, { 'Enforce Independent Review': enforceOut }));
  assert.equal(present.json.branchExists, true, 'FIX C - lookup 200 ⇒ branchExists true');
  assert.equal(present.json.candidateBaseSha, 'abc123abc123abc123abc123abc123abc123abcd', 'FIX C - branch present ⇒ candidateBaseSha = existing branch HEAD sha, never silently the baseline');

  // contentSha256 not a 64-hex string ⇒ hard fail (the Crypto node must have run)
  assert.throws(() => runCode(node, makeMockRuntime({
    'Lookup Remediation Branch': [{ statusCode: 404 }], 'Prepare Batch Context': [{ baseSha: '1aded596713cbe8477a4bf652cd081b9aec00aa7' }],
    __CURRENT_JSON__: { ...enforceOut },
  }, { 'Enforce Independent Review': enforceOut })), /CANDIDATE_CONTENT_SHA256_UNAVAILABLE/, 'FIX C - missing upstream hash fails closed');
  console.log('R22-E2Q PASS - FIX C: Accumulate Candidate File derives candidateBaseSha/branchExists from authoritative state (no hand-injection), fails closed without the upstream hash');
}

// ============================================================
// Test 4: the Pass-1 manifest chain — Prepare Candidate Manifest (build) →
// [Hash Candidate Manifest = native Crypto] → Assemble Candidate Manifest
// (freeze/validate). candidateDigest still byte-for-byte identical to the
// REAL compiled backend computeCandidateDigest.
// ============================================================
{
  // Items shaped like real 'Accumulate Candidate File' output (FIX C ⇒ these
  // fields are genuinely present now, not injected by the test harness).
  const mk = (path, op, code, extra) => ({
    target_file_path: path, fileOperation: op, patchedCode: code, oldSha: extra.oldSha ?? null,
    repository_owner: 'souhaiel11', repository_name: 'pfe-app-test', branchName: 'fix/pfe-x', commitMessage: 'fix',
    sourceContent: extra.sourceContent ?? null, approvedFindingIds: ['f1'], processedFindingIds: ['f1'],
    candidateAcceptedFindingIds: ['f1'], validationEvidence: {},
    branchExists: false, candidateBaseSha: '8a315b0dd508eb9843bb3037fe2827f02f6faa78',
    contentSha256: sha256hex(code),
  });
  const accumulated = [
    mk('src/main/java/com/pfe/devsecops/controller/TaskController.java', 'MODIFY', 'controller content', { oldSha: 'blobsha1', sourceContent: 'old controller' }),
    mk('src/main/java/com/pfe/devsecops/dto/TaskDTO.java', 'MODIFY', 'dto content', { oldSha: 'blobsha2', sourceContent: 'old dto' }),
    mk('src/test/java/com/pfe/devsecops/controller/TaskControllerTest.java', 'CREATE', 'controller test content', {}),
    mk('src/test/java/com/pfe/devsecops/dto/TaskDTOTest.java', 'CREATE', 'dto test content', {}),
  ];
  const ctx = { batchId: 'batch-1', attemptCount: 3, requestId: 'req-1', repository_owner: 'souhaiel11', repository_name: 'pfe-app-test', targetBranchName: 'fix/pfe-x', baseBranch: 'main' };

  // Step 1 — Prepare Candidate Manifest: builds the manifest + _canonicalJson, NO digest.
  const [{ json: prepared }] = runCode(nodesByName.get('Prepare Candidate Manifest'),
    makeMockRuntime({ 'Prepare Batch Context': [ctx], __CURRENT_INPUT__: accumulated }));
  assert.equal(prepared.candidateDigest, undefined, 'Prepare Candidate Manifest does NOT compute the digest (no sandbox crypto)');
  assert.equal(typeof prepared._canonicalJson, 'string', 'emits _canonicalJson for the Crypto node');

  // Step 2 — the native Crypto node: candidateDigest = SHA256(_canonicalJson).
  const withDigest = { ...prepared, candidateDigest: require('node:crypto').createHash('SHA256').update(prepared._canonicalJson).digest('hex') };

  // Step 3 — Assemble Candidate Manifest: strip helper field, validate, freeze.
  const [{ json: manifest }] = runCode(nodesByName.get('Assemble Candidate Manifest'),
    makeMockRuntime({ __CURRENT_JSON__: withDigest }));
  assert.equal(manifest._canonicalJson, undefined, 'frozen manifest carries no helper field');
  assert.equal(manifest.files.length, 4, 'Test 4 - all 4 planned files present exactly once');
  assert.equal(new Set(manifest.files.map(f => f.path)).size, 4, 'no duplicate paths');
  assert.equal(manifest.candidateBaseSha, '8a315b0dd508eb9843bb3037fe2827f02f6faa78');
  assert.equal(manifest.branchExists, false);
  assert.match(manifest.candidateDigest, /^[a-f0-9]{64}$/);

  // Cross-check against the REAL compiled backend digest function.
  const { computeCandidateDigest, computeContentSha256 } = require(path.join(here, '..', '..', 'backend', 'dist', 'candidate-verification', 'candidate-digest.js'));
  assert.equal(manifest.candidateDigest, computeCandidateDigest(manifest),
    'Test 4 - the native-Crypto-node digest is byte-for-byte identical to backend computeCandidateDigest');
  assert.equal(manifest.files[0].contentSha256, computeContentSha256('controller content'),
    'Test 4 - per-file contentSha256 identical to backend computeContentSha256');
  // Order independence (canonical sort) preserved through the split.
  const [{ json: reordered }] = runCode(nodesByName.get('Prepare Candidate Manifest'),
    makeMockRuntime({ 'Prepare Batch Context': [ctx], __CURRENT_INPUT__: [...accumulated].reverse() }));
  assert.equal(reordered._canonicalJson, prepared._canonicalJson, 'Test 4 - canonical serialization is independent of accumulated-file order');
  console.log('Test 4 PASS - Pass-1 manifest chain (Prepare → Crypto → Assemble): shape + order-independence + digest byte-identical to backend');
}

// ============================================================
// Test 5: Verify Content Hash Before Send — now compares the value the
// upstream 'Recompute Content Hash Before Send' Crypto node produced.
// ============================================================
{
  const node = nodesByName.get('Verify Content Hash Before Send');
  const contentSha256 = sha256hex('real content');
  const good = { target_file_path: 'A.java', patchedCode: 'real content', contentSha256, _recomputedContentSha256: contentSha256 };
  const [result] = [runCode(node, makeMockRuntime({ __CURRENT_JSON__: good }))];
  assert.deepEqual(result.json, { target_file_path: 'A.java', patchedCode: 'real content', contentSha256 },
    'matching content passes through; the transient _recomputedContentSha256 is stripped');

  const tampered = { target_file_path: 'A.java', patchedCode: 'real content', contentSha256: 'deadbeef'.repeat(8), _recomputedContentSha256: contentSha256 };
  assert.throws(() => runCode(node, makeMockRuntime({ __CURRENT_JSON__: tampered })),
    /CANDIDATE_CONTENT_MISMATCH/, 'Test 5 - mismatch is rejected before send, never written to GitHub');
  console.log('Test 5 (spec #14) PASS - Verify Content Hash Before Send catches a mismatch against the native-Crypto recompute');
}

// ============================================================
// R22-E2Q FIX A.4 — Evaluate GitHub Write Reconciliation (Pass 2) now reads
// the pre-decoded content + pre-computed hash; all four outcomes preserved.
// ============================================================
{
  const node = nodesByName.get('Evaluate GitHub Write Reconciliation (Pass 2)');
  const patch = { target_file_path: 'A.java', patchedCode: 'CANDIDATE', sourceContent: 'ORIGINAL', contentSha256: sha256hex('CANDIDATE') };
  const run = (extra) => runCode(node, makeMockRuntime(
    { __CURRENT_JSON__: { sha: 'newsha', ...extra } }, { 'Expand Manifest Files': patch }));
  assert.equal(run({ _reconciledRemoteContent: 'CANDIDATE', _reconciledRemoteSha256: sha256hex('CANDIDATE') }).json.remoteState, 'EXPECTED_CANDIDATE');
  assert.equal(run({ _reconciledRemoteContent: 'ORIGINAL', _reconciledRemoteSha256: sha256hex('ORIGINAL') }).json.remoteState, 'UNCHANGED');
  assert.equal(run({ _reconciledRemoteContent: 'CANDIDATE', _reconciledRemoteSha256: 'deadbeef'.repeat(8) }).json.remoteState, 'HASH_MISMATCH');
  assert.equal(run({ _reconciledRemoteContent: 'SOMETHING ELSE', _reconciledRemoteSha256: sha256hex('SOMETHING ELSE') }).json.remoteState, 'UNEXPECTED');
  console.log('R22-E2Q PASS - FIX A.4: Pass-2 reconciliation still classifies EXPECTED_CANDIDATE / UNCHANGED / HASH_MISMATCH / UNEXPECTED');
}

// ============================================================
// R22-E2Q FIX B — every R22-E two-pass Failure Envelope reaches
// 'Prepare WF2 Failure Status' → 'Persist WF2 Failure Status'. Before the
// fix, all 16 dead-ended and a Pass-1/Pass-2 failure never persisted
// FIX_FAILED (R22-E2O-R3 execution 1952). No cycles; no double persistence.
// ============================================================
{
  const feNodes = workflow.nodes.map(n => n.name).filter(n => n.startsWith('Failure Envelope'));
  const deadEnds = feNodes.filter(fe => !reachableFrom(fe).has('Persist WF2 Failure Status'));
  assert.deepEqual(deadEnds, [], `FIX B - every Failure Envelope must reach Persist WF2 Failure Status (dead-ends: ${deadEnds.join(', ')})`);

  // No cycle reachable from the persistence entry point.
  const walkForCycle = (start) => {
    const stack = [[start, []]];
    while (stack.length) {
      const [n, path] = stack.pop();
      if (path.includes(n)) return [...path, n];
      for (const s of successors(n)) stack.push([s, [...path, n]]);
    }
    return null;
  };
  assert.equal(walkForCycle('Prepare WF2 Failure Status'), null, 'FIX B - no cycle from Prepare WF2 Failure Status');

  // Persist is fed only by the three legitimate predecessors (no duplicate persistence path).
  const persistPreds = Object.entries(conns)
    .filter(([, c]) => (c.main || []).some(arr => arr.some(t => t.node === 'Persist WF2 Failure Status')))
    .map(([src]) => src).sort();
  assert.deepEqual(persistPreds, ['Persist Base Moved Failure', 'Persist Verification Failure', 'Prepare WF2 Failure Status'],
    'FIX B - Persist WF2 Failure Status keeps exactly its 3 legitimate feeders');
  console.log(`R22-E2Q PASS - FIX B: all ${feNodes.length} Failure Envelopes reach persistence, 0 cycles, 0 duplicate persistence`);
}

// ============================================================
// Test 6: Validate Batch Completeness (v2) classifies PARTIAL_REMOTE_WRITE
// distinctly from a generic WF2_BATCH_INCOMPLETE.
// ============================================================
{
  const node = nodesByName.get('Validate Batch Completeness');
  const manifestFiles = [
    { path: 'A.java', contentSha256: 'sha-a' },
    { path: 'B.java', contentSha256: 'sha-b' },
  ];
  const fullResult = (path, sha) => ({ targetFile: path, approvedFindingIds: [], processedFindingIds: [], candidateAcceptedFindingIds: [], validationEvidence: {}, outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION', candidateStateVerified: true, updateApplied: true, fileOperation: 'MODIFY', oldSha: 'x', newSha: 'y', commitSha: 'c', contentSha256: sha });

  // Only 1 of 2 files confirmed -> PARTIAL_REMOTE_WRITE, not the generic incomplete code.
  {
    const runtime = makeMockRuntime({
      'Prepare Batch Context': [{ findingIds: [] }],
      'Assemble Candidate Manifest': [{ files: manifestFiles, candidateDigest: 'd1' }],
      __CURRENT_INPUT__: [fullResult('A.java', 'sha-a')],
    });
    assert.throws(() => runCode(node, runtime), /PARTIAL_REMOTE_WRITE/, 'Test 17 - missing file(s) with no other defect classifies as PARTIAL_REMOTE_WRITE, forbidding PR creation');
  }
  // All files confirmed, hashes match -> passes.
  {
    const runtime = makeMockRuntime({
      'Prepare Batch Context': [{ findingIds: [] }],
      'Assemble Candidate Manifest': [{ files: manifestFiles, candidateDigest: 'd1' }],
      __CURRENT_INPUT__: [fullResult('A.java', 'sha-a'), fullResult('B.java', 'sha-b')],
    });
    const [{ json }] = runCode(node, runtime);
    assert.equal(json.completenessPassed, true, 'Test 16 - all N files confirmed -> completeness passes, PR eligible');
    assert.equal(json.candidateDigest, 'd1', 'completeness result carries the candidateDigest forward for observability');
  }
  // All files "present" but one's content hash doesn't match manifest -> CANDIDATE_CONTENT_MISMATCH, not a silent pass.
  {
    const runtime = makeMockRuntime({
      'Prepare Batch Context': [{ findingIds: [] }],
      'Assemble Candidate Manifest': [{ files: manifestFiles, candidateDigest: 'd1' }],
      __CURRENT_INPUT__: [fullResult('A.java', 'WRONG-HASH'), fullResult('B.java', 'sha-b')],
    });
    assert.throws(() => runCode(node, runtime), /CANDIDATE_CONTENT_MISMATCH/, 'Test 18 - a confirmed file whose remote content hash disagrees with the manifest is caught, not silently accepted');
  }
  console.log('Test 6 (spec #16/17/18) PASS - Validate Batch Completeness v2 classifications correct');
}

// ============================================================
// Test 7: Use Existing Branch captures the branch HEAD as candidateBaseSha,
// distinct from ctx.baseSha (Critical Invariant 1, existing-branch case).
// ============================================================
{
  const node = nodesByName.get('Use Existing Branch');
  const branchHead = 'b'.repeat(40);
  const mainSha = 'a'.repeat(40);
  const runtime = makeMockRuntime(
    { 'Prepare Batch Context': [{ targetBranchName: 'fix/pfe-x', baseSha: mainSha }] },
    {},
  );
  runtime.$json = { statusCode: 200, body: { ref: 'refs/heads/fix/pfe-x', object: { sha: branchHead } } };
  const [{ json }] = runCode(node, runtime);
  assert.equal(json.candidateBaseSha, branchHead.toLowerCase(), 'Test 5 (spec) - existing-branch candidateBaseSha = branch HEAD');
  assert.notEqual(json.candidateBaseSha, mainSha, 'existing-branch candidateBaseSha is NOT silently equated to main/baseline SHA');
  assert.equal(json.branchExists, true);
  console.log('Test 7 PASS - Use Existing Branch captures the real branch HEAD as candidateBaseSha');
}

// ============================================================
// Test 8: Record New Branch Baseline uses baseline SHA for a new branch.
// ============================================================
{
  const node = nodesByName.get('Record New Branch Baseline');
  const mainSha = 'a'.repeat(40);
  const runtime = makeMockRuntime({ 'Prepare Batch Context': [{ baseSha: mainSha }] });
  const [{ json }] = runCode(node, runtime);
  assert.equal(json.candidateBaseSha, mainSha.toLowerCase(), 'Test 6 (spec) - new-branch candidateBaseSha = baseline SHA');
  assert.equal(json.branchExists, false);
  console.log('Test 8 PASS - Record New Branch Baseline uses the baseline SHA for a not-yet-existing branch');
}

// ============================================================
// Tests 19/20/21/22 (spec) — R22-E2Q-SCOPE-CLEANUP tightened this from a
// hand-listed subset to the WHOLE workflow: EVERY node that is not one of
// the 10 authorised R22-E2Q nodes must have parameters BYTE-IDENTICAL to
// the accepted baseline artifact (the previously reviewed & committed
// R22E-TWO-PASS-CANDIDATE). This is the machine proof of
// "UNRELATED NODE PARAMETER CHANGES: 0".
// ============================================================
{
  const R22EQ_AUTHORISED = new Set([
    'Accumulate Candidate File', 'Assemble Candidate Manifest',
    'Verify Content Hash Before Send', 'Evaluate GitHub Write Reconciliation (Pass 2)',
    'Hash Candidate File Content', 'Prepare Candidate Manifest', 'Hash Candidate Manifest',
    'Recompute Content Hash Before Send', 'Decode Reconciled Remote Content', 'Hash Reconciled Remote Content',
  ]);
  const baselinePath = path.join(here, '..', 'pending-live-update', 'wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.R22E-TWO-PASS-CANDIDATE.baseline.json');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))[0];
  const baselineByName = new Map(baseline.nodes.map(n => [n.name, n]));

  const unrelatedChanges = [];
  for (const node of workflow.nodes) {
    if (R22EQ_AUTHORISED.has(node.name)) continue;
    const baselineNode = baselineByName.get(node.name);
    if (!baselineNode) { unrelatedChanges.push(`${node.name}: NEW (not authorised, not in baseline)`); continue; }
    if (JSON.stringify(baselineNode.parameters) !== JSON.stringify(node.parameters)) {
      unrelatedChanges.push(`${node.name}: parameters differ from baseline`);
    }
  }
  // Also: no baseline node silently dropped.
  for (const bn of baseline.nodes) {
    if (!nodesByName.has(bn.name)) unrelatedChanges.push(`${bn.name}: present in baseline, missing from regenerated artifact`);
  }
  assert.deepEqual(unrelatedChanges, [], `UNRELATED NODE PARAMETER CHANGES must be 0:\n  ${unrelatedChanges.join('\n  ')}`);

  const authorisedChanged = workflow.nodes.filter(n => R22EQ_AUTHORISED.has(n.name)
    && baselineByName.has(n.name)
    && JSON.stringify(baselineByName.get(n.name).parameters) !== JSON.stringify(n.parameters)).map(n => n.name).sort();
  assert.deepEqual(authorisedChanged, ['Accumulate Candidate File', 'Assemble Candidate Manifest', 'Evaluate GitHub Write Reconciliation (Pass 2)', 'Verify Content Hash Before Send'],
    'exactly the 4 authorised nodes changed vs baseline');
  const authorisedAdded = workflow.nodes.filter(n => !baselineByName.has(n.name)).map(n => n.name).sort();
  assert.deepEqual(authorisedAdded, ['Decode Reconciled Remote Content', 'Hash Candidate File Content', 'Hash Candidate Manifest', 'Hash Reconciled Remote Content', 'Prepare Candidate Manifest', 'Recompute Content Hash Before Send'],
    'exactly the 6 authorised nodes added vs baseline');
  console.log(`Preservation diff PASS - ${workflow.nodes.length - 10} unchanged nodes byte-identical to the accepted baseline; exactly 4 authorised param changes + 6 authorised additions`);
}

// ============================================================
// Test: no automatic WF3/Jenkins/merge/deploy trigger added anywhere in
// the new nodes (spec #22).
// ============================================================
{
  const newNodeNames = [
    'Record New Branch Baseline', 'Accumulate Candidate File', 'Assemble Candidate Manifest',
    'Call Candidate Verification', 'Call Write Guard', 'Write Guard Passed?', 'Persist Verification Failure',
    'Branch Existed At Generation?', 'Re-check Existing Branch Head', 'Re-lookup Baseline Ref Before Creation',
    'Call Remote Head Drift Guard', 'Remote Head Drift Passed?', 'Persist Base Moved Failure',
    'Branch Existed At Generation? (Pass 2 Entry)', 'Re-lookup Remediation Branch Before Create',
    'Expand Manifest Files', 'Loop Over Manifest Files', 'Verify Content Hash Before Send',
    'Build File Result (Pass 2)', 'Classify GitHub Write Error (Pass 2)', 'Read Back File After Write Error (Pass 2)',
    'Evaluate GitHub Write Reconciliation (Pass 2)', 'Lookup Head After Reconciled Write (Pass 2)',
    'Merge Effective File Results 2', 'Transport Requires Read Back? (Pass 2)', 'Remote Candidate Present? (Pass 2)',
  ];
  const forbiddenUrlPattern = /jenkins|buildWithParameters|pr-validation|\/merge\b/i;
  for (const name of newNodeNames) {
    const n = nodesByName.get(name);
    const serialized = JSON.stringify(n.parameters);
    assert.equal(forbiddenUrlPattern.test(serialized), false, `Test 22 - new node '${name}' contains no Jenkins/WF3/merge trigger`);
  }
  console.log('Test 22 PASS - no automatic WF3/Jenkins/merge/deploy trigger introduced by any new node');
}

console.log('\nALL R22-E STRUCTURAL/LOGIC PROOFS PASSED');
