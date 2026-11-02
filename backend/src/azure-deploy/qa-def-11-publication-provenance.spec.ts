// Teste le composant « qa-def-11-publication-provenance » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { DeploymentArtifactService } from './deployment-artifact.service';
import { DeploymentAuthorizationService } from './deployment-authorization.service';
import { Project } from '../projects/project.entity';
import { DeploymentAttempt } from './deployment-attempt.entity';
import { evaluateProvenDeploymentArtifact, deriveDeploymentEnvironmentIdentity } from './deployment-identity';
import { toCommitResolutionResult, resolveBuildIdentity } from './build-identity';
import { DeploymentArtifactRecord } from './deployment-identity.types';

// ── REAL values from the investigation ──────────────────────────────
// §1.1 / §1.8 — build #151 of job `pfe-app-test`.
const SHA_151 = '393816c250f73d907eb5a2dd43b2ec2288c7abcb';
// §1.4 — the ACR MANIFEST digest the tag `151` actually resolves to.
const MANIFEST_151 = 'sha256:6dc3cdba69592a91a5a1569978bcfca74d4080597a769ab368ed585ba397bcf5';
// §1.5 — the CONFIG digest build #151's `docker build` printed. Proves the
// bytes are the build's (claim A) and is NOT a publication receipt (claim C).
const CONFIG_151 = 'sha256:12aba29ceacaf1411a272df99c5376cdc0dfd9baa98de2bcd2f2c1a0c9256777';
// §1.10 — build #150 of the same job, already present in the ledger as
// MANUAL_REGISTERED. Same values the other specs in this package use.
const SHA_150 = '7ae0f954f99628b69ce9b42f42c1e2acc8568d99';
const DIGEST_150 = 'sha256:2027f8ed1c023e8d34e30e5848a3ed780831b8e52945543bd00f7c3ed521718d';
// §1.10 — the two `app-test-pfe-vermeg` artifacts whose pipeline really does
// publish (stage `Publish Image (ACR)`, `docker push` present in the log,
// push_status SUCCESS). Both rows carry buildNumber 10.
// Real ledger values, read read-only from deployment_artifacts on
// 2026-10-11 (rows 4f376922 and d6d26c89).
const SHA_VERMEG = 'f02b6fb4d2b2e9f46afcdc9ca88dc1d086187248';
const DIGEST_VERMEG_10 = 'sha256:f87baecf15a46f72b68ea235cb960333e8a42bdefbb8dabea4c55823cb620920';
const DIGEST_VERMEG_9 = 'sha256:a80a679ec30ad9b101cdabd9ce2fbaa0179f8f1f2226bf9a8e2bdc49b6affe53';

const PROJECT_APP_TEST = { id: 'proj-app-test', azureConfig: { provider: 'azure-container-instances', resourceGroup: 'rg-pfe-devsecops', registry: 'acrpfedevsecops', imageRepository: 'pfe-app-test', targetName: 'aci-pfe-app-test', region: 'francecentral' } };
const PROJECT_VERMEG = { id: 'proj-vermeg', azureConfig: { provider: 'azure-container-instances', resourceGroup: 'rg-pfe-devsecops', registry: 'acrpfedevsecops', imageRepository: 'app-test-pfe-vermeg', targetName: 'aci-vermeg', region: 'francecentral' } };

class FakeArtifactRepo {
  rows: any[] = [];
  /** Recherche l’élément correspondant à l’identifiant. */
  async findOne({ where }: any) { return this.rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) || null; }
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
constructor(private readonly p: any) {} 
/** Recherche l’élément correspondant à l’identifiant. */
async findOne() { return this.p; } }

/** Simule les dépendances nécessaires au scénario. */
function fakeReadiness(params: { projectId: string; buildNumber: number; commitSha: string; reportedPushStatus: string | null; reportedImageTag?: string | null }) {
  return {
    /** Prépare les données nécessaires à ce scénario. */
    resolveBuildIdentity: async () => ({
      buildIdentity: { ...resolveBuildIdentity({ projectId: params.projectId, incidentId: `inc-${params.buildNumber}`, mainBuildNumber: params.buildNumber, sourceCommitSha: params.commitSha, repository: 'souhaiel11/pfe-app-test' }), securityValidationMissing: true },
      validation: { present: false, validationStatus: null, passed: null, checkoutSha: null, validationBuildNumber: null, expectedPrHeadSha: null },
    }),
    /** Prépare les données nécessaires à ce scénario. */
    resolveBuildPublicationEvidence: async () => ({
      incidentId: `inc-${params.buildNumber}`, buildNumber: params.buildNumber,
      reportedPushStatus: params.reportedPushStatus,
      reportedImageTag: params.reportedImageTag ?? null,
      reportedBuildStatus: 'SUCCESS',
    }),
  } as any;
}

