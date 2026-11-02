// Teste les garanties transactionnelles de consommation d'autorisation et de réservation de déploiement avec la base réelle.
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Project } from '../src/projects/project.entity';
import { Incident, IncidentStatus } from '../src/incidents/incident.entity';
import { Report } from '../src/reports/report.entity';
import { DeploymentArtifact } from '../src/azure-deploy/deployment-artifact.entity';
import { DeploymentAuthorization } from '../src/azure-deploy/deployment-authorization.entity';
import { DeploymentAttempt } from '../src/azure-deploy/deployment-attempt.entity';
import { AzureDeployReadinessService } from '../src/azure-deploy/azure-deploy-readiness.service';
import { DeploymentArtifactService } from '../src/azure-deploy/deployment-artifact.service';
import { DeploymentAuthorizationService } from '../src/azure-deploy/deployment-authorization.service';

const SHA = '7ae0f954f99628b69ce9b42f42c1e2acc8568d99';
const OTHER_DIGEST = 'sha256:' + '1'.repeat(64);

/** Exécute les étapes principales de ce programme. */
async function main() {
  const ds = new DataSource({
    type: 'postgres',
    host: 'localhost', port: Number(process.env.TEST_POSTGRES_PORT) || 15555, username: 'testuser', password: 'testpass', database: 'testdb',
    entities: [Project, Incident, Report, DeploymentArtifact, DeploymentAuthorization, DeploymentAttempt],
    synchronize: false,
  });
  await ds.initialize();

  const projectRepo = ds.getRepository(Project);
  const incidentRepo = ds.getRepository(Incident);
  const reportRepo = ds.getRepository(Report);
  const artifactRepo = ds.getRepository(DeploymentArtifact);
  const authRepo = ds.getRepository(DeploymentAuthorization);
  const attemptRepo = ds.getRepository(DeploymentAttempt);

  const readiness = new AzureDeployReadinessService(reportRepo as any, projectRepo as any, incidentRepo as any);
  const artifacts = new DeploymentArtifactService(artifactRepo as any, projectRepo as any, readiness);
  const authService = new DeploymentAuthorizationService(authRepo as any, projectRepo as any, reportRepo as any, attemptRepo as any, readiness, artifacts);

  /** Prépare le résultat lié à empreinte pour donnée de test. */
  function digestForFixture(suffix: string): string {
    return 'sha256:' + createHash('sha256').update(`phase2b22-${suffix}`).digest('hex');
  }

  /** Insère les données nécessaires au scénario d’intégration. */
  async function seedFixture(suffix: string) {
    const project = await projectRepo.save(projectRepo.create({
      name: `phase2b22-${suffix}`,
      githubRepo: 'souhaiel11/pfe-app-test',
      azureConfig: {
        provider: 'azure-container-instances', resourceGroup: 'rg-phase2b22-test',
        targetName: `aci-${suffix}`, registry: 'acrpfedevsecops', imageRepository: 'pfe-app-test', region: 'francecentral',
      },
    }));
    const incident = await incidentRepo.save(incidentRepo.create({
      projectId: project.id, title: `build 150 (${suffix})`, status: IncidentStatus.COMPLETED,
      buildNumber: 150, metadata: { sourceCommitSha: SHA },
    }));
    await artifactRepo.save(artifactRepo.create({
      projectId: project.id, buildNumber: 150, commitSha: SHA,
      registry: 'acrpfedevsecops', repository: 'pfe-app-test', tag: '150', digest: digestForFixture(suffix),
      source: 'MANUAL_REGISTERED', provenanceVerified: true,
    }));
    return { project, incident };
  }

  const ADMIN_INPUT_BASE = {
    mode: 'CRITICAL_OVERRIDE' as const,
    reason: 'Déploiement critique autorisé pour test intégration réel.',
    acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
    confirmationPhrase: 'DEPLOYER MALGRÉ LES RISQUES',
    requestedByUserId: 'admin-1', requestedByRole: 'admin',
  };

  // ── §8 — REAL Postgres concurrency: two independent concurrent
  // transactions racing on the SAME authorizationId. ───────────────────
  {
    const { project } = await seedFixture('concurrency');
    const created = await authService.createAuthorization({ ...ADMIN_INPUT_BASE, projectId: project.id });
    assert.equal(created.ok, true, 'createAuthorization should succeed');
    assert.equal(created.governanceClass, 'CRITICAL_RISK', 'real #150-style fixture must classify CRITICAL_RISK');
    const authorizationId = created.authorization!.id;

    const [r1, r2] = await Promise.all([
      authService.reserveAndConsumeAuthorization({ authorizationId, requestId: 'req-A', actorUserId: 'admin-1', actorRole: 'admin' }),
      authService.reserveAndConsumeAuthorization({ authorizationId, requestId: 'req-B', actorUserId: 'admin-1', actorRole: 'admin' }),
    ]);
    const results = [r1, r2];
    const winners = results.filter(r => r.ok && r.attempt);
    const losers = results.filter(r => !r.ok);
    assert.equal(winners.length, 1, 'exactly one concurrent reservation must win');
    assert.equal(losers.length, 1, 'exactly one concurrent reservation must be denied');
    assert.equal(losers[0].failureCode, 'DEPLOY_AUTHORIZATION_CONSUMED', 'loser must see a deterministic already-consumed denial');

    const authAfter = await authRepo.findOne({ where: { id: authorizationId } });
    assert.equal(authAfter!.status, 'CONSUMED');
    const attemptCount = await attemptRepo.count({ where: { authorizationId } });
    assert.equal(attemptCount, 1, 'exactly one DeploymentAttempt row for this authorization');
    console.log('APPLICATION_POSTGRES_CONCURRENCY_PASS = YES (real two-transaction race, exactly one winner)');
  }

  // ── §9 — project already deploying ("different, unrelated deployment
  // already in flight") denies a second authorization's reservation. ──
  {
    const { project } = await seedFixture('alreadydeploying');
    const auth1 = await authService.createAuthorization({ ...ADMIN_INPUT_BASE, projectId: project.id });
    const r1 = await authService.reserveAndConsumeAuthorization({ authorizationId: auth1.authorization!.id, requestId: 'req-1', actorUserId: 'admin-1', actorRole: 'admin' });
    assert.equal(r1.ok, true, 'first reservation must succeed');

    const auth2 = await authService.createAuthorization({ ...ADMIN_INPUT_BASE, projectId: project.id });
    const r2 = await authService.reserveAndConsumeAuthorization({ authorizationId: auth2.authorization!.id, requestId: 'req-2', actorUserId: 'admin-1', actorRole: 'admin' });
    assert.equal(r2.ok, false);
    assert.equal(r2.failureCode, 'DEPLOY_DEPLOYMENT_IN_PROGRESS');

    const auth2After = await authRepo.findOne({ where: { id: auth2.authorization!.id } });
    assert.equal(auth2After!.status, 'CREATED', 'second authorization must remain CREATED, never consumed');
    const attempt2Count = await attemptRepo.count({ where: { authorizationId: auth2.authorization!.id } });
    assert.equal(attempt2Count, 0, 'no DeploymentAttempt for the denied second authorization');
    console.log('PROJECT_ALREADY_DEPLOYING_TEST_PASS = YES');
  }

  // ── §10 — snapshot drift: artifact digest changes after authorization
  // was CREATED (TOCTOU-style identity drift) -> must deny, not consume. ─
  {
    const { project } = await seedFixture('drift');
    const auth1 = await authService.createAuthorization({ ...ADMIN_INPUT_BASE, projectId: project.id });
    assert.equal(auth1.ok, true);

    // Mutate the underlying artifact record AFTER authorization — the
    // fresh recompute inside reserveAndConsumeAuthorization must see this.
    await artifactRepo.update({ projectId: project.id, buildNumber: 150 }, { digest: OTHER_DIGEST });

    const r = await authService.reserveAndConsumeAuthorization({ authorizationId: auth1.authorization!.id, requestId: 'req-drift', actorUserId: 'admin-1', actorRole: 'admin' });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_AUTHORIZATION_IDENTITY_CHANGED');

    const authAfter = await authRepo.findOne({ where: { id: auth1.authorization!.id } });
    assert.equal(authAfter!.status, 'CREATED', 'drifted authorization must remain CREATED, never consumed');
    const projectAfter = await projectRepo.findOne({ where: { id: project.id } });
    assert.equal(projectAfter!.azureDeploymentState, null, 'project must not be reserved on drift denial');
    const attemptCount = await attemptRepo.count({ where: { authorizationId: auth1.authorization!.id } });
    assert.equal(attemptCount, 0);
    console.log('SNAPSHOT_DRIFT_TEST_PASS = YES');
  }

  // ── §11 — requestId vs authorizationId semantics (2B.2.1's documented
  // contract), proven against the real service + real DB. ─────────────
  {
    const { project } = await seedFixture('requestid');
    const auth1 = await authService.createAuthorization({ ...ADMIN_INPUT_BASE, projectId: project.id });
    const r1 = await authService.reserveAndConsumeAuthorization({ authorizationId: auth1.authorization!.id, requestId: 'req-X', actorUserId: 'admin-1', actorRole: 'admin' });
    assert.equal(r1.ok, true, 'auth1 + requestId X must consume for real');

    // (a) a DIFFERENT, still-CREATED authorization for the SAME project,
    // retried with the SAME requestId X that already reserved the
    // project -> duplicate passthrough, never a second reservation/attempt,
    // and auth2 itself is left untouched (still CREATED).
    const auth2 = await authService.createAuthorization({ ...ADMIN_INPUT_BASE, projectId: project.id });
    const r2 = await authService.reserveAndConsumeAuthorization({ authorizationId: auth2.authorization!.id, requestId: 'req-X', actorUserId: 'admin-1', actorRole: 'admin' });
    assert.equal(r2.ok, true);
    assert.equal(r2.duplicate, true, 'same requestId on a different authorization must be a duplicate passthrough');
    const auth2After = await authRepo.findOne({ where: { id: auth2.authorization!.id } });
    assert.equal(auth2After!.status, 'CREATED', 'duplicate-requestId authorization must remain CREATED, never consumed');
    assert.equal(await attemptRepo.count({ where: { authorizationId: auth2.authorization!.id } }), 0, 'no attempt for the duplicate-requestId authorization');

    // (b) retrying the EXACT same call (auth1, requestId X again) ->
    // authorizationId status is checked FIRST: already CONSUMED, denied
    // outright. This is the real, exact code behavior (status check
    // precedes the requestId dedupe check) -- not a soft idempotent replay.
    const r3 = await authService.reserveAndConsumeAuthorization({ authorizationId: auth1.authorization!.id, requestId: 'req-X', actorUserId: 'admin-1', actorRole: 'admin' });
    assert.equal(r3.ok, false);
    assert.equal(r3.failureCode, 'DEPLOY_AUTHORIZATION_CONSUMED');

    // (c) same authorizationId (auth1, CONSUMED), a DIFFERENT requestId Y
    // -> still denied on authorizationId status alone, before requestId
    // is even inspected -- proves authorizationId is authoritative over
    // requestId, not the other way round.
    const r4 = await authService.reserveAndConsumeAuthorization({ authorizationId: auth1.authorization!.id, requestId: 'req-Y', actorUserId: 'admin-1', actorRole: 'admin' });
    assert.equal(r4.ok, false);
    assert.equal(r4.failureCode, 'DEPLOY_AUTHORIZATION_CONSUMED');

    assert.equal(await attemptRepo.count({ where: { authorizationId: auth1.authorization!.id } }), 1, 'auth1 must have exactly one attempt total, regardless of retries');
    console.log('REQUEST_ID_INTEGRATION_TESTS_PASS = YES');
  }

  await ds.destroy();
  console.log('phase2b22-integration-test: ALL PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
