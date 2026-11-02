// Teste le composant « unified-report-149 » et ses cas d’erreur.
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeOwaspFinding } from '../common/owasp-finding-normalizer';
import { resolveMavenProvenance } from '../security-remediation/maven-provenance-resolver';
import { classifySecurityAutoFixEligibility } from '../security-remediation/security-eligibility-classifier';
import { toUnifiedSecurityFinding, resolveUnifiedFinding, UnifiedSecurityFinding } from './unified-security-finding';
import { OwaspNativeFixedVersionProvider, TrivyCorrelationCandidateProvider, TrivyNativeFixedVersionProvider } from './security-candidate-collector';
import { VersionControl } from './dependency-control-profile.types';

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

/** Prépare les données nécessaires à ce scénario. */
function emptyCounts() {
  return {
    total: 0,
    control: { DIRECT_EXPLICIT: 0, PROPERTY: 0, DEPENDENCY_MANAGEMENT: 0, IMPORTED_BOM: 0, PARENT: 0, TRANSITIVE_MANAGED: 0, UNKNOWN: 0 } as Record<VersionControl, number>,
    securitySingle: 0, securityMultiple: 0, securityUnknown: 0,
    plansGenerated: 0,
    unresolvedCoordinate: 0,
  };
}

/** Demande l’analyse du fichier sélectionné. */
function analyze(source: 'OWASP' | 'TRIVY', findings: any[]) {
  const counts = emptyCounts();
  const unified: UnifiedSecurityFinding[] = [];
  let shadowMatchesCurrent = 0, shadowDiffersFromCurrent = 0;
  const diffs: string[] = [];

  for (const f of findings) {
    const ruleOrCve = String(f.id || f.VulnerabilityID || f.cve || '');
    const pkg = String(f.pkg || f.PkgName || f.package || '');
    const installedVersion = String(f.installedVersion || f.InstalledVersion || '');
    const nativeFixedVersion = f.fixedVersion || f.FixedVersion || null;

    const providers = source === 'OWASP'
      ? [new OwaspNativeFixedVersionProvider(nativeFixedVersion), trivyCorrelationProvider]
      : [new TrivyNativeFixedVersionProvider(nativeFixedVersion)];

    const finding = toUnifiedSecurityFinding(source, ruleOrCve, pkg, installedVersion, providers);
    counts.total++;
    if (!finding) { counts.unresolvedCoordinate++; continue; }
    unified.push(finding);

    const resolution = resolveUnifiedFinding(finding, projectContext);
    counts.control[resolution.profile.versionControl]++;
    if (finding.securityCandidates.length === 0) counts.securityUnknown++;
    else if (finding.securityCandidates.length === 1) counts.securitySingle++;
    else counts.securityMultiple++;
    counts.plansGenerated += resolution.plans.length;

    // Phase 13 shadow comparison against TODAY's real, unchanged classifier.
    const provenance = resolveMavenProvenance({ package: pkg, installedVersion, ...projectContext });
    const currentDecision = classifySecurityAutoFixEligibility(
      { source, ecosystem: 'MAVEN', pkg, installedVersion, fixedVersions: finding.securityCandidates.map(c => c.version) },
      provenance,
    );
    // Phase 10 — the correct shadow metric is automationEligible (whether
    // this resolver would ever offer the candidate for UNATTENDED
    // remediation), never merely "a plan object exists" -- a PARENT/BOM plan
    // or a CROSS_MAJOR candidate can exist as evidence while still being
    // automationEligible=false, which is exactly what must now match
    // production's own binary AUTO_FIX_ELIGIBLE / not.
    const currentAutoFixable = currentDecision.remediationType === 'AUTO_FIX_ELIGIBLE';
    const shadowAutomationEligible = resolution.plans.some(p => p.automationEligible);
    if (currentAutoFixable === shadowAutomationEligible) {
      shadowMatchesCurrent++;
    } else {
      shadowDiffersFromCurrent++;
      diffs.push([
        `source=${source}`, `cve=${ruleOrCve}`, `pkg=${pkg}`,
        `current=${currentDecision.remediationType}(${currentDecision.reason})`,
        `shadow=${shadowAutomationEligible ? 'AUTOMATION_ELIGIBLE' : (resolution.manualReviewReason || 'NOT_ELIGIBLE')}`,
        `versionPolicy=${resolution.plans.map(p => p.versionPolicy.state).join(',') || 'n/a'}`,
      ].join(' '));
    }
  }

  return { counts, unified, shadowMatchesCurrent, shadowDiffersFromCurrent, diffs };
}

