// Teste le composant « deployment-artifact.service » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { DeploymentArtifactService, RegisterArtifactInput } from './deployment-artifact.service';
import { CommitResolutionResult, EnvironmentResolutionResult } from './deployment-identity.types';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const DIGEST_A = `sha256:${'1'.repeat(64)}`;
const DIGEST_B = `sha256:${'2'.repeat(64)}`;

class FakeArtifactRepo {
  rows: any[] = [];
  /** Recherche l’élément correspondant à l’identifiant. */
  async findOne({ where }: any) {
    return this.rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) || null;
  }
  /** Crée et enregistre un nouvel élément. */
  create(partial: any) { return { id: `artifact-${this.rows.length + 1}`, createdAt: new Date(), ...partial }; }
  /** Enregistre les données fournies. */
  async save(entity: any) {
    const idx = this.rows.findIndex(r => r.id === entity.id);
    if (idx >= 0) this.rows[idx] = entity; else this.rows.push(entity);
    return entity;
  }
}

class FakeProjectRepo {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly project: any | null) {}
  /** Recherche l’élément correspondant à l’identifiant. */
  async findOne() { return this.project; }
}

/** Simule les dépendances nécessaires au scénario. */
function fakeReadiness(commit: CommitResolutionResult, _environment?: EnvironmentResolutionResult, reportedPushStatus: string | null = 'SUCCESS') {
  return {
    /** Prépare les données nécessaires à ce scénario. */
    resolveBuildPublicationEvidence: async () => ({
      incidentId: 'inc-1', buildNumber: commit.buildNumber ?? null,
      reportedPushStatus, reportedImageTag: null, reportedBuildStatus: 'SUCCESS',
    }),
    /** Prépare les données nécessaires à ce scénario. */
    resolveBuildIdentity: async () => ({
      buildIdentity: {
        ok: commit.ok,
        buildIdentity: commit.ok ? { projectId: 'proj-1', incidentId: 'inc-1', mainBuildNumber: commit.buildNumber!, commitSha: commit.commitSha!, repository: null, branchOrRef: null } : null,
        securityValidationMissing: true,
        evidence: commit.evidence,
        failureCode: commit.failureCode,
      },
      validation: { present: false, validationStatus: null, passed: null, checkoutSha: null, validationBuildNumber: null, expectedPrHeadSha: null },
    }),
  } as any;
}

/** Prépare les données nécessaires à ce scénario. */
const okCommit = (buildNumber: number, commitSha: string): CommitResolutionResult =>
  ({ ok: true, buildNumber, commitSha, evidence: {}, failureCode: null });
const okEnvironment: EnvironmentResolutionResult = {
  ok: true,
  environmentIdentity: { provider: 'azure-container-instances', resourceGroup: 'rg-pfe-devsecops', registry: 'acrpfedevsecops', targetName: 'aci-devsecops-testbed', region: 'francecentral', environmentIdentityHash: 'x' },
  failureCode: null,
};
/** Prépare les données nécessaires à ce scénario. */
const project = (repo = 'devsecops-testbed') => ({ id: 'proj-1', azureConfig: { provider: 'azure-container-instances', resourceGroup: 'rg-pfe-devsecops', registry: 'acrpfedevsecops', imageRepository: repo, targetName: 'aci-devsecops-testbed', region: 'francecentral' } });

/** Prépare les données nécessaires à ce scénario. */
const baseInput = (over: Partial<RegisterArtifactInput> = {}): RegisterArtifactInput =>
  ({ projectId: 'proj-1', buildNumber: 42, commitSha: SHA_A, repository: 'devsecops-testbed', tag: 'build-42', ...over });
/** Prépare les données nécessaires à ce scénario. */
const redigestFound = (digest = DIGEST_A) => async () => ({ found: true, registry: 'acrpfedevsecops', repository: 'devsecops-testbed', tag: 'build-42', digest });
/** Prépare les données nécessaires à ce scénario. */
const ociMatch = () => async () => ({ available: true, revision: SHA_A });
/** Prépare les données nécessaires à ce scénario. */
const ociAbsent = () => async () => ({ available: false });
/** Prépare les données nécessaires à ce scénario. */
const ociDiffers = () => async () => ({ available: true, revision: SHA_B });
/** Prépare les données nécessaires à ce scénario. */
const ociMalformed = () => async () => ({ available: true, revision: 'not-a-sha' });

/** Prépare les données nécessaires à ce scénario. */
const pushReceipt = (manifestDigest = DIGEST_A, buildNumber = 42) =>
  ({ manifestDigest, buildNumber, jenkinsBuildUrl: `http://jenkins:8080/job/pfe-app-test/${buildNumber}/` });
