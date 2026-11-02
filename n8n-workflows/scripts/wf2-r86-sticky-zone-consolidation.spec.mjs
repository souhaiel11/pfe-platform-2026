// Vérifie le regroupement des annotations visuelles dans WF2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { consolidateStickyZones, ZONES } from './harden-wf2-r86-sticky-zone-consolidation.mjs';

/** Vérifie les résultats attendus dans ce scénario. */
const ALL_74_FAILURE_ENVELOPES_CONVERGE = (workflow) => {
  const fe = workflow.nodes.filter((n) => n.name.startsWith('Failure Envelope'));
  assert.equal(fe.length, 74);
  for (const n of fe) {
    const edge = workflow.connections[n.name]?.main?.[0]?.[0];
    assert.equal(edge?.node, 'Prepare WF2 Failure Status', `${n.name} must still converge`);
  }
};

/** Vérifie les résultats attendus dans ce scénario. */
const NO_PARASITIC_EDGE = (workflow) => {
  const targets =
    workflow.connections['Record New Branch Baseline']?.main?.[0]?.map((e) => e.node) ?? [];
  assert.ok(!targets.includes('Remote Candidate Present?'), 'parasitic edge must remain absent');
};

/** Prépare les données nécessaires à ce scénario. */
const inBox = (node, zone) => {
  const [x, y] = node.position;
  const cx = x + 120;
  const cy = y + 40;
  const [bx, by] = zone.position;
  return cx >= bx && cx <= bx + zone.width && cy >= by && cy <= by + zone.height;
};

const artifactPath = process.argv[2];
if (!artifactPath) throw new Error('usage: node wf2-r86-sticky-zone-consolidation.spec.mjs <LIVE-BEFORE-R86.json>');

const root = JSON.parse(readFileSync(artifactPath, 'utf8'));
const before = structuredClone(Array.isArray(root) ? root[0] : root);
const workflow = structuredClone(before);

// --- precondition: state this patch was designed against ---
assert.equal(before.nodes.length, 193);
assert.equal(before.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length, 182);
assert.equal(before.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote').length, 11);
ALL_74_FAILURE_ENVELOPES_CONVERGE(before);
NO_PARASITIC_EDGE(before);

consolidateStickyZones(workflow);

// --- functional nodes: byte-identical, same count, same order-independent set ---
const beforeFunc = before.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
const afterFunc = workflow.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
assert.equal(afterFunc.length, 182, '182 functional nodes must remain');
assert.deepEqual(
  afterFunc.map((n) => n.name).sort(),
  beforeFunc.map((n) => n.name).sort(),
  'functional node set must be unchanged',
);
const beforeByName = new Map(beforeFunc.map((n) => [n.name, n]));
let functionalDiffs = 0;
for (const n of afterFunc) {
  if (JSON.stringify(n) !== JSON.stringify(beforeByName.get(n.name))) functionalDiffs++;
}
assert.equal(functionalDiffs, 0, 'no functional node may change in any way (position included)');

// --- connections: byte-identical, zero differences ---
assert.deepEqual(workflow.connections, before.connections, 'connections must be byte-identical');

// --- stickies: exactly 6, matching ZONES ---
const afterSticky = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.stickyNote');
assert.equal(afterSticky.length, 6, 'exactly 6 sticky notes');
assert.deepEqual(
  afterSticky.map((n) => n.name).sort(),
  ZONES.map((z) => z.name).sort(),
);

// --- total node count ---
assert.equal(workflow.nodes.length, 188, '182 functional + 6 sticky');

// --- exhaustive partition: every functional node in exactly one zone ---
const membership = new Map(afterFunc.map((n) => [n.name, []]));
for (const zone of ZONES) {
  for (const n of afterFunc) {
    if (inBox(n, zone)) membership.get(n.name).push(zone.name);
  }
}
const unassigned = [...membership.entries()].filter(([, zs]) => zs.length === 0);
const overlapping = [...membership.entries()].filter(([, zs]) => zs.length > 1);
assert.equal(unassigned.length, 0, `nodes outside every zone: ${unassigned.map(([n]) => n).join(', ')}`);
assert.equal(
  overlapping.length,
  0,
  `nodes in more than one zone: ${overlapping.map(([n, zs]) => `${n}->${zs}`).join(', ')}`,
);

// --- no zone is empty ---
for (const zone of ZONES) {
  const count = afterFunc.filter((n) => inBox(n, zone)).length;
  assert.ok(count > 0, `zone ${zone.name} must not be empty`);
}

/** Prépare les données nécessaires à ce scénario. */
const overlaps2D = (a, b) => {
  const ax0 = a.position[0], ax1 = a.position[0] + a.width;
  const ay0 = a.position[1], ay1 = a.position[1] + a.height;
  const bx0 = b.position[0], bx1 = b.position[0] + b.width;
  const by0 = b.position[1], by1 = b.position[1] + b.height;
  return ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1;
};
for (let i = 0; i < ZONES.length; i++) {
  for (let j = i + 1; j < ZONES.length; j++) {
    assert.ok(!overlaps2D(ZONES[i], ZONES[j]), `zone boxes overlap: ${ZONES[i].name} / ${ZONES[j].name}`);
  }
}

// --- R84 invariant still holds after this patch ---
ALL_74_FAILURE_ENVELOPES_CONVERGE(workflow);
NO_PARASITIC_EDGE(workflow);

console.log(
  'WF2 R86 — 11 stickies -> 6, 182 functional nodes byte-identical, connections byte-identical, ' +
    '182/182 nodes in exactly one of 6 non-overlapping zones, 74/74 convergence intact, parasitic edge absent: PASS',
);
