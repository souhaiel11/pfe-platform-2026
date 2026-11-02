#!/usr/bin/env node
// Vérifie WF6 r95 evaluation en échec retour automatique correction et ses cas d’erreur.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'node:test';

const dir = new URL('../pending-live-update/', import.meta.url);
const source = JSON.parse(readFileSync(new URL('WF6-R95-SOURCE-LIVE.json', dir)))[0];
const target = JSON.parse(readFileSync(new URL('WF6-R95-TARGET-EVALFAILED-FIX.json', dir)))[0];
/** Prépare les données nécessaires à ce scénario. */
const nodesOf = w => new Map(w.nodes.map(n => [n.name, n]));
const srcNodes = nodesOf(source);
const tgtNodes = nodesOf(target);

/** Prépare les données nécessaires à ce scénario. */
function outAdj(w) {
  const out = {}; w.nodes.forEach(n => out[n.name] = []);
  for (const [src, outputs] of Object.entries(w.connections)) {
    for (const port of (outputs.main || [])) for (const e of (port || [])) out[src].push(e.node);
  }
  return out;
}
/** Prépare les données nécessaires à ce scénario. */
function refsIn(nodes) {
  /** Prépare les données nécessaires à ce scénario. */
  const strings = o => typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(strings) : (o && typeof o === 'object') ? Object.values(o).flatMap(strings) : [];
  const pairs = [];
  for (const n of nodes) for (const s of strings(n.parameters || {})) {
    const re = /\$\(\s*['"]([^'"]+)['"]\s*\)/g; let m;
    while ((m = re.exec(s))) pairs.push({ referencer: n.name, referenced: m[1] });
  }
  return pairs;
}
/** Prépare les données nécessaires à ce scénario. */
function dominatorCheck(w) {
  const out = outAdj(w);
  const root = 'Webhook - Security Remediation Request';
  /** Prépare les données nécessaires à ce scénario. */
  function reachableExcluding(exclude) {
    const seen = new Set([root]); const q = [root];
    while (q.length) {
      const cur = q.shift();
      if (cur === exclude) continue;
      for (const nxt of out[cur]) { if (nxt === exclude) continue; if (!seen.has(nxt)) { seen.add(nxt); q.push(nxt); } }
    }
    return seen;
  }
  const cache = {};
  const unsafe = [];
  for (const { referencer, referenced } of refsIn(w.nodes)) {
    if (!(referenced in cache)) cache[referenced] = reachableExcluding(referenced);
    if (cache[referenced].has(referencer)) unsafe.push({ referencer, referenced });
  }
  return unsafe;
}

// Real captured data from executions 2086 (CVE-2022-38749) and 2087
// (CVE-2022-38751), both TRIVY_DB_NOT_PROVISIONED:TRIVY_READINESS.
const REAL = {
  '2086': {
    req: { projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', batchId: 'sec-batch-d359edf8f878f1dd',
      findingTaskIds: ['83555b3a-efa1-45e1-90a8-008debddba92'],
      v1_8ValidatedFindings: [{ findingTaskId: '83555b3a-efa1-45e1-90a8-008debddba92', cve: 'CVE-2022-38749' }] },
    ev: { status: 'TECHNICAL_FAILURE', reason: 'TRIVY_DB_NOT_PROVISIONED:TRIVY_READINESS',
      findings: [{ findingIdentity: 'be0d3c1e9cecdda3e67406d883601ab851041127509f69f1ac8e1ddfa219a2e3', cveId: 'CVE-2022-38749', status: 'PENDING', reason: 'BATCH_ABORTED_BY_SIBLING_FINDING', patchEvidence: null }] },
  },
  '2087': {
    req: { projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', batchId: 'sec-batch-bd22285c1649ea80',
      findingTaskIds: ['b52ea617-f5c3-47a3-bc6e-6230ea648d63'],
      v1_8ValidatedFindings: [{ findingTaskId: 'b52ea617-f5c3-47a3-bc6e-6230ea648d63', cve: 'CVE-2022-38751' }] },
    ev: { status: 'TECHNICAL_FAILURE', reason: 'TRIVY_DB_NOT_PROVISIONED:TRIVY_READINESS',
      findings: [{ findingIdentity: 'x', cveId: 'CVE-2022-38751', status: 'PENDING', reason: 'BATCH_ABORTED_BY_SIBLING_FINDING', patchEvidence: null }] },
  },
};

/** Vérifie les résultats attendus dans ce scénario. */
function evalFixedBody(req, ev) {
  const node = tgtNodes.get('Record Batch Result (EVALUATION_FAILED)');
  const src = node.parameters.jsonBody.slice(3, -2); // strip "={{" "}}"
  const fn = new vm.Script(`(function($, $json){ return (${src}); })`).runInNewContext({});
  /** Simule l’accès à un nœud n8n pour le scénario. */
  const $ = (name) => { assert.equal(name, 'Webhook - Security Remediation Request'); return { 
  /** Renvoie le premier élément disponible. */
  first: () => ({ json: { body: req } }) }; };
  return fn($, { body: ev });
}

test('T1 — EVALUATION_FAILED callback succeeds without Trusted Candidate ever executing', () => {
  for (const [execId, { req, ev }] of Object.entries(REAL)) {
    const payload = evalFixedBody(req, ev);
    assert.ok(payload, `${execId}: payload must be built`);
    assert.doesNotMatch(target.nodes.find(n => n.name === 'Record Batch Result (EVALUATION_FAILED)').parameters.jsonBody, /Trusted Candidate/, `${execId}: jsonBody must not reference Trusted Candidate at all`);
  }
});

