// Vérifie la classification et le retour des échecs dans WF2.
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

/** Exécute le traitement et collecte son résultat. */
function run(inputJson, captured) {
  const mockInput = {
  /** Renvoie le premier élément disponible. */
  first: () => ({ json: inputJson }) };
  /** Simule les dépendances nécessaires au scénario. */
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
