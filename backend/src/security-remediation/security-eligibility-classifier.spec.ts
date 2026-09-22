import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifySecurityAutoFixEligibility } from './security-eligibility-classifier';
import { resolveMavenProvenance } from './maven-provenance-resolver';
import { parseFixedVersions } from './fixed-version-normalizer';
import { remediationWorkflowFor } from '../incidents/incidents.service';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const pomXmlText = readFileSync(join(FIXTURES_DIR, 'pfe-app-test.pom.xml'), 'utf8');
const dependencyTreeText = readFileSync(join(FIXTURES_DIR, 'pfe-app-test.dependency-tree.txt'), 'utf8');
const groundedSha = 'a'.repeat(40);
const base = { pomXmlText, dependencyTreeText, controllingFilePath: 'pom.xml', groundedSha };

// ============================================================================
// A. direct Maven dep 9.0.63, fixed [9.0.99, 10.1.35] -> DIRECT_EXPLICIT ->
// target 9.0.99 -> AUTO_FIX_ELIGIBLE. (Using tomcat-embed-core's real
// installed version from the task's own example, but wired through a
// SYNTHETIC direct-dependency pom fragment for THIS specific check, since
// in the real pfe-app-test repo that exact package is transitive — see §9
// below for the real, honestly-classified outcome for the real package.)
// ============================================================================
{
  const syntheticPom = `<project><dependencies><dependency><groupId>org.apache.tomcat.embed</groupId><artifactId>tomcat-embed-core</artifactId><version>9.0.63</version></dependency></dependencies></project>`;
  const provenance = resolveMavenProvenance({
    pomXmlText: syntheticPom, dependencyTreeText: '', controllingFilePath: 'pom.xml', groundedSha,
    package: 'org.apache.tomcat.embed:tomcat-embed-core', installedVersion: '9.0.63',
  });
  assert.equal(provenance.kind, 'DIRECT_EXPLICIT');
  const result = classifySecurityAutoFixEligibility(
    { source: 'TRIVY', ecosystem: 'MAVEN', pkg: 'org.apache.tomcat.embed:tomcat-embed-core', installedVersion: '9.0.63', fixedVersions: parseFixedVersions('9.0.99, 10.1.35') },
    provenance,
  );
  assert.equal(result.remediationType, 'AUTO_FIX_ELIGIBLE');
  assert.equal(result.targetVersion, '9.0.99');
}
console.log('security-eligibility-classifier A) DIRECT_EXPLICIT + same-major fix -> AUTO_FIX_ELIGIBLE(9.0.99): PASS');

// ============================================================================
// B. property-managed dependency -> property correctly identified -> AUTO_FIX_ELIGIBLE
// ============================================================================
{
  const syntheticPom = `<project><properties><jackson.version>2.13.3</jackson.version></properties><dependencies><dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId><version>\${jackson.version}</version></dependency></dependencies></project>`;
  const provenance = resolveMavenProvenance({
    pomXmlText: syntheticPom, dependencyTreeText: '', controllingFilePath: 'pom.xml', groundedSha,
    package: 'com.fasterxml.jackson.core:jackson-databind', installedVersion: '2.13.3',
  });
  assert.equal(provenance.kind, 'PROPERTY_MANAGED');
  assert.equal(provenance.controllingProperty, 'jackson.version');
  const result = classifySecurityAutoFixEligibility(
    { source: 'OWASP', ecosystem: 'MAVEN', pkg: 'com.fasterxml.jackson.core:jackson-databind', installedVersion: '2.13.3', fixedVersions: ['2.13.5'] },
    provenance,
  );
  assert.equal(result.remediationType, 'AUTO_FIX_ELIGIBLE');
  assert.equal(result.targetVersion, '2.13.5');
}
console.log('security-eligibility-classifier B) PROPERTY_MANAGED + same-major fix -> AUTO_FIX_ELIGIBLE: PASS');

