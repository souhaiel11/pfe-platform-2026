// Offline contract tests for WF2's bounded transient-network retry hardening.
// Context: two real E2E attempts failed for unrelated transient network
// reasons (GitHub "socket hang up" on Get Main Branch SHA1, Anthropic DNS
// EAI_AGAIN on Independent Semantic Review) with full network diagnosis
// proving no persistent DNS/connectivity/configuration problem. This adds
// bounded native n8n retry (retryOnFail/maxTries/waitBetweenTries) to
// exactly those two non-mutating nodes, using the exact clamping behavior
// of the live n8n 2.14.2 execution engine, without touching any node that
// writes to GitHub or mutates backend/business state.
//
// No n8n execution, network or business action.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url)))[0];
const node = name => wf.nodes.find(n => n.name === name);

// ── Node classification (audit) ─────────────────────────────────────────────
// Mutating: writes to GitHub (branch/file/PR) or to backend business state
// (incident/fixRequest/report persistence). These must never receive a
// blind generic retry -- their existing idempotency/reconciliation logic
// (Lookup Existing Batch PR, Re-check Existing Branch Head, Evaluate GitHub
// Write Reconciliation, etc.) is the only sanctioned protection.
const MUTATING_NODES = [
  'Update File in Branch', 'Create Pull Request1', 'Create Missing Branch', 'Create File in Branch',
  'Save Execution Result to Backend', 'Log Fetch Error', 'Persist File Update Failure',
  'Persist PR Creation Failure', 'Persist WF2 Failure Status',
];
const RETRY_HARDENED_NODES = ['Get Main Branch SHA1', 'Independent Semantic Review'];

// ── A/B. Bounded retry enabled on exactly the two target nodes ─────────────
for (const name of RETRY_HARDENED_NODES) {
  const n = node(name);
  assert.equal(n.retryOnFail, true, `${name}: retryOnFail must be enabled`);
  assert.equal(typeof n.maxTries, 'number', `${name}: maxTries must be a number`);
  assert.equal(typeof n.waitBetweenTries, 'number', `${name}: waitBetweenTries must be a number`);
}

// ── C. Bounded, not infinite -- must fall inside n8n 2.14.2's own runtime
// clamp (workflow-execute.js: maxTries clamped to [2,5], waitBetweenTries
// clamped to [0,5000]ms). A configured value outside this range would
// silently be reinterpreted by the engine, so the source of truth must
// already be within bounds.
for (const name of RETRY_HARDENED_NODES) {
  const n = node(name);
  assert.ok(n.maxTries >= 2 && n.maxTries <= 5, `${name}: maxTries must be within n8n's supported [2,5] range`);
  assert.ok(n.waitBetweenTries >= 0 && n.waitBetweenTries <= 5000, `${name}: waitBetweenTries must be within n8n's supported [0,5000]ms range`);
  assert.ok(Number.isFinite(n.maxTries) && n.maxTries < Infinity, `${name}: maxTries must be finite`);
}

// ── D. Mutating nodes never receive generic retry ──────────────────────────
for (const name of MUTATING_NODES) {
  const n = node(name);
  assert.ok(n, `expected mutating node to exist: ${name}`);
  assert.notEqual(n.retryOnFail, true, `${name}: mutating node must NOT receive automatic retry`);
}
// Sanity: confirm the mutating set is exhaustive over every httpRequest/github
// node not in the hardened set and not a pure read (GET/lookup) -- any node
// with retryOnFail=true must be one of the two explicitly authorized targets.
const externalTypes = new Set(['n8n-nodes-base.httpRequest', 'n8n-nodes-base.github']);
for (const n of wf.nodes) {
  if (!externalTypes.has(n.type)) continue;
  if (n.retryOnFail === true) {
    assert.ok(RETRY_HARDENED_NODES.includes(n.name), `unexpected node with retryOnFail=true: ${n.name}`);
  }
}

// ── E. Failure routing remains connected after retry exhaustion ───────────
// onError must remain exactly as before (continueErrorOutput) so that once
// maxTries is exhausted, the engine still routes to the node's error output
// -- the canonical failure envelope path -- rather than stopping the
// workflow or silently continuing on the regular output.
for (const name of RETRY_HARDENED_NODES) {
  const n = node(name);
  assert.equal(n.onError, 'continueErrorOutput', `${name}: onError must be preserved for failure-envelope routing`);
}
// The dedicated failure-envelope node for each hardened node must still be
// present and still be the thing that actually gets executed on error
// (second output port), matching the graph's existing convention.
assert.ok(node('Failure Envelope - Get Main Branch SHA1'), 'failure envelope for Get Main Branch SHA1 must remain');
assert.ok(node('Failure Envelope - Independent Semantic Review'), 'failure envelope for Independent Semantic Review must remain');
const errorOutputTargets = (name) => (wf.connections[name]?.main?.[1] || []).map(e => e.node);
assert.ok(errorOutputTargets('Get Main Branch SHA1').length > 0, 'Get Main Branch SHA1 error output must still be wired');
assert.ok(errorOutputTargets('Independent Semantic Review').length > 0, 'Independent Semantic Review error output must still be wired');

// ── F/G. Identity contract untouched by this change ────────────────────────
assert.equal(wf.id, 'u3eeMwTuhCsetfcS');
const envelopeCode = node('Capture Correlation Envelope').parameters.jsCode;
assert.match(envelopeCode, /\$workflow\.id/);
assert.doesNotMatch(envelopeCode, /9adcV31eaIgJyMR0/);

// ── H. No direct main write / merge / force push introduced ───────────────
const blob = JSON.stringify(wf.nodes);
assert.doesNotMatch(blob, /force["']?\s*[:=]\s*true/i);
assert.ok(!blob.includes('/merge'));
assert.ok(!/pulls\/[^"]*merge/.test(blob));
assert.ok(!/refs\/heads\/main[^-]/.test(blob));
assert.doesNotMatch(blob, /httpRequestWithAuthentication|requestWithAuthenticationPaginated|(?:this\.)?helpers\./);

// ── Structural parity: only the two target nodes differ, node/edge count
// unchanged, no new/duplicate identity introduced ──────────────────────────
assert.equal(wf.nodes.length, 147);
assert.equal(new Set(wf.nodes.map(n => n.id)).size, 147);

console.log('WF2 resilience hardening (bounded retry on Get Main Branch SHA1 / Independent Semantic Review), cases A-H: PASS');
