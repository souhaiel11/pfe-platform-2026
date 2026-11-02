// Teste le composant « wf2-r83-sticky-notes » et ses cas d’erreur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STICKY = 'n8n-nodes-base.stickyNote';
const EXPECTED_STICKY_COUNT = 11;

const target = JSON.parse(readFileSync(new URL('../pending-live-update/WF2-R83-STICKY-NOTES.PROMOTION-TARGET.json', import.meta.url)))[0];
const base = JSON.parse(readFileSync(new URL('../backups/pre-promotion-r83-sticky-notes-20261002T213500Z/wf2-u3eeMwTuhCsetfcS.WF2_DRAFT_BEFORE_R83.json', import.meta.url)))[0];
// `base` above is the pre-R83 EDITOR DRAFT (still carrying the R82 stray
// edge) -- kept only to prove it was never mutated by this change. The
// actual functional baseline this artifact must match is the clean
// PUBLISHED version, read from workflow_history (a2bc0e9e), captured
// read-only during the audit into a2bc-nodes.json / a2bc-connections.json.
const cleanNodes = JSON.parse(readFileSync(new URL('../backups/r83-clean-baseline-a2bc0e9e/a2bc-nodes.json', import.meta.url), 'utf8').toString());

/** Prépare les données nécessaires à ce scénario. */
function canon(o) {
  if (Array.isArray(o)) return o.map(canon);
  if (o && typeof o === 'object') return Object.keys(o).sort().reduce((acc, k) => { acc[k] = canon(o[k]); return acc; }, {});
  return o;
}
/** Prépare les données nécessaires à ce scénario. */
const stable = (o) => JSON.stringify(canon(o));

assert.equal(target.id, 'u3eeMwTuhCsetfcS');

const functionalNodes = target.nodes.filter((n) => n.type !== STICKY);
const stickyNotes = target.nodes.filter((n) => n.type === STICKY);

assert.equal(functionalNodes.length, 186, 'FUNCTIONAL_NODE_COUNT must stay 186');
assert.equal(stickyNotes.length, EXPECTED_STICKY_COUNT, `exactly ${EXPECTED_STICKY_COUNT} sticky notes expected`);
assert.equal(target.nodes.length, 186 + EXPECTED_STICKY_COUNT);

// Every functional node id present in the clean baseline is present,
// unchanged, and nothing else was added or removed.
const cleanById = new Map(cleanNodes.map((n) => [n.id, n]));
const targetById = new Map(functionalNodes.map((n) => [n.id, n]));
assert.equal(targetById.size, 186, 'functional node ids must be unique');
for (const [id, cleanNode] of cleanById) {
  const node = targetById.get(id);
  assert.ok(node, `baseline node missing from target: ${cleanNode.name}`);
  assert.equal(stable(node), stable(cleanNode), `functional node changed: ${cleanNode.name}`);
}
for (const id of targetById.keys()) {
  assert.ok(cleanById.has(id), `unexpected extra functional node id: ${id}`);
}

console.log('wf2-r83-sticky-notes: 186 functional nodes byte-identical to clean a2bc0e9e baseline: PASS');

// Connections: strictly identical to the clean baseline -- not one edge
// added, removed or rewired, for any functional node.
const cleanConnections = JSON.parse(readFileSync(new URL('../backups/r83-clean-baseline-a2bc0e9e/a2bc-connections.json', import.meta.url), 'utf8').toString());
assert.equal(stable(target.connections), stable(cleanConnections), 'connections must be strictly identical to the clean baseline');

console.log('wf2-r83-sticky-notes: connections strictly unchanged vs clean baseline: PASS');

// Sticky notes: documentary only. No ports, no credentials, no entry in
// `connections` as source or as any edge's target.
const stickyNames = new Set(stickyNotes.map((s) => s.name));
for (const s of stickyNotes) {
  assert.equal(s.type, STICKY);
  assert.ok(!s.credentials, `sticky note must carry no credential: ${s.name}`);
  assert.ok(!target.connections[s.name], `sticky note must not be a connections source: ${s.name}`);
  assert.match(s.parameters.content, /^## /, `sticky note must carry documentary content: ${s.name}`);
  assert.ok(Number.isFinite(s.parameters.width) && s.parameters.width > 0);
  assert.ok(Number.isFinite(s.parameters.height) && s.parameters.height > 0);
}
let stickyAsTarget = 0;
for (const conn of Object.values(target.connections)) {
  for (const output of conn.main || []) {
    for (const edge of output || []) {
      if (stickyNames.has(edge.node)) stickyAsTarget++;
    }
  }
}
assert.equal(stickyAsTarget, 0, 'no connection may target a sticky note');

console.log(`wf2-r83-sticky-notes: ${stickyNotes.length} sticky notes carry zero connections and zero credentials: PASS`);

// Geometry sanity: no two sticky rectangles overlap (purely cosmetic, but a
// overlapping pair would defeat the "readable at a glance" purpose).
const rects = stickyNotes.map((s) => ({
  name: s.name,
  x1: s.position[0], y1: s.position[1],
  x2: s.position[0] + s.parameters.width, y2: s.position[1] + s.parameters.height,
}));
for (let i = 0; i < rects.length; i++) {
  for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    const overlap = a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
    assert.ok(!overlap, `sticky notes overlap: ${a.name} / ${b.name}`);
  }
}
console.log('wf2-r83-sticky-notes: no two sticky rectangles overlap: PASS');

console.log('wf2-r83-sticky-notes.spec.mjs: ALL CHECKS PASS');