// ============================================================================
// C. only cross-major fixed versions -> DEVELOPER_ACTION_REQUIRED
// ============================================================================
{
  const provenance = resolveMavenProvenance({ ...base, package: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11' });
  const result = classifySecurityAutoFixEligibility(
    { source: 'TRIVY', ecosystem: 'MAVEN', pkg: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', fixedVersions: ['2.0.0'] },
    provenance,
  );
  assert.equal(result.remediationType, 'DEVELOPER_ACTION_REQUIRED');
  assert.equal(result.reason, 'CROSS_MAJOR_ONLY');
  assert.equal(result.targetVersion, null);
}
console.log('security-eligibility-classifier C) cross-major-only fix -> DEVELOPER_ACTION_REQUIRED: PASS');

// ============================================================================
// D. transitive dependency -> never AUTO_FIX_ELIGIBLE. REAL fixture:
// tomcat-embed-core is genuinely transitive in pfe-app-test's real tree.
// ============================================================================
{
  const provenance = resolveMavenProvenance({ ...base, package: 'org.apache.tomcat.embed:tomcat-embed-core', installedVersion: '9.0.63' });
  assert.equal(provenance.kind, 'TRANSITIVE');
  const result = classifySecurityAutoFixEligibility(
    { source: 'TRIVY', ecosystem: 'MAVEN', pkg: 'org.apache.tomcat.embed:tomcat-embed-core', installedVersion: '9.0.63', fixedVersions: ['9.0.99'] },
    provenance,
  );
  assert.notEqual(result.remediationType, 'AUTO_FIX_ELIGIBLE');
  assert.equal(result.remediationType, 'DEVELOPER_ACTION_REQUIRED');
  assert.equal(result.reason, 'TRANSITIVE_NOT_AUTOFIXABLE_V1');
}
console.log('security-eligibility-classifier D) REAL transitive fixture -> never AUTO_FIX_ELIGIBLE: PASS');

// ============================================================================
// E. external BOM -> never AUTO_FIX_ELIGIBLE. REAL fixture:
// spring-boot-starter-web is BOM/parent-managed in pfe-app-test.
// ============================================================================
{
  const provenance = resolveMavenProvenance({ ...base, package: 'org.springframework.boot:spring-boot-starter-web', installedVersion: '2.7.0' });
  assert.equal(provenance.kind, 'BOM_MANAGED');
  const result = classifySecurityAutoFixEligibility(
    { source: 'OWASP', ecosystem: 'MAVEN', pkg: 'org.springframework.boot:spring-boot-starter-web', installedVersion: '2.7.0', fixedVersions: ['2.7.18'] },
    provenance,
  );
  assert.notEqual(result.remediationType, 'AUTO_FIX_ELIGIBLE');
  assert.equal(result.remediationType, 'ADMIN_ACTION_REQUIRED', 'V1 has no ownership-evidence resolution, so BOM_MANAGED defaults to the higher bar (ADMIN), never auto');
}
console.log('security-eligibility-classifier E) REAL BOM_MANAGED fixture -> never AUTO_FIX_ELIGIBLE: PASS');

// ============================================================================
// F. ambiguous provenance -> fail closed
// ============================================================================
{
  const result1 = classifySecurityAutoFixEligibility(
    { source: 'TRIVY', ecosystem: 'MAVEN', pkg: 'com.example:unknown-lib', installedVersion: '1.0.0', fixedVersions: ['1.0.1'] },
    null, // resolver never ran / found nothing
  );
  assert.equal(result1.remediationType, 'DEVELOPER_ACTION_REQUIRED');
  assert.equal(result1.reason, 'PROVENANCE_NOT_RESOLVED');

  const unresolvedProvenance = resolveMavenProvenance({ ...base, package: 'com.example:does-not-exist', installedVersion: '1.0.0' });
  const result2 = classifySecurityAutoFixEligibility(
    { source: 'TRIVY', ecosystem: 'MAVEN', pkg: 'com.example:does-not-exist', installedVersion: '1.0.0', fixedVersions: ['1.0.1'] },
    unresolvedProvenance,
  );
  assert.equal(result2.remediationType, 'DEVELOPER_ACTION_REQUIRED');
  assert.equal(result2.reason, 'PROVENANCE_UNRESOLVED');
}
console.log('security-eligibility-classifier F) ambiguous/unresolved provenance -> fail closed: PASS');

// ============================================================================
// G. missing installedVersion -> not eligible
// ============================================================================
{
  const result = classifySecurityAutoFixEligibility(
    { source: 'TRIVY', ecosystem: 'MAVEN', pkg: 'ch.qos.logback:logback-classic', installedVersion: null, fixedVersions: ['1.2.13'] },
    resolveMavenProvenance({ ...base, package: 'ch.qos.logback:logback-classic', installedVersion: '' }),
  );
  assert.equal(result.remediationType, 'DEVELOPER_ACTION_REQUIRED');
  assert.equal(result.reason, 'INSTALLED_VERSION_MISSING');
}
console.log('security-eligibility-classifier G) missing installedVersion -> not eligible: PASS');

// ============================================================================
// H. missing fixedVersions -> not eligible. REAL fixture, exactly the
// task's own worked example: OWASP always emits fixedVersion:null in this
// platform (see fixed-version-normalizer.ts header) -> fixedVersions=[].
// ============================================================================
{
  const provenance = resolveMavenProvenance({ ...base, package: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11' });
  const result = classifySecurityAutoFixEligibility(
    { source: 'OWASP', ecosystem: 'MAVEN', pkg: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', fixedVersions: parseFixedVersions(null) },
    provenance,
  );
  assert.equal(result.remediationType, 'DEVELOPER_ACTION_REQUIRED');
  assert.equal(result.reason, 'FIXED_VERSION_MISSING');
}
console.log('security-eligibility-classifier H) missing fixedVersions (REAL: OWASP always null in this platform) -> not eligible: PASS');

// ============================================================================
// I. malformed version -> not eligible
// ============================================================================
{
  const provenance = resolveMavenProvenance({ ...base, package: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11' });
  const result = classifySecurityAutoFixEligibility(
    { source: 'TRIVY', ecosystem: 'MAVEN', pkg: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', fixedVersions: ['not-a-real-version'] },
    provenance,
  );
  assert.notEqual(result.remediationType, 'AUTO_FIX_ELIGIBLE');
  assert.equal(result.reason, 'NO_PARSEABLE_FIXED_VERSION');
}
console.log('security-eligibility-classifier I) malformed fixed version -> not eligible: PASS');

// ============================================================================
// J. ZAP finding -> not eligible for this V1
// ============================================================================
{
  const result = classifySecurityAutoFixEligibility(
    { source: 'ZAP', ecosystem: 'MAVEN', pkg: 'irrelevant', installedVersion: '1.0.0', fixedVersions: ['1.0.1'] },
    null,
  );
  assert.notEqual(result.remediationType, 'AUTO_FIX_ELIGIBLE');
  assert.match(result.reason, /^SOURCE_NOT_SUPPORTED_V1/);
}
console.log('security-eligibility-classifier J) ZAP -> not eligible for V1: PASS');

// ============================================================================
// K. existing Sonar/Jenkins/Docker routing -> zero regression. Calls the
// REAL, UNCHANGED remediationWorkflowFor() from incidents.service.ts
// directly -- proves this turn added nothing to it and did not touch WF2 routing.
// ============================================================================
{
  assert.equal(remediationWorkflowFor({ source: 'SONARQUBE' }), 'WF2');
  assert.equal(remediationWorkflowFor({ source: 'JENKINS' }), 'WF4');
  assert.equal(remediationWorkflowFor({ source: 'DOCKER' }), 'WF5');
  assert.equal(remediationWorkflowFor({ source: 'TRIVY' }), null, 'K: TRIVY still does NOT route to WF2 or anywhere else -- unchanged this turn, by design (§7)');
  assert.equal(remediationWorkflowFor({ source: 'OWASP' }), null, 'K: OWASP still does NOT route anywhere -- unchanged this turn');
  assert.equal(remediationWorkflowFor({ source: 'ZAP' }), null, 'K: ZAP still does NOT route anywhere -- unchanged this turn');
}
console.log('security-eligibility-classifier K) existing Sonar/Jenkins/Docker routing unchanged, Trivy/OWASP/ZAP still unrouted: PASS');

// ============================================================================
// L. multiple fixed versions -> lowest safe same-major selected (REAL
// persisted fixture, see version-selection-policy.spec.ts for the isolated
// policy-level proof; here proven through the FULL classifier pipeline).
// ============================================================================
{
  const provenance = resolveMavenProvenance({ ...base, package: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11' });
  const result = classifySecurityAutoFixEligibility(
    { source: 'TRIVY', ecosystem: 'MAVEN', pkg: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', fixedVersions: parseFixedVersions('1.3.12, 1.4.12, 1.2.13') },
    provenance,
  );
  assert.equal(result.remediationType, 'AUTO_FIX_ELIGIBLE');
  assert.equal(result.targetVersion, '1.2.13', 'L: lowest of the 3 real candidates, not the first-listed');
}
console.log('security-eligibility-classifier L) REAL multi-fixed-version end-to-end -> AUTO_FIX_ELIGIBLE(1.2.13): PASS');

// ============================================================================
// M. scanner/source casing normalization -> deterministic
// ============================================================================
{
  const provenance = resolveMavenProvenance({ ...base, package: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11' });
  const lower = classifySecurityAutoFixEligibility({ source: 'trivy', ecosystem: 'maven', pkg: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', fixedVersions: ['1.2.13'] }, provenance);
  const upper = classifySecurityAutoFixEligibility({ source: 'TRIVY', ecosystem: 'MAVEN', pkg: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', fixedVersions: ['1.2.13'] }, provenance);
  const mixed = classifySecurityAutoFixEligibility({ source: 'Trivy', ecosystem: 'Maven', pkg: 'ch.qos.logback:logback-classic', installedVersion: '1.2.11', fixedVersions: ['1.2.13'] }, provenance);
  assert.deepEqual(lower, upper);
  assert.deepEqual(lower, mixed);
  assert.equal(lower.remediationType, 'AUTO_FIX_ELIGIBLE');
}
console.log('security-eligibility-classifier M) source/ecosystem casing normalization is deterministic: PASS');

// ============================================================================
// §9 — REAL FIXTURE PROOF, read-only, against the actual persisted finding
// this task's own example describes: org.apache.tomcat.embed:tomcat-embed-
// core, installed 9.0.63, project pfe-app-test (this platform's own
// Postgres, CVE-2024-50379, source OWASP). No patch applied.
// ============================================================================
{
  // Real persisted shape (verified against this platform's own DB this
  // session): OWASP's pkg is the jar FILENAME, not a groupId:artifactId
  // coordinate, and both installedVersion and fixedVersion are null.
  const realPersistedOwaspFinding = {
    source: 'OWASP', pkg: 'tomcat-embed-core-9.0.63.jar', installedVersion: null as string | null, fixedVersion: null as string | null,
  };

  // The resolver needs a real coordinate; a caller integrating this against
  // OWASP data would need groupId:artifactId resolution first (a known,
  // documented gap -- see report, OWASP pkg is a filename). For this
  // specific package, dependency:tree DOES give us the real coordinate:
  const realCoordinate = 'org.apache.tomcat.embed:tomcat-embed-core';
  const realInstalledFromTree = '9.0.63'; // from the real dependency:tree fixture, matches the task's own example exactly

  const provenance = resolveMavenProvenance({ ...base, package: realCoordinate, installedVersion: realInstalledFromTree });
  console.log('security-eligibility-classifier §9 PACKAGE =', realCoordinate);
  console.log('security-eligibility-classifier §9 INSTALLED =', realInstalledFromTree);
  console.log('security-eligibility-classifier §9 PROVENANCE_KIND =', provenance.kind);
  console.log('security-eligibility-classifier §9 CONTROLLING_FILE =', provenance.controllingFile);
  console.log('security-eligibility-classifier §9 CONTROLLING_ELEMENT =', provenance.controllingElement);
  assert.equal(provenance.kind, 'TRANSITIVE', '§9: real dependency:tree proves tomcat-embed-core is transitive (via spring-boot-starter-web -> spring-boot-starter-tomcat), never declared directly');

  const fixedVersions = parseFixedVersions(realPersistedOwaspFinding.fixedVersion);
  console.log('security-eligibility-classifier §9 FIXED_VERSIONS =', JSON.stringify(fixedVersions));
  assert.deepEqual(fixedVersions, [], '§9: the REAL persisted OWASP finding has fixedVersion=null -> fixedVersions=[]');

  const result = classifySecurityAutoFixEligibility(
    { source: realPersistedOwaspFinding.source, ecosystem: 'MAVEN', pkg: realCoordinate, installedVersion: realInstalledFromTree, fixedVersions },
    provenance,
  );
  console.log('security-eligibility-classifier §9 SELECTED_TARGET =', result.targetVersion);
  console.log('security-eligibility-classifier §9 AUTO_FIX_ELIGIBLE =', result.remediationType === 'AUTO_FIX_ELIGIBLE' ? 'YES' : 'NO');
  console.log('security-eligibility-classifier §9 REASON =', result.reason);
  assert.equal(result.remediationType, 'DEVELOPER_ACTION_REQUIRED', '§9: honest outcome for the real, currently-persisted finding — TRANSITIVE alone already excludes it, AND fixedVersion is null in the real OWASP data, two independent reasons converging');
  assert.equal(result.targetVersion, null);
}
console.log('security-eligibility-classifier §9) REAL fixture proof (tomcat-embed-core, read-only, not patched): PASS');

console.log('security-eligibility-classifier.spec.ts: ALL CHECKS PASS (A-M + §9 real fixture proof)');
