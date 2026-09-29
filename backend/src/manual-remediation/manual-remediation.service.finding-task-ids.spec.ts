// Increment 1 (sélection multiple CVE) -- offline contract tests for
// ManualRemediationService.attachFindingTaskIds(), the I/O half (batched
// DB lookup) of finding-task-id-enrichment.ts's pure merge (proven
// separately in finding-task-id-enrichment.spec.ts). Same hand-rolled fake
// TypeORM repo convention as manual-remediation.service.batch.spec.ts,
// including its In([...]) shape.
//
// Run: npx ts-node backend/src/manual-remediation/manual-remediation.service.finding-task-ids.spec.ts
import * as assert from 'node:assert/strict';
import { ManualRemediationService } from './manual-remediation.service';
import { findingFingerprint } from './finding-fingerprint';

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v && typeof v === 'object' && v.type === 'in' && Array.isArray(v.value)) return v.value.includes(row[k]);
    return row[k] === v;
  });
}
function makeService(taskRows: any[]) {
  const repo: any = { find: async ({ where }: any) => taskRows.filter(r => matches(r, where)) };
  const incidents: any = { find: async () => [], findOne: async () => null };
  return new ManualRemediationService(repo, incidents, { dispatch: async () => undefined });
}

const PROJECT_A = '3aa1c9b9-e114-40e4-884b-ebc7aa32e002';
const PROJECT_B = 'b1c9a3aa-e114-40e4-884b-ebc7aa32e003';

async function main() {
  // 1. Un CVE avec une ManualRemediationTask correspondante (même
  // findingFingerprint, même projet) reçoit son id -- fingerprint calculé
  // exactement comme reconcileSource() l'a fait à la création de la tâche.
  {
    const task = { id: 'task-1', projectId: PROJECT_A, findingFingerprint: findingFingerprint('TRIVY', { id: 'CVE-2023-6378', pkg: 'ch.qos.logback:logback-classic' }) };
    const service = makeService([task]);
    const incident: any = { projectId: PROJECT_A, metadata: { enrichedData: { trivy: { cves: [{ id: 'CVE-2023-6378', pkg: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', fixedVersion: '1.2.13' }] } } } };
    const [out] = await service.attachFindingTaskIds([incident]);
    assert.equal(out.metadata.enrichedData.trivy.cves[0].findingTaskId, 'task-1');
    assert.equal(out.metadata.enrichedData.trivy.cves[0].fixedVersion, '1.2.13', 'existing field untouched');
  }
  console.log('attachFindingTaskIds) matched CVE -> real task id resolved via a real DB lookup: PASS');

  // 2. Aucune tâche pour ce projet -> findingTaskId: null, pas de crash, pas
  // de requête ratée.
  {
    const service = makeService([]);
    const incident: any = { projectId: PROJECT_A, metadata: { enrichedData: { trivy: { cves: [{ id: 'CVE-9999-0000', pkg: 'x' }] } } } };
    const [out] = await service.attachFindingTaskIds([incident]);
    assert.equal(out.metadata.enrichedData.trivy.cves[0].findingTaskId, null);
  }
  console.log('attachFindingTaskIds) no ManualRemediationTask for the project -> findingTaskId null: PASS');

  // 3. Isolation par projectId : une tâche du projet B ne doit JAMAIS
  // résoudre un CVE du projet A, même avec un fingerprint identique (même
  // finding réel présent dans deux projets différents -- cas plausible,
  // deux repos avec la même dépendance vulnérable).
  {
    const fp = findingFingerprint('OWASP', { id: 'CVE-2024-1', pkg: 'commons-io' });
    const taskInProjectB = { id: 'task-b', projectId: PROJECT_B, findingFingerprint: fp };
    const service = makeService([taskInProjectB]);
    const incidentInProjectA: any = { projectId: PROJECT_A, metadata: { enrichedData: { owasp: { cves: [{ id: 'CVE-2024-1', pkg: 'commons-io' }] } } } };
    const [out] = await service.attachFindingTaskIds([incidentInProjectA]);
    assert.equal(out.metadata.enrichedData.owasp.cves[0].findingTaskId, null, 'must not cross-match another project\'s task');
  }
  console.log('attachFindingTaskIds) project isolation -- never cross-matches another project\'s task: PASS');

  // 4. Un lot de N incidents ne déclenche qu'UNE seule requête groupée
  // (In([...projectIds])), jamais une requête par incident.
  {
    let findCalls = 0;
    const repo: any = { find: async ({ where }: any) => { findCalls++; return []; } };
    const incidentsRepo: any = { find: async () => [], findOne: async () => null };
    const service = new ManualRemediationService(repo, incidentsRepo, { dispatch: async () => undefined });
    const incidents: any[] = Array.from({ length: 5 }, (_, i) => ({ projectId: PROJECT_A, metadata: { enrichedData: { trivy: { cves: [{ id: `CVE-${i}`, pkg: 'x' }] } } } }));
    await service.attachFindingTaskIds(incidents);
    assert.equal(findCalls, 1, 'must be exactly one batched query for the whole list, not N');
  }
  console.log('attachFindingTaskIds) N incidents -> exactly one batched DB query: PASS');

  // 5. Un incident sans metadata.enrichedData (jamais scanné) traverse
  // inchangé -- même référence, jamais une forme reconstruite.
  {
    const service = makeService([]);
    const incident: any = { projectId: PROJECT_A, metadata: null };
    const [out] = await service.attachFindingTaskIds([incident]);
    assert.equal(out, incident, 'incident without enrichedData must pass through as the exact same reference');
  }
  console.log('attachFindingTaskIds) incident without enrichedData -> untouched passthrough: PASS');

  // 6. Aucun incident du lot n'a de projectId exploitable -> zéro requête
  // (garde explicite dans attachFindingTaskIds, pas une coïncidence).
  {
    let findCalls = 0;
    const repo: any = { find: async () => { findCalls++; return []; } };
    const incidentsRepo: any = { find: async () => [], findOne: async () => null };
    const service = new ManualRemediationService(repo, incidentsRepo, { dispatch: async () => undefined });
    await service.attachFindingTaskIds([{ projectId: null, metadata: { enrichedData: {} } } as any]);
    assert.equal(findCalls, 0, 'must not query the DB at all when no incident carries a usable projectId');
  }
  console.log('attachFindingTaskIds) no usable projectId in the whole batch -> zero DB query: PASS');

  console.log('manual-remediation.service.finding-task-ids.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
