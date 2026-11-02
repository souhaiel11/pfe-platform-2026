// Teste le composant « wf2-promotion-identity » et ses cas d’erreur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** Lit les données depuis leur source. */
const read = name => JSON.parse(readFileSync(new URL('../pending-live-update/' + name, import.meta.url), 'utf8'))[0];
const source = read('WF2-R90-DTO-DISCOVERY.REBASE-BASELINE.json');
const target = read('WF2-R90-DTO-DISCOVERY.PROMOTION-TARGET-OFFLINE.json');

const ONLY_PERMITTED_DIFF = 'Expand Referenced API Sources';
const id = 'u3eeMwTuhCsetfcS';

// ── WORKFLOW_ID unchanged ───────────────────────────────────────────────────
assert.equal(source.id, id, 'SOURCE must be the real active workflow');
assert.equal(target.id, id, 'TARGET must promote the same workflow, never a different one');

// ── active state unchanged (this spec does not get to invent a promotion
// contract here -- it only proves the candidate never silently flips it) ───
assert.equal(target.active, source.active, 'promotion candidate must not change the active flag as a side effect');

/** Prépare les données nécessaires à ce scénario. */
const webhook = w => w.nodes.find(n => n.name === 'Webhook');
assert.ok(webhook(source) && webhook(target), 'Webhook node present on both sides');
assert.equal(webhook(target).webhookId, webhook(source).webhookId, 'WEBHOOK_ID unchanged');
assert.deepEqual(webhook(target).parameters, webhook(source).parameters, 'webhook path/method unchanged');
assert.equal(webhook(source).parameters.path, 'wf2-r22e-test');
assert.equal(webhook(source).parameters.httpMethod, 'POST');

/** Retrouve l’élément par son nom. */
const byName = w => new Map(w.nodes.map(n => [n.name, n]));
const sourceNodes = byName(source), targetNodes = byName(target);
assert.equal(target.nodes.length, source.nodes.length, 'NODE_SET size unchanged');
assert.deepEqual([...targetNodes.keys()].sort(), [...sourceNodes.keys()].sort(), 'NODE_SET names unchanged');
assert.deepEqual(
  [...targetNodes.values()].map(n => n.id).sort(),
  [...sourceNodes.values()].map(n => n.id).sort(),
  'NODE_SET ids unchanged',
);

// ── Per-node identity: everything must match SOURCE exactly, with exactly one
// permitted exception (jsCode on the one DTO-discovery node). ──────────────
let changedNodeNames = [];
let positionChanged = [];
let credentialChanged = [];
for (const name of sourceNodes.keys()) {
  const s = sourceNodes.get(name), t = targetNodes.get(name);
  if (JSON.stringify(s.position) !== JSON.stringify(t.position)) positionChanged.push(name);
  if (JSON.stringify(s.credentials) !== JSON.stringify(t.credentials)) credentialChanged.push(name);
  if (JSON.stringify(s) !== JSON.stringify(t)) changedNodeNames.push(name);
}
assert.deepEqual(positionChanged, [], 'POSITIONS unchanged for every node');
assert.deepEqual(credentialChanged, [], 'CREDENTIAL_REFS unchanged for every node');
assert.deepEqual(changedNodeNames, [ONLY_PERMITTED_DIFF], `the only node allowed to differ is ${ONLY_PERMITTED_DIFF}`);

// ── For the one permitted node, only parameters.jsCode may differ -- type,
// position, credentials, onError, typeVersion etc. must still match SOURCE. ─
{
  const s = sourceNodes.get(ONLY_PERMITTED_DIFF), t = targetNodes.get(ONLY_PERMITTED_DIFF);
  const { parameters: sp, ...sRest } = s;
  const { parameters: tp, ...tRest } = t;
  assert.deepEqual(tRest, sRest, `${ONLY_PERMITTED_DIFF}: only parameters may differ from SOURCE`);
  const { jsCode: sCode, ...sParamsRest } = sp;
  const { jsCode: tCode, ...tParamsRest } = tp;
  assert.deepEqual(tParamsRest, sParamsRest, `${ONLY_PERMITTED_DIFF}: only parameters.jsCode may differ from SOURCE`);
  assert.notEqual(tCode, sCode, `${ONLY_PERMITTED_DIFF}: jsCode was expected to change (R90 DTO-discovery fix)`);
}

/** Prépare les données nécessaires à ce scénario. */
const stickies = w => w.nodes.filter(n => n.type === 'n8n-nodes-base.stickyNote');
assert.deepEqual(
  stickies(target).map(n => [n.name, n]).sort((a, b) => a[0].localeCompare(b[0])),
  stickies(source).map(n => [n.name, n]).sort((a, b) => a[0].localeCompare(b[0])),
  'STICKIES byte-identical',
);

// ── CONNECTIONS unchanged ───────────────────────────────────────────────────
assert.deepEqual(target.connections, source.connections, 'CONNECTIONS unchanged');

// ── No other field (settings/staticData/pinData/name) silently drifted ────
for (const field of ['name', 'settings', 'staticData', 'pinData']) {
  assert.deepEqual(target[field], source[field], `${field} unchanged`);
}

console.log(
  'WF2 promotion identity (R90 rebase): workflow/webhook identity, node set, positions, credentials, stickies and ' +
  'connections all unchanged between the real active baseline and the R90 candidate; the only difference anywhere ' +
  'in the artifact is parameters.jsCode on "Expand Referenced API Sources" -- PASS',
);
