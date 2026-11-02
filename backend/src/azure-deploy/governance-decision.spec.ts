// Teste le composant « governance-decision » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { evaluateGovernanceDecision } from './governance-decision';
import { resolveBuildIdentity, toCommitResolutionResult } from './build-identity';
import { evaluateProvenDeploymentArtifact } from './deployment-identity';
import { BuildIdentityResolutionResult, DeploymentArtifactRecord, EnvironmentResolutionResult, GovernanceRiskSignals } from './deployment-identity.types';

const SHA_A = 'a'.repeat(40);
const DIGEST_A = `sha256:${'1'.repeat(64)}`;

const okEnvironment: EnvironmentResolutionResult = {
  ok: true,
  environmentIdentity: { provider: 'azure-container-instances', resourceGroup: 'rg-pfe-devsecops', registry: 'acrpfedevsecops', targetName: 'aci-pfe-app-test', region: 'francecentral', environmentIdentityHash: 'x' },
  failureCode: null,
};
/** Prépare les données nécessaires à ce scénario. */
const resolvedIdentity = (sha = SHA_A, build = 150): BuildIdentityResolutionResult =>
  resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-1', mainBuildNumber: build, sourceCommitSha: sha, repository: 'souhaiel11/pfe-app-test' });
/** Prépare les données nécessaires à ce scénario. */
const unresolvedIdentity = (): BuildIdentityResolutionResult =>
  resolveBuildIdentity({ projectId: 'proj-1', incidentId: 'inc-1', mainBuildNumber: 150, sourceCommitSha: null, repository: null });

/** Prépare les données nécessaires à ce scénario. */
const record = (over: Partial<DeploymentArtifactRecord> = {}): DeploymentArtifactRecord =>
  // QA-DEF-11 — see build-identity.spec.ts: a deployable record must now
  // carry a proven publication, not just a proven source-code identity.
  ({ projectId: 'proj-1', buildNumber: 150, commitSha: SHA_A, registry: 'acrpfedevsecops', repository: 'pfe-app-test', tag: '150', digest: DIGEST_A, source: 'JENKINS_PIPELINE', provenanceVerified: true, publicationSource: 'PIPELINE_VERIFIED', ...over });

/** Prépare les données nécessaires à ce scénario. */
const okProvenance = () => {
  const commit = toCommitResolutionResult(resolvedIdentity());
  return evaluateProvenDeploymentArtifact({ commit, environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'pfe-app-test', candidateArtifact: record(), freshLookup: { found: true, digest: DIGEST_A } });
};
/** Prépare les données nécessaires à ce scénario. */
const badProvenance = () => {
  const commit = toCommitResolutionResult(resolvedIdentity());
  return evaluateProvenDeploymentArtifact({ commit, environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'pfe-app-test', candidateArtifact: record(), freshLookup: { found: true, digest: `sha256:${'2'.repeat(64)}` } });
};

const cleanRisk: GovernanceRiskSignals = {
  securityValidationApplicability: 'APPLICABLE',
  testsStatus: 'PASSED', sonarQualityGate: 'OK', trivyCritical: 0, owaspCritical: 0,
  judgeDecision: 'AUTO_FIX', unresolvedBlockingCount: 0, requiredStages: [],
};

