// Produit un rapport de comparaison V1.8 en mode observation à partir des données d'évaluation ; outil de qualification, pas un contrôleur HTTP.
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { normalizeOwaspFinding } from '../common/owasp-finding-normalizer';
import { resolveDependencyControlProfile } from './dependency-control-profile-resolver';
import { TrivyCorrelationCandidateProvider, OwaspNativeFixedVersionProvider, TrivyNativeFixedVersionProvider, collectSecurityCandidates } from './security-candidate-collector';
import { buildRemediationPlans, RemediationPlan } from './remediation-plan';
import { discoverOwnerVersionCandidates } from './owner-version-discovery';
import { runOwnerDiscoveryTrial } from './owner-discovery-trial';
import { compareMavenVersions } from './maven-qualifier-comparator';

const SEC_FIXTURES = join(__dirname, '../security-remediation/fixtures');
const COMMON_FIXTURES = join(__dirname, '../common/fixtures');
const pomXmlText = readFileSync(join(SEC_FIXTURES, 'pfe-app-test.pom.xml'), 'utf8');
const dependencyTreeText = readFileSync(join(SEC_FIXTURES, 'pfe-app-test.dependency-tree.txt'), 'utf8');
const projectContext = { pomXmlText, dependencyTreeText, controllingFilePath: 'pom.xml', groundedSha: 'c0c21af'.padEnd(40, '0') };

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
  versionControl: string;
  state: ShadowState;
  detail: string;
}

