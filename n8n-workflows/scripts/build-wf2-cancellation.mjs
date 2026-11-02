// Recherche les nœuds accessibles depuis le point de départ.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const sourceUrl = new URL('../backups/pre-promotion-r90-dto-source-discovery-20261004T133500Z/WF2-R90-LIVE-ACTIVE-POST-RESTART.json', import.meta.url);
export const targetUrl = new URL('../pending-live-update/WF2-R91-TRUE-CANCELLATION.OFFLINE.json', import.meta.url);
export const writes = ['Create Missing Branch', 'Update File in Branch', 'Create File in Branch', 'Create Pull Request1'];
export const boundary = 'Branch Existed At Generation? (Pass 2 Entry)';

/** Recherche les nœuds accessibles depuis le point de départ. */
export function reachable(w, start, blocked = new Set()) {
  const seen = new Set(), queue = [start];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name) || blocked.has(name)) continue;
    seen.add(name);
    for (const ports of Object.values(w.connections[name] || {})) {
      for (const port of ports) for (const edge of port) queue.push(edge.node);
    }
  }
  return seen;
}

/** Construit le candidat. */
export function buildCandidate() {
  const raw = readFileSync(sourceUrl, 'utf8');
  const parsed = JSON.parse(raw), source = Array.isArray(parsed) ? parsed[0] : parsed;
  assert.equal(source.id, 'u3eeMwTuhCsetfcS');
  assert.equal(source.versionId, 'fe09bc17-27e7-4b0b-a76b-cd45d3959370');
  // Prove the selected insertion point BEFORE modifying any graph.
  const originalReach = reachable(source, 'Webhook');
  const bypass = reachable(source, 'Webhook', new Set([boundary]));
  for (const name of writes) {
    assert.ok(originalReach.has(name), `${name} must be reachable (non-vacuous proof)`);
    assert.ok(!bypass.has(name), `STOP: boundary does not dominate ${name}`);
  }
  const w = structuredClone(source);
  /** Construit une liaison entre deux nœuds. */
  const edge = node => ({ node, type: 'main', index: 0 });
  /** Relie les nœuds du workflow. */
  const connect = (name, ...ports) => { w.connections[name] = { main: ports.map(port => port.map(edge)) }; };
  const identity = "const e=$('Capture Correlation Envelope').first().json.correlationEnvelope;";
  const payload = `={{ (() => { ${identity} return JSON.stringify({requestId:e.requestId,batchId:e.batchId,attemptCount:e.attemptCount,executionId:$execution.id}); })() }}`;
  /** Ajoute l’élément au résultat en cours. */
  const add = (name, type, parameters, position, version = 1) => {
    w.nodes.push({ id: `r91-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, type,
      typeVersion: version, position, parameters });
  };
  /** Construit l’appel HTTP du traitement. */
  const http = (name, endpoint, position) => add(name, 'n8n-nodes-base.httpRequest', {
    method: 'POST',
    url: `={{ (() => { ${identity} return 'http://backend:3001/api/incidents/'+encodeURIComponent(e.incidentId)+'/remediation/'+encodeURIComponent(e.requestId)+'/${endpoint}'; })() }}`,
    sendHeaders: true, headerParameters: { parameters: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'X-Internal-Secret', value: '={{ $env.N8N_INTERNAL_SECRET }}' },
    ] }, sendBody: true, specifyBody: 'json', jsonBody: payload, options: { timeout: 15000 },
  }, position, 4.2);
  /** Construit la condition utilisée par le nœud. */
  const condition = (name, expression, position) => add(name, 'n8n-nodes-base.if', {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
      conditions: [{ id: 'cancellation-permission', leftValue: expression, rightValue: true,
        operator: { type: 'boolean', operation: 'true' } }], combinator: 'and' }, options: {},
  }, position, 2.3);
  http('Register WF2 Execution', 'execution-started', [-1760, 100]);
  condition('Execution May Continue?', '={{ $json.success === true && $json.cancelRequested === false && $json.cancelled === false && !$json.stale }}', [-1530, 100]);
  add('Restore Registered Intake', 'n8n-nodes-base.code', {
    jsCode: "return [{json:$('Adapt Webhook Payload').first().json,pairedItem:{item:0}}];",
  }, [-1300, 100], 2);
  http('Pre-Git Cancellation Gate', 'pre-write-gate', [4000, 200]);
  condition('Git Write Allowed?', '={{ $json.allowed === true && $json.cancelRequested === false }}', [4230, 200]);
  add('Restore Pre-Git Context', 'n8n-nodes-base.code', {
    jsCode: "return [{json:$('Remote Head Drift Passed?').first().json,pairedItem:{item:0}}];",
  }, [4460, 200], 2);
  add('WF2 Cancellation Terminal', 'n8n-nodes-base.noOp', {}, [4200, 700]);
  // Existing error outputs remain byte-for-byte intact. New HTTP failures stop
  // the execution: no continueOnFail, no bypass, no Git, no terminal callbacks.
  const intakePort = w.connections['Adapt Webhook Payload'].main[0];
  assert.deepEqual(intakePort, [edge('Fetch Repository Metadata')]);
  w.connections['Adapt Webhook Payload'].main[0] = [edge('Register WF2 Execution')];
  connect('Register WF2 Execution', ['Execution May Continue?']);
  connect('Execution May Continue?', ['Restore Registered Intake'], ['WF2 Cancellation Terminal']);
  connect('Restore Registered Intake', ['Fetch Repository Metadata']);
  assert.deepEqual(w.connections['Remote Head Drift Passed?'].main[0], [edge(boundary)]);
  w.connections['Remote Head Drift Passed?'].main[0] = [edge('Pre-Git Cancellation Gate')];
  connect('Pre-Git Cancellation Gate', ['Git Write Allowed?']);
  connect('Git Write Allowed?', ['Restore Pre-Git Context'], ['WF2 Cancellation Terminal']);
  connect('Restore Pre-Git Context', [boundary]);
  for (const name of writes) assert.ok(!reachable(w, 'Webhook', new Set(['Pre-Git Cancellation Gate'])).has(name));
  // Explicitly inactive offline artifact. Source identity stays in the report.
  w.active = false;
  w.activeVersionId = null;
  w.versionId = '3a12a145-4975-49ce-93e0-17b9a91a0091';
  const added = w.nodes.filter(n => !source.nodes.some(old => old.id === n.id));
  const changed = source.nodes.filter(n => JSON.stringify(n) !== JSON.stringify(w.nodes.find(next => next.id === n.id)));
  const connectionKeys = [...new Set([...Object.keys(source.connections), ...Object.keys(w.connections)])];
  const report = {
    sourceVersion: source.versionId, sourceSha256: createHash('sha256').update(raw).digest('hex'),
    selectedBoundary: boundary, domination: Object.fromEntries(writes.map(n => [n, 'YES'])),
    FUNCTIONAL_NODE_ADDED_COUNT: added.length, FUNCTIONAL_NODE_REMOVED_COUNT: 0,
    FUNCTIONAL_NODE_CHANGED_COUNT: changed.filter(n => n.type !== 'n8n-nodes-base.stickyNote').length,
    CONNECTION_CHANGED_COUNT: connectionKeys.filter(k => JSON.stringify(source.connections[k]) !== JSON.stringify(w.connections[k])).length,
    STICKY_NOTE_CHANGED_COUNT: changed.filter(n => n.type === 'n8n-nodes-base.stickyNote').length,
    CREDENTIAL_CHANGED_COUNT: 0, UNRELATED_NODE_CHANGED_COUNT: 0,
    addedNodes: added.map(n => ({ name: n.name, justification: n.name.includes('Restore')
      ? 'Restore original input after backend permission response' : n.name.includes('Terminal')
      ? 'Clean cancellation termination without success/failure callbacks' : 'Execution registration or atomic cancellation permission' })),
    changedConnectionSources: connectionKeys.filter(k => JSON.stringify(source.connections[k]) !== JSON.stringify(w.connections[k])),
    rootChanges: ['active=false', 'activeVersionId=null', 'versionId=offline candidate identifier'],
  };
  assert.equal(changed.length, 0);
  return { source, candidate: w, report };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { candidate, report } = buildCandidate();
  writeFileSync(targetUrl, JSON.stringify([candidate], null, 2) + '\n');
  writeFileSync(new URL('../../docs/qa/wf2-cancellation/wf2-strict-diff.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
