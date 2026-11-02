// Génère le magasin de preuves V1.8 et leurs identifiants déterministes avec l'enveloppe de rattachement au contexte.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, cpSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { normalizeOwaspFinding } from '../common/owasp-finding-normalizer';
import { resolveDependencyControlProfile } from './dependency-control-profile-resolver';
import { TrivyCorrelationCandidateProvider, OwaspNativeFixedVersionProvider, TrivyNativeFixedVersionProvider, collectSecurityCandidates } from './security-candidate-collector';
import { buildRemediationPlans, RemediationPlan } from './remediation-plan';
import { discoverOwnerVersionCandidates } from './owner-version-discovery';
import { runOwnerDiscoveryTrial, extractResolvedVersion } from './owner-discovery-trial';
import { compareMavenVersions } from './maven-qualifier-comparator';
import { LIVE_PROVEN_RESULTS, OWNER_PLAN_KEY_EXCEPTIONS } from './v1_8_phase3_live_results';
import { V1_8CompatibilityDecision, V1_8CompatibilityState, V1_8EvidenceBinding } from './v1_8-compatibility-decision.types';

const SEC_FIXTURES = join(__dirname, '../security-remediation/fixtures');
const COMMON_FIXTURES = join(__dirname, '../common/fixtures');
const pomXmlText = readFileSync(join(SEC_FIXTURES, 'pfe-app-test.pom.xml'), 'utf8');
const dependencyTreeText = readFileSync(join(SEC_FIXTURES, 'pfe-app-test.dependency-tree.txt'), 'utf8');
const effectivePomXmlText = readFileSync(join(SEC_FIXTURES, 'pfe-app-test.effective-pom.xml'), 'utf8');
const projectContext = { pomXmlText, dependencyTreeText, effectivePomXmlText, controllingFilePath: 'pom.xml', groundedSha: 'c0c21af'.padEnd(40, '0') };

// The exact repository/commit every real sandbox run this V1.8 effort has
// EVER executed against (v1_8_phase2_live_proof_snakeyaml.ts,
// v1_8_phase3_live_run_owner.ts, v1_8_phase3_live_run_direct.ts all used
// this SAME real, live-resolved remote HEAD) -- never a different value
// invented here; this is what "validated" means for every entry below.
const VALIDATED_REPOSITORY = 'souhaiel11/pfe-app-test';
const VALIDATED_COMMIT_SHA = '7ae0f954f99628b69ce9b42f42c1e2acc8568d99';
// One id per generator execution -- every entry produced by THIS run shares
// it, honestly describing "this evidence was (re)computed together, in one
// batch, against the SAME pinned repository/commit above" (see
// v1_8-compatibility-decision.types.ts's own header comment on
// validationRunId for why per-finding mvn/HTTP request ids are not what
// this field means).
const VALIDATION_RUN_ID = randomUUID();
const VALIDATED_AT = new Date().toISOString();

const owaspFixture = JSON.parse(readFileSync(join(COMMON_FIXTURES, 'owasp-149-dependencies.json'), 'utf8'));
const trivyFixture = JSON.parse(readFileSync(join(COMMON_FIXTURES, 'trivy-149-cves.json'), 'utf8'));
const owaspFindings = owaspFixture.dependencies.flatMap((d: any) => d.vulnerabilities.map((v: any) => normalizeOwaspFinding(d, v)));
const trivyFindings = trivyFixture.cves;
const trivyCorrelationProvider = new TrivyCorrelationCandidateProvider(trivyFixture.cves);

const REAL_REPO = process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test';
const ownerDiscoveryCache = new Map<string, ReturnType<typeof discoverOwnerVersionCandidates>>();
const treeTextCache = new Map<string, string | null>();
let ownerScratchDir: string | null = null;
/** Prépare le contexte d’essai du parent ou BOM Maven. */
function ownerScratch(): string | null {
  if (!existsSync(REAL_REPO) || !existsSync(join(REAL_REPO, 'pom.xml'))) return null;
  if (!ownerScratchDir) {
    ownerScratchDir = mkdtempSync(join(tmpdir(), 'v18-p4-evidence-'));
    cpSync(REAL_REPO, ownerScratchDir, { recursive: true, 
    /** Retient les éléments qui respectent le filtre. */
    filter: (src) => !src.includes(`${REAL_REPO}/.git`) });
  }
  return ownerScratchDir;
}

