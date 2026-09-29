#!/usr/bin/env node
// V1.7 — static, offline proof for the WF6 immediate-ack contract change.
// Compares the BASELINE (wf6-security-remediation-maven-RdYyfjVpOm2LxS95.
// REVALIDATE-BATCH-FIX.PROMOTION-TARGET.json) against the CORRECTED draft
// (wf6-security-remediation-maven-RdYyfjVpOm2LxS95.V1.7-ACK-CONTRACT.json).
// No n8n execution, no network, no live workflow touched.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

const dir = new URL('../pending-live-update/', import.meta.url);
const baseline = JSON.parse(readFileSync(new URL('wf6-security-remediation-maven-RdYyfjVpOm2LxS95.REVALIDATE-BATCH-FIX.PROMOTION-TARGET.json', dir)))[0];
const fixed = JSON.parse(readFileSync(new URL('wf6-security-remediation-maven-RdYyfjVpOm2LxS95.V1.7-ACK-CONTRACT.json', dir)))[0];

const nodesOf = w => new Map(w.nodes.map(n => [n.name, n]));
const baseNodes = nodesOf(baseline);
const fixedNodes = nodesOf(fixed);
const webhookOf = w => w.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
const respondNamesOf = w => w.nodes.filter(n => n.type === 'n8n-nodes-base.respondToWebhook').map(n => n.name);
const SECURITY_NODES = ['Evaluate Security Remediation', 'Revalidate Before Write (New Branch)', 'Revalidate Before Write (Reuse)', 'Revalidate Before Write (PR)'];

test('1. webhook responseMode is onReceived (fixed) vs responseNode (baseline)', () => {
  assert.equal(webhookOf(baseline).parameters.responseMode, 'responseNode');
  assert.equal(webhookOf(fixed).parameters.responseMode, 'onReceived');
});

test('2. zero respondToWebhook nodes remain in the fixed draft (none left that would error under onReceived)', () => {
  const baselineRespond = respondNamesOf(baseline);
  assert.equal(baselineRespond.length, 28, 'baseline sanity: the known 28 respondToWebhook nodes');
  const fixedRespond = respondNamesOf(fixed);
  assert.equal(fixedRespond.length, 0, 'the fixed draft must contain zero n8n-nodes-base.respondToWebhook nodes');
});

test('3. every terminal outcome path still exists, now as a noOp with the SAME name, SAME incoming wiring', () => {
  const baselineRespond = respondNamesOf(baseline);
  for (const name of baselineRespond) {
    const fixedNode = fixedNodes.get(name);
    assert.ok(fixedNode, `terminal node "${name}" must still exist (renamed/removed nodes would silently drop a business outcome)`);
    assert.equal(fixedNode.type, 'n8n-nodes-base.noOp', `"${name}" must be the safe no-op replacement, not something else`);
    assert.equal(fixedNode.typeVersion, 1);
    assert.deepEqual(fixedNode.parameters, {}, `"${name}" must carry no parameters (a plain no-op)`);
  }
  // Incoming wiring identical: same source node, same output index, for every terminal.
  const incomingOf = w => {
    const map = new Map();
    for (const [src, outs] of Object.entries(w.connections)) {
      (outs.main || []).forEach((arr, outIdx) => {
        for (const edge of (arr || [])) map.set(edge.node, [...(map.get(edge.node) || []), [src, outIdx]]);
      });
    }
    return map;
  };
  const baseIncoming = incomingOf(baseline), fixedIncoming = incomingOf(fixed);
  for (const name of baselineRespond) {
    assert.deepEqual(fixedIncoming.get(name), baseIncoming.get(name), `"${name}" incoming wiring must be byte-identical`);
  }
});

test('4. recordWf6BatchResult callback path ("Record Batch Result" nodes) is untouched, still feeds the same two terminals', () => {
  for (const w of [baseline, fixed]) {
    const names = w.nodes.filter(n => /^Record Batch Result/.test(n.name)).map(n => n.name);
    assert.deepEqual(names.sort(), ['Record Batch Result (Not Ready)', 'Record Batch Result (Success)']);
  }
  const baseCallback = baseNodes.get('Record Batch Result (Success)');
  const fixedCallback = fixedNodes.get('Record Batch Result (Success)');
  assert.deepEqual(baseCallback, fixedCallback, 'the callback node itself must be byte-identical (not touched)');
  assert.deepEqual(baseline.connections['Record Batch Result (Success)'], fixed.connections['Record Batch Result (Success)']);
  assert.deepEqual(baseline.connections['Record Batch Result (Not Ready)'], fixed.connections['Record Batch Result (Not Ready)']);
});

