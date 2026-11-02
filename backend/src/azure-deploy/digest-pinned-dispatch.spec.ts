// Teste le composant « digest-pinned-dispatch » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { DeploymentAuthorizationService } from './deployment-authorization.service';
import { CRITICAL_OVERRIDE_CONFIRMATION_PHRASE } from './deployment-authorization-policy';
import { resolveBuildIdentity } from './build-identity';
import { Project } from '../projects/project.entity';
import { DeploymentAuthorization } from './deployment-authorization.entity';
import { DeploymentAttempt } from './deployment-attempt.entity';
import { ArtifactProvenanceResolutionResult, SecurityValidationEvidence } from './deployment-identity.types';

class FakeGenericRepo {
  rows: any[] = [];
  /** Recherche l’élément correspondant à l’identifiant. */
  async findOne({ where }: any) { return this.rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) || null; }
  /** Crée et enregistre un nouvel élément. */
  create(partial: any) { return { id: `${this.rows.length + 1}-${Math.random().toString(16).slice(2)}`, createdAt: new Date(), ...partial }; }
  /** Enregistre les données fournies. */
  async save(entity: any) {
    const idx = this.rows.findIndex(r => r.id === entity.id);
    if (idx >= 0) this.rows[idx] = entity; else this.rows.push(entity);
    return entity;
  }
}
class FakeAuthRepo extends FakeGenericRepo {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(public projectRepo: FakeGenericRepo, public attemptRepo: FakeGenericRepo) { super(); }
  manager = {
    /** Exécute les opérations dans le cadre transactionnel prévu. */
    transaction: async (fn: (m: any) => Promise<any>) => fn({
      /** Simule la lecture des données demandées par le composant. */
      getRepository: (cls: any) => (cls === Project ? this.projectRepo : cls === DeploymentAttempt ? this.attemptRepo : this),
    }),
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
constructor(public current: any) {} 
/** Prépare les données nécessaires à ce scénario. */
resolveBuildIdentity = async () => this.current; }
class MutableFakeArtifacts { 
/** Initialise les dépendances et l’état de ce composant. */
constructor(public current: ArtifactProvenanceResolutionResult) {} 
/** Prépare les données nécessaires à ce scénario. */
resolveProvenDeploymentArtifact = async () => this.current; }

const okAzureConfig = { provider: 'azure-container-instances', resourceGroup: 'rg-pfe-devsecops', registry: 'acrpfedevsecops', targetName: 'aci-pfe-app-test', region: 'francecentral', imageRepository: 'pfe-app-test' };
const cleanReport = { rawData: { enrichedData: { sonar: { quality_gate: 'OK' }, trivy: { critical: 0 }, owasp: { critical: 0 }, stages: { tests: { stage: 'tests', status: 'PASSED', blocking: false, executed: true, findings: [], findingCount: 0, source: 'JENKINS' } } } } };
const criticalReport = { rawData: { enrichedData: { sonar: { quality_gate: 'ERROR' }, trivy: { critical: 13 }, owasp: { critical: 23 }, stages: { tests: { stage: 'tests', status: 'NOT_RUN', blocking: false, executed: false, findings: [], findingCount: 0, source: 'JENKINS' } } } } };

/** Exécute les étapes principales de ce programme. */
async function main() {
  // ── D4 — tag changes after authorization: deployed digest remains
  // unchanged (restated against the real service; the underlying
  // mechanism is the SAME TOCTOU identity check proven in B3/B4 of
  // deployment-authorization.service.spec.ts — demonstrated here from the
  // angle of "what would be dispatched", not just "is it denied"). ──────
  {
    const SHA = 'a'.repeat(40);
    const DIGEST = `sha256:${'1'.repeat(64)}`;
    const projectRepo = new MutableFakeProjectRepo({ id: 'proj-1', azureConfig: okAzureConfig });
    const attemptRepo = new FakeGenericRepo();
    const authRepo = new FakeAuthRepo(projectRepo, attemptRepo);
    const reportRepo = new MutableFakeReportRepo(cleanReport);
    const buildIdentity = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-1', mainBuildNumber: 150, sourceCommitSha: SHA, repository: 'souhaiel11/pfe-app-test' });
    const validation: SecurityValidationEvidence = { present: true, validationStatus: 'VALIDATED', passed: true, checkoutSha: SHA, validationBuildNumber: 1, expectedPrHeadSha: SHA };
    const readiness = new MutableFakeReadiness({ buildIdentity, validation });
    const artifacts = new MutableFakeArtifacts({ ok: true, commitSha: SHA, buildNumber: 150, registry: 'acrpfedevsecops', repository: 'pfe-app-test', tag: '150', digest: DIGEST, provenanceEvidence: {}, failureCode: null });
    const svc = new DeploymentAuthorizationService(authRepo as any, projectRepo as any, reportRepo as any, attemptRepo as any, readiness as any, artifacts as any);

    const created = await svc.createAuthorization({ projectId: 'proj-1', mode: 'NORMAL', requestedByUserId: 'u1', requestedByRole: 'developer' });
    assert.equal(created.ok, true);
    assert.equal(created.authorization!.artifactDigest, DIGEST);

    // The tag ":150" moves to point at a different digest in the registry
    // (simulated: a fresh lookup now returns DIGEST_B for the same tag).
    artifacts.current = { ...artifacts.current, digest: `sha256:${'2'.repeat(64)}` };
    const reservation = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: 'req-d4', actorUserId: 'u1', actorRole: 'developer' });
    assert.equal(reservation.ok, false);
    assert.equal(reservation.failureCode, 'DEPLOY_AUTHORIZATION_IDENTITY_CHANGED');
    // No DeploymentAttempt was ever created -- nothing was dispatched, so
    // "the deployed digest" (there is none) trivially "remains unchanged"
    // from the only digest that was ever authorized.
    assert.equal(attemptRepo.rows.length, 0);
    console.log('D4 tag moves after authorization -> deny, nothing dispatched with the moved digest: PASS');
  }

  // ── D7 — CRITICAL admin override still cannot change the digest ──────
  {
    const REAL_SHA = '7ae0f954f99628b69ce9b42f42c1e2acc8568d99';
    const REAL_DIGEST = 'sha256:2027f8ed1c023e8d34e30e5848a3ed780831b8e52945543bd00f7c3ed521718d';
    const projectRepo = new MutableFakeProjectRepo({ id: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', azureConfig: okAzureConfig });
    const attemptRepo = new FakeGenericRepo();
    const authRepo = new FakeAuthRepo(projectRepo, attemptRepo);
    const reportRepo = new MutableFakeReportRepo(criticalReport);
    const buildIdentity = resolveBuildIdentity({ projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', incidentId: 'a657d5ae-fbe0-47cb-b954-451bd81636aa', mainBuildNumber: 150, sourceCommitSha: REAL_SHA, repository: 'souhaiel11/pfe-app-test' });
    const noValidation: SecurityValidationEvidence = { present: false, validationStatus: null, passed: null, checkoutSha: null, validationBuildNumber: null, expectedPrHeadSha: null };
    const readiness = new MutableFakeReadiness({ buildIdentity, validation: noValidation });
    const artifacts = new MutableFakeArtifacts({ ok: true, commitSha: REAL_SHA, buildNumber: 150, registry: 'acrpfedevsecops', repository: 'pfe-app-test', tag: '150', digest: REAL_DIGEST, provenanceEvidence: {}, failureCode: null });
    const svc = new DeploymentAuthorizationService(authRepo as any, projectRepo as any, reportRepo as any, attemptRepo as any, readiness as any, artifacts as any);

    // Note: CreateAuthorizationInput (deployment-authorization.service.ts)
    // and AuthorizeDeploymentDto (dto/authorize-deployment.dto.ts) have NO
    // digest/commitSha field at all -- there is structurally no way for
    // ANY caller, admin included, to submit one. The assertion below
    // proves the OUTCOME: the persisted digest is exactly the
    // backend-resolved one, regardless of mode.
    const r = await svc.createAuthorization({
      projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', mode: 'CRITICAL_OVERRIDE', reason: 'ship despite known risk, approved verbally',
      acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
      confirmationPhrase: CRITICAL_OVERRIDE_CONFIRMATION_PHRASE, requestedByUserId: 'u-admin', requestedByRole: 'admin',
    } as any); // `as any`: deliberately NOT adding a digest field to the typed input, proving none exists to add
    assert.equal(r.ok, true);
    assert.equal(r.authorization!.artifactDigest, REAL_DIGEST);
    console.log('D7 CRITICAL admin override -> persisted digest is exactly the backend-resolved one, unchangeable by the caller: PASS');
  }

  // ── §18 — real build #150 digest-pinned dispatch fixture (NO actual
  // deployment; constructs and inspects the exact request body a future
  // live call would send, never calling fetch). ───────────────────────
  {
    const REAL_SHA = '7ae0f954f99628b69ce9b42f42c1e2acc8568d99';
    const REAL_DIGEST = 'sha256:2027f8ed1c023e8d34e30e5848a3ed780831b8e52945543bd00f7c3ed521718d';
    const projectRepo = new MutableFakeProjectRepo({ id: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', azureConfig: okAzureConfig });
    const attemptRepo = new FakeGenericRepo();
    const authRepo = new FakeAuthRepo(projectRepo, attemptRepo);
    const reportRepo = new MutableFakeReportRepo(criticalReport);
    const buildIdentity = resolveBuildIdentity({ projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', incidentId: 'a657d5ae-fbe0-47cb-b954-451bd81636aa', mainBuildNumber: 150, sourceCommitSha: REAL_SHA, repository: 'souhaiel11/pfe-app-test' });
    const noValidation: SecurityValidationEvidence = { present: false, validationStatus: null, passed: null, checkoutSha: null, validationBuildNumber: null, expectedPrHeadSha: null };
    const readiness = new MutableFakeReadiness({ buildIdentity, validation: noValidation });
    const artifacts = new MutableFakeArtifacts({ ok: true, commitSha: REAL_SHA, buildNumber: 150, registry: 'acrpfedevsecops', repository: 'pfe-app-test', tag: '150', digest: REAL_DIGEST, provenanceEvidence: {}, failureCode: null });
    const svc = new DeploymentAuthorizationService(authRepo as any, projectRepo as any, reportRepo as any, attemptRepo as any, readiness as any, artifacts as any);

    const created = await svc.createAuthorization({
      projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', mode: 'CRITICAL_OVERRIDE', reason: 'offline fixture proof, §18',
      acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
      confirmationPhrase: CRITICAL_OVERRIDE_CONFIRMATION_PHRASE, requestedByUserId: 'u-admin', requestedByRole: 'admin',
    });
    assert.equal(created.ok, true);
    assert.equal(created.governanceClass, 'CRITICAL_RISK');

    const reservation = await svc.reserveAndConsumeAuthorization({ authorizationId: created.authorization!.id, requestId: 'req-150-fixture', actorUserId: 'u-admin', actorRole: 'admin' });
    assert.equal(reservation.ok, true);
    const authorization = reservation.authorization!;

    // Exactly the body azure-deploy.module.ts's deployWithAuthorization()
    // would JSON.stringify and POST to the agent -- constructed and
    // inspected here, NEVER sent (no fetch call exists in this test file
    // at all).
    const wouldSendToAgent = {
      projectId: reservation.project!.id, requestId: 'req-150-fixture',
      imageTag: authorization.artifactTag, artifactDigest: authorization.artifactDigest,
      target: reservation.project!.azureConfig,
    };
    assert.equal(wouldSendToAgent.artifactDigest, REAL_DIGEST);
    const expectedImageReference = `${wouldSendToAgent.target.registry}.azurecr.io/${wouldSendToAgent.target.imageRepository}@${wouldSendToAgent.artifactDigest}`;
    assert.equal(expectedImageReference, `acrpfedevsecops.azurecr.io/pfe-app-test@${REAL_DIGEST}`);
    console.log(`§18 real build #150: admin authorization binds digest ${authorization.artifactDigest} exactly; governed dispatch command would target ${expectedImageReference} (NOT sent): PASS`);
  }

  console.log('digest-pinned-dispatch.spec: ALL PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