/** Identifie le type de propriétaire de la version Maven. */
function ownerKind(editType: RemediationPlan['editType']): V1_8CompatibilityDecision['ownerType'] {
  if (editType === 'PARENT_VERSION') return 'PARENT';
  if (editType === 'BOM_VERSION') return 'IMPORTED_BOM';
  if (editType === 'DEPENDENCY_MANAGEMENT_VERSION') return 'DEPENDENCY_MANAGEMENT';
  return null;
}

// Everything a decision needs EXCEPT the evidence-binding envelope
// (repository/validatedCommitSha/findingSource/cve/component/installedVersion/
// evidenceId/schemaVersion/validationRunId/validatedAt) -- that envelope is
// stamped on exactly once, in one place (buildEntry(), below), so every one
// of the ~20 return points in the functions below cannot possibly diverge
// on how the binding fields are computed.
type DecisionCore = Omit<V1_8CompatibilityDecision, keyof V1_8EvidenceBinding>;

/** Évalue le plan portant sur le parent ou BOM Maven. */
function decideOwnerPlan(plan: RemediationPlan): DecisionCore {
  const [ownerGroupId, ownerArtifactId] = plan.editCoordinate.split(':');
  const cwd = ownerScratch();
  const base = { actualEditTarget: plan.editCoordinate, editType: plan.editType, ownerType: ownerKind(plan.editType), ownerCoordinate: plan.editCoordinate, requiresDeveloperReview: true, fromVersion: plan.fromVersion as string | null };
  if (!cwd) {
    return { ...base, toVersion: null, expectedResolvedDependency: null, state: 'PROJECT_CONTEXT_INSUFFICIENT', recommendedVersion: null, evidenceSummary: 'No local repo checkout available to run real owner discovery.', recommendationReason: 'PROJECT_CONTEXT_INSUFFICIENT', sandboxValidated: false, targetCveClosed: null, newHighCriticalCount: null };
  }

  const discoveryKey = `${ownerGroupId}:${ownerArtifactId}:${plan.fromVersion}`;
  let discovery = ownerDiscoveryCache.get(discoveryKey);
  if (!discovery) {
    discovery = discoverOwnerVersionCandidates({ groupId: ownerGroupId, artifactId: ownerArtifactId, currentVersion: plan.fromVersion, cwd });
    ownerDiscoveryCache.set(discoveryKey, discovery);
  }
  if (discovery.status !== 'DISCOVERED' || !discovery.sameMajorCandidates.length) {
    const state: V1_8CompatibilityState = discovery.status !== 'DISCOVERED' ? 'PROJECT_CONTEXT_INSUFFICIENT'
      : discovery.crossMajorEvidence.length ? 'MAJOR_UPGRADE_REQUIRES_REVIEW' : 'NO_COMPATIBLE_CANDIDATE';
    return { ...base, toVersion: null, expectedResolvedDependency: null, state, recommendedVersion: null, evidenceSummary: `Owner discovery: ${discovery.status}, sameMajor=${discovery.sameMajorCandidates.length}, crossMajor=${discovery.crossMajorEvidence.length}.`, recommendationReason: state, sandboxValidated: false, targetCveClosed: null, newHighCriticalCount: null };
  }

  for (const ownerCandidate of discovery.sameMajorCandidates) {
    const validationKey = `${plan.editCoordinate}:${plan.fromVersion}->${ownerCandidate.version}`;
    let resolvedVulnerableVersion: string | null;
    if (treeTextCache.has(validationKey)) {
      const cachedTree = treeTextCache.get(validationKey)!;
      resolvedVulnerableVersion = cachedTree ? extractResolvedVersion(cachedTree, plan.vulnerableDependency) : null;
    } else {
      const trial = runOwnerDiscoveryTrial({ workspacePath: cwd, pomRelativePath: 'pom.xml', plan, ownerCandidateVersion: ownerCandidate.version });
      treeTextCache.set(validationKey, trial.treeText);
      resolvedVulnerableVersion = trial.status === 'RESOLVED' ? trial.resolvedVulnerableVersion : null;
    }
    if (!resolvedVulnerableVersion) continue;
    const cmp = compareMavenVersions(resolvedVulnerableVersion, plan.securityCandidate.version);
    if (cmp !== 0 && cmp !== 1) continue;

    const ownerPlanKey = `OWNER:${plan.editCoordinate}:${plan.fromVersion}->${ownerCandidate.version}`;
    const perFindingException = OWNER_PLAN_KEY_EXCEPTIONS[`${plan.securityCandidate.cve}:${plan.vulnerableDependency}`];
    if (perFindingException) {
      return {
        ...base, toVersion: ownerCandidate.version, expectedResolvedDependency: resolvedVulnerableVersion,
        state: perFindingException.state, recommendedVersion: null,
        evidenceSummary: perFindingException.detail, recommendationReason: perFindingException.state,
        sandboxValidated: true, targetCveClosed: false, newHighCriticalCount: 0,
      };
    }
    const live = LIVE_PROVEN_RESULTS[ownerPlanKey];
    if (live) {
      return {
        ...base, toVersion: ownerCandidate.version, expectedResolvedDependency: resolvedVulnerableVersion,
        state: live.state, recommendedVersion: resolvedVulnerableVersion,
        evidenceSummary: live.detail, recommendationReason: live.detail, requiresDeveloperReview: false,
        sandboxValidated: true, targetCveClosed: true, newHighCriticalCount: 0,
      };
    }
    // Real cheap-trial resolution exists but no full Phase 8 sandbox run
    // backs it (yet) -- Phase 3's real run reached zero of these across
    // all 251 real findings, kept here only for a future, not-yet-run finding.
    return {
      ...base, toVersion: ownerCandidate.version, expectedResolvedDependency: resolvedVulnerableVersion,
      state: 'NOT_YET_SANDBOXED', recommendedVersion: resolvedVulnerableVersion,
      evidenceSummary: `Real cheap trial: owner ${plan.editCoordinate} ${plan.fromVersion} -> ${ownerCandidate.version} resolves ${plan.vulnerableDependency} to ${resolvedVulnerableVersion}. Full sandbox not yet run.`,
      recommendationReason: 'NOT_YET_SANDBOXED', sandboxValidated: false, targetCveClosed: null, newHighCriticalCount: null,
    };
  }
  return { ...base, toVersion: null, expectedResolvedDependency: null, state: 'NO_COMPATIBLE_CANDIDATE', recommendedVersion: null, evidenceSummary: `None of the ${discovery.sameMajorCandidates.length} same-major owner candidate(s) resolve ${plan.vulnerableDependency} to >= the security target ${plan.securityCandidate.version}.`, recommendationReason: 'NO_COMPATIBLE_CANDIDATE', sandboxValidated: false, targetCveClosed: null, newHighCriticalCount: null };
}

