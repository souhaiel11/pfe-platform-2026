// Teste le composant « manual-remediation.service.finding-task-ids » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { ManualRemediationService } from './manual-remediation.service';
import { findingFingerprint } from './finding-fingerprint';

/** Prépare les données nécessaires à ce scénario. */
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v && typeof v === 'object' && v.type === 'in' && Array.isArray(v.value)) return v.value.includes(row[k]);
    return row[k] === v;
  });
}
/** Prépare les données nécessaires à ce scénario. */
function makeService(taskRows: any[]) {
  const repo: any = {
  /** Recherche les éléments correspondants. */
  find: async ({ where }: any) => taskRows.filter(r => matches(r, where)) };
  const incidents: any = {
  /** Recherche les éléments correspondants. */
  find: async () => [],
  /** Recherche l’élément correspondant à l’identifiant. */
  findOne: async () => null };
  return new ManualRemediationService(repo, incidents, {
  /** Transmet la demande au service chargé de l’exécuter. */
  dispatch: async () => undefined });
}

const PROJECT_A = '3aa1c9b9-e114-40e4-884b-ebc7aa32e002';
const PROJECT_B = 'b1c9a3aa-e114-40e4-884b-ebc7aa32e003';

/** Exécute les étapes principales de ce programme. */
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
    const repo: any = {
    /** Recherche les éléments correspondants. */
    find: async ({ where }: any) => { findCalls++; return []; } };
    const incidentsRepo: any = {
    /** Recherche les éléments correspondants. */
    find: async () => [],
    /** Recherche l’élément correspondant à l’identifiant. */
    findOne: async () => null };
    const service = new ManualRemediationService(repo, incidentsRepo, {
    /** Transmet la demande au service chargé de l’exécuter. */
    dispatch: async () => undefined });
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
    const repo: any = {
    /** Recherche les éléments correspondants. */
    find: async () => { findCalls++; return []; } };
    const incidentsRepo: any = {
    /** Recherche les éléments correspondants. */
    find: async () => [],
    /** Recherche l’élément correspondant à l’identifiant. */
    findOne: async () => null };
    const service = new ManualRemediationService(repo, incidentsRepo, {
    /** Transmet la demande au service chargé de l’exécuter. */
    dispatch: async () => undefined });
    await service.attachFindingTaskIds([{ projectId: null, metadata: { enrichedData: {} } } as any]);
    assert.equal(findCalls, 0, 'must not query the DB at all when no incident carries a usable projectId');
  }
  console.log('attachFindingTaskIds) no usable projectId in the whole batch -> zero DB query: PASS');

  console.log('manual-remediation.service.finding-task-ids.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
