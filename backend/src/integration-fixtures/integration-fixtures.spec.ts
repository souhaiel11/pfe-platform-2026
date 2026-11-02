// Teste le composant « integration-fixtures » et ses cas d’erreur.
import { emptyReservationQuery } from '../incidents/sonar-file-reservation.test-double';
import * as assert from 'node:assert/strict';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Incident } from '../incidents/incident.entity';
import { IncidentsService } from '../incidents/incidents.service';
import { Project } from '../projects/project.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IntegrationFixturesController } from './integration-fixtures.controller';
import { IntegrationFixturesService, Wf2FixtureInput } from './integration-fixtures.service';

const admin = { id: 'fixture-admin', role: 'admin' };

/** Prépare les données nécessaires à ce scénario. */
function harness(environment = 'test', enabled = 'true') {
  const incidents = new Map<string, any>();
  const projects = new Map<string, any>();
  let projectSequence = 0;
  const incidentRepo: any = {
    /** Crée et enregistre un nouvel élément. */
    create: (value: any) => ({ ...value }),
    /** Enregistre les données fournies. */
    save: async (value: any) => { incidents.set(value.id, value); return value; },
    /** Recherche l’élément correspondant à l’identifiant. */
    findOne: async ({ where }: any) => incidents.get(where.id) || null,
    /** Applique les modifications autorisées à l’élément. */
    update: async (id: string, patch: any) => Object.assign(incidents.get(id), patch),
    /** Compte les éléments correspondants. */
    count: async ({ where }: any) => [...incidents.values()].filter(value => value.projectId === where.projectId).length,
    /** Supprime l’élément ciblé et gère ses dépendances. */
    remove: async (value: any) => { incidents.delete(value.id); return value; },
  };
  const projectRepo: any = {
    /** Crée et enregistre un nouvel élément. */
    create: (value: any) => ({ ...value }),
    /** Enregistre les données fournies. */
    save: async (value: any) => { value.id ||= `fixture-project-${++projectSequence}`; projects.set(value.id, value); return value; },
    /** Recherche l’élément correspondant à l’identifiant. */
    findOne: async ({ where }: any) => projects.get(where.id) || null,
    /** Supprime l’élément ciblé et gère ses dépendances. */
    remove: async (value: any) => { projects.delete(value.id); return value; },
  };
  const manager = {
  /** Simule la lecture des données demandées par le composant. */
  query: emptyReservationQuery, getRepository: (entity: any) => entity === Incident ? incidentRepo : projectRepo };
  /** Exécute les opérations dans le cadre transactionnel prévu. */
  const transaction = async (fn: any) => fn(manager);
  incidentRepo.manager = { transaction };
  const config = new ConfigService({ NODE_ENV: environment, INTEGRATION_FIXTURES_ENABLED: enabled });
  const fixtures = new IntegrationFixturesService(incidentRepo, projectRepo, config);
  const lifecycle = new IncidentsService(incidentRepo, projectRepo, {
  /** Diffuse ou construit le résultat prévu. */
  emit: () => undefined } as any,
    {
    /** Prépare les données nécessaires à ce scénario. */
    syncIncident: async () => undefined } as any, {} as any);
  return { fixtures, lifecycle, incidents, projects };
}

/** Prépare les données nécessaires à ce scénario. */
const fixture = (repository: string, buildType: string, finding: any): Wf2FixtureInput => ({
  repository: { fullName: repository, defaultBranch: 'main', buildType }, findings: [finding], buildNumber: 1,
});
/** Simule la lecture des données demandées par le composant. */
const finding = (findingId: string, source: string, category: string, remediationDomain: string, file: string) =>
  ({ findingId, source, category, remediationDomain, file, line: 7, message: 'Synthetic integration finding' });