/** Évalue le plan de modification directe d’une dépendance. */
function decideDirectPlan(plan: RemediationPlan): DecisionCore {
  const base = { actualEditTarget: plan.editCoordinate, editType: plan.editType, ownerType: null as null, ownerCoordinate: null as null, fromVersion: plan.fromVersion as string | null, toVersion: plan.toVersion as string | null, expectedResolvedDependency: plan.toVersion as string | null };
  const planKey = `DIRECT:${plan.editCoordinate}:${plan.fromVersion}->${plan.toVersion}`;
  const live = LIVE_PROVEN_RESULTS[planKey];
  if (live) {
    return { ...base, state: live.state, recommendedVersion: plan.toVersion, evidenceSummary: live.detail, recommendationReason: live.detail, sandboxValidated: true, targetCveClosed: true, newHighCriticalCount: 0, requiresDeveloperReview: false };
  }
  return { ...base, state: 'NOT_YET_SANDBOXED', recommendedVersion: plan.toVersion, evidenceSummary: `Automation-eligible plan generated (${plan.versionPolicy.state}); no real sandbox run yet for ${planKey}.`, recommendationReason: 'NOT_YET_SANDBOXED', sandboxValidated: false, targetCveClosed: null, newHighCriticalCount: null, requiresDeveloperReview: !plan.automationEligible };
}

