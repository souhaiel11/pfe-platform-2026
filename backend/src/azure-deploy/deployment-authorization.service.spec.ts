// Teste le composant « deployment-authorization.service » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { DeploymentAuthorizationService } from './deployment-authorization.service';
import { CRITICAL_OVERRIDE_CONFIRMATION_PHRASE } from './deployment-authorization-policy';
import { resolveBuildIdentity } from './build-identity';
import { Project } from '../projects/project.entity';
import { DeploymentAuthorization } from './deployment-authorization.entity';
import { DeploymentAttempt } from './deployment-attempt.entity';
import { BuildIdentityResolutionResult, SecurityValidationEvidence, ArtifactProvenanceResolutionResult } from './deployment-identity.types';

const SHA_A = 'a'.repeat(40);
const DIGEST_A = `sha256:${'1'.repeat(64)}`;
const DIGEST_B = `sha256:${'2'.repeat(64)}`;

// ── Fakes ──────────────────────────────────────────────────────────────
class FakeGenericRepo {
  rows: any[] = [];
  /** Recherche l’élément correspondant à l’identifiant. */
  async findOne({ where }: any) {
    return this.rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) || null;
  }
  /** Crée et enregistre un nouvel élément. */
  create(partial: any) { return { id: `${this.rows.length + 1}-${Math.random().toString(16).slice(2)}`, createdAt: new Date(), ...partial }; }
  /** Enregistre les données fournies. */
  async save(entity: any) {
    const idx = this.rows.findIndex(r => r.id === entity.id);
    if (idx >= 0) this.rows[idx] = entity; else this.rows.push(entity);
    return entity;
  }
}

// The transaction entry point. manager.transaction() serializes via a
// mutex (simulating pessimistic_write's real serialization), then hands
// the callback a fake manager that routes getRepository() by entity class.
class FakeAuthRepo extends FakeGenericRepo {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(public projectRepo: FakeGenericRepo, public attemptRepo: FakeGenericRepo) { super(); }
  private mutexTail: Promise<void> = Promise.resolve();
  manager = {
    /** Exécute les opérations dans le cadre transactionnel prévu. */
    transaction: async (fn: (m: any) => Promise<any>) => {
      let release!: () => void;
      const prev = this.mutexTail;
      this.mutexTail = new Promise<void>(res => { release = res; });
      await prev;
      try {
        return await fn({
          /** Simule la lecture des données demandées par le composant. */
          getRepository: (cls: any) => {
            if (cls === Project) return this.projectRepo;
            if (cls === DeploymentAttempt) return this.attemptRepo;
            return this; // DeploymentAuthorization
          },
        });
      } finally { release(); }
    },
  };
}
class MutableFakeProjectRepo extends FakeGenericRepo { 
/** Initialise les dépendances et l’état de ce composant. */
constructor(public current: any) { super(); this.rows = [current]; } }
class MutableFakeReportRepo { 
/** Initialise les dépendances et l’état de ce composant. */
constructor(public current: any) {} 
/** Recherche l’élément correspondant à l’identifiant. */
async findOne() { return this.current; } }
class MutableFakeReadiness {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(public current: { buildIdentity: BuildIdentityResolutionResult; validation: SecurityValidationEvidence }) {}
  /** Prépare les données nécessaires à ce scénario. */
  resolveBuildIdentity = async () => this.current;
}
class MutableFakeArtifacts {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(public current: ArtifactProvenanceResolutionResult) {}
  /** Prépare les données nécessaires à ce scénario. */
  resolveProvenDeploymentArtifact = async () => this.current;
}

const okAzureConfig = { provider: 'azure-container-instances', resourceGroup: 'rg-pfe-devsecops', registry: 'acrpfedevsecops', targetName: 'aci-pfe-app-test', region: 'francecentral', imageRepository: 'pfe-app-test' };
const cleanReport = { rawData: { enrichedData: { sonar: { quality_gate: 'OK' }, trivy: { critical: 0 }, owasp: { critical: 0 }, stages: { tests: { stage: 'tests', status: 'PASSED', blocking: false, executed: true, findings: [], findingCount: 0, source: 'JENKINS' } } } } };
const criticalReport = { rawData: { enrichedData: { sonar: { quality_gate: 'ERROR' }, trivy: { critical: 13 }, owasp: { critical: 23 }, stages: { tests: { stage: 'tests', status: 'NOT_RUN', blocking: false, executed: false, findings: [], findingCount: 0, source: 'JENKINS' } } } } };