/** Exécute les étapes principales de ce programme. */
async function main() {
  const h = harness();
  const java = await h.fixtures.provisionWf2Context(fixture('fixture-owner/service-a', 'maven',
    finding('finding-a', 'SAST', 'CODE_QUALITY', 'SOURCE', 'src/main/java/org/example/Service.java')), admin);
  const typescript = await h.fixtures.provisionWf2Context(fixture('another-owner/service-b', 'npm',
    finding('finding-b', 'CODE', 'SECURITY', 'APPLICATION', 'packages/api/src/router.ts')), admin);
  assert.notEqual(java.incidentId, typescript.incidentId);
  assert.notEqual(java.requestId, typescript.requestId);
  assert.notEqual(java.batchId, typescript.batchId);
  assert.equal(h.incidents.get(java.incidentId).metadata.integrationFixture.classification, 'NON_PRODUCTION');
  assert.equal(h.incidents.get(java.incidentId).metadata.integrationFixture.purpose, 'INTEGRATION_TEST');

  const failure: any = {
    status: 'FAILED', workflowId: process.env.N8N_WF2_ID || '9adcV31eaIgJyMR0', executionId: 'fixture-execution-failure',
    incidentId: java.incidentId, requestId: java.requestId, batchId: java.batchId, batchKey: java.batchId,
    attemptCount: 1, failureCode: 'SYNTHETIC_FAILURE', failureSummary: 'Synthetic lifecycle proof', failureNode: 'Synthetic Node',
  };
  const accepted: any = await h.lifecycle.saveWorkflowBatchStatus(java.incidentId, failure);
  assert.equal(accepted.applied, true);
  assert.equal(h.incidents.get(java.incidentId).metadata.fixRequest.status, 'FIX_FAILED');
  await assert.rejects(() => h.lifecycle.saveWorkflowBatchStatus('00000000-0000-4000-8000-000000000000', failure), /Incident introuvable/);

  const successIncident = h.incidents.get(typescript.incidentId);
  const success: any = {
    status: 'PR_CREATED', workflowId: process.env.N8N_WF2_ID || '9adcV31eaIgJyMR0', executionId: 'fixture-execution-success',
    incidentId: typescript.incidentId, requestId: typescript.requestId, batchId: typescript.batchId, batchKey: typescript.batchId,
    attemptCount: 1, completenessPassed: true, processedFindingIds: ['finding-b'], candidateAcceptedFindingIds: ['finding-b'],
    plannedFiles: ['packages/api/src/router.ts'], candidateVerifiedFiles: ['packages/api/src/router.ts'],
    updatedFiles: ['packages/api/src/router.ts'], fileResults: [{ targetFile: 'packages/api/src/router.ts',
      outcome: 'CANDIDATE_ACCEPTABLE_FOR_SCANNER_VALIDATION', candidateStateVerified: true }],
    commitShas: ['1'.repeat(40)], prUrl: 'https://github.com/fixture-owner/service-b/pull/1', prNumber: 1, prHeadSha: '2'.repeat(40),
  };
  const successResult: any = await h.lifecycle.saveWorkflowBatchStatus(typescript.incidentId, success);
  assert.equal(successResult.applied, true);
  assert.equal(successIncident.metadata.fixRequest.status, 'PR_CREATED');

  const unrelated = { id: 'unrelated', projectId: 'unrelated-project', metadata: {} };
  h.incidents.set(unrelated.id, unrelated);
  await assert.rejects(() => h.fixtures.cleanup(java.fixtureId, { id: 'different-admin', role: 'admin' }), /not found/i);
  const removed = await h.fixtures.cleanup(java.fixtureId, admin);
  assert.equal(removed.deleted, true);
  assert.equal(h.incidents.has(java.incidentId), false);
  assert.equal(h.incidents.has(unrelated.id), true);
  assert.equal(h.incidents.has(typescript.incidentId), true);

  await assert.rejects(() => harness('production', 'true').fixtures.provisionWf2Context(
    fixture('owner/repo', 'generic', finding('f', 'CODE', 'OTHER', 'SOURCE', 'src/file.txt')), admin), /unavailable/i);
  await assert.rejects(() => harness('test', 'false').fixtures.provisionWf2Context(
    fixture('owner/repo', 'generic', finding('f', 'CODE', 'OTHER', 'SOURCE', 'src/file.txt')), admin), /unavailable/i);
  await assert.rejects(() => h.fixtures.provisionWf2Context(
    fixture('owner/repo', 'generic', finding('f', 'CODE', 'OTHER', 'SOURCE', 'src/file.txt')), { id: 'dev', role: 'developer' }), /Administrative/);

  const guards = Reflect.getMetadata(GUARDS_METADATA, IntegrationFixturesController) || [];
  assert.ok(guards.includes(JwtAuthGuard), 'fixture controller must require JWT authentication');

  const runtime = `${IntegrationFixturesService.toString()}\n${IntegrationFixturesController.toString()}`;
  for (const forbidden of ['souhaiel11/pfe-app-test', 'TaskController.java', 'TaskDTO.java', 'java:S4684', '1949']) {
    assert.equal(runtime.includes(forbidden), false, `runtime must not contain ${forbidden}`);
  }
  assert.equal(/if\s*\([^)]*(?:java|maven|npm|typescript)/i.test(runtime), false);
  console.log('integration fixture lifecycle contract: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
