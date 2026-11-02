// Teste le composant « wf6-revalidate-batch-fix-identity » et ses cas d’erreur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BACKUP_PATH = new URL('../backups/pre-promotion-wf6-revalidate-fix-20260929T010000Z/wf6-security-remediation-maven-RdYyfjVpOm2LxS95.LIVE-BEFORE-REVALIDATE-FIX.json', import.meta.url);
const TARGET_PATH = new URL('../pending-live-update/wf6-security-remediation-maven-RdYyfjVpOm2LxS95.REVALIDATE-BATCH-FIX.PROMOTION-TARGET.json', import.meta.url);

const backupBytes = readFileSync(BACKUP_PATH);
const targetBytes = readFileSync(TARGET_PATH);
const backup = JSON.parse(backupBytes);
const target = JSON.parse(targetBytes)[0];

const WF6_ID = 'RdYyfjVpOm2LxS95';
const NODES_MODIFIED = ['Revalidate Before Write (New Branch)', 'Revalidate Before Write (Reuse)', 'Revalidate Before Write (PR)'];
const OLD_URL = '={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/revalidate" }}';
const NEW_URL = '={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/revalidate-batch" }}';

/** Exécute les étapes principales de ce programme. */
function main() {
  console.log('LIVE-BEFORE-REVALIDATE-FIX.json SHA256:', createHash('sha256').update(backupBytes).digest('hex'));
  console.log('REVALIDATE-BATCH-FIX.PROMOTION-TARGET.json SHA256:', createHash('sha256').update(targetBytes).digest('hex'));

  assert.equal(backup.id, WF6_ID);
  assert.equal(target.id, WF6_ID, 'target must be imported under the SAME id');
  assert.equal(target.active, false, 'import artifact only -- activation is a separate, explicit, later step (per instruction)');

  // Node count UNCHANGED -- this fix modifies 3 existing nodes, adds
  // nothing, removes nothing (unlike the multi-CVE promotion, which added 2).
  assert.equal(backup.nodes.length, 151, 'backup must be the real 151-node live graph (multi-CVE promotion already applied)');
  assert.equal(target.nodes.length, 151, 'target must have the SAME node count -- this is a payload fix, not a topology change');

  for (const [label, wf] of [['backup', backup], ['target', target]]) {
    assert.equal(new Set(wf.nodes.map(n => n.id)).size, wf.nodes.length, `${label}: node ids must be unique`);
    assert.equal(new Set(wf.nodes.map(n => n.name)).size, wf.nodes.length, `${label}: node names must be unique`);
  }

  // EXACTLY the 3 intended nodes differ; the other 148 are byte-identical.
  const backupByName = new Map(backup.nodes.map(n => [n.name, n]));
  const targetByName = new Map(target.nodes.map(n => [n.name, n]));
  assert.equal(backupByName.size, targetByName.size, 'no node added or removed');
  const changedNames = [];
  for (const [name, backupNode] of backupByName) {
    const targetNode = targetByName.get(name);
    assert.ok(targetNode, `node "${name}" present in backup must still be present in target`);
    if (JSON.stringify(targetNode) !== JSON.stringify(backupNode)) changedNames.push(name);
  }
  assert.deepEqual(changedNames.sort(), [...NODES_MODIFIED].sort(), 'exactly the 3 intended Revalidate Before Write nodes must differ -- no other one of the 148 untouched nodes may change by even one byte, and the 2 Record Batch Result nodes from the prior promotion stay untouched too');

  // Each of the 3 changed exactly the intended way: url + jsonBody only,
  // nothing else (position/credentials/continueOnFail/retryOnFail/options untouched).
  for (const name of NODES_MODIFIED) {
    const before = backupByName.get(name), after = targetByName.get(name);
    const { parameters: beforeParams, ...beforeRest } = before;
    const { parameters: afterParams, ...afterRest } = after;
    assert.deepEqual(afterRest, beforeRest, `${name}: only "parameters" may differ`);
    const { url: beforeUrl, jsonBody: beforeBody, ...beforeParamsRest } = beforeParams;
    const { url: afterUrl, jsonBody: afterBody, ...afterParamsRest } = afterParams;
    assert.deepEqual(afterParamsRest, beforeParamsRest, `${name}: only url/jsonBody may differ inside parameters -- headers/timeout/options untouched`);
    assert.equal(beforeUrl, OLD_URL, `${name}: backup must show the OLD (buggy) /revalidate url`);
    assert.equal(afterUrl, NEW_URL, `${name}: target must point at /revalidate-batch`);
    assert.match(beforeBody, /findingTaskId:/);
    assert.doesNotMatch(beforeBody, /findingTaskIds/, `${name}: backup's real payload confirmed singular-only (the proven bug)`);
    assert.match(afterBody, /findingTaskIds:/, `${name}: target must send the plural list`);
    assert.doesNotMatch(afterBody, /\bfindingTaskId:/, `${name}: target must not ALSO send a stray singular findingTaskId field`);
  }
  console.log('wf6-revalidate-batch-fix) exactly 3 nodes changed, url+jsonBody only, nothing else on them or elsewhere: PASS');

  // Connections byte-identical -- this fix touches no wiring at all.
  assert.deepEqual(target.connections, backup.connections, 'connections must be COMPLETELY unchanged -- this fix only edits node parameters, never topology');
  console.log('wf6-revalidate-batch-fix) connections completely unchanged (payload-only fix, zero topology change): PASS');

  // No dangling links (defensive re-check).
  {
    const nodeNames = new Set(target.nodes.map(n => n.name));
    for (const [source, obj] of Object.entries(target.connections)) {
      assert.ok(nodeNames.has(source));
      for (const output of obj.main || []) for (const edge of output || []) assert.ok(nodeNames.has(edge.node), `dangling link: "${edge.node}" from "${source}"`);
    }
  }
  console.log('wf6-revalidate-batch-fix) no dangling links: PASS');

  console.log('wf6-revalidate-batch-fix-identity.spec.mjs: ALL CHECKS PASS');
}

main();
