// Teste le composant « build-identity » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { resolveBuildIdentity, extractSecurityValidationEvidence, crossCheckBuildIdentityAgainstValidation, toCommitResolutionResult } from './build-identity';
import { evaluateProvenDeploymentArtifact } from './deployment-identity';
import { DeploymentArtifactRecord, EnvironmentResolutionResult } from './deployment-identity.types';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const DIGEST_A = `sha256:${'1'.repeat(64)}`;
const DIGEST_B = `sha256:${'2'.repeat(64)}`;

/** Exécute les étapes principales de ce programme. */
async function main() {
  // ── B1-B6 — build identity ──────────────────────────────────────────
  {
    const r = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-150', mainBuildNumber: 150, sourceCommitSha: SHA_A, repository: 'souhaiel11/pfe-app-test' });
    assert.equal(r.ok, true);
    assert.equal(r.buildIdentity?.commitSha, SHA_A);
    assert.equal(r.buildIdentity?.mainBuildNumber, 150);
    console.log('B1 normal build + valid sourceCommitSha -> resolved: PASS');
  }
  {
    // No WF3 validation at all -- resolveBuildIdentity doesn't even take a
    // validation input, so "still resolved" is structural, not incidental.
    const r = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-150', mainBuildNumber: 150, sourceCommitSha: SHA_A, repository: 'souhaiel11/pfe-app-test' });
    const validation = extractSecurityValidationEvidence(undefined);
    assert.equal(r.ok, true);
    assert.equal(validation.present, false);
    console.log('B2 no WF3 validation -> still resolved: PASS');
  }
  {
    const r = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-150', mainBuildNumber: 150, sourceCommitSha: 'not-a-sha', repository: null });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_COMMIT_MISSING');
    console.log('B3 malformed sourceCommitSha -> technically impossible: PASS');
  }
  {
    const r = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-150', mainBuildNumber: 150, sourceCommitSha: SHA_A, secondarySourceCommitSha: SHA_B, repository: null });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_COMMIT_AMBIGUOUS');
    console.log('B4 conflicting SHA evidence -> technically impossible: PASS');
  }
  {
    // B5 -- no "current repo HEAD" input exists on this function's
    // signature at all; feeding it a sha returns EXACTLY that sha, never
    // something substituted from elsewhere.
    const r1 = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-150', mainBuildNumber: 150, sourceCommitSha: SHA_A, repository: null });
    const r2 = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-150', mainBuildNumber: 150, sourceCommitSha: SHA_A, secondarySourceCommitSha: SHA_A, repository: null });
    assert.equal(r1.buildIdentity?.commitSha, SHA_A);
    assert.equal(r2.buildIdentity?.commitSha, SHA_A);
    console.log('B5 never substitute current repo HEAD (no such input exists; result always echoes the supplied sourceCommitSha): PASS');
  }
  {
    // B6 -- real evidence: incident #147's validation.buildNumber (the
    // PR-validation job's OWN counter, value 6) is wildly different from
    // the main job's build number (147). crossCheckBuildIdentityAgainstValidation
    // takes NO build-number input at all -- it cannot possibly compare them.
    const buildIdentity = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-147', mainBuildNumber: 147, sourceCommitSha: SHA_A, repository: null });
    const validation = extractSecurityValidationEvidence({ validationStatus: 'VALIDATED', passed: true, checkoutSha: SHA_B, buildNumber: 6, expectedPrHeadSha: SHA_B });
    const cross = crossCheckBuildIdentityAgainstValidation(buildIdentity.buildIdentity!.commitSha, validation);
    assert.equal(cross.ok, true);
    assert.equal(cross.failureCode, null);
    console.log('B6 PR validation counter (6) != main build counter (147) -> does not cause false mismatch: PASS');
  }

  // ── A1-A6 — artifact provenance, bound to BuildIdentity ─────────────
  const okEnvironment: EnvironmentResolutionResult = {
    ok: true,
    environmentIdentity: { provider: 'azure-container-instances', resourceGroup: 'rg-pfe-devsecops', registry: 'acrpfedevsecops', targetName: 'aci-pfe-app-test', region: 'francecentral', environmentIdentityHash: 'x' },
    failureCode: null,
  };
  /** Prépare les données nécessaires à ce scénario. */
  const record = (over: Partial<DeploymentArtifactRecord> = {}): DeploymentArtifactRecord =>
    // QA-DEF-11 — publicationSource is now a REQUIRED part of a record
    // that can authorize a deployment: the gate refuses UNKNOWN/absent.
    // Default to a proven publication here so these cases keep testing
    // build identity; the publication-specific cases live in
    // qa-def-11-publication-provenance.spec.ts.
    ({ projectId: 'proj-1', buildNumber: 150, commitSha: SHA_A, registry: 'acrpfedevsecops', repository: 'pfe-app-test', tag: '150', digest: DIGEST_A, source: 'JENKINS_PIPELINE', provenanceVerified: true, publicationSource: 'PIPELINE_VERIFIED', ...over });

  {
    const buildIdentity = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-150', mainBuildNumber: 150, sourceCommitSha: SHA_A, repository: 'souhaiel11/pfe-app-test' });
    const commit = toCommitResolutionResult(buildIdentity);
    const r = evaluateProvenDeploymentArtifact({ commit, environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'pfe-app-test', candidateArtifact: record(), freshLookup: { found: true, digest: DIGEST_A } });
    assert.equal(r.ok, true);
    console.log('A1 build commit == OCI revision + digest stable -> provenance verified: PASS');
  }
  {
    // A2 -- no WF3 validation object exists anywhere in this input at
    // all; evaluateProvenDeploymentArtifact never takes one.
    const buildIdentity = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-150', mainBuildNumber: 150, sourceCommitSha: SHA_A, repository: null });
    const commit = toCommitResolutionResult(buildIdentity);
    const r = evaluateProvenDeploymentArtifact({ commit, environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'pfe-app-test', candidateArtifact: record() });
    assert.equal(r.ok, true);
    console.log('A2 validation absent -> provenance still verified: PASS');
  }
  {
    const buildIdentity = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-150', mainBuildNumber: 150, sourceCommitSha: SHA_A, repository: null });
    const commit = toCommitResolutionResult(buildIdentity);
    const r = evaluateProvenDeploymentArtifact({ commit, environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'pfe-app-test', candidateArtifact: record({ commitSha: SHA_B }) });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_COMMIT_MISMATCH');
    console.log('A3 OCI mismatch -> technically impossible: PASS');
  }
  {
    const buildIdentity = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-150', mainBuildNumber: 150, sourceCommitSha: SHA_A, repository: null });
    const commit = toCommitResolutionResult(buildIdentity);
    const r = evaluateProvenDeploymentArtifact({ commit, environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'pfe-app-test', candidateArtifact: record(), freshLookup: { found: true, digest: DIGEST_B } });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_DIGEST_MISMATCH');
    console.log('A4 digest moved -> technically impossible: PASS');
  }
  {
    const buildIdentity = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-150', mainBuildNumber: 150, sourceCommitSha: SHA_A, repository: null });
    const commit = toCommitResolutionResult(buildIdentity);
    const r = evaluateProvenDeploymentArtifact({ commit, environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'pfe-app-test', candidateArtifact: record({ repository: 'some-other-repo' }) });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_REPOSITORY_MISMATCH');
    console.log('A5 repository mismatch -> technically impossible: PASS');
  }
  {
    const buildIdentity = resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-150', mainBuildNumber: 150, sourceCommitSha: SHA_A, repository: null });
    const commit = toCommitResolutionResult(buildIdentity);
    const r = evaluateProvenDeploymentArtifact({ commit, environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'pfe-app-test', candidateArtifact: record({ registry: 'some-other-registry' }) });
    assert.equal(r.ok, false);
    assert.equal(r.failureCode, 'DEPLOY_ARTIFACT_REGISTRY_MISMATCH');
    console.log('A6 registry mismatch -> technically impossible: PASS');
  }

  console.log('build-identity.spec: ALL PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