test('5. every outcome that reached a callback in the baseline still reaches the SAME callback in the fixed draft', () => {
  // Only 2 of 28 terminals have a real backend callback upstream today
  // (a pre-existing gap, not introduced by this change -- see MISSING_CALLBACKS
  // in this increment's own report). This test proves the fix does not
  // regress even those 2.
  const incomingOf = w => {
    const map = new Map();
    for (const [src, outs] of Object.entries(w.connections)) {
      (outs.main || []).forEach((arr, outIdx) => {
        for (const edge of (arr || [])) map.set(edge.node, [...(map.get(edge.node) || []), src]);
      });
    }
    return map;
  };
  const baseIncoming = incomingOf(baseline), fixedIncoming = incomingOf(fixed);
  for (const terminal of ['Respond - Not Eligible', 'Respond - PR Created']) {
    assert.ok((baseIncoming.get(terminal) || []).includes(`Record Batch Result ${terminal === 'Respond - Not Eligible' ? '(Not Ready)' : '(Success)'}`));
    assert.ok((fixedIncoming.get(terminal) || []).includes(`Record Batch Result ${terminal === 'Respond - Not Eligible' ? '(Not Ready)' : '(Success)'}`));
  }
});

test('6/7. Evaluate + all 3 Revalidate nodes keep the reconciled 920000ms timeout, byte-identical to baseline', () => {
  for (const name of SECURITY_NODES) {
    const b = baseNodes.get(name), f = fixedNodes.get(name);
    assert.ok(b && f, `"${name}" must exist in both`);
    assert.equal(f.parameters.options.timeout, 920000);
    assert.deepEqual(f, b, `"${name}" must be byte-identical to baseline (no timeout/business-logic change)`);
  }
});

test('8. node/connection count delta is exactly explained by the respondToWebhook->noOp swap (no node added/removed, no other connection changed)', () => {
  assert.equal(fixed.nodes.length, baseline.nodes.length, 'node COUNT must be unchanged (type-in-place swap, not add/remove)');
  const baseEdges = Object.entries(baseline.connections).flatMap(([src, outs]) => (outs.main || []).flatMap((arr, i) => (arr || []).map(e => `${src}->${i}->${e.node}`)));
  const fixedEdges = Object.entries(fixed.connections).flatMap(([src, outs]) => (outs.main || []).flatMap((arr, i) => (arr || []).map(e => `${src}->${i}->${e.node}`)));
  assert.deepEqual(fixedEdges.sort(), baseEdges.sort(), 'connection edges must be byte-identical (same source, same output index, same target name)');
  // The ONLY node-content differences allowed: the 28 respond->noOp swaps and the webhook's responseMode.
  const changedNodes = baseline.nodes.filter(bn => JSON.stringify(bn) !== JSON.stringify(fixedNodes.get(bn.name)));
  const changedNames = changedNodes.map(n => n.name).sort();
  const expected = [...respondNamesOf(baseline), 'Webhook - Security Remediation Request'].sort();
  assert.deepEqual(changedNames, expected, 'no node besides the 28 respond nodes and the webhook itself may differ');
});

test('9. both workflow JSON files are structurally valid (parseable, single workflow object, required top-level keys)', () => {
  for (const w of [baseline, fixed]) {
    for (const key of ['name', 'nodes', 'connections', 'settings']) assert.ok(key in w, `missing top-level key "${key}"`);
    assert.ok(Array.isArray(w.nodes) && w.nodes.length > 0);
    assert.equal(w.active, false, 'must remain inactive in its versioned form');
  }
});

test('10. n8n 2.14.2 compatibility: noOp node shape matches the installed node\'s real contract', () => {
  const nb = JSON.parse(readFileSync('/tmp/wf6-n8n-package.json', 'utf8'));
  assert.equal(nb.version, '2.14.2');
  // The installed NoOp node (verified separately against the real n8n
  // container: nodes/NoOp/NoOp.node.js) is name:'noOp', version:1, no
  // required parameters -- exactly what every replaced node now carries.
  for (const n of fixed.nodes.filter(n => n.type === 'n8n-nodes-base.noOp')) {
    assert.equal(n.typeVersion, 1);
    assert.deepEqual(n.parameters, {});
  }
});

console.log('BASELINE_SHA256 = ' + createHash('sha256').update(readFileSync(new URL('wf6-security-remediation-maven-RdYyfjVpOm2LxS95.REVALIDATE-BATCH-FIX.PROMOTION-TARGET.json', dir))).digest('hex'));
console.log('FIXED_SHA256 = ' + createHash('sha256').update(readFileSync(new URL('wf6-security-remediation-maven-RdYyfjVpOm2LxS95.V1.7-ACK-CONTRACT.json', dir))).digest('hex'));
