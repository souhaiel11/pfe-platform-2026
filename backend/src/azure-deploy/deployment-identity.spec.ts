// Teste le composant « deployment-identity » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import {
  resolveValidatedDeploymentCommit,
  evaluateArtifactIdentity,
  deriveDeploymentEnvironmentIdentity,
  computeDeploymentIdentityHash,
  evaluateProvenDeploymentArtifact,
} from './deployment-identity';
import { CommitResolutionResult, DeploymentArtifactRecord, EnvironmentResolutionResult } from './deployment-identity.types';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const DIGEST_A = `sha256:${'1'.repeat(64)}`;
const DIGEST_B = `sha256:${'2'.repeat(64)}`;

/** Exécute les étapes principales de ce programme. */
async function main() {
  // ── Commit identity ────────────────────────────────────────────────
  {
    const r = resolveValidatedDeploymentCommit({ reportBuildNumber: 42, validation: { buildNumber: 42, validationStatus: 'VALIDATED', passed: true, checkoutSha: SHA_A, expectedPrHeadSha: SHA_A } });
    assert.equal(r.ok, true);
    assert.equal(r.commitSha, SHA_A);
    assert.equal(r.buildNumber, 42);
    console.log('C1 validated build + same commit -> PASS: PASS');
  }
  {
    const r = resolveValidatedDeploymentCommit({ reportBuildNumber: 42, validation: { buildNumber: 42, validationStatus: 'VALIDATED', passed: true, checkoutSha: null, expectedPrHeadSha: null } });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_COMMIT_MISSING');
    console.log('C2 build matches but commit missing -> FAIL DEPLOY_COMMIT_MISSING: PASS');
  }
  {
    const r = resolveValidatedDeploymentCommit({ reportBuildNumber: 42, validation: { buildNumber: 42, validationStatus: 'VALIDATED', passed: true, checkoutSha: SHA_A, expectedPrHeadSha: SHA_B } });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_COMMIT_MISMATCH');
    console.log('C3 build matches but commit differs -> FAIL DEPLOY_COMMIT_MISMATCH: PASS');
  }
  {
    const r = resolveValidatedDeploymentCommit({ reportBuildNumber: 42, reportCommitSha: SHA_B, validation: { buildNumber: 42, validationStatus: 'VALIDATED', passed: true, checkoutSha: SHA_A, expectedPrHeadSha: SHA_A } });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_COMMIT_AMBIGUOUS');
    console.log('C4 incident commit differs from report commit -> FAIL: PASS');
  }
  {
    const r = resolveValidatedDeploymentCommit({
      reportBuildNumber: 42, reportCommitSha: SHA_C,
      validation: { buildNumber: 42, validationStatus: 'VALIDATED', passed: true, checkoutSha: SHA_A, expectedPrHeadSha: SHA_B, mergeAuthorization: { forSha: SHA_C } },
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_COMMIT_AMBIGUOUS');
    console.log('C5 multiple conflicting commit SHAs -> FAIL DEPLOY_COMMIT_AMBIGUOUS: PASS');
  }
  {
    const r = resolveValidatedDeploymentCommit({ reportBuildNumber: 43, validation: { buildNumber: 42, validationStatus: 'VALIDATED', passed: true, checkoutSha: SHA_A, expectedPrHeadSha: SHA_A } });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_BUILD_MISMATCH');
    console.log('C6 stale validation from previous build -> FAIL DEPLOY_BUILD_MISMATCH: PASS');
  }
  {
    const input = { reportBuildNumber: 42, validation: { buildNumber: 42, validationStatus: 'VALIDATED', passed: true, checkoutSha: SHA_A, expectedPrHeadSha: SHA_A } };
    assert.deepEqual(resolveValidatedDeploymentCommit(input), resolveValidatedDeploymentCommit(input));
    console.log('C7 current exact validated commit -> stable canonical result: PASS');
  }

  // ── Artifact identity ──────────────────────────────────────────────
  const base = { targetRegistry: 'acrpfedevsecops', targetRepository: 'devsecops-testbed' };
  {
    const r = evaluateArtifactIdentity({ ...base, requestedTag: 'v1.2.3', lookup: { found: true, registry: 'acrpfedevsecops', repository: 'devsecops-testbed', tag: 'v1.2.3', digest: DIGEST_A } });
    assert.equal(r.ok, true);
    assert.equal(r.artifactDigest, DIGEST_A);
    console.log('A1 artifact digest resolved -> PASS: PASS');
  }
  {
    const r = evaluateArtifactIdentity({ ...base, requestedTag: 'v1.2.3', lookup: { found: true, registry: 'acrpfedevsecops', repository: 'devsecops-testbed', tag: 'v1.2.3', digest: null } });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_DIGEST_MISSING');
    console.log('A2 tag exists but digest unavailable -> FAIL DEPLOY_ARTIFACT_DIGEST_MISSING: PASS');
  }
  {
    const r = evaluateArtifactIdentity({ ...base, requestedTag: 'latest', lookup: null });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE');
    console.log('A3 arbitrary "latest" cannot establish identity: PASS');
  }
  {
    const r = evaluateArtifactIdentity({ ...base, requestedTag: 'v1.2.3', expectedDigest: DIGEST_B, lookup: { found: true, registry: 'acrpfedevsecops', repository: 'devsecops-testbed', tag: 'v1.2.3', digest: DIGEST_A } });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_DIGEST_MISMATCH');
    console.log('A4 requested tag points to wrong digest -> FAIL DEPLOY_ARTIFACT_DIGEST_MISMATCH: PASS');
  }
  {
    const r = evaluateArtifactIdentity({ ...base, requestedTag: 'v1.2.3', expectedDigest: DIGEST_A, lookup: { found: true, registry: 'acrpfedevsecops', repository: 'devsecops-testbed', tag: 'v1.2.3', digest: DIGEST_A } });
    assert.equal(r.ok, true);
    console.log('A5 validated artifact digest matches -> PASS: PASS');
  }
  {
    const r = evaluateArtifactIdentity({ ...base, requestedTag: 'v1.2.3', lookup: { found: true, registry: 'acrpfedevsecops', repository: 'some-other-repo', tag: 'v1.2.3', digest: DIGEST_A } });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_REPOSITORY_MISMATCH');
    console.log('A6 repository mismatch -> FAIL DEPLOY_ARTIFACT_REPOSITORY_MISMATCH: PASS');
  }
  {
    const r = evaluateArtifactIdentity({ ...base, requestedTag: 'v1.2.3', lookup: { found: true, registry: 'some-other-registry', repository: 'devsecops-testbed', tag: 'v1.2.3', digest: DIGEST_A } });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_REGISTRY_MISMATCH');
    console.log('A7 registry mismatch -> FAIL DEPLOY_ARTIFACT_REGISTRY_MISMATCH: PASS');
  }
  {
    const input = { ...base, requestedTag: 'v1.2.3', lookup: { found: true, registry: 'acrpfedevsecops', repository: 'devsecops-testbed', tag: 'v1.2.3', digest: DIGEST_A } };
    assert.deepEqual(evaluateArtifactIdentity(input), evaluateArtifactIdentity(input));
    console.log('A8 artifact identity canonical/hash stable: PASS');
  }

  // ── Environment identity ───────────────────────────────────────────
  const cfg = { provider: 'azure-container-instances', resourceGroup: 'rg-pfe-devsecops', registry: 'acrpfedevsecops', targetName: 'aci-devsecops-testbed', region: 'francecentral' };
  {
    const r1 = deriveDeploymentEnvironmentIdentity(cfg);
    const r2 = deriveDeploymentEnvironmentIdentity({ ...cfg });
    assert.equal(r1.environmentIdentity?.environmentIdentityHash, r2.environmentIdentity?.environmentIdentityHash);
    console.log('E1 same azureConfig -> same environment identity: PASS');
  }
  {
    const r1 = deriveDeploymentEnvironmentIdentity(cfg);
    const r2 = deriveDeploymentEnvironmentIdentity({ ...cfg, resourceGroup: 'rg-other' });
    assert.notEqual(r1.environmentIdentity?.environmentIdentityHash, r2.environmentIdentity?.environmentIdentityHash);
    console.log('E2 resourceGroup changes -> identity changes: PASS');
  }
  {
    const r1 = deriveDeploymentEnvironmentIdentity(cfg);
    const r2 = deriveDeploymentEnvironmentIdentity({ ...cfg, registry: 'acrother' });
    assert.notEqual(r1.environmentIdentity?.environmentIdentityHash, r2.environmentIdentity?.environmentIdentityHash);
    console.log('E3 registry changes -> identity changes: PASS');
  }
  {
    const r1 = deriveDeploymentEnvironmentIdentity(cfg);
    const r2 = deriveDeploymentEnvironmentIdentity({ ...cfg, targetName: 'aci-other' });
    assert.notEqual(r1.environmentIdentity?.environmentIdentityHash, r2.environmentIdentity?.environmentIdentityHash);
    console.log('E4 targetName changes -> identity changes: PASS');
  }
  {
    const r = deriveDeploymentEnvironmentIdentity(null);
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ENVIRONMENT_UNRESOLVED');
    console.log('E5 missing target config -> DEPLOY_ENVIRONMENT_UNRESOLVED: PASS');
  }

  // ── Canonical deployment identity hash (printed for the Phase 2A report) ──
  {
    const env = deriveDeploymentEnvironmentIdentity(cfg);
    const identity = { projectId: 'proj-1', commitSha: SHA_A, artifactDigest: DIGEST_A, environmentIdentity: env.environmentIdentity! };
    const h1 = computeDeploymentIdentityHash(identity);
    const h2 = computeDeploymentIdentityHash(identity);
    assert.equal(h1, h2);
    console.log('deploymentIdentityHash stable: PASS');
    console.log(`DEPLOYMENT_IDENTITY_SHA256 (fixture projectId=proj-1, commitSha=${SHA_A}, artifactDigest=${DIGEST_A}, environment=${JSON.stringify(cfg)}) = ${h1}`);
  }

  /** Prépare les données nécessaires à ce scénario. */
  const okCommit = (buildNumber: number, commitSha: string): CommitResolutionResult =>
    ({ ok: true, buildNumber, commitSha, evidence: {}, failureCode: null });
  const okEnvironment: EnvironmentResolutionResult = deriveDeploymentEnvironmentIdentity(cfg);
  const artifactBase = { projectId: 'proj-1', registry: 'acrpfedevsecops', repository: 'devsecops-testbed', source: 'MANUAL_REGISTERED' as const };
  /** Prépare les données nécessaires à ce scénario. */
  const record = (over: Partial<DeploymentArtifactRecord> = {}): DeploymentArtifactRecord =>
    // QA-DEF-11 — publication must be proven too, not just identity.
    ({ ...artifactBase, buildNumber: 42, commitSha: SHA_A, tag: 'build-42', digest: DIGEST_A, provenanceVerified: true, publicationSource: 'PIPELINE_VERIFIED', ...over });

  {
    const r = evaluateProvenDeploymentArtifact({ commit: okCommit(42, SHA_A), environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'devsecops-testbed', candidateArtifact: record() });
    assert.equal(r.ok, true);
    assert.equal(r.digest, DIGEST_A);
    console.log('P1 validated commit + artifact OCI revision match -> PASS: PASS');
  }
  {
    const r = evaluateProvenDeploymentArtifact({ commit: okCommit(42, SHA_A), environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'devsecops-testbed', candidateArtifact: null });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE');
    console.log('P2 image digest exists but no commit provenance -> FAIL: PASS');
  }
  {
    const r = evaluateProvenDeploymentArtifact({ commit: okCommit(42, SHA_A), environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'devsecops-testbed', candidateArtifact: record({ commitSha: SHA_B }) });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_COMMIT_MISMATCH');
    console.log('P3 image revision differs from validated commit -> FAIL: PASS');
  }
  {
    const r = evaluateProvenDeploymentArtifact({
      commit: okCommit(42, SHA_A), environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'devsecops-testbed',
      candidateArtifact: record(), freshLookup: { found: true, digest: DIGEST_B },
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_DIGEST_MISMATCH');
    console.log('P4 mutable tag moved to different digest -> FAIL: PASS');
  }
  {
    const r = evaluateProvenDeploymentArtifact({ commit: okCommit(42, SHA_A), environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'devsecops-testbed', candidateArtifact: record({ buildNumber: 42, commitSha: SHA_C }) });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_COMMIT_MISMATCH');
    console.log('P5 build number correct but artifact commit wrong -> FAIL: PASS');
  }
  {
    const r = evaluateProvenDeploymentArtifact({ commit: okCommit(42, SHA_A), environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'devsecops-testbed', candidateArtifact: record({ repository: 'some-other-repo' }) });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_REPOSITORY_MISMATCH');
    console.log('P6 correct commit but repository wrong -> FAIL: PASS');
  }
  {
    const r = evaluateProvenDeploymentArtifact({
      commit: okCommit(42, SHA_A), environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'devsecops-testbed',
      candidateArtifact: record(), freshLookup: { found: true, digest: DIGEST_A },
    });
    assert.equal(r.ok, true);
    console.log('P7 correct commit/repo/digest -> provenance proven: PASS');
  }
  {
    // Currently validated build is #50, but the only artifact on file is
    // for an OLDER, previously-validated build (#42) — must not authorize.
    const r = evaluateProvenDeploymentArtifact({ commit: okCommit(50, SHA_C), environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'devsecops-testbed', candidateArtifact: record({ buildNumber: 42, commitSha: SHA_A }) });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_BUILD_MISMATCH');
    console.log('P8 previous artifact for old build cannot authorize current build: PASS');
  }
  {
    // Same as P4, framed as "after authorization": a fresh re-resolve
    // right before dispatch must deny if the tag has since moved.
    const r = evaluateProvenDeploymentArtifact({
      commit: okCommit(42, SHA_A), environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'devsecops-testbed',
      candidateArtifact: record(), freshLookup: { found: true, digest: DIGEST_B },
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_DIGEST_MISMATCH');
    console.log('P9 changing tag after authorization invalidates dispatch if digest differs: PASS');
  }
  {
    // No DeploymentArtifact record at all for a "latest"-tagged lookup —
    // a bare tag (mutable or not) never establishes provenance by itself.
    const r = evaluateProvenDeploymentArtifact({ commit: okCommit(42, SHA_A), environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'devsecops-testbed', candidateArtifact: null });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE');
    console.log('P10 latest alone never establishes provenance: PASS');
  }

  console.log('deployment-identity.spec: ALL PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
