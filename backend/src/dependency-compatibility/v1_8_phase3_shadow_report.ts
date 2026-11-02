// Génère le rapport d'observation V1.8 intégrant les résultats de qualification de la phase suivante.
import { readFileSync, existsSync, mkdtempSync, rmSync, cpSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { normalizeOwaspFinding } from '../common/owasp-finding-normalizer';
import { resolveMavenProvenance } from '../security-remediation/maven-provenance-resolver';
import { resolveDependencyControlProfile } from './dependency-control-profile-resolver';
import { TrivyCorrelationCandidateProvider, OwaspNativeFixedVersionProvider, TrivyNativeFixedVersionProvider, collectSecurityCandidates } from './security-candidate-collector';
import { buildRemediationPlans, RemediationPlan } from './remediation-plan';
import { discoverOwnerVersionCandidates } from './owner-version-discovery';
import { runOwnerDiscoveryTrial, extractResolvedVersion } from './owner-discovery-trial';
import { compareMavenVersions } from './maven-qualifier-comparator';
import { LIVE_PROVEN_RESULTS, OWNER_PLAN_KEY_EXCEPTIONS } from './v1_8_phase3_live_results';

const SEC_FIXTURES = join(__dirname, '../security-remediation/fixtures');
const COMMON_FIXTURES = join(__dirname, '../common/fixtures');
const pomXmlText = readFileSync(join(SEC_FIXTURES, 'pfe-app-test.pom.xml'), 'utf8');
const dependencyTreeText = readFileSync(join(SEC_FIXTURES, 'pfe-app-test.dependency-tree.txt'), 'utf8');
const effectivePomXmlText = readFileSync(join(SEC_FIXTURES, 'pfe-app-test.effective-pom.xml'), 'utf8');
const projectContext = { pomXmlText, dependencyTreeText, effectivePomXmlText, controllingFilePath: 'pom.xml', groundedSha: 'c0c21af'.padEnd(40, '0') };

const owaspFixture = JSON.parse(readFileSync(join(COMMON_FIXTURES, 'owasp-149-dependencies.json'), 'utf8'));
const trivyFixture = JSON.parse(readFileSync(join(COMMON_FIXTURES, 'trivy-149-cves.json'), 'utf8'));
const owaspFindings = owaspFixture.dependencies.flatMap((d: any) => d.vulnerabilities.map((v: any) => normalizeOwaspFinding(d, v)));
const trivyFindings = trivyFixture.cves;
const trivyCorrelationProvider = new TrivyCorrelationCandidateProvider(trivyFixture.cves);

type ShadowState = 'VALIDATED_RECOMMENDED' | 'VALIDATED_ALTERNATIVES' | 'SECURITY_TARGET_UNKNOWN'
  | 'PROJECT_CONTEXT_INSUFFICIENT' | 'MAJOR_UPGRADE_REQUIRES_REVIEW' | 'NO_COMPATIBLE_CANDIDATE'
  | 'VALIDATION_FAILED' | 'NOT_YET_SANDBOXED';

interface FindingRow {
  source: 'OWASP' | 'TRIVY';
  cve: string;
  pkg: string;
  rawKind: string;
  versionControl: string;
  promoted: boolean;
  planKey: string | null; // deduplication key for DIRECT_EXPLICIT/PROPERTY plans: editCoordinate:fromVersion->toVersion
  state: ShadowState;
  detail: string;
}

const REAL_REPO = process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test';
const ownerDiscoveryCache = new Map<string, ReturnType<typeof discoverOwnerVersionCandidates>>();
let ownerScratchDir: string | null = null;
let ownerCandidatesDiscovered = 0;
let ownerCandidatesSentToCheapTrial = 0;
const dedupKeys = new Set<string>();
let uniqueCheapTrialRuns = 0;
const ownerNotYetTargets = new Map<string, { pkg: string; cve: string; source: string; securityTargetVersion: string; resolvedVersion: string; fromVersion: string }[]>();
// V1.8 Phase 3 — real Phase 11 deduplication: the underlying `mvn
// dependency:tree` for a given (owner, fromVersion, candidateVersion) edit
// is byte-identical no matter which vulnerable dependency is later checked
// against it (H2 and spring-web both owned by the same Spring Boot parent
// bump, say) -- cache the real tree TEXT once per edit and re-extract for
// each dependency, never re-running the same real Maven operation twice.
const treeTextCache = new Map<string, string | null>();

/** Prépare le contexte d’essai du parent ou BOM Maven. */
function ownerScratch(): string | null {
  if (!existsSync(REAL_REPO) || !existsSync(join(REAL_REPO, 'pom.xml'))) return null;
  if (!ownerScratchDir) {
    ownerScratchDir = mkdtempSync(join(tmpdir(), 'v18-p3-shadow-owner-'));
    cpSync(REAL_REPO, ownerScratchDir, { recursive: true, 
    /** Retient les éléments qui respectent le filtre. */
    filter: (src) => !src.includes(`${REAL_REPO}/.git`) });
  }
  return ownerScratchDir;
}

/** Classe propriétaire plan. */
function classifyOwnerPlan(plan: RemediationPlan): { state: ShadowState; detail: string; ownerCandidateVersion: string | null; resolvedVersion: string | null } {
  const [ownerGroupId, ownerArtifactId] = plan.editCoordinate.split(':');
  const cwd = ownerScratch();
  if (!cwd) return { state: 'PROJECT_CONTEXT_INSUFFICIENT', detail: 'No local repo checkout available in this environment for real owner discovery.', ownerCandidateVersion: null, resolvedVersion: null };

  const discoveryKey = `${ownerGroupId}:${ownerArtifactId}:${plan.fromVersion}`;
  let discovery = ownerDiscoveryCache.get(discoveryKey);
  if (!discovery) {
    discovery = discoverOwnerVersionCandidates({ groupId: ownerGroupId, artifactId: ownerArtifactId, currentVersion: plan.fromVersion, cwd });
    ownerDiscoveryCache.set(discoveryKey, discovery);
    ownerCandidatesDiscovered += discovery.sameMajorCandidates.length + discovery.crossMajorEvidence.length;
  }
  if (discovery.status !== 'DISCOVERED') return { state: 'PROJECT_CONTEXT_INSUFFICIENT', detail: `Owner discovery: ${discovery.status}`, ownerCandidateVersion: null, resolvedVersion: null };
  if (!discovery.sameMajorCandidates.length) {
    return discovery.crossMajorEvidence.length
      ? { state: 'MAJOR_UPGRADE_REQUIRES_REVIEW', detail: `Only cross-major owner candidates exist (${discovery.crossMajorEvidence.map(c => c.version).join(', ')}); no same-major candidate to try.`, ownerCandidateVersion: null, resolvedVersion: null }
      : { state: 'NO_COMPATIBLE_CANDIDATE', detail: 'No same-major or cross-major owner candidate found at all.', ownerCandidateVersion: null, resolvedVersion: null };
  }

  for (const ownerCandidate of discovery.sameMajorCandidates) {
    ownerCandidatesSentToCheapTrial++;
    const validationKey = `${plan.editCoordinate}:${plan.fromVersion}->${ownerCandidate.version}`;
    let resolvedVulnerableVersion: string | null;
    if (treeTextCache.has(validationKey)) {
      // Real Maven operation already ran once for this EXACT owner edit --
      // reuse its real output text, just extract a different dependency
      // from it. Never re-invokes mvn.
      const cachedTree = treeTextCache.get(validationKey)!;
      resolvedVulnerableVersion = cachedTree ? extractResolvedVersion(cachedTree, plan.vulnerableDependency) : null;
    } else {
      dedupKeys.add(validationKey); uniqueCheapTrialRuns++;
      console.error('  [real mvn dependency:tree]', validationKey);
      const trial = runOwnerDiscoveryTrial({ workspacePath: cwd, pomRelativePath: 'pom.xml', plan, ownerCandidateVersion: ownerCandidate.version });
      treeTextCache.set(validationKey, trial.treeText);
      resolvedVulnerableVersion = trial.status === 'RESOLVED' ? trial.resolvedVulnerableVersion : null;
    }
    if (!resolvedVulnerableVersion) continue;
    const cmp = compareMavenVersions(resolvedVulnerableVersion, plan.securityCandidate.version);
    if (cmp === 0 || cmp === 1) {
      const liveKey = `OWNER:${plan.editCoordinate}:${plan.fromVersion}->${ownerCandidate.version}`;
      const live = LIVE_PROVEN_RESULTS[liveKey];
      if (live) return { state: live.state, detail: live.detail, ownerCandidateVersion: ownerCandidate.version, resolvedVersion: resolvedVulnerableVersion };
      return {
        state: 'NOT_YET_SANDBOXED',
        detail: `Phase 6 cheap trial (real): owner ${plan.editCoordinate} ${plan.fromVersion} -> ${ownerCandidate.version} resolves ${plan.vulnerableDependency} to ${resolvedVulnerableVersion} (>= security target ${plan.securityCandidate.version}). Full Phase 8 not run for this plan.`,
        ownerCandidateVersion: ownerCandidate.version, resolvedVersion: resolvedVulnerableVersion,
      };
    }
  }
  return { state: 'NO_COMPATIBLE_CANDIDATE', detail: `None of the ${discovery.sameMajorCandidates.length} same-major owner candidate(s) tried (${discovery.sameMajorCandidates.map(c => c.version).join(', ')}) resolve ${plan.vulnerableDependency} to >= the security target ${plan.securityCandidate.version}.`, ownerCandidateVersion: null, resolvedVersion: null };
}

/** Classe le finding. */
function classifyFinding(source: 'OWASP' | 'TRIVY', cve: string, pkg: string, installedVersion: string, providers: any[]): FindingRow {
  const parts = String(pkg).split(':');
  if (parts.length !== 2) return { source, cve, pkg, rawKind: 'UNRESOLVED', versionControl: 'UNRESOLVED_COORDINATE', promoted: false, planKey: null, state: 'PROJECT_CONTEXT_INSUFFICIENT', detail: 'Not a resolvable groupId:artifactId Maven coordinate.' };

  const rawProvenance = resolveMavenProvenance({ package: pkg, installedVersion, pomXmlText, dependencyTreeText, controllingFilePath: 'pom.xml', groundedSha: projectContext.groundedSha });
  const profile = resolveDependencyControlProfile({ package: pkg, installedVersion, ...projectContext });
  const candidates = collectSecurityCandidates({ cve, pkg, installedVersion }, providers);
  const { plans, manualReviewReason } = buildRemediationPlans(profile, candidates);
  const versionControl = profile.versionControl;
  const promoted = rawProvenance.kind === 'TRANSITIVE' && versionControl !== 'TRANSITIVE_MANAGED';

  if (!candidates.length) return { source, cve, pkg, rawKind: rawProvenance.kind, versionControl, promoted, planKey: null, state: 'SECURITY_TARGET_UNKNOWN', detail: manualReviewReason || 'NO_SECURITY_CANDIDATE' };
  if (!plans.length) return { source, cve, pkg, rawKind: rawProvenance.kind, versionControl, promoted, planKey: null, state: 'PROJECT_CONTEXT_INSUFFICIENT', detail: manualReviewReason || 'NO_PLAN_GENERATED' };

  if (versionControl === 'PARENT' || versionControl === 'IMPORTED_BOM') {
    const best = classifyOwnerPlan(plans[0]);
    const planKey = best.ownerCandidateVersion ? `OWNER:${plans[0].editCoordinate}:${plans[0].fromVersion}->${best.ownerCandidateVersion}` : null;
    if (best.state === 'NOT_YET_SANDBOXED' && planKey && best.resolvedVersion) {
      const existing = ownerNotYetTargets.get(planKey) ?? [];
      if (!existing.some(t => t.pkg === pkg && t.cve === cve)) {
        existing.push({ pkg, cve, source, securityTargetVersion: plans[0].securityCandidate.version, resolvedVersion: best.resolvedVersion, fromVersion: plans[0].fromVersion });
      }
      ownerNotYetTargets.set(planKey, existing);
    }
    // A finding-specific exception (Phase 3: e.g. CVE-2024-24549's real
    // rescan did NOT close even though the shared owner build's OTHER
    // targets did) always overrides the uniform per-owner-plan-key result --
    // never let one finding's real evidence silently borrow another's verdict.
    const exception = OWNER_PLAN_KEY_EXCEPTIONS[`${cve}:${pkg}`];
    if (exception) return { source, cve, pkg, rawKind: rawProvenance.kind, versionControl, promoted, planKey, state: exception.state, detail: exception.detail };
    return { source, cve, pkg, rawKind: rawProvenance.kind, versionControl, promoted, planKey, state: best.state, detail: best.detail };
  }

  const eligible = plans.filter(p => p.automationEligible);
  if (!eligible.length) return { source, cve, pkg, rawKind: rawProvenance.kind, versionControl, promoted, planKey: null, state: 'MAJOR_UPGRADE_REQUIRES_REVIEW', detail: `${plans.length} plan(s), none automation-eligible (${plans.map(p => p.versionPolicy.state).join(',')}).` };

  const eligibleSorted = [...eligible].sort((a, b) => {
    const cmp = compareMavenVersions(a.toVersion!, b.toVersion!);
    return cmp === 'INCOMPARABLE' ? 0 : cmp;
  });
  const plan = eligibleSorted[0];
  const planKey = `DIRECT:${plan.editCoordinate}:${plan.fromVersion}->${plan.toVersion}`;
  const live = LIVE_PROVEN_RESULTS[planKey];
  if (live) return { source, cve, pkg, rawKind: rawProvenance.kind, versionControl, promoted, planKey, state: live.state, detail: live.detail };
  return { source, cve, pkg, rawKind: rawProvenance.kind, versionControl, promoted, planKey, state: 'NOT_YET_SANDBOXED', detail: `${eligible.length} automation-eligible plan(s) generated (${versionControl}); plan key ${planKey}.` };
}

const rows: FindingRow[] = [];
for (const f of owaspFindings) {
  const providers = [new OwaspNativeFixedVersionProvider(f.fixedVersion || null), trivyCorrelationProvider];
  rows.push(classifyFinding('OWASP', String(f.id || ''), String(f.pkg || ''), String(f.installedVersion || ''), providers));
}
for (const f of trivyFindings) {
  const providers = [new TrivyNativeFixedVersionProvider(f.fixedVersion || null)];
  rows.push(classifyFinding('TRIVY', String(f.id || f.cve || ''), String(f.pkg || f.package || ''), String(f.installedVersion || ''), providers));
}

if (ownerScratchDir) rmSync(ownerScratchDir, { recursive: true, force: true });

/** Compte les éléments correspondants. */
function count(source: 'OWASP' | 'TRIVY', state: ShadowState): number {
  return rows.filter(r => r.source === source && r.state === state).length;
}

const transitiveBefore = rows.filter(r => r.rawKind === 'TRANSITIVE').length;
const transitivePromoted = rows.filter(r => r.promoted).length;
const transitiveStillUnresolved = transitiveBefore - transitivePromoted;

console.log('══════════════════════════════════════════════════');
console.log('V1.8 Phase 3 — TRANSITIVE OWNER RESOLUTION + FINAL 251-FINDING SHADOW REPORT');
console.log('══════════════════════════════════════════════════');
console.log('OWASP_TOTAL:', owaspFindings.length);
console.log('TRIVY_TOTAL:', trivyFindings.length);
console.log();
console.log('TRANSITIVE_BEFORE:', transitiveBefore);
console.log('TRANSITIVE_PROMOTED_TO_OWNER:', transitivePromoted);
console.log('TRANSITIVE_STILL_UNRESOLVED:', transitiveStillUnresolved);
console.log('Promoted findings:');
for (const r of rows) if (r.promoted) console.log(' -', r.source, r.cve, r.pkg, ': TRANSITIVE ->', r.versionControl);
console.log();
for (const source of ['OWASP', 'TRIVY'] as const) {
  console.log(`── ${source} ──`);
  for (const state of ['VALIDATED_RECOMMENDED', 'VALIDATED_ALTERNATIVES', 'SECURITY_TARGET_UNKNOWN', 'PROJECT_CONTEXT_INSUFFICIENT', 'MAJOR_UPGRADE_REQUIRES_REVIEW', 'NO_COMPATIBLE_CANDIDATE', 'VALIDATION_FAILED', 'NOT_YET_SANDBOXED'] as ShadowState[]) {
    console.log(`${source}_${state}:`, count(source, state));
  }
}
console.log();
console.log('OWNER_CANDIDATES_DISCOVERED:', ownerCandidatesDiscovered);
console.log('CANDIDATES_SENT_TO_CHEAP_TRIAL:', ownerCandidatesSentToCheapTrial);
console.log('UNIQUE_CHEAP_TRIAL_RUNS (deduplicated):', uniqueCheapTrialRuns);
console.log();
console.log('All PARENT/IMPORTED_BOM-owned findings:');
for (const r of rows) if (r.versionControl === 'PARENT' || r.versionControl === 'IMPORTED_BOM') console.log(' -', r.source, r.cve, r.pkg, '(promoted=' + r.promoted + ') ->', r.state, ':', r.detail);
console.log();
console.log('DISTINCT NOT_YET_SANDBOXED plan keys (dedup unit for remaining real sandbox work):');
const notYetKeys = new Set<string>();
for (const r of rows) if (r.state === 'NOT_YET_SANDBOXED' && r.planKey) notYetKeys.add(r.planKey);
for (const k of notYetKeys) console.log(' -', k, '(findings:', rows.filter(r => r.planKey === k).map(r => `${r.source}/${r.cve}`).join(', '), ')');
console.log('CANDIDATES_REQUESTED (NOT_YET_SANDBOXED rows):', rows.filter(r => r.state === 'NOT_YET_SANDBOXED').length);
console.log('UNIQUE_PLANS (distinct plan keys among them):', notYetKeys.size);

console.log('\nOWNER_NOT_YET_TARGETS_JSON_START');
console.log(JSON.stringify(Object.fromEntries(ownerNotYetTargets), null, 2));
console.log('OWNER_NOT_YET_TARGETS_JSON_END');

console.log('\nv1_8_phase3_shadow_report.ts: DONE');
