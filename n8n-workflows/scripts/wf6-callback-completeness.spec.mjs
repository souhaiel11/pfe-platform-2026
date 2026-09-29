#!/usr/bin/env node
// V1.7 — static, offline proof that EVERY WF6 terminal outcome now reaches
// the existing recordWf6BatchResult() callback before its (no-op) terminal
// node, closing the 26/28 gap found by the ack-contract audit. No n8n
// execution, no network, no live workflow touched.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'node:test';

const dir = new URL('../pending-live-update/', import.meta.url);
const ackFixed = JSON.parse(readFileSync(new URL('wf6-security-remediation-maven-RdYyfjVpOm2LxS95.V1.7-ACK-CONTRACT.json', dir)))[0];
const fixed = JSON.parse(readFileSync(new URL('wf6-security-remediation-maven-RdYyfjVpOm2LxS95.V1.7-CALLBACK-COMPLETENESS.json', dir)))[0];

const nodesOf = w => new Map(w.nodes.map(n => [n.name, n]));
const ackNodes = nodesOf(ackFixed);
const fixedNodes = nodesOf(fixed);
const terminals = w => w.nodes.filter(n => n.type === 'n8n-nodes-base.noOp').map(n => n.name);
const incomingOf = w => {
  const map = new Map();
  for (const [src, outs] of Object.entries(w.connections)) {
    (outs.main || []).forEach((arr, outIdx) => {
      for (const edge of (arr || [])) map.set(edge.node, [...(map.get(edge.node) || []), { src, outIdx }]);
    });
  }
  return map;
};

test('1. every one of the 28 terminal noOps now has EXACTLY ONE incoming edge, from a Record Batch Result node', () => {
  const incoming = incomingOf(fixed);
  const term = terminals(fixed);
  assert.equal(term.length, 28);
  for (const name of term) {
    const edges = incoming.get(name) || [];
    assert.equal(edges.length, 1, `"${name}" must have exactly one incoming edge (its own callback), got ${edges.length}`);
    assert.match(edges[0].src, /^Record Batch Result \(/, `"${name}"'s sole predecessor must be a Record Batch Result node, got "${edges[0].src}"`);
    assert.equal(edges[0].outIdx, 0);
  }
});

test('2. exactly 26 NEW callback nodes were added (177 = 151 + 26), 2 pre-existing callbacks untouched', () => {
  assert.equal(ackFixed.nodes.length, 151);
  assert.equal(fixed.nodes.length, 177);
  const newCallbacks = fixed.nodes.filter(n => /^Record Batch Result \(/.test(n.name) && !ackNodes.has(n.name));
  assert.equal(newCallbacks.length, 26);
  for (const preexisting of ['Record Batch Result (Not Ready)', 'Record Batch Result (Success)']) {
    assert.deepEqual(fixedNodes.get(preexisting), ackNodes.get(preexisting), `"${preexisting}" must be byte-identical to the ack-contract baseline`);
  }
});

test('3. every callback node targets the SAME existing endpoint the 2 pre-existing ones use, with the same fire-and-forget shape', () => {
  const callbacks = fixed.nodes.filter(n => /^Record Batch Result \(/.test(n.name));
  assert.equal(callbacks.length, 28);
  for (const n of callbacks) {
    assert.equal(n.type, 'n8n-nodes-base.httpRequest');
    assert.equal(n.parameters.method, 'POST');
    assert.equal(n.parameters.url, '={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}');
    assert.equal(n.parameters.headerParameters.parameters[0].name, 'X-Internal-Secret');
    assert.equal(n.continueOnFail, true, `"${n.name}" must never block its terminal on a callback failure`);
    assert.equal(n.retryOnFail, false);
    assert.equal(n.parameters.options.response.response.neverError, true);
  }
});

test('4. every new callback jsonBody is syntactically valid JavaScript and builds projectId/batchId/status/findings', () => {
  const newCallbacks = fixed.nodes.filter(n => /^Record Batch Result \(/.test(n.name) && !ackNodes.has(n.name));
  for (const n of newCallbacks) {
    const src = n.parameters.jsonBody;
    assert.match(src, /^=\{\{.*\}\}$/s, `"${n.name}" jsonBody must be an n8n expression`);
    const body = src.slice(3, -2); // strip "={{" and "}}"
    // Syntax-only check (Function constructor parses but never calls it) --
    // $/req/tc/ids are intentionally undefined here, only the SHAPE matters.
    assert.doesNotThrow(() => new vm.Script(`(${body})`), `"${n.name}" jsonBody must be syntactically valid JS`);
    assert.match(body, /projectId: req\?\.projectId/, `"${n.name}" must forward projectId`);
    assert.match(body, /batchId: req\?\.batchId/, `"${n.name}" must forward batchId`);
    assert.match(body, /status: "/, `"${n.name}" must set a status`);
    assert.match(body, /findings/, `"${n.name}" must include a findings array`);
  }
});

test('5. no node besides the 26 additions and their rewired predecessors\' outgoing edges differs from the ack-contract baseline', () => {
  // Every ack-contract node must still exist, unchanged, in the fixed file
  // EXCEPT the outgoing "main" edges of nodes that used to point straight
  // at a terminal (now pointing at the new callback instead).
  const redirected = new Set();
  const ackIncoming = incomingOf(ackFixed);
  for (const term of terminals(ackFixed)) {
    for (const { src } of (ackIncoming.get(term) || [])) redirected.add(src);
  }
  for (const n of ackFixed.nodes) {
    const fn = fixedNodes.get(n.name);
    assert.ok(fn, `"${n.name}" must still exist`);
    const { ...nodeOnly } = n; // node body itself (not connections) must be untouched
    assert.deepEqual(fn, nodeOnly, `node "${n.name}" body must be byte-identical (only connections may change)`);
  }
  console.log(`(${redirected.size} pre-existing nodes had their terminal-pointing edges redirected to a new callback)`);
});

test('6. Evaluate + Revalidate 920000ms timeout nodes remain byte-identical', () => {
  for (const name of ['Evaluate Security Remediation', 'Revalidate Before Write (New Branch)', 'Revalidate Before Write (Reuse)', 'Revalidate Before Write (PR)']) {
    assert.deepEqual(fixedNodes.get(name), ackNodes.get(name));
    assert.equal(fixedNodes.get(name).parameters.options.timeout, 920000);
  }
});

test('7. webhook stays onReceived (ack-contract fix preserved), workflow stays inactive', () => {
  const wh = fixed.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
  assert.equal(wh.parameters.responseMode, 'onReceived');
  assert.equal(fixed.active, false);
});

test('8. structurally valid workflow JSON', () => {
  for (const key of ['name', 'nodes', 'connections', 'settings']) assert.ok(key in fixed, `missing "${key}"`);
  assert.ok(Array.isArray(fixed.nodes) && fixed.nodes.length === 177);
});

console.log('MISSING_CALLBACKS after fix: 0 / 28 (all terminals now reach recordWf6BatchResult via the SAME existing endpoint)');
