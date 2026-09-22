import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeSecurityPatch } from './maven-security-patch-writer';
import { assertSecurityPatchSafeToWrite } from './security-patch-guard';
import { SecurityPatchRequest } from './security-patch-request.types';
import { SecurityFindingDecision } from './security-finding-decision.types';
import { DependencyProvenance } from './dependency-provenance.types';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const realPomXmlText = readFileSync(join(FIXTURES_DIR, 'pfe-app-test.pom.xml'), 'utf8');
const EVALUATED_SHA = 'a'.repeat(40);

const provenance: DependencyProvenance = {
  ecosystem: 'MAVEN', kind: 'DIRECT_EXPLICIT', package: 'ch.qos.logback:logback-classic',
  installedVersion: '1.2.11', controllingFile: 'pom.xml', controllingElement: '<version>1.2.11</version>',
  controllingProperty: null, groundedSha: EVALUATED_SHA, evidence: 'test fixture',
};

function baseRequest(overrides: Partial<SecurityPatchRequest> = {}): SecurityPatchRequest {
  return {
    findingIdentity: 'fp-1', evaluatedSha: EVALUATED_SHA, ecosystem: 'MAVEN',
    provenanceKind: 'DIRECT_EXPLICIT', package: 'ch.qos.logback:logback-classic',
    installedVersion: '1.2.11', targetVersion: '1.2.13',
    controllingFile: 'pom.xml', controllingElement: '<version>1.2.11</version>', controllingProperty: null,
    sourceContent: realPomXmlText,
    ...overrides,
  };
}

function baseDecision(overrides: Partial<SecurityFindingDecision> = {}): SecurityFindingDecision {
  return {
    findingIdentity: 'fp-1', evaluatedSha: EVALUATED_SHA, provenance, fixedVersions: ['1.2.13'],
    selectedTargetVersion: '1.2.13', remediationType: 'AUTO_FIX_ELIGIBLE', reason: 'DIRECT_EXPLICIT:SELECTED',
    ...overrides,
  };
}

function authenticCandidate() {
  const result = writeSecurityPatch(baseRequest());
  assert.equal(result.ok, true);
  return (result as any).candidate;
}

// ============================================================================
// N. authentic clean version-only patch -> guard passes
// ============================================================================
{
  const candidate = authenticCandidate();
  const result = assertSecurityPatchSafeToWrite(baseDecision(), baseRequest(), candidate);
  assert.equal(result.ok, true, `N: ${JSON.stringify(result)}`);
}
console.log('security-patch-guard N) authentic clean version-only patch -> PASS: PASS');

// ============================================================================
// D. target version differs from classifier-selected target -> reject
// ============================================================================
{
  const candidate = authenticCandidate();
  const decision = baseDecision({ selectedTargetVersion: '1.2.9' }); // classifier "actually" selected something else
  const result = assertSecurityPatchSafeToWrite(decision, baseRequest(), candidate);
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, 'SECURITY_PATCH_TARGET_VERSION_MISMATCH');
}
console.log('security-patch-guard D) target version != classifier-selected target -> reject: PASS');

// ============================================================================
// J. attempted dependency addition -> guard rejects
// ============================================================================
{
  const candidate = authenticCandidate();
  const tampered = { ...candidate, file: { ...candidate.file, content: candidate.file.content.replace(
    '</dependencies>',
    '  <dependency>\n      <groupId>com.evil</groupId>\n      <artifactId>injected</artifactId>\n      <version>1.0.0</version>\n    </dependency>\n  </dependencies>',
  ) } };
  const result = assertSecurityPatchSafeToWrite(baseDecision(), baseRequest(), tampered);
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, 'SECURITY_PATCH_UNAUTHORIZED_CHANGE');
}
console.log('security-patch-guard J) attempted dependency addition -> guard rejects: PASS');

// ============================================================================
// K. attempted <exclusions> addition -> guard rejects
// ============================================================================
{
  const candidate = authenticCandidate();
  const tampered = { ...candidate, file: { ...candidate.file, content: candidate.file.content.replace(
    '<artifactId>logback-classic</artifactId>',
    '<artifactId>logback-classic</artifactId>\n      <exclusions><exclusion><groupId>x</groupId><artifactId>y</artifactId></exclusion></exclusions>',
  ) } };
  const result = assertSecurityPatchSafeToWrite(baseDecision(), baseRequest(), tampered);
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, 'SECURITY_PATCH_UNAUTHORIZED_CHANGE');
}
console.log('security-patch-guard K) attempted <exclusions> addition -> guard rejects: PASS');