/** Exécute les étapes principales de ce programme. */
async function main() {
  {
    const r = evaluateGovernanceDecision({ buildIdentity: resolvedIdentity(), artifactProvenance: okProvenance(), environment: okEnvironment, risk: cleanRisk });
    assert.equal(r.class, 'READY');
    console.log('G1 identity/provenance valid + all controls pass -> READY: PASS');
  }
  {
    const risk: GovernanceRiskSignals = { ...cleanRisk, securityValidationApplicability: 'MISSING' };
    const r = evaluateGovernanceDecision({ buildIdentity: resolvedIdentity(), artifactProvenance: okProvenance(), environment: okEnvironment, risk });
    assert.equal(r.class, 'CRITICAL_RISK');
    assert.ok(r.criticalRiskReasons.some(x => x.includes('WF3')));
    console.log('G2 identity/provenance valid + validation missing -> risk state, not technical impossible: PASS');
  }
  {
    const risk: GovernanceRiskSignals = { ...cleanRisk, trivyCritical: 13 };
    const r = evaluateGovernanceDecision({ buildIdentity: resolvedIdentity(), artifactProvenance: okProvenance(), environment: okEnvironment, risk });
    assert.equal(r.class, 'CRITICAL_RISK');
    console.log('G3 identity/provenance valid + critical CVE -> CRITICAL_RISK: PASS');
  }
  {
    const risk: GovernanceRiskSignals = { ...cleanRisk, judgeDecision: 'BLOCK' };
    const r = evaluateGovernanceDecision({ buildIdentity: resolvedIdentity(), artifactProvenance: okProvenance(), environment: okEnvironment, risk });
    assert.equal(r.class, 'CRITICAL_RISK');
    console.log('G4 governance BLOCK -> CRITICAL_RISK: PASS');
  }
  {
    const risk: GovernanceRiskSignals = { ...cleanRisk, testsStatus: 'NOT_RUN' };
    const r = evaluateGovernanceDecision({ buildIdentity: resolvedIdentity(), artifactProvenance: okProvenance(), environment: okEnvironment, risk });
    assert.equal(r.class, 'CRITICAL_RISK');
    console.log('G5 tests skipped -> CRITICAL_RISK (current policy treats required tests as blocking): PASS');
  }
  {
    const r = evaluateGovernanceDecision({ buildIdentity: unresolvedIdentity(), artifactProvenance: null, environment: okEnvironment, risk: cleanRisk });
    assert.equal(r.class, 'TECHNICALLY_IMPOSSIBLE');
    console.log('G6 identity missing + security otherwise clean -> TECHNICALLY_IMPOSSIBLE: PASS');
  }
  {
    // G7 -- the function takes no user/role/"isAdmin" input at all; a
    // digest mismatch classifies identically regardless of who's asking.
    const r = evaluateGovernanceDecision({ buildIdentity: resolvedIdentity(), artifactProvenance: badProvenance(), environment: okEnvironment, risk: cleanRisk });
    assert.equal(r.class, 'TECHNICALLY_IMPOSSIBLE');
    console.log('G7 digest mismatch + admin user -> still TECHNICALLY_IMPOSSIBLE (no role input exists to bypass it): PASS');
  }
  {
    // Bonus — confirms the CONDITIONAL branch (the one defensible rule:
    // a required stage reporting WARNING without being blocking, proven
    // real on pfe-app-test's own live readiness this session).
    const risk: GovernanceRiskSignals = { ...cleanRisk, requiredStages: [{ stage: 'zap', status: 'WARNING', blocking: false, required: true }] };
    const r = evaluateGovernanceDecision({ buildIdentity: resolvedIdentity(), artifactProvenance: okProvenance(), environment: okEnvironment, risk });
    assert.equal(r.class, 'CONDITIONAL');
    console.log('bonus: non-blocking WARNING stage -> CONDITIONAL: PASS');
  }

  // ── Real build #150 fixture (§8/§26) ────────────────────────────────
  // projectId=3aa1c9b9-e114-40e4-884b-ebc7aa32e002, build=150,
  // sourceCommitSha=7ae0f954f99628b69ce9b42f42c1e2acc8568d99, digest=
  // sha256:2027f8ed1c023e8d34e30e5848a3ed780831b8e52945543bd00f7c3ed521718d,
  // OCI revision = same sha, validation = absent (all live-proven 2A.11/2A.12).
  {
    const REAL_SHA = '7ae0f954f99628b69ce9b42f42c1e2acc8568d99';
    const REAL_DIGEST = 'sha256:2027f8ed1c023e8d34e30e5848a3ed780831b8e52945543bd00f7c3ed521718d';
    const buildIdentity = resolveBuildIdentity({
      projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', incidentId: 'a657d5ae-fbe0-47cb-b954-451bd81636aa',
      mainBuildNumber: 150, sourceCommitSha: REAL_SHA, repository: 'souhaiel11/pfe-app-test',
    });
    assert.equal(buildIdentity.ok, true, 'BUILD_IDENTITY_PROVEN');

    const commit = toCommitResolutionResult(buildIdentity);
    const artifact = evaluateProvenDeploymentArtifact({
      commit, environment: okEnvironment, targetRegistry: 'acrpfedevsecops', targetRepository: 'pfe-app-test',
      candidateArtifact: { projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', buildNumber: 150, commitSha: REAL_SHA, registry: 'acrpfedevsecops', repository: 'pfe-app-test', tag: '150', digest: REAL_DIGEST, source: 'JENKINS_PIPELINE', provenanceVerified: true, publicationSource: 'PIPELINE_VERIFIED' },
      freshLookup: { found: true, digest: REAL_DIGEST },
      freshRevisionCheck: { available: true, revision: REAL_SHA },
    });
    assert.equal(artifact.ok, true, 'ARTIFACT_PROVENANCE_PROVEN');

    // Real pfe-app-test readiness state, read live this session (Phase 2A.10's
    // GET /azure-deploy/ready after configuring azureConfig): governance
    // BLOCK, Sonar ERROR, 13 Trivy criticals, 23 OWASP criticals, tests
    // SKIPPED, validation absent for this build.
    const realRisk: GovernanceRiskSignals = {
      securityValidationApplicability: 'MISSING',
      testsStatus: 'NOT_RUN', sonarQualityGate: 'ERROR', trivyCritical: 13, owaspCritical: 23,
      judgeDecision: 'BLOCK', unresolvedBlockingCount: 37,
      requiredStages: [
        { stage: 'zap', status: 'WARNING', blocking: false, required: true },
        { stage: 'owasp', status: 'FAILED', blocking: true, required: true },
        { stage: 'sonar', status: 'FAILED', blocking: true, required: true },
        { stage: 'trivy', status: 'FAILED', blocking: true, required: true },
      ],
    };
    const decision = evaluateGovernanceDecision({ buildIdentity, artifactProvenance: artifact, environment: okEnvironment, risk: realRisk });
    assert.equal(decision.class, 'CRITICAL_RISK', 'build #150 must classify CRITICAL_RISK, not TECHNICALLY_IMPOSSIBLE');
    assert.equal(decision.technicallyImpossibleReasons.length, 0);
    console.log(`BUILD_150_FIXTURE: BUILD_IDENTITY_PROVEN=YES ARTIFACT_PROVENANCE_PROVEN=YES SECURITY_VALIDATION_PRESENT=NO GOVERNANCE_CLASS=${decision.class}: PASS`);
  }

  console.log('governance-decision.spec: ALL PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