/** Prépare les données nécessaires à ce scénario. */
function okBuildIdentity(sha = SHA_A, build = 150): BuildIdentityResolutionResult {
  return resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-1', mainBuildNumber: build, sourceCommitSha: sha, repository: 'souhaiel11/pfe-app-test' });
}
// Named `applicableValidation`: the B1-B7/O1-O5/R1-R5 baseline tests are
// about commit/digest/environment/risk-snapshot/reservation BINDING, not
// about validation applicability (that's security-validation-applicability.spec.ts's
// job) — kept APPLICABLE throughout so WF3 is a non-issue in this file.
const applicableValidation: SecurityValidationEvidence = { present: true, validationStatus: 'VALIDATED', passed: true, checkoutSha: SHA_A, validationBuildNumber: 1, expectedPrHeadSha: SHA_A };
/** Prépare les données nécessaires à ce scénario. */
function okArtifact(digest = DIGEST_A): ArtifactProvenanceResolutionResult {
  return { ok: true, commitSha: SHA_A, buildNumber: 150, registry: 'acrpfedevsecops', repository: 'pfe-app-test', tag: '150', digest, provenanceEvidence: {}, failureCode: null };
}

/** Prépare les données nécessaires à ce scénario. */
function makeService(projectOverride?: any) {
  const projectRepo = new MutableFakeProjectRepo(projectOverride ?? { id: 'proj-1', azureConfig: okAzureConfig });
  const attemptRepo = new FakeGenericRepo();
  const authRepo = new FakeAuthRepo(projectRepo, attemptRepo);
  const reportRepo = new MutableFakeReportRepo(cleanReport);
  const readiness = new MutableFakeReadiness({ buildIdentity: okBuildIdentity(), validation: applicableValidation });
  const artifacts = new MutableFakeArtifacts(okArtifact());
  const svc = new DeploymentAuthorizationService(authRepo as any, projectRepo as any, reportRepo as any, attemptRepo as any, readiness as any, artifacts as any);
  return { svc, authRepo, projectRepo, attemptRepo, reportRepo, readiness, artifacts };
}

let reqCounter = 0;
/** Prépare les données nécessaires à ce scénario. */
const nextReq = () => `req-${++reqCounter}`;
const actor = { actorUserId: 'u1', actorRole: 'developer' };