import { mkdtempSync, rmSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

const REAL_REPO = process.env.SECURITY_TEST_REPO || '/home/souhaiel/pfe-2026/pfe-app-test';
const ownerDiscoveryCache = new Map<string, ReturnType<typeof discoverOwnerVersionCandidates>>();
let ownerScratchDir: string | null = null;
let ownerCandidatesDiscovered = 0;
let ownerCandidatesSentToCheapTrial = 0;
let uniqueSandboxRuns = 0;
const dedupKeys = new Set<string>();

/** Prépare le contexte d’essai du parent ou BOM Maven. */
function ownerScratch(): string | null {
  if (!existsSync(REAL_REPO) || !existsSync(join(REAL_REPO, 'pom.xml'))) return null;
  if (!ownerScratchDir) {
    ownerScratchDir = mkdtempSync(join(tmpdir(), 'v18-p2-shadow-owner-'));
    cpSync(REAL_REPO, ownerScratchDir, { recursive: true, 
    /** Retient les éléments qui respectent le filtre. */
    filter: (src) => !src.includes(`${REAL_REPO}/.git`) });
  }
  return ownerScratchDir;
}

/** Classe propriétaire plan. */
function classifyOwnerPlan(plan: RemediationPlan): { state: ShadowState; detail: string } {
  const [ownerGroupId, ownerArtifactId] = plan.editCoordinate.split(':');
  const cwd = ownerScratch();
  if (!cwd) return { state: 'PROJECT_CONTEXT_INSUFFICIENT', detail: 'No local repo checkout available in this environment for real owner discovery.' };

  const discoveryKey = `${ownerGroupId}:${ownerArtifactId}:${plan.fromVersion}`;
  let discovery = ownerDiscoveryCache.get(discoveryKey);
  if (!discovery) {
    discovery = discoverOwnerVersionCandidates({ groupId: ownerGroupId, artifactId: ownerArtifactId, currentVersion: plan.fromVersion, cwd });
    ownerDiscoveryCache.set(discoveryKey, discovery);
    ownerCandidatesDiscovered += discovery.sameMajorCandidates.length + discovery.crossMajorEvidence.length;
  }
  if (discovery.status !== 'DISCOVERED') return { state: 'PROJECT_CONTEXT_INSUFFICIENT', detail: `Owner discovery: ${discovery.status}` };
  if (!discovery.sameMajorCandidates.length) {
    return discovery.crossMajorEvidence.length
      ? { state: 'MAJOR_UPGRADE_REQUIRES_REVIEW', detail: `Only cross-major owner candidates exist (${discovery.crossMajorEvidence.map(c => c.version).join(', ')}); no same-major candidate to try.` }
      : { state: 'NO_COMPATIBLE_CANDIDATE', detail: 'No same-major or cross-major owner candidate found at all.' };
  }

  for (const ownerCandidate of discovery.sameMajorCandidates) {
    ownerCandidatesSentToCheapTrial++;
    const validationKey = `${plan.editCoordinate}:${plan.fromVersion}->${ownerCandidate.version}`;
    const alreadyRun = dedupKeys.has(validationKey);
    if (!alreadyRun) { dedupKeys.add(validationKey); uniqueSandboxRuns++; }
    const trial = runOwnerDiscoveryTrial({ workspacePath: cwd, pomRelativePath: 'pom.xml', plan, ownerCandidateVersion: ownerCandidate.version });
    if (trial.status !== 'RESOLVED' || !trial.resolvedVulnerableVersion) continue;
    const cmp = compareMavenVersions(trial.resolvedVulnerableVersion, plan.securityCandidate.version);
    if (cmp === 0 || cmp === 1) {
      return {
        state: 'NOT_YET_SANDBOXED',
        detail: `Phase 6 cheap trial (real): owner ${plan.editCoordinate} ${plan.fromVersion} -> ${ownerCandidate.version} resolves ${plan.vulnerableDependency} to ${trial.resolvedVulnerableVersion} (>= security target ${plan.securityCandidate.version}). Full Phase 8 build/tests/rescan not run this pass.`,
      };
    }
  }
  return { state: 'NO_COMPATIBLE_CANDIDATE', detail: `None of the ${discovery.sameMajorCandidates.length} same-major owner candidate(s) tried (${discovery.sameMajorCandidates.map(c => c.version).join(', ')}) resolve ${plan.vulnerableDependency} to >= the security target ${plan.securityCandidate.version}.` };
}

// The ONE real, live-proven case this session -- see
// v1_8_phase2_live_proof_snakeyaml.ts. Injected as a literal, explicit
// override (never inferred/assumed) so this report can honestly say
// VALIDATED for exactly the one finding that actually ran through a real
// sandbox, and NOT_YET_SANDBOXED for every other otherwise-identical
// DIRECT_EXPLICIT/PROPERTY finding.
const LIVE_PROVEN: Record<string, ShadowState> = {
  'CVE-2022-25857:org.yaml:snakeyaml': 'VALIDATED_RECOMMENDED',
};

/** Classe le finding. */
function classifyFinding(source: 'OWASP' | 'TRIVY', cve: string, pkg: string, installedVersion: string, providers: any[]): FindingRow {
  const parts = String(pkg).split(':');
  if (parts.length !== 2) return { source, cve, pkg, versionControl: 'UNRESOLVED_COORDINATE', state: 'PROJECT_CONTEXT_INSUFFICIENT', detail: 'Not a resolvable groupId:artifactId Maven coordinate.' };

  const profile = resolveDependencyControlProfile({ package: pkg, installedVersion, ...projectContext });
  const candidates = collectSecurityCandidates({ cve, pkg, installedVersion }, providers);
  const { plans, manualReviewReason } = buildRemediationPlans(profile, candidates);
  const versionControl = profile.versionControl;

  if (!candidates.length) return { source, cve, pkg, versionControl, state: 'SECURITY_TARGET_UNKNOWN', detail: manualReviewReason || 'NO_SECURITY_CANDIDATE' };
  if (!plans.length) return { source, cve, pkg, versionControl, state: 'PROJECT_CONTEXT_INSUFFICIENT', detail: manualReviewReason || 'NO_PLAN_GENERATED' };

  const liveKey = `${cve}:${pkg}`;
  if (LIVE_PROVEN[liveKey]) return { source, cve, pkg, versionControl, state: LIVE_PROVEN[liveKey], detail: 'Real, live sandbox run this session (see v1_8_phase2_live_proof_snakeyaml.ts output).' };

  if (versionControl === 'PARENT' || versionControl === 'IMPORTED_BOM') {
    const best = classifyOwnerPlan(plans[0]);
    return { source, cve, pkg, versionControl, state: best.state, detail: best.detail };
  }

  const eligible = plans.filter(p => p.automationEligible);
  if (!eligible.length) return { source, cve, pkg, versionControl, state: 'MAJOR_UPGRADE_REQUIRES_REVIEW', detail: `${plans.length} plan(s), none automation-eligible (${plans.map(p => p.versionPolicy.state).join(',')}).` };
  return { source, cve, pkg, versionControl, state: 'NOT_YET_SANDBOXED', detail: `${eligible.length} automation-eligible plan(s) generated (${versionControl}); no real sandbox run this pass.` };
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

console.log('══════════════════════════════════════════════════');
console.log('V1.8 Phase 2 — UNIFIED SHADOW COVERAGE REPORT (Phase 17/18/19)');
console.log('══════════════════════════════════════════════════');
console.log('OWASP_TOTAL:', owaspFindings.length);
console.log('TRIVY_TOTAL:', trivyFindings.length);
console.log('UNIFIED_TOTAL:', owaspFindings.length + trivyFindings.length);
console.log();
for (const source of ['OWASP', 'TRIVY'] as const) {
  console.log(`── ${source} ──`);
  for (const state of ['VALIDATED_RECOMMENDED', 'VALIDATED_ALTERNATIVES', 'SECURITY_TARGET_UNKNOWN', 'PROJECT_CONTEXT_INSUFFICIENT', 'MAJOR_UPGRADE_REQUIRES_REVIEW', 'NO_COMPATIBLE_CANDIDATE', 'VALIDATION_FAILED', 'NOT_YET_SANDBOXED'] as ShadowState[]) {
    console.log(`${source}_${state}:`, count(source, state));
  }
}
console.log();
console.log('OWNER_CANDIDATES_DISCOVERED:', ownerCandidatesDiscovered);
console.log('CANDIDATES_SENT_TO_SANDBOX (cheap trial):', ownerCandidatesSentToCheapTrial);
console.log('UNIQUE_SANDBOX_RUNS (deduplicated cheap-trial validation keys):', uniqueSandboxRuns);
console.log();
console.log('All PARENT/IMPORTED_BOM-owned findings (real owner-discovery ran for each):');
for (const r of rows) if (r.versionControl === 'PARENT' || r.versionControl === 'IMPORTED_BOM') console.log(' -', r.source, r.cve, r.pkg, '->', r.state, ':', r.detail);
console.log();
console.log('Live-proven findings this pass:');
for (const r of rows) if (LIVE_PROVEN[`${r.cve}:${r.pkg}`]) console.log(' -', r.source, r.cve, r.pkg, '->', r.state);

console.log('\nv1_8_phase2_shadow_report.ts: DONE');