const ciPublished = { requireVerifiedProvenance: true, publicationChannel: 'CI_CALLBACK' as const };

/** Exécute les étapes principales de ce programme. */
async function main() {
  // ── O1-O6 — OCI inspection interpretation ──────────────────────────
  {
    const svc = new DeploymentArtifactService(new FakeArtifactRepo() as any, new FakeProjectRepo(project()) as any, fakeReadiness(okCommit(42, SHA_A), okEnvironment));
    const r = await svc.registerArtifact(baseInput(), redigestFound(), ociMatch(), { requireVerifiedProvenance: true });
    assert.equal(r.status, 'PROVENANCE_VERIFIED');
    console.log('O1 digest + matching revision -> PASS: PASS');
  }
  {
    const svc = new DeploymentArtifactService(new FakeArtifactRepo() as any, new FakeProjectRepo(project()) as any, fakeReadiness(okCommit(42, SHA_A), okEnvironment));
    const r = await svc.registerArtifact(baseInput(), redigestFound(), ociAbsent(), { requireVerifiedProvenance: true });
    assert.equal(r.status, 'REJECTED');
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_REVISION_MISSING');
    console.log('O2 revision missing -> FAIL: PASS');
  }
  {
    const svc = new DeploymentArtifactService(new FakeArtifactRepo() as any, new FakeProjectRepo(project()) as any, fakeReadiness(okCommit(42, SHA_A), okEnvironment));
    const r = await svc.registerArtifact(baseInput(), redigestFound(), ociDiffers(), { requireVerifiedProvenance: true });
    assert.equal(r.status, 'REJECTED');
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_REVISION_MISMATCH');
    console.log('O3 revision different -> FAIL: PASS');
  }
  {
    const svc = new DeploymentArtifactService(new FakeArtifactRepo() as any, new FakeProjectRepo(project()) as any, fakeReadiness(okCommit(42, SHA_A), okEnvironment));
    const r = await svc.registerArtifact(baseInput(), redigestFound(), ociMalformed(), { requireVerifiedProvenance: true });
    assert.equal(r.status, 'REJECTED');
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_REVISION_MISMATCH');
    console.log('O4 malformed revision -> FAIL: PASS');
  }
  {
    // Registry not allowed: the agent would 403 before resolving anything
    // -> resolveArtifactDigest's wrapper surfaces that as found:false.
    const svc = new DeploymentArtifactService(new FakeArtifactRepo() as any, new FakeProjectRepo(project()) as any, fakeReadiness(okCommit(42, SHA_A), okEnvironment));
    const r = await svc.registerArtifact(baseInput(), async () => ({ found: false }), ociMatch(), { requireVerifiedProvenance: true });
    assert.equal(r.status, 'REJECTED');
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_DIGEST_MISSING');
    console.log('O5 registry not allowed -> FAIL: PASS');
  }
  {
    const svc = new DeploymentArtifactService(new FakeArtifactRepo() as any, new FakeProjectRepo(project('devsecops-testbed')) as any, fakeReadiness(okCommit(42, SHA_A), okEnvironment));
    const r = await svc.registerArtifact(baseInput({ repository: 'some-other-repo' }), redigestFound(), ociMatch(), { requireVerifiedProvenance: true });
    assert.equal(r.status, 'REJECTED');
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_REPOSITORY_MISMATCH');
    console.log('O6 repository mismatch -> FAIL: PASS');
  }

  // ── R1-R8 — registration ───────────────────────────────────────────
  {
    const svc = new DeploymentArtifactService(new FakeArtifactRepo() as any, new FakeProjectRepo(project()) as any, fakeReadiness(okCommit(42, SHA_A), okEnvironment));
    const r = await svc.registerArtifact(baseInput(), redigestFound(), ociMatch(), { requireVerifiedProvenance: true });
    assert.equal(r.status, 'PROVENANCE_VERIFIED');
    assert.equal(r.digest, DIGEST_A);
    console.log('R1 exact build/commit/digest/revision -> verified artifact: PASS');
  }
  {
    const svc = new DeploymentArtifactService(new FakeArtifactRepo() as any, new FakeProjectRepo(project()) as any, fakeReadiness(okCommit(42, SHA_A), okEnvironment));
    const r = await svc.registerArtifact(baseInput(), redigestFound(), ociDiffers(), { requireVerifiedProvenance: true });
    assert.equal(r.status, 'REJECTED');
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_REVISION_MISMATCH');
    console.log('R2 caller claims correct commit but OCI revision differs -> reject: PASS');
  }
  {
    const svc = new DeploymentArtifactService(new FakeArtifactRepo() as any, new FakeProjectRepo(project()) as any, fakeReadiness(okCommit(42, SHA_A), okEnvironment));
    const r = await svc.registerArtifact(baseInput({ digest: DIGEST_B }), redigestFound(DIGEST_A), ociMatch(), { requireVerifiedProvenance: true });
    assert.equal(r.status, 'REJECTED');
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_DIGEST_MISMATCH');
    console.log('R3 caller claims digest but ACR resolves different digest -> reject: PASS');
  }
  {
    const svc = new DeploymentArtifactService(new FakeArtifactRepo() as any, new FakeProjectRepo(project()) as any, fakeReadiness(okCommit(42, SHA_A), okEnvironment));
    const r = await svc.registerArtifact(baseInput(), redigestFound(), ociAbsent(), { requireVerifiedProvenance: true });
    assert.equal(r.status, 'REJECTED');
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_REVISION_MISSING');
    console.log('R4 valid digest but no revision -> reject: PASS');
  }
  {
    // Validated build has moved on to #50; caller still claims #42.
    const svc = new DeploymentArtifactService(new FakeArtifactRepo() as any, new FakeProjectRepo(project()) as any, fakeReadiness(okCommit(50, SHA_B), okEnvironment));
    const r = await svc.registerArtifact(baseInput({ buildNumber: 42 }), redigestFound(), ociMatch(), { requireVerifiedProvenance: true });
    assert.equal(r.status, 'REJECTED');
    assert.equal(r.failureCode, 'DEPLOY_BUILD_MISMATCH');
    console.log('R5 old build artifact for new validation -> reject: PASS');
  }
  {
    const artifactRepo = new FakeArtifactRepo();
    const svc = new DeploymentArtifactService(artifactRepo as any, new FakeProjectRepo(project()) as any, fakeReadiness(okCommit(42, SHA_A), okEnvironment));
    const r1 = await svc.registerArtifact(baseInput(), redigestFound(), ociMatch(), { requireVerifiedProvenance: true });
    const r2 = await svc.registerArtifact(baseInput(), redigestFound(), ociMatch(), { requireVerifiedProvenance: true });
    assert.equal(r1.status, 'PROVENANCE_VERIFIED');
    assert.equal(r2.status, 'PROVENANCE_VERIFIED');
    assert.equal(r1.artifactId, r2.artifactId);
    assert.equal(artifactRepo.rows.length, 1);
    console.log('R6 duplicate identical callback -> idempotent: PASS');
  }
  {
    const artifactRepo = new FakeArtifactRepo();
    const svc1 = new DeploymentArtifactService(artifactRepo as any, new FakeProjectRepo(project()) as any, fakeReadiness(okCommit(42, SHA_A), okEnvironment));
    const first = await svc1.registerArtifact(baseInput(), redigestFound(DIGEST_A), ociMatch(), { requireVerifiedProvenance: true });
    assert.equal(first.status, 'PROVENANCE_VERIFIED');
    // Same digest, but now claimed for a DIFFERENT project/build/commit.
    const svc2 = new DeploymentArtifactService(artifactRepo as any, new FakeProjectRepo({ ...project(), id: 'proj-2' }) as any, fakeReadiness(okCommit(7, SHA_B), okEnvironment));
    const second = await svc2.registerArtifact(baseInput({ projectId: 'proj-2', buildNumber: 7, commitSha: SHA_B }), redigestFound(DIGEST_A), async () => ({ available: true, revision: SHA_B }), { requireVerifiedProvenance: true });
    assert.equal(second.status, 'REJECTED');
    assert.equal(second.failureCode, 'DEPLOY_ARTIFACT_COMMIT_MISMATCH');
    assert.equal(artifactRepo.rows.length, 1);
    console.log('R7 conflicting provenance for same digest -> reject: PASS');
  }
  {
    const svc = new DeploymentArtifactService(new FakeArtifactRepo() as any, new FakeProjectRepo(null) as any, fakeReadiness(okCommit(42, SHA_A), okEnvironment));
    const r = await svc.registerArtifact(baseInput(), redigestFound(), ociMatch(), { requireVerifiedProvenance: true });
    assert.equal(r.status, 'REJECTED');
    assert.equal(r.failureCode, 'DEPLOY_ENVIRONMENT_UNRESOLVED');
    console.log('R8 unknown project -> reject: PASS');
  }

  // ── §17 P1-P6 — resolution ──────────────────────────────────────────
  {
    const artifactRepo = new FakeArtifactRepo();
    const readiness = fakeReadiness(okCommit(42, SHA_A), okEnvironment);
    const svc = new DeploymentArtifactService(artifactRepo as any, new FakeProjectRepo(project()) as any, readiness);
    await svc.registerArtifact(baseInput({ pushReceipt: pushReceipt() }), redigestFound(), ociMatch(), ciPublished);
    const r = await svc.resolveProvenDeploymentArtifact('proj-1', redigestFound(), ociMatch());
    assert.equal(r.ok, true);
    assert.equal(r.digest, DIGEST_A);
    console.log('P1 (§17) proven current artifact (identity AND publication proven) -> PASS: PASS');
  }
  {
    const artifactRepo = new FakeArtifactRepo();
    const readiness = fakeReadiness(okCommit(42, SHA_A), okEnvironment);
    const svc = new DeploymentArtifactService(artifactRepo as any, new FakeProjectRepo(project()) as any, readiness);
    // requireVerifiedProvenance:false (manual path) with no label -> persists UNVERIFIED.
    await svc.registerArtifact(baseInput(), redigestFound(), ociAbsent(), { requireVerifiedProvenance: false });
    const r = await svc.resolveProvenDeploymentArtifact('proj-1', redigestFound(), ociAbsent());
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE');
    console.log('P2 (§17) unverified manual artifact -> FAIL: PASS');
  }
  {
    const artifactRepo = new FakeArtifactRepo();
    const readiness = fakeReadiness(okCommit(42, SHA_A), okEnvironment);
    const svc = new DeploymentArtifactService(artifactRepo as any, new FakeProjectRepo(project()) as any, readiness);
    await svc.registerArtifact(baseInput({ pushReceipt: pushReceipt() }), redigestFound(DIGEST_A), ociMatch(), ciPublished);
    // Tag moved: a fresh lookup now returns a DIFFERENT digest.
    const r = await svc.resolveProvenDeploymentArtifact('proj-1', redigestFound(DIGEST_B), ociMatch());
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_DIGEST_MISMATCH');
    console.log('P3 (§17) tag moved after registration -> FAIL: PASS');
  }
  {
    const artifactRepo = new FakeArtifactRepo();
    const readinessAtRegister = fakeReadiness(okCommit(42, SHA_A), okEnvironment);
    const svc = new DeploymentArtifactService(artifactRepo as any, new FakeProjectRepo(project()) as any, readinessAtRegister);
    await svc.registerArtifact(baseInput(), redigestFound(), ociMatch(), { requireVerifiedProvenance: true });
    // Validated commit has since changed (new push to the branch, re-validated).
    const readinessNow = fakeReadiness(okCommit(43, SHA_B), okEnvironment);
    const svcNow = new DeploymentArtifactService(artifactRepo as any, new FakeProjectRepo(project()) as any, readinessNow);
    const r = await svcNow.resolveProvenDeploymentArtifact('proj-1', redigestFound(), ociMatch());
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE');
    console.log('P4 (§17) current validated commit changed -> old artifact rejected: PASS');
  }
  {
    const artifactRepo = new FakeArtifactRepo();
    const readiness = fakeReadiness(okCommit(42, SHA_A), okEnvironment);
    const svc = new DeploymentArtifactService(artifactRepo as any, new FakeProjectRepo(project('devsecops-testbed')) as any, readiness);
    await svc.registerArtifact(baseInput(), redigestFound(), ociMatch(), { requireVerifiedProvenance: true });
    // Project's target repository changed since registration.
    const svcChangedRepo = new DeploymentArtifactService(artifactRepo as any, new FakeProjectRepo(project('a-different-repo')) as any, readiness);
    const r = await svcChangedRepo.resolveProvenDeploymentArtifact('proj-1', redigestFound(), ociMatch());
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_REPOSITORY_MISMATCH');
    console.log('P5 (§17) environment/repository changed -> old artifact rejected: PASS');
  }
  {
    const artifactRepo = new FakeArtifactRepo();
    const readiness = fakeReadiness(okCommit(42, SHA_A), okEnvironment);
    const svc = new DeploymentArtifactService(artifactRepo as any, new FakeProjectRepo(project()) as any, readiness);
    await svc.registerArtifact(baseInput({ pushReceipt: pushReceipt() }), redigestFound(), ociMatch(), ciPublished);
    const r1 = await svc.resolveProvenDeploymentArtifact('proj-1', redigestFound(), ociMatch());
    const r2 = await svc.resolveProvenDeploymentArtifact('proj-1', redigestFound(), ociMatch());
    assert.equal(r1.ok, true);
    assert.deepEqual(r1, r2);
    console.log('P6 (§17) exact proven artifact -> stable result: PASS');
  }

  console.log('deployment-artifact.service.spec: ALL PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