/** Exécute les étapes principales de ce programme. */
async function main() {
  // ── B1-B7 — binding ────────────────────────────────────────────────
  {
    const { svc } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    assert.equal(created.ok, true);
    const consumed = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: nextReq(), ...actor });
    assert.equal(consumed.ok, true);
    console.log('B1 exact commit/digest/environment -> usable: PASS');
  }
  {
    const { svc, readiness } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    readiness.current = { buildIdentity: okBuildIdentity('b'.repeat(40)), validation: applicableValidation };
    const consumed = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: nextReq(), ...actor });
    assert.equal(consumed.ok, false);
    assert.equal(consumed.failureCode, 'DEPLOY_AUTHORIZATION_IDENTITY_CHANGED');
    console.log('B2 commit changes -> denied: PASS');
  }
  {
    const { svc, artifacts } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    artifacts.current = okArtifact(DIGEST_B);
    const consumed = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: nextReq(), ...actor });
    assert.equal(consumed.ok, false);
    assert.equal(consumed.failureCode, 'DEPLOY_AUTHORIZATION_IDENTITY_CHANGED');
    console.log('B3 digest changes -> denied: PASS');
  }
  {
    const { svc, artifacts } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    artifacts.current = { ...okArtifact(), digest: DIGEST_B };
    const consumed = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: nextReq(), ...actor });
    assert.equal(consumed.ok, false);
    assert.equal(consumed.failureCode, 'DEPLOY_AUTHORIZATION_IDENTITY_CHANGED');
    console.log('B4 tag moves -> denied: PASS');
  }
  {
    const { svc, projectRepo } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    projectRepo.current = { id: 'proj-1', azureConfig: { ...okAzureConfig, resourceGroup: 'rg-other' } };
    projectRepo.rows = [projectRepo.current];
    const consumed = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: nextReq(), ...actor });
    assert.equal(consumed.ok, false);
    assert.equal(consumed.failureCode, 'DEPLOY_AUTHORIZATION_IDENTITY_CHANGED');
    console.log('B5 environment changes -> denied: PASS');
  }
  {
    const { svc, reportRepo } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    assert.equal(created.governanceClass, 'READY');
    reportRepo.current = criticalReport;
    const consumed = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: nextReq(), ...actor });
    assert.equal(consumed.ok, false);
    assert.equal(consumed.failureCode, 'DEPLOY_AUTHORIZATION_RISK_CHANGED');
    console.log('B6 risk snapshot changes -> denied: PASS');
  }
  {
    const { svc, authRepo } = makeService();
    const row = authRepo.create({
      projectId: 'proj-1', incidentId: 'inc-1', mainBuildNumber: 150, commitSha: SHA_A, artifactDigest: DIGEST_A,
      artifactTag: '150', registry: 'acrpfedevsecops', repository: 'pfe-app-test', environmentIdentityHash: 'x',
      decisionAtAuthorization: 'READY', securityValidationApplicability: 'MISSING', riskSnapshot: {}, failedControls: [], warnings: [],
      requestedByUserId: 'u1', requestedByRole: 'developer', authorizationMode: 'NORMAL', reason: null, acknowledgements: null,
      authorizationIdentityHash: 'y', status: 'CREATED', expiresAt: new Date(Date.now() - 60_000),
    });
    await authRepo.save(row);
    const consumed = await svc.reserveAndConsumeAuthorization({ authorizationId: row.id, requestId: nextReq(), ...actor });
    assert.equal(consumed.ok, false);
    assert.equal(consumed.failureCode, 'DEPLOY_AUTHORIZATION_EXPIRED');
    console.log('B7 expired authorization -> denied: PASS');
  }

  // ── O1-O5 — one-time use ─────────────────────────────────────────────
  {
    const { svc } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    const first = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: nextReq(), ...actor });
    assert.equal(first.ok, true);
    console.log('O1 first consumption -> succeeds: PASS');
    const second = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: nextReq(), ...actor });
    assert.equal(second.ok, false);
    assert.equal(second.failureCode, 'DEPLOY_AUTHORIZATION_CONSUMED');
    console.log('O2 second consumption same authorization -> denied: PASS');
  }
  {
    const { svc } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    const reqA = nextReq(), reqB = nextReq();
    const [r1, r2] = await Promise.all([
      svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: reqA, ...actor }),
      svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: reqB, ...actor }),
    ]);
    const successes = [r1, r2].filter(r => r.ok && !r.duplicate).length;
    assert.equal(successes, 1);
    console.log('O3 two concurrent consumers -> exactly one succeeds: PASS');
  }
  {
    const { svc, authRepo } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    const row = authRepo.rows.find(r => r.id === created.authorization!.id);
    row.status = 'REVOKED';
    const consumed = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: nextReq(), ...actor });
    assert.equal(consumed.ok, false);
    assert.equal(consumed.failureCode, 'DEPLOY_AUTHORIZATION_REVOKED');
    console.log('O4 revoked authorization -> denied: PASS');
  }
  {
    const { svc, authRepo } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    const row = authRepo.rows.find(r => r.id === created.authorization!.id);
    row.expiresAt = new Date(Date.now() - 1000);
    const consumed = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: nextReq(), ...actor });
    assert.equal(consumed.ok, false);
    assert.equal(consumed.failureCode, 'DEPLOY_AUTHORIZATION_EXPIRED');
    console.log('O5 expired authorization -> denied: PASS');
  }

  // ── R1-R5 — reservation/consumption timing (§16, plus §5's 3 scenarios) ──
  {
    // R1 — invalid/expired authorization -> not consumed (status stays EXPIRED, never CONSUMED)
    const { svc, authRepo } = makeService();
    const row = authRepo.create({
      projectId: 'proj-1', incidentId: 'inc-1', mainBuildNumber: 150, commitSha: SHA_A, artifactDigest: DIGEST_A,
      artifactTag: '150', registry: 'acrpfedevsecops', repository: 'pfe-app-test', environmentIdentityHash: 'x',
      decisionAtAuthorization: 'READY', securityValidationApplicability: 'MISSING', riskSnapshot: {}, failedControls: [], warnings: [],
      requestedByUserId: 'u1', requestedByRole: 'developer', authorizationMode: 'NORMAL', reason: null, acknowledgements: null,
      authorizationIdentityHash: 'y', status: 'CREATED', expiresAt: new Date(Date.now() - 1000),
    });
    await authRepo.save(row);
    await svc.reserveAndConsumeAuthorization({ authorizationId: row.id, requestId: nextReq(), ...actor });
    const after = authRepo.rows.find(r => r.id === row.id);
    assert.equal(after.status, 'EXPIRED');
    assert.notEqual(after.status, 'CONSUMED');
    console.log('R1 invalid/expired authorization -> not consumed: PASS');
  }
  {
    // R2 — project already deploying (different requestId, DISPATCHING) -> authorization remains CREATED
    const { svc, authRepo, projectRepo } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    projectRepo.current.azureDeploymentState = { requestId: 'unrelated-req', status: 'DISPATCHING', imageTag: 'x', updatedAt: new Date().toISOString() };
    const consumed = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: nextReq(), ...actor });
    assert.equal(consumed.ok, false);
    assert.equal(consumed.failureCode, 'DEPLOY_DEPLOYMENT_IN_PROGRESS');
    const after = authRepo.rows.find(r => r.id === created.authorization!.id);
    assert.equal(after.status, 'CREATED');
    console.log('R2 project already deploying -> authorization remains CREATED: PASS');
  }
  {
    // R3 — snapshot drift -> authorization remains CREATED, never falsely CONSUMED
    const { svc, authRepo, artifacts } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    artifacts.current = okArtifact(DIGEST_B);
    const consumed = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: nextReq(), ...actor });
    assert.equal(consumed.ok, false);
    const after = authRepo.rows.find(r => r.id === created.authorization!.id);
    assert.equal(after.status, 'CREATED');
    console.log('R3 snapshot drift -> authorization remains CREATED, never falsely CONSUMED: PASS');
  }
  {
    // R4 — successful reservation -> authorization CONSUMED exactly once, attempt+Project reservation exist
    const { svc, authRepo, projectRepo, attemptRepo } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    const reqId = nextReq();
    const consumed = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: reqId, ...actor });
    assert.equal(consumed.ok, true);
    const after = authRepo.rows.find(r => r.id === created.authorization!.id);
    assert.equal(after.status, 'CONSUMED');
    assert.equal(projectRepo.current.azureDeploymentState.requestId, reqId);
    assert.equal(attemptRepo.rows.length, 1);
    assert.equal(attemptRepo.rows[0].authorizationId, created.authorization!.id);
    console.log('R4 successful reservation -> authorization CONSUMED exactly once: PASS');
  }
  {
    // R5 — §16: a legitimate dispatch was reserved; the SERVICE layer's
    // job ends at reservation. The controller (azure-deploy.module.ts)
    // is what marks the DeploymentAttempt FAILED if the agent call later
    // throws -- simulated here directly on the already-reserved attempt
    // row, proving the authorization itself is untouched by that outcome.
    const { svc, authRepo, attemptRepo } = makeService();
    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    const consumed = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: nextReq(), ...actor });
    assert.equal(consumed.ok, true);
    const attempt = attemptRepo.rows[0];
    attempt.dispatchStatus = 'FAILED'; attempt.completedAt = new Date();
    await attemptRepo.save(attempt);
    const afterAuth = authRepo.rows.find(r => r.id === created.authorization!.id);
    assert.equal(afterAuth.status, 'CONSUMED');
    assert.equal(attemptRepo.rows[0].dispatchStatus, 'FAILED');
    console.log('R5 agent later fails -> authorization remains CONSUMED, DeploymentAttempt records FAILED: PASS');
  }
  {
    // §5 scenario 3 — same requestId + a DIFFERENT (still-CREATED)
    // authorization -> must not create a duplicate deployment. First
    // authorization consumes requestId X normally; a second, unrelated
    // authorization attempted with the SAME requestId X must return
    // duplicate:true and leave the second authorization CREATED (never
    // consumed, never double-dispatched).
    const { svc, authRepo, projectRepo } = makeService();
    const first = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    const sharedReqId = nextReq();
    const firstConsume = await svc.reserveAndConsumeAuthorization({ authorizationId: first.authorization!.id, requestId: sharedReqId, ...actor });
    assert.equal(firstConsume.ok, true);
    // Reset azureDeploymentState's status to DEPLOYED (as the controller
    // would after a successful agent call) so the SECOND call's
    // DISPATCHING-in-progress check doesn't fire for an unrelated reason.
    projectRepo.current.azureDeploymentState.status = 'DEPLOYED';
    const second = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    const secondConsume = await svc.reserveAndConsumeAuthorization({ authorizationId: second.authorization!.id, requestId: sharedReqId, ...actor });
    assert.equal(secondConsume.ok, true);
    assert.equal(secondConsume.duplicate, true);
    const secondRow = authRepo.rows.find(r => r.id === second.authorization!.id);
    assert.equal(secondRow.status, 'CREATED', 'a different authorization colliding on requestId must remain CREATED, never consumed');
    console.log('§5 same requestId + different authorization -> no duplicate deployment, second authorization left CREATED: PASS');
  }

  // ── §31 — real build #150 authorization fixture ─────────────────────
  {
    const REAL_SHA = '7ae0f954f99628b69ce9b42f42c1e2acc8568d99';
    const REAL_DIGEST = 'sha256:2027f8ed1c023e8d34e30e5848a3ed780831b8e52945543bd00f7c3ed521718d';
    const realBuildIdentity = resolveBuildIdentity({ projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', incidentId: 'a657d5ae-fbe0-47cb-b954-451bd81636aa', mainBuildNumber: 150, sourceCommitSha: REAL_SHA, repository: 'souhaiel11/pfe-app-test' });
    const realArtifact: ArtifactProvenanceResolutionResult = { ok: true, commitSha: REAL_SHA, buildNumber: 150, registry: 'acrpfedevsecops', repository: 'pfe-app-test', tag: '150', digest: REAL_DIGEST, provenanceEvidence: {}, failureCode: null };

    /** Prépare les données nécessaires à ce scénario. */
    function makeReal150Service() {
      const projectRepo = new MutableFakeProjectRepo({ id: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', azureConfig: okAzureConfig });
      const attemptRepo = new FakeGenericRepo();
      const authRepo = new FakeAuthRepo(projectRepo, attemptRepo);
      const reportRepo = new MutableFakeReportRepo(criticalReport);
      const readiness = new MutableFakeReadiness({ buildIdentity: realBuildIdentity, validation: { present: false, validationStatus: null, passed: null, checkoutSha: null, validationBuildNumber: null, expectedPrHeadSha: null } });
      const artifacts = new MutableFakeArtifacts(realArtifact);
      return new DeploymentAuthorizationService(authRepo as any, projectRepo as any, reportRepo as any, attemptRepo as any, readiness as any, artifacts as any);
    }

    {
      const svc = makeReal150Service();
      const r = await svc.createAuthorization({
        projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', mode: 'CRITICAL_OVERRIDE', reason: 'ship despite known risk, approved verbally',
        acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
        confirmationPhrase: CRITICAL_OVERRIDE_CONFIRMATION_PHRASE, requestedByUserId: 'u-dev', requestedByRole: 'developer',
      });
      assert.equal(r.ok, false);
      assert.equal(r.failureCode, 'DEPLOY_AUTHORIZATION_ROLE_FORBIDDEN');
      assert.equal(r.governanceClass, 'CRITICAL_RISK');
      console.log('REAL_150 as DEVELOPER: critical override denied: PASS');
    }
    {
      const svc = makeReal150Service();
      const r = await svc.createAuthorization({
        projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', mode: 'CRITICAL_OVERRIDE', reason: 'ship despite known risk, approved verbally',
        acknowledgements: { criticalRiskAccepted: true }, confirmationPhrase: CRITICAL_OVERRIDE_CONFIRMATION_PHRASE,
        requestedByUserId: 'u-admin', requestedByRole: 'admin',
      });
      assert.equal(r.ok, false);
      assert.equal(r.failureCode, 'DEPLOY_AUTHORIZATION_ACKNOWLEDGEMENT_MISSING');
      console.log('REAL_150 as ADMIN without full acknowledgement: denied: PASS');
    }
    {
      const svc = makeReal150Service();
      const r = await svc.createAuthorization({
        projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', mode: 'CRITICAL_OVERRIDE', reason: 'ship despite known risk, approved verbally',
        acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
        confirmationPhrase: CRITICAL_OVERRIDE_CONFIRMATION_PHRASE, requestedByUserId: 'u-admin', requestedByRole: 'admin',
      });
      assert.equal(r.ok, true);
      assert.equal(r.governanceClass, 'CRITICAL_RISK');
      assert.equal(r.authorization!.commitSha, REAL_SHA);
      assert.equal(r.authorization!.artifactDigest, REAL_DIGEST);
      console.log(`REAL_150 as ADMIN with complete acknowledgements: authorization CREATED offline (id=${r.authorization!.id}, class=${r.governanceClass}, digest=${r.authorization!.artifactDigest}): PASS`);
    }
  }

  console.log('deployment-authorization.service.spec: ALL PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