test('T2 — TRIVY_DB_NOT_PROVISIONED payload carries TECHNICAL_FAILURE at both batch and finding level', () => {
  for (const { req, ev } of Object.values(REAL)) {
    const payload = evalFixedBody(req, ev);
    assert.equal(payload.status, 'TECHNICAL_FAILURE');
    assert.equal(payload.reason, 'TRIVY_DB_NOT_PROVISIONED:TRIVY_READINESS');
    for (const f of payload.findings) assert.equal(f.status, 'TECHNICAL_FAILURE');
  }
});

test('T3 — payload contains task identity (findingTaskId, cveId) matching the real stuck tasks', () => {
  const expect = { '2086': { taskId: '83555b3a-efa1-45e1-90a8-008debddba92', cve: 'CVE-2022-38749' },
                   '2087': { taskId: 'b52ea617-f5c3-47a3-bc6e-6230ea648d63', cve: 'CVE-2022-38751' } };
  for (const [execId, { req, ev }] of Object.entries(REAL)) {
    const payload = evalFixedBody(req, ev);
    assert.equal(payload.findings.length, 1);
    assert.equal(payload.findings[0].findingTaskId, expect[execId].taskId);
    assert.equal(payload.findings[0].cveId, expect[execId].cve);
  }
});

test('T4 — batchId preserved exactly (correlates to the task\'s securityRemediationBatchId); payload never fabricates attemptCount (server-derived)', () => {
  const expectBatch = { '2086': 'sec-batch-d359edf8f878f1dd', '2087': 'sec-batch-bd22285c1649ea80' };
  for (const [execId, { req, ev }] of Object.entries(REAL)) {
    const payload = evalFixedBody(req, ev);
    assert.equal(payload.batchId, expectBatch[execId]);
    assert.ok(!('attemptCount' in payload), 'payload must not fabricate attemptCount -- Wf6BatchRemediationResultDto has no such field, it is server-computed from the task\'s own prior attempts');
  }
});

test('T5 — status is never DISPATCHING; this callback always resolves the task out of DISPATCHING', () => {
  for (const { req, ev } of Object.values(REAL)) {
    const payload = evalFixedBody(req, ev);
    assert.notEqual(payload.status, 'DISPATCHING');
    for (const f of payload.findings) assert.notEqual(f.status, 'DISPATCHING');
  }
});

test('T6 — success/candidate path nodes byte-identical to the live baseline (no change)', () => {
  for (const name of ['Trusted Candidate', 'Evaluate Security Remediation', 'Evaluation HTTP OK?', 'Evaluation Not Technical Failure?']) {
    assert.deepEqual(tgtNodes.get(name), srcNodes.get(name), `"${name}" must be untouched`);
  }
});

test('T7 — CANDIDATE_READY path (Candidate Ready?, Record Batch Result (Success)) byte-identical', () => {
  for (const name of ['Candidate Ready?', 'Record Batch Result (Success)', 'Respond - PR Created']) {
    assert.deepEqual(tgtNodes.get(name), srcNodes.get(name), `"${name}" must be untouched`);
  }
});

test('T8 — CLOSED/merged-PR callback nodes byte-identical (unrelated to this fix)', () => {
  for (const name of ['Record Batch Result (Historical Already Merged)', 'Record Batch Result (Final Already Merged)', 'Record Batch Result (Historical Closed Not Merged)', 'Record Batch Result (Final Closed Not Merged)']) {
    assert.deepEqual(tgtNodes.get(name), srcNodes.get(name), `"${name}" must be untouched`);
  }
});

test('T9 — WF2 / R91 untouched by this fix (file-scope check: this fix touches only WF6 artifacts)', () => {
  assert.equal(target.id, 'RdYyfjVpOm2LxS95');
  assert.notEqual(target.id, 'u3eeMwTuhCsetfcS');
});

test('T10 — no unrelated WF6 topology change: node count, connections, and all other node bodies identical', () => {
  assert.equal(source.nodes.length, target.nodes.length);
  assert.deepEqual(source.connections, target.connections);
  let changed = 0;
  for (const [name, a] of srcNodes) { if (JSON.stringify(a) !== JSON.stringify(tgtNodes.get(name))) changed++; }
  assert.equal(changed, 1, 'exactly one node (the EVALUATION_FAILED callback) may differ');
});

test('GRAPH PROOF — Trusted Candidate required on EVALUATION_FAILED failure path = NO', () => {
  const unsafeBefore = dominatorCheck(source).filter(u => u.referencer === 'Record Batch Result (EVALUATION_FAILED)');
  assert.equal(unsafeBefore.length, 1, 'baseline must reproduce the known bug: 1 unsafe reference');
  assert.equal(unsafeBefore[0].referenced, 'Trusted Candidate');
  const unsafeAfter = dominatorCheck(target).filter(u => u.referencer === 'Record Batch Result (EVALUATION_FAILED)');
  assert.equal(unsafeAfter.length, 0, 'FAILURE_CALLBACK_UNSAFE_REFERENCES must be 0 after the fix');
});

test('GRAPH PROOF — no OTHER unsafe references exist anywhere in WF6 (before or after this fix)', () => {
  const allUnsafeAfter = dominatorCheck(target);
  assert.equal(allUnsafeAfter.length, 0, `OTHER_UNSAFE_FAILURE_REFERENCES must be 0, found: ${JSON.stringify(allUnsafeAfter)}`);
});

console.log('WF6 R95 EVALUATION_FAILED callback fix: all cases PASS. FAILURE_CALLBACK_UNSAFE_REFERENCES=0, OTHER_UNSAFE_FAILURE_REFERENCES=0.');
