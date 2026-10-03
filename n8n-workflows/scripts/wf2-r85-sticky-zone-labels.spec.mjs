import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relabelStickyZones } from './harden-wf2-r85-sticky-zone-labels.mjs';

const ALL_74_FAILURE_ENVELOPES_SAMPLE_CHECK = (workflow) => {
  const fe = workflow.nodes.filter(n => n.name.startsWith('Failure Envelope'));
  assert.equal(fe.length, 74);
  for (const n of fe) {
    const edge = workflow.connections[n.name]?.main?.[0]?.[0];
    assert.equal(edge?.node, 'Prepare WF2 Failure Status', `${n.name} must still converge`);
  }
};

const artifact = new URL(
  '../backups/pre-promotion-r85-sticky-zone-labels-20261003T000000Z/wf2-u3eeMwTuhCsetfcS.LIVE-BEFORE-R85.json',
  import.meta.url,
);
const root = JSON.parse(readFileSync(artifact, 'utf8'));
const before = structuredClone(root[0]);
const workflow = structuredClone(root[0]);

// precondition: R84 already live, 197/186/11
assert.equal(before.nodes.length, 197);
assert.equal(before.nodes.filter(n => n.type !== 'n8n-nodes-base.stickyNote').length, 186);
assert.equal(before.nodes.filter(n => n.type === 'n8n-nodes-base.stickyNote').length, 11);
ALL_74_FAILURE_ENVELOPES_SAMPLE_CHECK(before);

relabelStickyZones(workflow);

// --- node set: same count, same names, same order ---
assert.equal(workflow.nodes.length, before.nodes.length);
assert.deepEqual(workflow.nodes.map(n => n.name), before.nodes.map(n => n.name));

const CHANGED_STICKIES = new Set([
  'Sticky - Phase 1a - Reception & correlation',
  'Sticky - Phase 4 - Generation du patch',
  'Sticky - Phase 5 - Preflight deterministe',
  'Sticky - Phase 6 - Revue semantique',
  'Sticky - Phase 7 - Verification du candidat',
  'Sticky - Phase 8b - Ecriture Git & Pull Request (suite)',
  'Sticky - Phase 1b - Reception & correlation (resolution de branche)',
  'Sticky - Phase 2 - Grounding des sources',
  'Sticky - Phase 3 - Planification',
  'Sticky - Phase 8 - Ecriture Git & Pull Request',
  'Sticky - Phase 9 - Grounding & verification multi-fichiers (extension)',
]);
assert.equal(CHANGED_STICKIES.size, 11, 'all 11 stickies are expected to be touched');

const beforeByName = new Map(before.nodes.map(n => [n.name, n]));
let functionalDiffs = 0;
let stickyContentDiffs = 0;
for (const n of workflow.nodes) {
  const b = beforeByName.get(n.name);
  if (n.type === 'n8n-nodes-base.stickyNote') {
    // only content/height may differ; id/type/position/typeVersion/width must not
    assert.equal(n.id, b.id, `sticky ${n.name} id must not change`);
    assert.equal(n.type, b.type);
    assert.deepEqual(n.position, b.position, `sticky ${n.name} position must not move`);
    assert.equal(n.parameters.width, b.parameters.width, `sticky ${n.name} width must not change`);
    if (n.parameters.content !== b.parameters.content) stickyContentDiffs++;
    const otherParamKeys = new Set([...Object.keys(n.parameters), ...Object.keys(b.parameters)]);
    otherParamKeys.delete('content');
    otherParamKeys.delete('height');
    for (const k of otherParamKeys) {
      assert.deepEqual(n.parameters[k], b.parameters[k], `sticky ${n.name} parameters.${k} must not change`);
    }
  } else {
    if (JSON.stringify(n) !== JSON.stringify(b)) functionalDiffs++;
  }
}
assert.equal(functionalDiffs, 0, 'no functional node may change in any way');
assert.equal(stickyContentDiffs, 11, 'all 11 stickies must have new content');

// --- connections: byte-identical, zero differences ---
assert.deepEqual(workflow.connections, before.connections, 'connections must be byte-identical — 0 differences');

// --- R84 invariant still holds after this patch ---
ALL_74_FAILURE_ENVELOPES_SAMPLE_CHECK(workflow);

// --- no parasitic edge introduced ---
const rnb = workflow.connections['Record New Branch Baseline']?.main?.[0]?.map(e => e.node) || [];
assert.ok(!rnb.includes('Remote Candidate Present?'), 'parasitic edge must remain absent');

// --- spot-check the actual new wording landed correctly ---
const zone1 = workflow.nodes.find(n => n.name === 'Sticky - Phase 1a - Reception & correlation');
assert.match(zone1.parameters.content, /Zone 1 — Blocs 1, 2, 3/);
assert.match(zone1.parameters.content, /aucune entree detectee par l'analyse, conservee/);
assert.doesNotMatch(zone1.parameters.content, /chaine Pass-1 morte/);

const chemins = workflow.nodes.find(n => n.name === 'Sticky - Phase 6 - Revue semantique');
assert.match(chemins.parameters.content, /aucune entree detectee par l'analyse, conserves/);
assert.match(chemins.parameters.content, /ne sont PAS dans cette zone/);

console.log('WF2 R85 — 11 sticky labels rewritten, 186 functional byte-identical, connections byte-identical, 74/74 convergence intact, parasitic edge absent: PASS');
