// Increment 1 (sélection multiple CVE, cadrage OPTION A) -- proves that
// IncidentsService.findAll()/findOneForClient() actually route their result
// through ManualRemediationService.attachFindingTaskIds() before responding
// (GET /incidents and GET /incidents/:id, the two endpoints that actually
// reach the frontend -- api.getDecisions() in
// project-detail.component.ts::loadReports(), whose metadata.enrichedData
// is what cve-table renders), while the shared internal findOne() helper
// (reused by ~12 other service methods) stays untouched. The enrichment
// logic itself (fingerprint matching, additive-only merge) is proven
// independently in finding-task-id-enrichment.spec.ts and
// manual-remediation.service.finding-task-ids.spec.ts -- this file only
// proves the WIRING, with a spy fake standing in for ManualRemediationService.
//
// Same fake-repo/no-network convention as modify-failed-selection.spec.ts.
//
// Run: npx ts-node backend/src/incidents/finding-task-id-exposure.spec.ts
import * as assert from 'node:assert/strict';
import { IncidentsService } from './incidents.service';

function makeIncident(overrides: any = {}) {
  return { id: 'incident-1', projectId: 'project-1', status: 'pending', metadata: { enrichedData: { trivy: { cves: [{ id: 'CVE-1' }] } } }, ...overrides };
}
function makeService(incidents: any[]) {
  const project = { id: 'project-1', githubRepo: 'owner/repo' };
  const projectRepo = { findOne: async () => project };
  const repository: any = {
    find: async () => incidents,
    findOne: async ({ where }: any) => incidents.find(i => i.id === where.id) || null,
  };
  let attachCalls: any[][] = [];
  const manualRemediation: any = {
    attachFindingTaskIds: async (rows: any[]) => {
      attachCalls.push(rows);
      // Marqueur observable, distinct d'une forme reconstruite par erreur
      // par sanitizeIncident lui-même -- prouve que c'est bien LE retour de
      // attachFindingTaskIds() qui ressort de findAll()/findOne(), pas les
      // incidents sanitizés bruts.
      return rows.map(r => ({ ...r, _wentThroughAttachFindingTaskIds: true }));
    },
  };
  const service = new IncidentsService(repository, projectRepo as any, { emit: () => undefined } as any, manualRemediation, {} as any);
  return { service, attachCalls };
}

async function main() {
  // 1. findAll() passe le résultat par attachFindingTaskIds() et renvoie SON
  // résultat (pas les incidents sanitizés bruts).
  {
    const { service, attachCalls } = makeService([makeIncident()]);
    const result: any[] = await service.findAll('project-1');
    assert.equal(attachCalls.length, 1, 'attachFindingTaskIds must be called exactly once');
    assert.equal(attachCalls[0].length, 1);
    assert.equal(attachCalls[0][0].id, 'incident-1', 'must receive the SANITIZED incident, not the raw repo row');
    assert.equal(result[0]._wentThroughAttachFindingTaskIds, true, 'findAll() must return attachFindingTaskIds\' own result');
  }
  console.log('findAll) routes through ManualRemediationService.attachFindingTaskIds() and returns its result: PASS');

  // 2. findOneForClient() (la route GET /incidents/:id) fait de même.
  {
    const { service, attachCalls } = makeService([makeIncident({ id: 'incident-2' })]);
    const result: any = await service.findOneForClient('incident-2');
    assert.equal(attachCalls.length, 1);
    assert.equal(attachCalls[0][0].id, 'incident-2');
    assert.equal(result._wentThroughAttachFindingTaskIds, true, 'findOneForClient() must return attachFindingTaskIds\' own result');
  }
  console.log('findOneForClient) routes through ManualRemediationService.attachFindingTaskIds() and returns its result: PASS');

  // 3. findOne() elle-même (le helper interne réutilisé par ~12 méthodes du
  // service) reste NON enrichie et ne touche jamais manualRemediation --
  // c'est précisément ce qui évite de casser tout appelant interne dont le
  // fake manualRemediation n'implémente pas attachFindingTaskIds (preuve
  // concrète : voir modify-failed-selection.spec.ts, qui n'a pas eu besoin
  // d'être modifié).
  {
    const { service, attachCalls } = makeService([makeIncident({ id: 'incident-3' })]);
    const result: any = await service.findOne('incident-3');
    assert.equal(attachCalls.length, 0, 'the internal findOne() helper must never call attachFindingTaskIds');
    assert.equal(result._wentThroughAttachFindingTaskIds, undefined);
  }
  console.log('findOne) internal helper stays unenriched, never touches manualRemediation: PASS');

  console.log('finding-task-id-exposure.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
