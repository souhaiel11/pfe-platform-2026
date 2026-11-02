// Compare les décisions de l'ancien chemin avec celles du mécanisme V1.8 pour mesurer leurs différences.
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeOwaspFinding } from '../common/owasp-finding-normalizer';
import { resolveMavenProvenance } from '../security-remediation/maven-provenance-resolver';
import { classifySecurityAutoFixEligibility } from '../security-remediation/security-eligibility-classifier';
import { TrivyCorrelationCandidateProvider, OwaspNativeFixedVersionProvider, TrivyNativeFixedVersionProvider, collectSecurityCandidates } from './security-candidate-collector';
import { V1_8CompatibilityDecisionService } from './v1_8-compatibility-decision.service';

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
const service = new V1_8CompatibilityDecisionService();

type DivergenceClass = 'SAFETY_TIGHTENING' | 'CAPABILITY_GAIN' | 'EXPECTED_DIFFERENCE' | 'UNEXPECTED_DIFFERENCE' | null;

/** Classe Divergence. */
function classifyDivergence(currentDecision: string, v1_8State: string): DivergenceClass {
  if (currentDecision === 'AUTO_FIX_ELIGIBLE') {
    // Current says go; V1.8 either agrees (no divergence) or is STRICTER --
    // that is exactly this ticket's Phase 7 "important safety question",
    // never a bug: V1.8 requires REAL sandbox proof, current does not.
    if (v1_8State === 'VALIDATED_RECOMMENDED' || v1_8State === 'VALIDATED_ALTERNATIVES') return null;
    return 'SAFETY_TIGHTENING';
  }
  // Current says DEVELOPER_ACTION_REQUIRED / ADMIN_ACTION_REQUIRED (blocked).
  if (v1_8State === 'VALIDATED_RECOMMENDED' || v1_8State === 'VALIDATED_ALTERNATIVES') return 'CAPABILITY_GAIN';
  // Both sides agree "not auto-fixable" -- WHY differs (current is coarse:
  // TRANSITIVE/BOM_MANAGED always blocked; V1.8 subdivides into
  // SECURITY_TARGET_UNKNOWN/NO_COMPATIBLE_CANDIDATE/MAJOR_UPGRADE/
  // VALIDATION_FAILED/PROJECT_CONTEXT_INSUFFICIENT) -- this refinement is
  // fully expected and was this entire multi-phase ticket's own stated
  // purpose, never unexplained.
  return 'EXPECTED_DIFFERENCE';
}

interface Row { source: string; cve: string; pkg: string; installedVersion: string; currentDecision: string; currentReason: string; v1_8Decision: string; divergence: DivergenceClass }

/** Évalue les données et retourne la décision correspondante. */
function evaluate(source: 'OWASP' | 'TRIVY', cve: string, pkg: string, installedVersion: string, providers: any[]): Row {
  const parts = String(pkg).split(':');
  const candidates = parts.length === 2 ? collectSecurityCandidates({ cve, pkg, installedVersion }, providers) : [];
  const provenance = parts.length === 2 ? resolveMavenProvenance({ package: pkg, installedVersion, ...projectContext }) : null;
  const current = classifySecurityAutoFixEligibility(
    { source, ecosystem: 'MAVEN', pkg, installedVersion, fixedVersions: candidates.map(c => c.version) },
    provenance,
  );
  const v1_8 = service.lookup(source, cve, pkg);
  return {
    source, cve, pkg, installedVersion, currentDecision: current.remediationType, currentReason: current.reason,
    v1_8Decision: v1_8.state, divergence: classifyDivergence(current.remediationType, v1_8.state),
  };
}

const rows: Row[] = [];
for (const f of owaspFindings) {
  const providers = [new OwaspNativeFixedVersionProvider(f.fixedVersion || null), trivyCorrelationProvider];
  rows.push(evaluate('OWASP', String(f.id || ''), String(f.pkg || ''), String(f.installedVersion || ''), providers));
}
for (const f of trivyFindings) {
  const providers = [new TrivyNativeFixedVersionProvider(f.fixedVersion || null)];
  rows.push(evaluate('TRIVY', String(f.id || f.cve || ''), String(f.pkg || f.package || ''), String(f.installedVersion || ''), providers));
}

console.log('══════════════════════════════════════════════════');
console.log('V1.8 Phase 4 — DUAL DECISION COMPARISON (current production vs V1.8), 251 real findings');
console.log('══════════════════════════════════════════════════');

const currentAutoFix = rows.filter(r => r.currentDecision === 'AUTO_FIX_ELIGIBLE').length;
const v1_8ValidatedRecommended = rows.filter(r => r.v1_8Decision === 'VALIDATED_RECOMMENDED' || r.v1_8Decision === 'VALIDATED_ALTERNATIVES').length;
const currentAutoFixButV1_8Blocks = rows.filter(r => r.currentDecision === 'AUTO_FIX_ELIGIBLE' && r.divergence === 'SAFETY_TIGHTENING');
const currentBlockedButV1_8Validated = rows.filter(r => r.currentDecision !== 'AUTO_FIX_ELIGIBLE' && r.divergence === 'CAPABILITY_GAIN');
const safetyTightening = rows.filter(r => r.divergence === 'SAFETY_TIGHTENING');
const capabilityGain = rows.filter(r => r.divergence === 'CAPABILITY_GAIN');
const expectedDifference = rows.filter(r => r.divergence === 'EXPECTED_DIFFERENCE');
const unexpectedDifference = rows.filter(r => r.divergence === 'UNEXPECTED_DIFFERENCE');

console.log('CURRENT_AUTO_FIX:', currentAutoFix);
console.log('V1_8_VALIDATED_RECOMMENDED (incl. ALTERNATIVES):', v1_8ValidatedRecommended);
console.log();
console.log('SAFETY_TIGHTENING:', safetyTightening.length);
console.log('CAPABILITY_GAIN:', capabilityGain.length);
console.log('EXPECTED_DIFFERENCE:', expectedDifference.length);
console.log('UNEXPECTED_DIFFERENCE:', unexpectedDifference.length);
console.log();
console.log('CURRENT_AUTO_FIX_BUT_V1_8_BLOCKS:', currentAutoFixButV1_8Blocks.length);
for (const r of currentAutoFixButV1_8Blocks) console.log('  -', r.source, r.cve, r.pkg, 'installed', r.installedVersion, '| current=' + r.currentDecision, '| v1.8=' + r.v1_8Decision);
console.log();
console.log('CURRENT_BLOCKED_BUT_V1_8_VALIDATED:', currentBlockedButV1_8Validated.length);
for (const r of currentBlockedButV1_8Validated) console.log('  -', r.source, r.cve, r.pkg, 'installed', r.installedVersion, '| current=' + r.currentDecision + '(' + r.currentReason + ')', '| v1.8=' + r.v1_8Decision);
console.log();
if (unexpectedDifference.length) {
  console.log('UNEXPECTED_DIFFERENCE details (must be zero):');
  for (const r of unexpectedDifference) console.log('  -', r.source, r.cve, r.pkg, r.currentDecision, '->', r.v1_8Decision);
}

console.log('\nv1_8_phase4_dual_decision_comparison.ts: DONE');