/** Prépare les données nécessaires à ce scénario. */
const resolver = (digest: string) => async (p: any) => ({ found: true, registry: p.registry, repository: p.repository, tag: p.tag, digest });
/** Prépare les données nécessaires à ce scénario. */
const ociRevision = (revision: string) => async () => ({ available: true, revision });

/** Prépare les données nécessaires à ce scénario. */
function gateVerdict(project: any, buildNumber: number, commitSha: string, row: DeploymentArtifactRecord | null, freshDigest: string | null) {
  const buildIdentity = { ...resolveBuildIdentity({ projectId: project.id, incidentId: `inc-${buildNumber}`, mainBuildNumber: buildNumber, sourceCommitSha: commitSha, repository: 'souhaiel11/pfe-app-test' }), securityValidationMissing: true };
  return evaluateProvenDeploymentArtifact({
    commit: toCommitResolutionResult(buildIdentity),
    environment: deriveDeploymentEnvironmentIdentity(project.azureConfig as any),
    targetRegistry: project.azureConfig.registry,
    targetRepository: project.azureConfig.imageRepository,
    candidateArtifact: row,
    freshLookup: freshDigest ? { found: true, digest: freshDigest } : null,
    freshRevisionCheck: { available: true, revision: commitSha },
  });
}

/** Prépare les données nécessaires à ce scénario. */
const asRecord = (row: any): DeploymentArtifactRecord => ({
  projectId: row.projectId, buildNumber: row.buildNumber, commitSha: row.commitSha,
  registry: row.registry, repository: row.repository, tag: row.tag, digest: row.digest,
  source: row.source, provenanceVerified: row.provenanceVerified, publicationSource: row.publicationSource,
});

