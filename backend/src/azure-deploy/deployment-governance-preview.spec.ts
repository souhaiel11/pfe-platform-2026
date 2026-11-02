// Teste le composant « deployment-governance-preview » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DeploymentAuthorizationService } from './deployment-authorization.service';
import { CRITICAL_OVERRIDE_CONFIRMATION_PHRASE } from './deployment-authorization-policy';
import { resolveBuildIdentity } from './build-identity';
import { Project } from '../projects/project.entity';
import { DeploymentAttempt } from './deployment-attempt.entity';
import { ArtifactProvenanceResolutionResult } from './deployment-identity.types';

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
  getRepository: (cls: any) => cls === Project ? this.projectRepo : cls === DeploymentAttempt ? this.attemptRepo : this }) };
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
const PROJECT_ID = '3aa1c9b9-e114-40e4-884b-ebc7aa32e002';
const REAL_SHA = '7ae0f954f99628b69ce9b42f42c1e2acc8568d99';
const REAL_DIGEST = 'sha256:2027f8ed1c023e8d34e30e5848a3ed780831b8e52945543bd00f7c3ed521718d';
const OTHER_DIGEST = 'sha256:' + '9'.repeat(64);
const noValidation = { present: false, validationStatus: null, passed: null, checkoutSha: null, validationBuildNumber: null, expectedPrHeadSha: null };
const realBuildIdentity = resolveBuildIdentity({ projectId: PROJECT_ID, incidentId: 'a657d5ae-fbe0-47cb-b954-451bd81636aa', mainBuildNumber: 150, sourceCommitSha: REAL_SHA, repository: 'souhaiel11/pfe-app-test' });

/** Prépare les données nécessaires à ce scénario. */
function makeService(digest: string) {
  const projectRepo = new MutableFakeProjectRepo({ id: PROJECT_ID, azureConfig: okAzureConfig });
  const attemptRepo = new FakeGenericRepo();
  const authRepo = new FakeAuthRepo(projectRepo, attemptRepo);
  const reportRepo = new MutableFakeReportRepo(null);
  const readiness = new MutableFakeReadiness({ buildIdentity: realBuildIdentity, validation: noValidation });
  const artifact: ArtifactProvenanceResolutionResult = { ok: true, commitSha: REAL_SHA, buildNumber: 150, registry: 'acrpfedevsecops', repository: 'pfe-app-test', tag: '150', digest, provenanceEvidence: {}, failureCode: null };
  const artifacts = new MutableFakeArtifacts(artifact);
  const svc = new DeploymentAuthorizationService(authRepo as any, projectRepo as any, reportRepo as any, attemptRepo as any, readiness as any, artifacts as any);
  return { svc, artifacts };
}

/** Exécute les étapes principales de ce programme. */
async function main() {
  // ── §6 — real #150 preview fixture ──────────────────────────────────
  {
    const { svc } = makeService(REAL_DIGEST);
    const preview = await svc.getGovernancePreview(PROJECT_ID);
    assert.equal(preview.buildIdentity.resolved, true);
    assert.equal(preview.buildIdentity.commitSha, REAL_SHA);
    assert.equal(preview.artifact.provenanceVerified, true);
    assert.equal(preview.artifact.digest, REAL_DIGEST);
    assert.equal(preview.securityValidation.applicability, 'MISSING');
    assert.equal(preview.decision, 'CRITICAL_RISK');
    assert.notEqual(preview.decision, 'TECHNICALLY_IMPOSSIBLE');
    assert.equal(preview.authorizationPolicy.requiredMode, 'CRITICAL_OVERRIDE');
    assert.equal(preview.authorizationPolicy.adminRequired, true);
    console.log(`REAL_150 preview: decision=${preview.decision}, buildIdentity.resolved=${preview.buildIdentity.resolved}, artifact.provenanceVerified=${preview.artifact.provenanceVerified}, securityValidation=${preview.securityValidation.applicability}: PASS`);
  }

  // ── §4 — preview/authorization consistency: same unchanged state,
  // GET preview then POST authorize must agree on every shared field. ──
  {
    const { svc } = makeService(REAL_DIGEST);
    const preview = await svc.getGovernancePreview(PROJECT_ID);
    const created = await svc.createAuthorization({
      projectId: PROJECT_ID, mode: 'CRITICAL_OVERRIDE', reason: 'ship despite known risk, approved verbally',
      acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
      confirmationPhrase: CRITICAL_OVERRIDE_CONFIRMATION_PHRASE, requestedByUserId: 'u-admin', requestedByRole: 'admin',
    });
    assert.equal(created.ok, true);
    const auth = created.authorization!;
    assert.equal(created.governanceClass, preview.decision);
    assert.equal(auth.commitSha, preview.buildIdentity.commitSha);
    assert.equal(auth.artifactDigest, preview.artifact.digest);
    assert.equal(auth.environmentIdentityHash, preview.environment.identityHash);
    assert.deepEqual(auth.failedControls, preview.failedControls);
    assert.deepEqual(auth.warnings, preview.warnings);
    console.log('§4 preview/authorization consistency (unchanged state): decision/commit/digest/environmentIdentityHash/failedControls/warnings all match: PASS');
  }

  // ── §5 — stale preview: state (artifact digest) changes between GET
  // and POST -> POST must reflect NEW state, never the stale preview. ──
  {
    const { svc, artifacts } = makeService(REAL_DIGEST);
    const stalePreview = await svc.getGovernancePreview(PROJECT_ID);
    assert.equal(stalePreview.artifact.digest, REAL_DIGEST);

    // State drifts after the preview was read (e.g. a new build pushed).
    artifacts.current = { ...artifacts.current, digest: OTHER_DIGEST };

    const created = await svc.createAuthorization({
      projectId: PROJECT_ID, mode: 'CRITICAL_OVERRIDE', reason: 'ship despite known risk, approved verbally',
      acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
      confirmationPhrase: CRITICAL_OVERRIDE_CONFIRMATION_PHRASE, requestedByUserId: 'u-admin', requestedByRole: 'admin',
    });
    assert.equal(created.ok, true);
    assert.equal(created.authorization!.artifactDigest, OTHER_DIGEST, 'authorization must bind the FRESH digest, never the stale preview value');
    assert.notEqual(created.authorization!.artifactDigest, stalePreview.artifact.digest, 'old preview must not have authorized the old digest');
    console.log('§5 stale preview: POST /authorize recomputed fresh state, ignored the stale GET snapshot: PASS');
  }

  // ── §3 — frontend cannot submit trusted decision/identity facts. ────
  {
    const dtoSrc = fs.readFileSync(path.join(__dirname, 'dto/authorize-deployment.dto.ts'), 'utf8');
    const forbidden = ['decision', 'failedControls', 'riskSnapshot', 'commitSha', 'digest', 'artifactDigest', 'environmentIdentityHash'];
    for (const field of forbidden) {
      assert.equal(new RegExp(`\\b${field}\\s*[?]?:`).test(dtoSrc), false, `AuthorizeDeploymentDto must not declare a "${field}" field`);
    }
    const mainSrc = fs.readFileSync(path.join(__dirname, '../main.ts'), 'utf8');
    assert.match(mainSrc, /whitelist:\s*true/, 'global ValidationPipe must strip any non-declared field from the request body');
    console.log('§3 AuthorizeDeploymentDto has no decision/identity fields AND global ValidationPipe whitelist:true strips anything else a caller might add: PASS');
  }

  console.log('deployment-governance-preview.spec: ALL PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