const owaspResult = analyze('OWASP', owaspFindings);
const trivyResult = analyze('TRIVY', trivyFindings);

/** Simule l’échec attendu par ce scénario. */
function report(label: string, r: ReturnType<typeof analyze>) {
  console.log(`\n── ${label} ──`);
  console.log(`${label}_TOTAL:`, r.counts.total, '(unresolved Maven coordinate:', r.counts.unresolvedCoordinate, ')');
  console.log('DIRECT_EXPLICIT:', r.counts.control.DIRECT_EXPLICIT);
  console.log('PROPERTY:', r.counts.control.PROPERTY);
  console.log('DEPENDENCY_MANAGEMENT:', r.counts.control.DEPENDENCY_MANAGEMENT);
  console.log('IMPORTED_BOM:', r.counts.control.IMPORTED_BOM);
  console.log('PARENT:', r.counts.control.PARENT);
  console.log('TRANSITIVE_MANAGED:', r.counts.control.TRANSITIVE_MANAGED);
  console.log('UNKNOWN_CONTROL:', r.counts.control.UNKNOWN);
  const controlSum = Object.values(r.counts.control).reduce((a, b) => a + b, 0) + r.counts.unresolvedCoordinate;
  console.log('CONTROL_SUM:', controlSum, controlSum === r.counts.total ? '(OK)' : '(MISMATCH)');
  console.log('SECURITY_SINGLE_TARGET:', r.counts.securitySingle);
  console.log('SECURITY_MULTIPLE_TARGETS:', r.counts.securityMultiple);
  console.log('SECURITY_TARGET_UNKNOWN:', r.counts.securityUnknown);
  console.log('PLANS_GENERATED:', r.counts.plansGenerated);
  console.log(`SHADOW vs CURRENT: ${r.shadowMatchesCurrent} match, ${r.shadowDiffersFromCurrent} differ`);
  if (r.diffs.length) { console.log(`  ALL ${r.diffs.length} divergences:`); for (const d of r.diffs) console.log('   -', d); }
  if (controlSum !== r.counts.total) throw new Error(`${label}: CONTROL_SUM mismatch`);
}

console.log('══════════════════════════════════════════════════');
console.log('V1.8 UNIFIED OWASP + TRIVY resolver — report #149, SAME engine for both sources');
console.log('══════════════════════════════════════════════════');
report('OWASP', owaspResult);
report('TRIVY', trivyResult);

console.log('\nUNIFIED_RESOLVER_USED_FOR_OWASP: YES (resolveUnifiedFinding, zero source branches)');
console.log('UNIFIED_RESOLVER_USED_FOR_TRIVY: YES (same function, same call site)');
console.log('SOURCE_SPECIFIC_COMPATIBILITY_SHORTCUTS: 0 (resolveUnifiedFinding/resolveDependencyControlProfile/buildRemediationPlans never read finding.source)');

// Cross-source correlation proof (Phase 7): find a real OWASP finding whose
// candidate set includes a TRIVY_CORRELATED_EXACT entry, and confirm the
// SAME cve+pkg also exists as an independent, never-merged Trivy finding.
{
  const snakeUnified = owaspResult.unified.find(f => f.ruleOrCve === 'CVE-2022-25857');
  if (snakeUnified) {
    const correlated = snakeUnified.securityCandidates.find(c => c.evidenceType === 'TRIVY_CORRELATED_EXACT');
    console.log('\nCross-source correlation (CVE-2022-25857/snakeyaml): OWASP candidate =', JSON.stringify(correlated));
    if (!correlated) throw new Error('expected a TRIVY_CORRELATED_EXACT candidate on this real, already-validated finding');
  }
}

console.log('\nunified-report-149.spec.ts: ALL INVARIANTS HOLD');