/** Exécute les étapes principales de ce programme. */
async function main() {
  // ══ G1 — TAG 151: the defect itself ════════════════════════════════
  // Source code verified, publication UNKNOWN, deployment refused.
  {
    const artifactRepo = new FakeArtifactRepo();
    const svc = new DeploymentArtifactService(
      artifactRepo as any,
      new FakeProjectRepo(PROJECT_APP_TEST) as any,
      // The pipeline's own telemetry for build #151, verbatim from §1.9.
      fakeReadiness({ projectId: PROJECT_APP_TEST.id, buildNumber: 151, commitSha: SHA_151, reportedPushStatus: 'NOT_ATTEMPTED', reportedImageTag: 'pfe-app-test:151' }),
    );

    // Replayed exactly as the CI callback that produced row 008f1b22: no
    // push receipt (the pipeline has no publication stage to produce one).
    const r = await svc.registerArtifact(
      { projectId: PROJECT_APP_TEST.id, buildNumber: 151, commitSha: SHA_151, repository: 'pfe-app-test', tag: '151', digest: MANIFEST_151 },
      resolver(MANIFEST_151),
      ociRevision(SHA_151),
      { requireVerifiedProvenance: true, publicationChannel: 'CI_CALLBACK' },
    );

    // CLAIM A — still proven, and still reported as proven. Fixing the
    // defect must not throw away a true statement.
    assert.equal(r.status, 'PROVENANCE_VERIFIED');
    assert.equal(r.artifactIdentitySource, 'PIPELINE_BUILT');
    // CLAIM C — the whole point: UNKNOWN, with the reason named.
    assert.equal(r.publicationSource, 'UNKNOWN');
    assert.equal(r.publicationFailureCode, 'PUSH_RECEIPT_MISSING');
    // CLAIM C must NOT have been auto-rewritten into a manual status.
    assert.notEqual(r.publicationSource, 'MANUAL_ATTESTED' as any);
    // The REGRESSION assertion — the row must never claim the pipeline
    // published this. This single line is what would have caught QA-DEF-11.
    const row = artifactRepo.rows[0];
    assert.notEqual(row.source, 'JENKINS_PIPELINE');
    assert.equal(row.source, 'UNKNOWN');
    assert.equal(row.publicationSource, 'UNKNOWN');
    assert.equal(row.artifactIdentitySource, 'PIPELINE_BUILT');
    // The audit record keeps the pipeline's self-contradicting report.
    assert.equal(row.publicationReceipt.reportedPushStatus, 'NOT_ATTEMPTED');
    assert.equal(row.publicationReceipt.reportedImageTag, 'pfe-app-test:151');
    console.log('G1.a tag 151 registered: identity=PIPELINE_BUILT, publication=UNKNOWN, source NOT JENKINS_PIPELINE: PASS');

    // Deployment must be refused — fail-closed on publication alone, with a
    // code that does NOT blame identity (which is sound).
    const verdict = gateVerdict(PROJECT_APP_TEST, 151, SHA_151, asRecord(row), MANIFEST_151);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.failureCode, 'DEPLOY_ARTIFACT_PUBLICATION_UNVERIFIED');
    assert.equal(verdict.provenanceEvidence.publicationSource, 'UNKNOWN');
    assert.equal(verdict.provenanceEvidence.artifactIdentityProven, true);
    console.log('G1.b tag 151 deployment DENIED with DEPLOY_ARTIFACT_PUBLICATION_UNVERIFIED (identity was sound): PASS');

    // A CI retry of the same unproven claim must not launder it.
    const replay = await svc.registerArtifact(
      { projectId: PROJECT_APP_TEST.id, buildNumber: 151, commitSha: SHA_151, repository: 'pfe-app-test', tag: '151' },
      resolver(MANIFEST_151), ociRevision(SHA_151), { requireVerifiedProvenance: true, publicationChannel: 'CI_CALLBACK' },
    );
    assert.equal(replay.publicationSource, 'UNKNOWN');
    assert.equal(artifactRepo.rows.length, 1);
    console.log('G1.c re-submitting the same unproven claim stays UNKNOWN (a retry is not evidence): PASS');

    // A later CI call bearing a receipt must not launder the standing
    // UNKNOWN verdict of a row already in the ledger either: the stored
    // verdict is returned, never recomputed optimistically on replay.
    const laundered = await svc.registerArtifact(
      { projectId: PROJECT_APP_TEST.id, buildNumber: 151, commitSha: SHA_151, repository: 'pfe-app-test', tag: '151',
        pushReceipt: { manifestDigest: MANIFEST_151, buildNumber: 151, jenkinsBuildUrl: 'http://jenkins:8080/job/pfe-app-test/151/' } },
      resolver(MANIFEST_151), ociRevision(SHA_151), { requireVerifiedProvenance: true, publicationChannel: 'CI_CALLBACK' },
    );
    assert.equal(laundered.publicationSource, 'UNKNOWN');
    assert.equal(artifactRepo.rows.length, 1);
    assert.equal(artifactRepo.rows[0].publicationSource, 'UNKNOWN');
    console.log('G1.d a receipt sent AFTER the fact cannot upgrade a standing UNKNOWN row: PASS');
  }
  {
    // Same build #151, registered fresh WITH the config digest offered as
    // the push receipt. §1.5's trap: that digest is genuinely build #151's,
    // which is exactly why accepting it would make an unpublished build
    // look published. It must be refused as a receipt.
    const repo = new FakeArtifactRepo();
    const svc = new DeploymentArtifactService(
      repo as any, new FakeProjectRepo(PROJECT_APP_TEST) as any,
      fakeReadiness({ projectId: PROJECT_APP_TEST.id, buildNumber: 151, commitSha: SHA_151, reportedPushStatus: 'NOT_ATTEMPTED', reportedImageTag: 'pfe-app-test:151' }),
    );
    const forged = await svc.registerArtifact(
      { projectId: PROJECT_APP_TEST.id, buildNumber: 151, commitSha: SHA_151, repository: 'pfe-app-test', tag: '151',
        pushReceipt: { manifestDigest: CONFIG_151, buildNumber: 151, jenkinsBuildUrl: 'http://jenkins:8080/job/pfe-app-test/151/' } },
      resolver(MANIFEST_151), ociRevision(SHA_151), { requireVerifiedProvenance: true, publicationChannel: 'CI_CALLBACK' },
    );
    assert.equal(forged.publicationSource, 'UNKNOWN');
    assert.equal(forged.publicationFailureCode, 'PUSH_RECEIPT_DIGEST_MISMATCH');
    assert.equal(repo.rows[0].source, 'UNKNOWN');
    console.log("G1.e build #151's CONFIG digest offered as a push receipt -> UNKNOWN/PUSH_RECEIPT_DIGEST_MISMATCH: PASS");
  }

  // ══ G2 — TAG 150: a manual status survives only if its path proves it ══
  {
    // (a) A row registered through the manual admin path by an identified
    // admin: MANUAL_ATTESTED. The attester's identity IS the proof.
    const artifactRepo = new FakeArtifactRepo();
    const svc = new DeploymentArtifactService(
      artifactRepo as any, new FakeProjectRepo(PROJECT_APP_TEST) as any,
      fakeReadiness({ projectId: PROJECT_APP_TEST.id, buildNumber: 150, commitSha: SHA_150, reportedPushStatus: 'NOT_ATTEMPTED', reportedImageTag: 'pfe-app-test:150' }),
    );
    const attested = await svc.registerArtifact(
      { projectId: PROJECT_APP_TEST.id, buildNumber: 150, commitSha: SHA_150, repository: 'pfe-app-test', tag: '150' },
      resolver(DIGEST_150), ociRevision(SHA_150),
      { requireVerifiedProvenance: false, publicationChannel: 'MANUAL_ADMIN', attestedByUserId: 'admin-user-1' },
    );
    assert.equal(attested.publicationSource, 'MANUAL_ATTESTED');
    assert.equal(artifactRepo.rows[0].source, 'MANUAL_REGISTERED');
    assert.match(String(artifactRepo.rows[0].publicationEvidence), /admin-user-1/);
    console.log('G2.a tag 150 via the manual admin path WITH a named attester -> MANUAL_ATTESTED kept: PASS');

    // (b) The same registration with nobody on record: the manual status is
    // NOT kept. Its registration path does not prove it, so UNKNOWN.
    const anonRepo = new FakeArtifactRepo();
    const anonSvc = new DeploymentArtifactService(
      anonRepo as any, new FakeProjectRepo(PROJECT_APP_TEST) as any,
      fakeReadiness({ projectId: PROJECT_APP_TEST.id, buildNumber: 150, commitSha: SHA_150, reportedPushStatus: 'NOT_ATTEMPTED' }),
    );
    const anon = await anonSvc.registerArtifact(
      { projectId: PROJECT_APP_TEST.id, buildNumber: 150, commitSha: SHA_150, repository: 'pfe-app-test', tag: '150' },
      resolver(DIGEST_150), ociRevision(SHA_150),
      { requireVerifiedProvenance: false, publicationChannel: 'MANUAL_ADMIN', attestedByUserId: null },
    );
    assert.equal(anon.publicationSource, 'UNKNOWN');
    assert.equal(anon.publicationFailureCode, 'PUBLICATION_ATTESTATION_MISSING');
    assert.equal(anonRepo.rows[0].source, 'UNKNOWN');
    console.log('G2.b same registration with nobody on record -> UNKNOWN, manual status NOT granted: PASS');

    // (c) A pre-QA-DEF-11 row, as it exists in production today: no
    // publication column at all. It must read as UNKNOWN and deny — never
    // be grandfathered on the strength of its legacy `source` value.
    const legacyRow: DeploymentArtifactRecord = {
      projectId: PROJECT_APP_TEST.id, buildNumber: 150, commitSha: SHA_150,
      registry: 'acrpfedevsecops', repository: 'pfe-app-test', tag: '150', digest: DIGEST_150,
      source: 'MANUAL_REGISTERED', provenanceVerified: true,
      // publicationSource deliberately absent — a row written before the
      // column existed.
    };
    const legacyVerdict = gateVerdict(PROJECT_APP_TEST, 150, SHA_150, legacyRow, DIGEST_150);
    assert.equal(legacyVerdict.ok, false);
    assert.equal(legacyVerdict.failureCode, 'DEPLOY_ARTIFACT_PUBLICATION_UNVERIFIED');
    console.log('G2.c legacy row with no publication column -> DENIED, not grandfathered by its old `source`: PASS');

    // (d) A MANUAL_ATTESTED row may deploy — a known, named publication is
    // categorically different from an unknown one — and the record keeps
    // the distinction so an auditor can still tell them apart.
    const attestedVerdict = gateVerdict(PROJECT_APP_TEST, 150, SHA_150, asRecord(artifactRepo.rows[0]), DIGEST_150);
    assert.equal(attestedVerdict.ok, true);
    assert.equal(attestedVerdict.provenanceEvidence.publicationSource, 'MANUAL_ATTESTED');
    console.log('G2.d MANUAL_ATTESTED row deploys, and is still distinguishable from PIPELINE_VERIFIED: PASS');
  }

  // ══ G3 — BUILDS 9 & 10 (app-test-pfe-vermeg): pipeline publication
  // accepted ONLY when the receipt AND the registry digest agree ═══════
  {
    /** Prépare les données communes à ce contrôle. */
    const mk = () => {
      const repo = new FakeArtifactRepo();
      const svc = new DeploymentArtifactService(
        repo as any, new FakeProjectRepo(PROJECT_VERMEG) as any,
        // This pipeline really publishes: push_status SUCCESS (§1.10).
        fakeReadiness({ projectId: PROJECT_VERMEG.id, buildNumber: 10, commitSha: SHA_VERMEG, reportedPushStatus: 'SUCCESS', reportedImageTag: 'app-test-pfe-vermeg:10' }),
      );
      return { repo, svc };
    };
    const url10 = 'http://jenkins:8080/job/app-test-pfe-vermeg/10/';

    // (a) build 10, tag `10-f02b6fb4d2b2`: complete receipt, digest matches
    // what ACR confirms -> accepted as a pipeline publication.
    {
      const { repo, svc } = mk();
      const r = await svc.registerArtifact(
        { projectId: PROJECT_VERMEG.id, buildNumber: 10, commitSha: SHA_VERMEG, repository: 'app-test-pfe-vermeg', tag: '10-f02b6fb4d2b2',
          pushReceipt: { manifestDigest: DIGEST_VERMEG_10, buildNumber: 10, jenkinsBuildUrl: url10 } },
        resolver(DIGEST_VERMEG_10), ociRevision(SHA_VERMEG), { requireVerifiedProvenance: true, publicationChannel: 'CI_CALLBACK' },
      );
      assert.equal(r.publicationSource, 'PIPELINE_VERIFIED');
      assert.equal(r.publicationFailureCode, null);
      assert.equal(repo.rows[0].source, 'JENKINS_PIPELINE');
      const verdict = gateVerdict(PROJECT_VERMEG, 10, SHA_VERMEG, asRecord(repo.rows[0]), DIGEST_VERMEG_10);
      assert.equal(verdict.ok, true);
      console.log('G3.a build 10 with push receipt matching the registry digest -> PIPELINE_VERIFIED, deploy allowed: PASS');
    }

    // (b) the second artifact of the same build (tag `9-f02b6fb4d2b2`,
    // buildNumber 10 per §1.10): same rule, its OWN digest must match.
    {
      const { repo, svc } = mk();
      const r = await svc.registerArtifact(
        { projectId: PROJECT_VERMEG.id, buildNumber: 10, commitSha: SHA_VERMEG, repository: 'app-test-pfe-vermeg', tag: '9-f02b6fb4d2b2',
          pushReceipt: { manifestDigest: DIGEST_VERMEG_9, buildNumber: 10, jenkinsBuildUrl: url10 } },
        resolver(DIGEST_VERMEG_9), ociRevision(SHA_VERMEG), { requireVerifiedProvenance: true, publicationChannel: 'CI_CALLBACK' },
      );
      assert.equal(r.publicationSource, 'PIPELINE_VERIFIED');
      console.log('G3.b build 10 / tag 9-f02b6fb4d2b2 with its own matching digest -> PIPELINE_VERIFIED: PASS');
    }

    // (c) receipt digest belongs to the OTHER artifact of the same build:
    // refused. "The same pipeline pushed something" is not "it pushed THIS".
    {
      const { repo, svc } = mk();
      const r = await svc.registerArtifact(
        { projectId: PROJECT_VERMEG.id, buildNumber: 10, commitSha: SHA_VERMEG, repository: 'app-test-pfe-vermeg', tag: '10-f02b6fb4d2b2',
          pushReceipt: { manifestDigest: DIGEST_VERMEG_9, buildNumber: 10, jenkinsBuildUrl: url10 } },
        resolver(DIGEST_VERMEG_10), ociRevision(SHA_VERMEG), { requireVerifiedProvenance: true, publicationChannel: 'CI_CALLBACK' },
      );
      assert.equal(r.publicationSource, 'UNKNOWN');
      assert.equal(r.publicationFailureCode, 'PUSH_RECEIPT_DIGEST_MISMATCH');
      assert.equal(repo.rows[0].source, 'UNKNOWN');
      console.log("G3.c receipt digest from the build's OTHER artifact -> UNKNOWN/PUSH_RECEIPT_DIGEST_MISMATCH: PASS");
    }

    // (d) no receipt at all, even on a pipeline whose push_status is
    // SUCCESS: SUCCESS alone says "a push happened", never "this digest was
    // pushed by this run". Refused.
    {
      const { repo, svc } = mk();
      const r = await svc.registerArtifact(
        { projectId: PROJECT_VERMEG.id, buildNumber: 10, commitSha: SHA_VERMEG, repository: 'app-test-pfe-vermeg', tag: '10-f02b6fb4d2b2' },
        resolver(DIGEST_VERMEG_10), ociRevision(SHA_VERMEG), { requireVerifiedProvenance: true, publicationChannel: 'CI_CALLBACK' },
      );
      assert.equal(r.publicationSource, 'UNKNOWN');
      assert.equal(r.publicationFailureCode, 'PUSH_RECEIPT_MISSING');
      console.log('G3.d push_status=SUCCESS but no receipt -> UNKNOWN (SUCCESS alone binds no digest): PASS');
    }

    // (e) receipt naming a different build: refused.
    {
      const { repo, svc } = mk();
      const r = await svc.registerArtifact(
        { projectId: PROJECT_VERMEG.id, buildNumber: 10, commitSha: SHA_VERMEG, repository: 'app-test-pfe-vermeg', tag: '10-f02b6fb4d2b2',
          pushReceipt: { manifestDigest: DIGEST_VERMEG_10, buildNumber: 9, jenkinsBuildUrl: 'http://jenkins:8080/job/app-test-pfe-vermeg/9/' } },
        resolver(DIGEST_VERMEG_10), ociRevision(SHA_VERMEG), { requireVerifiedProvenance: true, publicationChannel: 'CI_CALLBACK' },
      );
      assert.equal(r.publicationSource, 'UNKNOWN');
      assert.equal(r.publicationFailureCode, 'PUSH_RECEIPT_BUILD_MISMATCH');
      console.log('G3.e receipt attributed to another build -> UNKNOWN/PUSH_RECEIPT_BUILD_MISMATCH: PASS');
    }
  }

  // ══ G4 — POST /artifacts/provenance: authorization ═════════════════
  // §1.11's authorization gap: the route stamping the STRONGEST value had
  // the WEAKEST guard (JwtOrInternalSecretGuard, no role check), while
  // /artifacts/register — stamping the weaker value — required admin.
  {
    process.env.AZURE_DEPLOY_AGENT_SECRET = process.env.AZURE_DEPLOY_AGENT_SECRET || 'test-agent-secret';
    // Imported AFTER the env var is set: AGENT_SECRET is read at module load.
    const { AzureDeployController } = require('./azure-deploy.module');

    // A service that records whether it was reached at all, and with which
    // channel — the authorization check must stop a bad caller BEFORE any
    // provenance is computed or written.
    const calls: any[] = [];
    const artifacts = { 
    /** Prépare les données nécessaires à ce scénario. */
    registerArtifact: async (_i: any, _r: any, _o: any, options: any) => { calls.push(options); return { status: 'PROVENANCE_VERIFIED', publicationSource: 'PIPELINE_VERIFIED' }; } };
    const controller = new AzureDeployController({} as any, artifacts as any, {} as any, {} as any, {} as any);
    const body = { projectId: PROJECT_APP_TEST.id, buildNumber: 151, commitSha: SHA_151, repository: 'pfe-app-test', tag: '151' } as any;

    // (a) authenticated NON-admin human -> refused outright.
    for (const role of ['developer', 'viewer', '', undefined]) {
      calls.length = 0;
      await assert.rejects(
        () => controller.artifactProvenanceCallback(body, { authChannel: 'JWT', user: { id: 'u-1', role } }),
        (e: any) => e.getStatus() === 403,
        `role=${role} must be refused`,
      );
      assert.equal(calls.length, 0, 'nothing may be registered for an unauthorized caller');
    }
    console.log('G4.a non-admin JWT on /artifacts/provenance -> 403, nothing registered: PASS');

    // (b) an admin human IS allowed through, but only as MANUAL_ADMIN — a
    // human can never obtain a pipeline-attributed publication, which is
    // what the old route handed out.
    calls.length = 0;
    await controller.artifactProvenanceCallback(body, { authChannel: 'JWT', user: { id: 'admin-9', role: 'admin' } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].publicationChannel, 'MANUAL_ADMIN');
    assert.equal(calls[0].attestedByUserId, 'admin-9');
    console.log('G4.b admin JWT on /artifacts/provenance -> allowed but forced to MANUAL_ADMIN: PASS');

    // (c) an admin with no resolvable identity -> refused (an anonymous
    // attestation would be worth nothing).
    calls.length = 0;
    await assert.rejects(
      () => controller.artifactProvenanceCallback(body, { authChannel: 'JWT', user: { role: 'admin' } }),
      (e: any) => e.getStatus() === 403,
    );
    assert.equal(calls.length, 0);
    console.log('G4.c admin with no resolvable user id -> 403 (no anonymous attestation): PASS');

    // (d) the internal CI secret is the ONLY channel that may claim a
    // pipeline publication — and even then, only the push receipt decides.
    calls.length = 0;
    await controller.artifactProvenanceCallback(body, { authChannel: 'INTERNAL_SECRET' });
    assert.equal(calls[0].publicationChannel, 'CI_CALLBACK');
    assert.equal(calls[0].attestedByUserId, null);
    console.log('G4.d internal CI secret -> CI_CALLBACK (the only channel that can reach PIPELINE_VERIFIED): PASS');

    // (e) /artifacts/register keeps its admin-only bar and its own channel.
    calls.length = 0;
    await assert.rejects(
      () => controller.registerArtifact(body, { user: { id: 'u-2', role: 'developer' } }),
      (e: any) => e.getStatus() === 403,
    );
    await controller.registerArtifact(body, { user: { id: 'admin-9', role: 'admin' } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].publicationChannel, 'MANUAL_ADMIN');
    assert.equal(calls[0].requireVerifiedProvenance, false);
    console.log('G4.e /artifacts/register still admin-only and still MANUAL_ADMIN: PASS');

    // (f) the guard itself must label the channel, otherwise the handler
    // above could not tell a pipeline from a human. Fail-closed: an
    // unlabelled request is treated as a human (never as CI).
    calls.length = 0;
    await assert.rejects(
      () => controller.artifactProvenanceCallback(body, { user: { id: 'u-3', role: 'developer' } }),
      (e: any) => e.getStatus() === 403,
      'a request with no authChannel must be treated as a human, not as CI',
    );
    assert.equal(calls.length, 0);
    console.log('G4.f request with no authChannel label -> treated as human, refused: PASS');
  }

  // ══ G5 — END-TO-END: the ledger row actually blocks an authorization ══
  // G1.b proves the artifact gate denies. This block proves the denial
  // survives all the way through the REAL governance/authorization path
  // that POST /api/azure-deploy/authorize uses — with the real
  // DeploymentArtifactService wired in, not a stub — and that it cannot be
  // overridden by an administrator.
  {
    class FakeGenericRepo {
      rows: any[] = [];
      /** Recherche l’élément correspondant à l’identifiant. */
      async findOne({ where }: any) { return this.rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) || null; }
      /** Crée et enregistre un nouvel élément. */
      create(partial: any) { return { id: `row-${this.rows.length + 1}`, createdAt: new Date(), ...partial }; }
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
      getRepository: (cls: any) => (cls === Project ? this.projectRepo : cls === DeploymentAttempt ? this.attemptRepo : this) }) };
    }
    // A deliberately CLEAN risk report: quality gate OK, 0 critical CVE,
    // tests PASSED. So if the authorization is denied, the publication is
    // the ONLY possible cause — the test cannot pass for the wrong reason.
    const cleanReport = { rawData: { enrichedData: { sonar: { quality_gate: 'OK' }, trivy: { critical: 0 }, owasp: { critical: 0 }, stages: { tests: { stage: 'tests', status: 'PASSED', blocking: false, executed: true, findings: [], findingCount: 0, source: 'JENKINS' } } } } };

    /** Prépare les données nécessaires à ce scénario. */
    const build = async (opts: { pushStatus: string | null; receipt?: any }) => {
      const artifactRepo = new FakeArtifactRepo();
      const projectRepo = new FakeGenericRepo();
      projectRepo.rows = [PROJECT_APP_TEST];
      /** Recherche l’élément correspondant à l’identifiant. */
      (projectRepo as any).findOne = async () => PROJECT_APP_TEST;
      const readiness = fakeReadiness({ projectId: PROJECT_APP_TEST.id, buildNumber: 151, commitSha: SHA_151, reportedPushStatus: opts.pushStatus, reportedImageTag: 'pfe-app-test:151' });
      const artifacts = new DeploymentArtifactService(artifactRepo as any, { 
      /** Recherche l’élément correspondant à l’identifiant. */
      findOne: async () => PROJECT_APP_TEST } as any, readiness);
      await artifacts.registerArtifact(
        { projectId: PROJECT_APP_TEST.id, buildNumber: 151, commitSha: SHA_151, repository: 'pfe-app-test', tag: '151', ...(opts.receipt ? { pushReceipt: opts.receipt } : {}) },
        resolver(MANIFEST_151), ociRevision(SHA_151), { requireVerifiedProvenance: true, publicationChannel: 'CI_CALLBACK' },
      );
      const attemptRepo = new FakeGenericRepo();
      const authRepo = new FakeAuthRepo(projectRepo, attemptRepo);
      const svc = new DeploymentAuthorizationService(
        authRepo as any, { 
        /** Recherche l’élément correspondant à l’identifiant. */
        findOne: async () => PROJECT_APP_TEST } as any,
        { 
        /** Recherche l’élément correspondant à l’identifiant. */
        findOne: async () => cleanReport } as any, attemptRepo as any, readiness, artifacts,
      );
      return { svc, authRepo, artifactRepo, redigest: resolver(MANIFEST_151), oci: ociRevision(SHA_151) };
    };

    // (a) the tag-151 row: governance must report TECHNICALLY_IMPOSSIBLE
    // and name the publication as the failed control.
    const unproven = await build({ pushStatus: 'NOT_ATTEMPTED' });
    const preview = await unproven.svc.getGovernancePreview(PROJECT_APP_TEST.id, 151, '151', unproven.redigest, unproven.oci);
    assert.equal(preview.decision, 'TECHNICALLY_IMPOSSIBLE');
    assert.equal(preview.artifact.publicationSource, 'UNKNOWN');
    assert.ok(preview.failedControls.some(c => c.includes('DEPLOY_ARTIFACT_PUBLICATION_UNVERIFIED')), `failedControls=${JSON.stringify(preview.failedControls)}`);
    // The source-code identity is still reported as resolved — the preview
    // does not smear the publication failure onto the commit.
    assert.equal(preview.buildIdentity.resolved, true);
    assert.equal(preview.buildIdentity.commitSha, SHA_151);
    console.log('G5.a governance preview: TECHNICALLY_IMPOSSIBLE on publication, commit identity still resolved: PASS');

    // (b) no authorization can be created — not even by an admin asking
    // for a full CRITICAL_OVERRIDE. TECHNICALLY_IMPOSSIBLE has no mode.
    for (const mode of ['NORMAL', 'CONDITIONAL_EXCEPTION', 'CRITICAL_OVERRIDE'] as const) {
      const denied = await unproven.svc.createAuthorization(
        { projectId: PROJECT_APP_TEST.id, mainBuildNumber: 151, mode, reason: "Je prends la responsabilité de ce déploiement malgré l'alerte.",
          acknowledgements: { identity: true, risk: true, rollback: true, publication: true },
          confirmationPhrase: 'DEPLOYER MALGRE RISQUE CRITIQUE', requestedByUserId: 'admin-9', requestedByRole: 'admin' },
        unproven.redigest, unproven.oci,
      );
      assert.equal(denied.ok, false, `mode=${mode} must be denied`);
      assert.equal(denied.governanceClass, 'TECHNICALLY_IMPOSSIBLE');
      assert.equal(denied.failureCode, 'DEPLOY_TECHNICALLY_IMPOSSIBLE_NO_OVERRIDE');
    }
    assert.equal(unproven.authRepo.rows.length, 0, 'no authorization row may be persisted');
    console.log('G5.b admin CRITICAL_OVERRIDE on an UNKNOWN publication -> denied, nothing persisted: PASS');

    // (c) CONTRAST — the same build, same clean report, same everything,
    // but WITH a complete push receipt and push_status=SUCCESS: the
    // authorization IS created. This is what proves (a)/(b) are caused by
    // the publication specifically, and that the new gate is not simply
    // refusing everything.
    const proven = await build({
      pushStatus: 'SUCCESS',
      receipt: { manifestDigest: MANIFEST_151, buildNumber: 151, jenkinsBuildUrl: 'http://jenkins:8080/job/pfe-app-test/151/' },
    });
    assert.equal(proven.artifactRepo.rows[0].publicationSource, 'PIPELINE_VERIFIED');
    const okPreview = await proven.svc.getGovernancePreview(PROJECT_APP_TEST.id, 151, '151', proven.redigest, proven.oci);
    assert.notEqual(okPreview.decision, 'TECHNICALLY_IMPOSSIBLE');
    assert.equal(okPreview.artifact.publicationSource, 'PIPELINE_VERIFIED');
    assert.ok(!okPreview.failedControls.some(c => c.includes('PUBLICATION')), `failedControls=${JSON.stringify(okPreview.failedControls)}`);
    console.log(`G5.c CONTRAST: same build with a proven publication -> ${okPreview.decision} (not TECHNICALLY_IMPOSSIBLE): PASS`);
  }

  console.log('qa-def-11-publication-provenance.spec: ALL PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