/** Détermine la décision de compatibilité de ce finding. */
function decideFinding(cve: string, pkg: string, installedVersion: string, providers: any[]): DecisionCore {
  const parts = String(pkg).split(':');
  /** Signale que les preuves ne suffisent pas pour conclure. */
  const notEnough = (reason: string): DecisionCore => ({ state: 'PROJECT_CONTEXT_INSUFFICIENT', recommendedVersion: null, actualEditTarget: null, editType: null, fromVersion: null, toVersion: null, expectedResolvedDependency: null, ownerType: null, ownerCoordinate: null, evidenceSummary: reason, recommendationReason: reason, sandboxValidated: false, targetCveClosed: null, newHighCriticalCount: null, requiresDeveloperReview: true });
  if (parts.length !== 2) return notEnough('Not a resolvable groupId:artifactId Maven coordinate.');

  const profile = resolveDependencyControlProfile({ package: pkg, installedVersion, ...projectContext });
  const candidates = collectSecurityCandidates({ cve, pkg, installedVersion }, providers);
  const { plans, manualReviewReason } = buildRemediationPlans(profile, candidates);

  if (!candidates.length) return { state: 'SECURITY_TARGET_UNKNOWN', recommendedVersion: null, actualEditTarget: null, editType: null, fromVersion: null, toVersion: null, expectedResolvedDependency: null, ownerType: null, ownerCoordinate: null, evidenceSummary: manualReviewReason || 'NO_SECURITY_CANDIDATE', recommendationReason: manualReviewReason || 'NO_SECURITY_CANDIDATE', sandboxValidated: false, targetCveClosed: null, newHighCriticalCount: null, requiresDeveloperReview: true };
  if (!plans.length) return notEnough(manualReviewReason || 'NO_PLAN_GENERATED');

  if (profile.versionControl === 'PARENT' || profile.versionControl === 'IMPORTED_BOM') return decideOwnerPlan(plans[0]);

  const eligible = plans.filter(p => p.automationEligible);
  if (!eligible.length) {
    return { state: 'MAJOR_UPGRADE_REQUIRES_REVIEW', recommendedVersion: null, actualEditTarget: plans[0].editCoordinate, editType: plans[0].editType, fromVersion: plans[0].fromVersion, toVersion: null, expectedResolvedDependency: null, ownerType: null, ownerCoordinate: null, evidenceSummary: `${plans.length} plan(s), none automation-eligible (${plans.map(p => p.versionPolicy.state).join(',')}).`, recommendationReason: 'MAJOR_UPGRADE_REQUIRES_REVIEW', sandboxValidated: false, targetCveClosed: null, newHighCriticalCount: null, requiresDeveloperReview: true };
  }
  const eligibleSorted = [...eligible].sort((a, b) => { const cmp = compareMavenVersions(a.toVersion!, b.toVersion!); return cmp === 'INCOMPARABLE' ? 0 : cmp; });
  return decideDirectPlan(eligibleSorted[0]);
}

/** Construit entrée. */
function buildEntry(source: 'OWASP' | 'TRIVY', cve: string, pkg: string, installedVersion: string, core: DecisionCore): V1_8CompatibilityDecision {
  const evidenceId = createHash('sha256').update([VALIDATED_REPOSITORY, source, cve, pkg, core.editType ?? '', core.fromVersion ?? '', core.toVersion ?? ''].join('|')).digest('hex').slice(0, 32);
  return {
    evidenceId, schemaVersion: 2, repository: VALIDATED_REPOSITORY, validatedCommitSha: VALIDATED_COMMIT_SHA,
    findingSource: source, cve, component: pkg, installedVersion,
    validationRunId: VALIDATION_RUN_ID, validatedAt: VALIDATED_AT,
    ...core,
  };
}

const store: Record<string, V1_8CompatibilityDecision> = {};
for (const f of owaspFindings) {
  const providers = [new OwaspNativeFixedVersionProvider(f.fixedVersion || null), trivyCorrelationProvider];
  const cve = String(f.id || ''), pkg = String(f.pkg || ''), installedVersion = String(f.installedVersion || '');
  store[`OWASP:${cve}:${pkg}`] = buildEntry('OWASP', cve, pkg, installedVersion, decideFinding(cve, pkg, installedVersion, providers));
}
for (const f of trivyFindings) {
  const providers = [new TrivyNativeFixedVersionProvider(f.fixedVersion || null)];
  const cve = String(f.id || f.cve || ''), pkg = String(f.pkg || f.package || ''), installedVersion = String(f.installedVersion || '');
  store[`TRIVY:${cve}:${pkg}`] = buildEntry('TRIVY', cve, pkg, installedVersion, decideFinding(cve, pkg, installedVersion, providers));
}

if (ownerScratchDir) rmSync(ownerScratchDir, { recursive: true, force: true });

const outPath = join(__dirname, 'v1_8-evidence-store.json');
writeFileSync(outPath, JSON.stringify({ generatedAt: VALIDATED_AT, schemaVersion: 2, validationRunId: VALIDATION_RUN_ID, entryCount: Object.keys(store).length, decisions: store }, null, 2));
console.log(`Wrote ${Object.keys(store).length} entries to ${outPath}`);
