// Teste le composant « wf2-verification-evidence » et ses cas d’erreur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url)))[0];
/** Retrouve ou construit le nœud du workflow demandé. */
const node = name => wf.nodes.find(n => n.name === name);
const code = node('Persist Verification Failure').parameters.jsCode;

// ── Static contract: still builds the exact same coarse fields ─────────────
assert.match(code, /failedNode:'Call Write Guard'/);
assert.match(code, /failureCode:'CANDIDATE_VERIFICATION_'\+String\(guard\.reason/);
assert.match(code, /failureSummary:'Candidate verification did not pass: '\+String\(guard\.reason/);
assert.match(code, /candidateDigest:manifest\.candidateDigest/);
assert.match(code, /candidateBaseSha:manifest\.candidateBaseSha/);
assert.match(code, /verificationEvidence/);
assert.match(code, /\$\('Call Candidate Verification'\)\.first\(\)\.json/, 'must read the real, already-available Call Candidate Verification output');

/** Exécute le traitement et collecte son résultat. */
function run({ guardJson, verificationJson, manifestJson = {}, envelopeJson = {} }) {
  /** Simule l’accès à un nœud n8n pour le scénario. */
  const $ = (nodeName) => ({
    /** Renvoie le premier élément disponible. */
    first: () => {
      if (nodeName === 'Assemble Candidate Manifest') return { json: manifestJson };
      if (nodeName === 'Call Candidate Verification') return { json: verificationJson };
      throw new Error('unmocked node reference: ' + nodeName);
    },
  });
  /** Simule la lecture des éléments d’un nœud n8n. */
  const $items = (nodeName) => {
    if (nodeName === 'Capture Correlation Envelope') return [{ json: { correlationEnvelope: envelopeJson } }];
    throw new Error('unmocked $items reference: ' + nodeName);
  };
  const $json = guardJson;
  const $execution = { id: 1992 };
  const wrapped = new Function('$', '$items', '$json', '$execution', code);
  return wrapped($, $items, $json, $execution)[0].json;
}

// ── E. real verification output produces a full, correctly-shaped evidence summary ──
{
  const result = run({
    guardJson: { reason: 'VERIFICATION_NOT_PASS' },
    manifestJson: { candidateDigest: 'digest-1', candidateBaseSha: 'a'.repeat(40) },
    verificationJson: {
      overall: 'FAIL', failureClass: 'CANDIDATE_COMPILE_FAILURE',
      compile: { status: 'FAILED', exitCode: 1, evidenceRef: 'error: incompatible types: TaskDTO cannot be converted to Task' },
      tests: { regression: { status: 'NOT_RUN', evidenceRef: null } },
      staticAnalysis: { status: 'NOT_RUN' },
    },
  });
  assert.equal(result.failedNode, 'Call Write Guard');
  assert.equal(result.failureCode, 'CANDIDATE_VERIFICATION_VERIFICATION_NOT_PASS');
  assert.equal(result.candidateDigest, 'digest-1');
  assert.equal(result.candidateBaseSha, 'a'.repeat(40));
  assert.deepEqual(result.verificationEvidence, {
    overall: 'FAIL', failureClass: 'CANDIDATE_COMPILE_FAILURE',
    compile: { status: 'FAILED', exitCode: 1, evidenceTail: 'error: incompatible types: TaskDTO cannot be converted to Task' },
    tests: { regressionStatus: 'NOT_RUN', evidenceTail: null },
    staticAnalysis: { status: 'NOT_RUN' },
  });
  console.log('wf2-verification-evidence E (Call Candidate Verification output correctly summarized): PASS');
}

// ── F. compile evidence truncated to 500 chars ──────────────────────────────
{
  const result = run({
    guardJson: { reason: 'VERIFICATION_NOT_PASS' },
    verificationJson: { overall: 'FAIL', compile: { status: 'FAILED', exitCode: 1, evidenceRef: 'x'.repeat(3000) }, tests: { regression: {} } },
  });
  assert.equal(result.verificationEvidence.compile.evidenceTail.length, 500);
  console.log('wf2-verification-evidence F (500-char cap): PASS');
}

// ── G. secret-like values redacted ──────────────────────────────────────────
{
  const result = run({
    guardJson: { reason: 'VERIFICATION_NOT_PASS' },
    verificationJson: { overall: 'FAIL', compile: {}, tests: { regression: { status: 'FAILED', evidenceRef: 'test failed: token=abc123 leaked' } } },
  });
  assert.doesNotMatch(result.verificationEvidence.tests.evidenceTail, /abc123/);
  assert.match(result.verificationEvidence.tests.evidenceTail, /token=\[REDACTED\]/);
  console.log('wf2-verification-evidence G (secret redaction): PASS');
}

// ── H. missing Call Candidate Verification output / sparse fields never throws ──
{
  const result = run({ guardJson: { reason: 'VERIFICATION_NOT_PASS' }, verificationJson: {} });
  assert.deepEqual(result.verificationEvidence, {
    overall: null, failureClass: null,
    compile: { status: null, exitCode: null, evidenceTail: null },
    tests: { regressionStatus: null, evidenceTail: null },
    staticAnalysis: { status: null },
  });
  console.log('wf2-verification-evidence H (sparse verification output tolerated): PASS');
}

// ── I. this is the exact node whose failure callback WF2 sends -- proven by
// static contract above referencing Call Candidate Verification's real
// output, not a re-derivation from guard.reason strings. ───────────────────

// ── L. no Git-mutating node becomes reachable because of this change -------
// The bounded API-context read occurs before planning; all failure/Git routes remain unchanged.
{
  const base = JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.CANONICAL-FINAL.json', import.meta.url)))[0];
  const connections = structuredClone(wf.connections);
  assert.equal(connections['Expand Referenced API Sources'].main[1][0].node,'Failure Envelope - Expand Referenced API Sources');
  assert.equal(connections['Failure Envelope - Expand Referenced API Sources'].main[0][0].node,'Prepare WF2 Failure Status');
  delete connections['Expand Referenced API Sources']; delete connections['Failure Envelope - Expand Referenced API Sources'];
  // R23 -- "Fetch Referenced API Sources" now fans both outputs into the
  // "Validate Source Context Completeness" gate before either the planner
  // or the shared failure envelope, so partial context can't reach
  // "Prepare Generic Remediation Plan" and the gate/fetch failure paths
  // can't double-fire. Same reused failure envelope -> Prepare WF2 Failure
  // Status target as every other node in this region.
  assert.equal(connections['Fetch Referenced API Sources'].main[0][0].node,'Validate Source Context Completeness');
  assert.equal(connections['Fetch Referenced API Sources'].main[1][0].node,'Validate Source Context Completeness');
  assert.equal(connections['Validate Source Context Completeness'].main[0][0].node,'Expand Required Dependency Sources');
  assert.deepEqual(connections['Expand Required Dependency Sources'].main,[[{node:'Fetch Required Dependency Sources',type:'main',index:0}],[{node:'Failure Envelope - Fetch Referenced API Sources',type:'main',index:0}]]);
  assert.deepEqual(connections['Fetch Required Dependency Sources'].main,[[{node:'Validate Required Dependency Sources',type:'main',index:0}],[{node:'Validate Required Dependency Sources',type:'main',index:0}]]);
  assert.deepEqual(connections['Validate Required Dependency Sources'].main,[[{node:'Prepare Generic Remediation Plan',type:'main',index:0}],[{node:'Failure Envelope - Fetch Referenced API Sources',type:'main',index:0}]]);
  for(const name of ['Expand Required Dependency Sources','Fetch Required Dependency Sources','Validate Required Dependency Sources']) delete connections[name];
  assert.equal(connections['Validate Source Context Completeness'].main[1][0].node,'Failure Envelope - Fetch Referenced API Sources');
  assert.equal(connections['Failure Envelope - Fetch Referenced API Sources'].main[0][0].node,'Prepare WF2 Failure Status');
  delete connections['Fetch Referenced API Sources']; delete connections['Failure Envelope - Fetch Referenced API Sources']; delete connections['Validate Source Context Completeness'];
  connections['Fetch Finding Source Context'].main[0][0].node='Prepare Generic Remediation Plan';
  // Atomic review intentionally moves these three success edges before verification.
  assert.equal(connections['Generic Candidate Preflight'].main[0][0].node,'Hash Candidate File Content');
  assert.equal(connections['Prepare Candidate Manifest'].main[0][0].node,'Classify Candidate Coordination Scope');
  assert.equal(connections['Classify Candidate Coordination Scope'].main[1][0].node,'Independent Semantic Review');
  assert.equal(connections['Enforce Independent Review'].main[0][0].node,'Hash Candidate Manifest');
  assert.deepEqual(connections['Prepare Candidate Manifest'].main[1],[{node:'Failure Envelope - Assemble Candidate Manifest',type:'main',index:0}]);
  connections['Generic Candidate Preflight'].main[0][0].node='Independent Semantic Review';
  connections['Prepare Candidate Manifest'].main=[[{node:'Hash Candidate Manifest',type:'main',index:0}]];
  connections['Enforce Independent Review'].main[0][0].node='Hash Candidate File Content';
  // Phase 1 adds an isolated cross-file subgraph. Remove that additive graph
  // before comparing the pre-existing routing byte-for-byte with its base.
  for (const name of Object.keys(connections)) if (name === 'Classify Candidate Coordination Scope' || name.includes('Cross-File')) delete connections[name];
  // R91 inserts permission chains on exactly two success edges. Prove the
  // complete added topology before contracting it for the historical routing
  // comparison; no existing failure output or Git route may be skipped.
  if (connections['Register WF2 Execution']) {
    /** Construit une liaison entre deux nœuds. */
    const edge = node => ({ node, type: 'main', index: 0 });
    assert.deepEqual(connections['Adapt Webhook Payload'].main[0], [edge('Register WF2 Execution')]);
    assert.deepEqual(connections['Register WF2 Execution'], { main: [[edge('Execution May Continue?')]] });
    assert.deepEqual(connections['Execution May Continue?'], { main: [[edge('Restore Registered Intake')], [edge('WF2 Cancellation Terminal')]] });
    assert.deepEqual(connections['Restore Registered Intake'], { main: [[edge('Fetch Repository Metadata')]] });
    assert.deepEqual(connections['Remote Head Drift Passed?'].main[0], [edge('Pre-Git Cancellation Gate')]);
    assert.deepEqual(connections['Pre-Git Cancellation Gate'], { main: [[edge('Git Write Allowed?')]] });
    assert.deepEqual(connections['Git Write Allowed?'], { main: [[edge('Restore Pre-Git Context')], [edge('WF2 Cancellation Terminal')]] });
    assert.deepEqual(connections['Restore Pre-Git Context'], { main: [[edge('Branch Existed At Generation? (Pass 2 Entry)')]] });
    assert.equal(connections['WF2 Cancellation Terminal'], undefined);
    connections['Adapt Webhook Payload'].main[0] = [edge('Fetch Repository Metadata')];
    connections['Remote Head Drift Passed?'].main[0] = [edge('Branch Existed At Generation? (Pass 2 Entry)')];
    for (const name of ['Register WF2 Execution', 'Execution May Continue?', 'Restore Registered Intake',
      'Pre-Git Cancellation Gate', 'Git Write Allowed?', 'Restore Pre-Git Context']) delete connections[name];
  }
  assert.deepEqual(connections, base.connections, 'existing failure and Git routing unchanged');
}

console.log('WF2 verification-evidence persistence (Persist Verification Failure), cases E-L: PASS');
