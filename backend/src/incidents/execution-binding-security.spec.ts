// Teste le composant « execution-binding-security » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { ValidationPipe } from '@nestjs/common';
import { makeIncident, harness } from './wf2-cancellation.spec';
import { IncidentWriteDto, sanitizeIncidentPatch } from './incident-write.dto';
import { ExecutionStartedInput, PreWriteGateInput, CancelFixRequestInput } from './wf2-cancellation.types';
import { IncidentsController } from './incidents.controller';
const admin = { id: 'admin', role: 'admin' };
const identity = { requestId: 'request-1', batchId: 'batch-1', attemptCount: 1, executionId: '101' };
/** Exécute les étapes principales de ce programme. */
async function main() {
 const pipe = new ValidationPipe({ whitelist: true, transform: true });
 const incident = makeIncident(); const { service } = harness(incident);
 const controller = new IncidentsController(service);
 /** Prépare les données nécessaires à ce scénario. */
 const put = async (body: any) => controller.update(incident.id, await pipe.transform(body, { type: 'body', metatype: IncidentWriteDto }));
 const original = structuredClone(incident.metadata.fixRequest);
 for (const [label, malicious] of [
   ['S1', { n8nExecutionId: '202' }], ['S2', { status: 'CANCELLED' }], ['S3', { sideEffectsStarted: true }],
 ] as const) {
   await put({ metadata: { fixRequest: { ...original, ...malicious } } });
   assert.deepEqual(incident.metadata.fixRequest, original); console.log(`${label} PASS`);
 }
 await put({ metadata: {} }); assert.deepEqual(incident.metadata.fixRequest, original); console.log('S4 PASS');
 await put({ metadata: { enrichedData: { sonar: { complete: true } }, sourceCommitSha: 'a'.repeat(40) } });
 assert.equal(incident.metadata.enrichedData.sonar.complete, true);
 assert.deepEqual(incident.metadata.fixRequest, original); console.log('S5 PASS');
 for (const order of [false, true]) {
   const row = makeIncident(); const h = harness(row); const stale = structuredClone(row.metadata);
   const tasks = [() => h.service.cancelFixRequest(row.id, identity.requestId, {}, admin), () => h.service.update(row.id, { metadata: { ...stale, note: 'legitimate' } })];
   await Promise.all((order ? tasks.reverse() : tasks).map(fn => fn()));
   assert.equal(row.metadata.fixRequest.status, 'CANCEL_REQUESTED'); assert.equal(row.metadata.note, 'legitimate');
 }
 console.log('S6 PASS');
 for (const order of [false, true]) {
   const row = makeIncident(); const h = harness(row); await h.service.recordExecutionStarted(row.id, identity.requestId, identity);
   const stale = structuredClone(row.metadata);
   const tasks = [() => h.service.preWriteGate(row.id, identity.requestId, identity), () => h.service.update(row.id, { metadata: { ...stale, note: 'legitimate' } })];
   await Promise.all((order ? tasks.reverse() : tasks).map(fn => fn()));
   assert.equal(row.metadata.fixRequest.sideEffectsStarted, true); assert.equal(row.metadata.note, 'legitimate');
 }
 console.log('S7 PASS');
 await service.recordExecutionStarted(incident.id, identity.requestId, identity);
 assert.equal(incident.metadata.fixRequest.n8nExecutionId, '101'); assert.ok(incident.metadata.fixRequest.executionRegisteredAt); console.log('S8 PASS');
 await put({ metadata: { fixRequest: { ...incident.metadata.fixRequest, n8nExecutionId: '202' } } });
 assert.equal(incident.metadata.fixRequest.n8nExecutionId, '101');
 await assert.rejects(() => service.recordExecutionStarted(incident.id, identity.requestId, { ...identity, executionId: '202' }));
 console.log('S10 PASS');
 const oldFetch = globalThis.fetch; const oldUrl = process.env.N8N_API_URL; const oldKey = process.env.N8N_API_KEY;
 try {
   process.env.N8N_API_URL = 'http://offline.invalid'; process.env.N8N_API_KEY = 'offline-only-dummy'; let stops = 0;
   /** Envoie la requête et lit la réponse distante. */
   globalThis.fetch = async (url: any) => { assert.equal(String(url), 'http://offline.invalid/api/v1/executions/101/stop'); stops++; return { ok: true, status: 200 } as any; };
   await service.cancelFixRequest(incident.id, identity.requestId, {}, admin);
   assert.equal(stops, 1); assert.equal(incident.metadata.fixRequest.status, 'CANCELLED'); console.log('S9 PASS');
 } finally { globalThis.fetch = oldFetch; for (const [k,v] of [['N8N_API_URL',oldUrl],['N8N_API_KEY',oldKey]]) if(v===undefined) delete process.env[k!]; else process.env[k!] = v; }
 await put({ status: 'fix_generated', prUrl: 'https://github.com/a/b/pull/1', metadata: { fixRequest: { ...original, status: 'CANCELLED', sideEffectsStarted: true } } });
 assert.equal(incident.metadata.fixRequest.status, 'CANCELLED'); assert.notEqual(incident.metadata.fixRequest.sideEffectsStarted, true);
 await assert.rejects(() => service.rejectFix(incident.id, admin));
 assert.equal((await service.preWriteGate(incident.id, identity.requestId, identity)).allowed, false); console.log('S11 PASS');
 for (const patch of [{ requestId: 'stale' }, { batchId: 'stale' }, { attemptCount: 2 }]) {
   const row = makeIncident(); const h = harness(row);
   await assert.rejects(() => h.service.recordExecutionStarted(row.id, { ...identity, ...patch }.requestId, { ...identity, ...patch }));
   await assert.rejects(() => h.service.preWriteGate(row.id, { ...identity, ...patch }.requestId, { ...identity, ...patch }));
 }
 console.log('S12 PASS');
 // Public creation cannot plant ownership; unrelated root/entity fields are whitelisted.
 assert.deepEqual(sanitizeIncidentPatch({ metadata: { fixRequest: { n8nExecutionId: '202' }, note: 'ok' }, id: 'injected', project: {} }), { metadata: { note: 'ok' } });
 for (const dto of [ExecutionStartedInput, PreWriteGateInput]) for (const patch of [
   { requestId: '' }, { requestId: 'a'.repeat(129) }, { batchId: {} }, { batchId: 'a'.repeat(129) },
   { executionId: '0' }, { executionId: '1'.repeat(20) }, { executionId: 1 }, { attemptCount: 0 }, { attemptCount: 1.5 }, { attemptCount: 1000001 },
 ]) await assert.rejects(() => pipe.transform({ ...identity, ...patch }, { type: 'body', metatype: dto }));
 await assert.rejects(() => pipe.transform({ reason: 'a'.repeat(301) }, { type: 'body', metatype: CancelFixRequestInput }));
 for (const patch of [{ attemptCount: 1000001 }, { executionId: '1'.repeat(20) }, { requestId: 'a'.repeat(129) }]) await assert.rejects(() => service.recordExecutionStarted(incident.id, { ...identity, ...patch }.requestId, { ...identity, ...patch }));
 const unregistered = makeIncident({ fixRequest: { n8nExecutionId: '202', executionRegisteredAt: undefined } });
 const untrusted = harness(unregistered);
 await assert.rejects(() => untrusted.service.cancelFixRequest(unregistered.id, identity.requestId, {}, admin));
 await assert.rejects(() => untrusted.service.preWriteGate(unregistered.id, identity.requestId, { ...identity, executionId: '202' }));
 assert.equal(unregistered.metadata.fixRequest.status, 'DISPATCHED');
 const noNamespace = makeIncident({ incident: { metadata: { note: 'existing' } } }); const noNamespaceHarness = harness(noNamespace);
 await noNamespaceHarness.service.update(noNamespace.id, { metadata: { fixRequest: { status: 'CANCELLED', n8nExecutionId: '202', sideEffectsStarted: true }, note: 'changed' } });
 assert.equal(noNamespace.metadata.fixRequest, undefined); assert.equal(noNamespace.metadata.note, 'changed');
 await put({ metadata: { fixRequest: null } }); assert.equal(incident.metadata.fixRequest.status, 'CANCELLED');
 await assert.rejects(() => put({ metadata: null }));

 for (const status of ['CANCEL_REQUESTED', 'CANCELLED']) {
   const row = makeIncident({ fixRequest: { status } }); const h = harness(row);
   const protectedFix = structuredClone(row.metadata.fixRequest);
   await (h.service as any).mergeNonLifecycleMetadata(row.id, { validation: { result: 'FAILED' }, fixRequest: { status: 'DISPATCHED' } });
   assert.deepEqual(row.metadata.fixRequest, protectedFix);
   await assert.rejects(() => h.service.rejectFix(row.id, admin));
   assert.deepEqual(row.metadata.fixRequest, protectedFix);
 }
 const clean = await pipe.transform({ status: 'pending', id: 'injected', n8nExecutionId: '202' }, { type: 'body', metatype: IncidentWriteDto });
 assert.equal(clean.id, undefined); assert.equal(clean.n8nExecutionId, undefined);
 console.log('security bypass/DTO bounds S1-S12: ALL PASS');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
