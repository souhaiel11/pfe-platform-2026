// BRIQUE 5 — PHASE 12 READ-ONLY AUDIT of the WF2 failure-envelope contract
// ("Prepare WF2 Failure Status" -> "Persist WF2 Failure Status" in the
// repo-tracked, active WF2 export). The described defect pattern
// (Persist node referencing `$json.incidentId` where the field actually
// lived at `correlationEnvelope.incidentId`, producing
// POST /api/incidents//workflow-status) is AUDITED HERE and found NOT
// PRESENT in this artifact:
//
//   1. "Prepare WF2 Failure Status" is the ONLY node feeding "Persist WF2
//      Failure Status" (single direct edge — verified below from the
//      workflow's own connections graph).
//   2. It resolves the correlation envelope via an EXPLICIT named lookup
//      ($items('Capture Correlation Envelope', 0, 0)) regardless of which
//      of the ~30 error-output edges triggered it, and copies
//      `ctx.incidentId` into its OWN output as `incidentId`.
//   3. "Persist WF2 Failure Status" then reads `$json.incidentId` off of
//      its direct (and only) predecessor's output -- i.e. exactly
//      correlationEnvelope.incidentId, correctly threaded.
//   4. If the correlation envelope never captured (or is missing required
//      fields), step 2 THROWS ('FAILURE_CORRELATION_MISSING:...') before
//      "Persist" ever runs -- an empty-incidentId URL can never be built.
//
// No fix applied (none required, per Phase 12: "fix it ONLY if the defect
// is still present"). This is a proof, not a patch. REPO-ONLY / no live n8n.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(here, '..', 'active', 'wf2-git-patch-pr-v4-1-9adcV31eaIgJyMR0.json');
const workflow = JSON.parse(readFileSync(wfPath, 'utf8'))[0];

// --- Structural proof: single direct edge into "Persist WF2 Failure Status" ---
const prepareToPersist = workflow.connections['Prepare WF2 Failure Status'];
assert.ok(prepareToPersist, '"Prepare WF2 Failure Status" must have outgoing connections');
const persistTargets = prepareToPersist.main.flat().map(edge => edge.node);
assert.deepEqual(persistTargets, ['Persist WF2 Failure Status'], 'Prepare feeds ONLY Persist, directly');

let feedersIntoPersist = 0;
for (const [name, conn] of Object.entries(workflow.connections)) {
  for (const output of conn.main || []) {
    for (const edge of output) {
      if (edge.node === 'Persist WF2 Failure Status') feedersIntoPersist++;
    }
  }
}
assert.equal(feedersIntoPersist, 1, 'exactly one node feeds "Persist WF2 Failure Status" -- always "Prepare WF2 Failure Status"');

const persistNode = workflow.nodes.find(n => n.name === 'Persist WF2 Failure Status');
assert.equal(persistNode.parameters.url, '=http://backend:3001/api/incidents/{{ $json.incidentId }}/workflow-status');

// --- Behavioral proof: run the real "Prepare WF2 Failure Status" jsCode ---
const prepareNode = workflow.nodes.find(n => n.name === 'Prepare WF2 Failure Status');
const code = prepareNode.parameters.jsCode;

function run(inputJson, captured) {
  const mockInput = { first: () => ({ json: inputJson }) };
  const mockItems = (name, a, b) => name === 'Capture Correlation Envelope' ? captured : undefined;
  const mockExecution = { id: 'exec-1' };
  const fn = new Function('$input', '$items', '$execution', code);
  return fn(mockInput, mockItems, mockExecution);
}

const fullEnvelope = [{ json: { correlationEnvelope: {
  workflowId: '9adcV31eaIgJyMR0', incidentId: 'incident-real-id', requestId: 'req-1', batchId: 'batch-1', batchKey: 'batch-1', attemptCount: 1,
} } }];

// Case 1: a normal failure, correlation envelope fully captured.
{
  const [out] = run({ failureSummary: 'boom' }, fullEnvelope);
  assert.equal(out.json.incidentId, 'incident-real-id', 'incidentId threaded from correlationEnvelope.incidentId');
  const url = persistNode.parameters.url.replace('{{ $json.incidentId }}', out.json.incidentId);
  assert.ok(!url.includes('/incidents//'), 'the constructed URL never has an empty incident segment');
  assert.equal(out.json.status, 'FAILED');
  assert.equal(out.json.requestId, 'req-1');
  assert.equal(out.json.batchId, 'batch-1');
  assert.equal(out.json.attemptCount, 1);
}

// Case 2 (the exact bug this audit targets): correlation envelope was NEVER
// captured (e.g. failure happened before that node ran) -- must throw,
// never silently build a /incidents//workflow-status URL.
assert.throws(() => run({ failureSummary: 'boom' }, undefined), /FAILURE_CORRELATION_MISSING/);
assert.throws(() => run({ failureSummary: 'boom' }, [{ json: { correlationEnvelope: {} } }]), /FAILURE_CORRELATION_MISSING/);
// Partial envelope (missing batchId) also fails closed -- never a partial URL.
assert.throws(() => run({ failureSummary: 'boom' }, [{ json: { correlationEnvelope: {
  workflowId: 'x', incidentId: 'incident-real-id', requestId: 'req-1', attemptCount: 1,
} } }]), /FAILURE_CORRELATION_MISSING/);

// Case 3: the PRIMARY root cause is preserved, never replaced by a
// persistence-layer detail.
{
  const [out] = run({ failureCode: 'WF2_PATCH_SCOPE_VIOLATION', failureSummary: 'patch touched an unapproved file', failureNode: 'Validate Candidate Remediation' }, fullEnvelope);
  assert.equal(out.json.failureCode, 'WF2_PATCH_SCOPE_VIOLATION', 'primary failureCode preserved verbatim');
  assert.equal(out.json.failureSummary, 'patch touched an unapproved file');
  assert.equal(out.json.failureNode, 'Validate Candidate Remediation');
}

console.log('WF2 failure-persistence audit (Brique 5 Phase 12): PASS -- defect NOT present, no fix required');