// ============================================================================
// L. attempted scanner suppression / config weakening -> guard rejects
// ============================================================================
{
  const candidate = authenticCandidate();
  const tampered = { ...candidate, file: { ...candidate.file, content: candidate.file.content.replace(
    '<failBuildOnCVSS>9</failBuildOnCVSS>',
    '<failBuildOnCVSS>11</failBuildOnCVSS>', // weakened: no real CVSS ever reaches 11, effectively disables the gate
  ) } };
  const result = assertSecurityPatchSafeToWrite(baseDecision(), baseRequest(), tampered);
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, 'SECURITY_PATCH_UNAUTHORIZED_CHANGE');
}
console.log('security-patch-guard L) attempted scanner config weakening (failBuildOnCVSS) -> guard rejects: PASS');

// ============================================================================
// M. unrelated XML edit -> guard rejects
// ============================================================================
{
  const candidate = authenticCandidate();
  const tampered = { ...candidate, file: { ...candidate.file, content: candidate.file.content.replace(
    '<java.version>11</java.version>', '<java.version>17</java.version>',
  ) } };
  const result = assertSecurityPatchSafeToWrite(baseDecision(), baseRequest(), tampered);
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, 'SECURITY_PATCH_UNAUTHORIZED_CHANGE');
}
console.log('security-patch-guard M) unrelated XML edit (java.version) -> guard rejects: PASS');

// ── Further guard-specific invariants ───────────────────────────────────
{
  // finding identity mismatch
  const candidate = authenticCandidate();
  const r1 = assertSecurityPatchSafeToWrite(baseDecision({ findingIdentity: 'fp-different' }), baseRequest(), candidate);
  assert.equal(r1.ok, false);
  assert.equal((r1 as any).reason, 'SECURITY_PATCH_SCOPE_MISMATCH');

  // evaluatedSha mismatch (not a full SHA)
  const r2 = assertSecurityPatchSafeToWrite(baseDecision({ evaluatedSha: 'not-a-sha' }), baseRequest(), candidate);
  assert.equal(r2.ok, false);
  assert.equal((r2 as any).reason, 'SECURITY_PATCH_SHA_NOT_GROUNDED');

  // decision not actually AUTO_FIX_ELIGIBLE
  const r3 = assertSecurityPatchSafeToWrite(baseDecision({ remediationType: 'DEVELOPER_ACTION_REQUIRED', selectedTargetVersion: null }), baseRequest(), candidate);
  assert.equal(r3.ok, false);
  assert.equal((r3 as any).reason, 'SECURITY_PATCH_ELIGIBILITY_NOT_CONFIRMED');

  // controllingFile mismatch (proposed candidate targets a different path than authorized)
  const tamperedPath = { ...candidate, file: { ...candidate.file, path: 'package.json' } };
  const r4 = assertSecurityPatchSafeToWrite(baseDecision(), baseRequest(), tamperedPath);
  assert.equal(r4.ok, false);
  assert.equal((r4 as any).reason, 'SECURITY_PATCH_SCOPE_MISMATCH');

  // integrity: originalBlobSha does not match sourceContent
  const tamperedBlob = { ...candidate, file: { ...candidate.file, originalBlobSha: 'f'.repeat(40) } };
  const r5 = assertSecurityPatchSafeToWrite(baseDecision(), baseRequest(), tamperedBlob);
  assert.equal(r5.ok, false);
  assert.equal((r5 as any).reason, 'ORIGINAL_CONTENT_INTEGRITY_MISMATCH', 'reuses the exact R81.3 write-guard reason, not a duplicated one');

  // sourceContent swapped for a DIFFERENT but internally-consistent (hash matches itself) text
  const otherText = 'not the real pom';
  const { computeGitBlobSha1 } = require('../candidate-verification/candidate-digest');
  const tamperedSource = { ...candidate, file: { ...candidate.file, sourceContent: otherText, originalBlobSha: computeGitBlobSha1(otherText) } };
  const r6 = assertSecurityPatchSafeToWrite(baseDecision(), baseRequest(), tamperedSource);
  assert.equal(r6.ok, false, 'a self-consistent but SWAPPED sourceContent (matches its own hash, but not the grounded request.sourceContent) must still be rejected');
  assert.equal((r6 as any).reason, 'ORIGINAL_CONTENT_INTEGRITY_MISMATCH');
}
console.log('security-patch-guard) additional invariants (identity, SHA, eligibility, path, integrity, swapped-source): PASS');

console.log('security-patch-guard.spec.ts: ALL CHECKS PASS');
