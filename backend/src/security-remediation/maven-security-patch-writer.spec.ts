import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeSecurityPatch } from './maven-security-patch-writer';
import { computeGitBlobSha1 } from '../candidate-verification/candidate-digest';
import { SecurityPatchRequest } from './security-patch-request.types';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const realPomXmlText = readFileSync(join(FIXTURES_DIR, 'pfe-app-test.pom.xml'), 'utf8');
const EVALUATED_SHA = 'a'.repeat(40);

function baseRequest(overrides: Partial<SecurityPatchRequest>): SecurityPatchRequest {
  return {
    findingIdentity: 'fp-1', evaluatedSha: EVALUATED_SHA, ecosystem: 'MAVEN',
    provenanceKind: 'DIRECT_EXPLICIT', package: 'ch.qos.logback:logback-classic',
    installedVersion: '1.2.11', targetVersion: '1.2.13',
    controllingFile: 'pom.xml', controllingElement: '<version>1.2.11</version>', controllingProperty: null,
    sourceContent: realPomXmlText,
    ...overrides,
  };
}

// ============================================================================
// A. DIRECT_EXPLICIT exact old version -> only version changed. REAL fixture.
// ============================================================================
{
  const result = writeSecurityPatch(baseRequest({}));
  assert.equal(result.ok, true, `A: ${JSON.stringify(result)}`);
  const { file } = result.candidate;
  assert.notEqual(file.content, realPomXmlText, 'A: content actually changed');
  assert.equal(file.content.length, realPomXmlText.length, 'A: same length (1.2.11 -> 1.2.13, both 6 chars)');
  // Only ONE contiguous diff region exists (not scattered edits) -- prove it
  // by diffing char-by-char and requiring every differing index to be
  // contiguous (no gap of matching characters between two differing runs).
  const diffIndices: number[] = [];
  for (let i = 0; i < realPomXmlText.length; i++) if (realPomXmlText[i] !== file.content[i]) diffIndices.push(i);
  assert.ok(diffIndices.length >= 1 && diffIndices.length <= '1.2.11'.length, `A: at most the version substring's length can differ, got ${diffIndices.length}`);
  for (let i = 1; i < diffIndices.length; i++) assert.equal(diffIndices[i], diffIndices[i - 1] + 1, 'A: differing characters form exactly one contiguous run, never scattered edits');
  assert.match(file.content, /<version>1\.2\.13<\/version>/);
  assert.doesNotMatch(file.content, /<version>1\.2\.11<\/version>/);
  assert.equal(file.sourceContent, realPomXmlText);
  assert.equal(file.originalBlobSha, computeGitBlobSha1(realPomXmlText), 'A: originalBlobSha is derived from sourceContent, matches real `git hash-object` (cross-checked against the real repo in this turn\'s report)');
  assert.equal(result.candidate.oldVersion, '1.2.11');
  assert.equal(result.candidate.targetVersion, '1.2.13');
}
console.log('maven-security-patch-writer A) DIRECT_EXPLICIT, real fixture -> only version changed: PASS');

// ============================================================================
// B. PROPERTY_MANAGED exact property -> only property value changed. HONEST
// NOTE (same as V1/V1.1): pfe-app-test's real pom.xml has no dependency
// actually controlled by ${property} syntax -- synthetic, standard-Maven-
// syntax fixture, clearly labeled.
// ============================================================================
{
  const syntheticPom = `<project>\n  <properties>\n    <jackson.version>2.13.3</jackson.version>\n  </properties>\n  <dependencies>\n    <dependency>\n      <groupId>com.fasterxml.jackson.core</groupId>\n      <artifactId>jackson-databind</artifactId>\n      <version>\${jackson.version}</version>\n    </dependency>\n  </dependencies>\n</project>`;
  const request = baseRequest({
    provenanceKind: 'PROPERTY_MANAGED', package: 'com.fasterxml.jackson.core:jackson-databind',
    installedVersion: '2.13.3', targetVersion: '2.13.5',
    controllingProperty: 'jackson.version', sourceContent: syntheticPom,
  });
  const result = writeSecurityPatch(request);
  assert.equal(result.ok, true, `B: ${JSON.stringify(result)}`);
  const { file } = result.candidate;
  assert.match(file.content, /<jackson\.version>2\.13\.5<\/jackson\.version>/);
  assert.doesNotMatch(file.content, /2\.13\.3/, 'B: the old value is gone everywhere it appeared');
  assert.match(file.content, /<version>\$\{jackson\.version\}<\/version>/, 'B: the dependency\'s own <version>${...}</version> reference is untouched -- only the PROPERTY declaration changed');
}
console.log('maven-security-patch-writer B) PROPERTY_MANAGED (synthetic, standard Maven syntax, honestly labeled) -> only property changed: PASS');

// ============================================================================
// C. old version mismatch -> reject
// ============================================================================
{
  const result = writeSecurityPatch(baseRequest({ installedVersion: '1.0.0' }));
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, 'OLD_VERSION_MISMATCH');
}
console.log('maven-security-patch-writer C) old version mismatch -> reject: PASS');

// ============================================================================
// E. multiple matching dependencies -> reject
// ============================================================================
{
  const duplicatePom = realPomXmlText.replace(
    '</dependencies>',
    '  <dependency>\n      <groupId>ch.qos.logback</groupId>\n      <artifactId>logback-classic</artifactId>\n      <version>1.2.11</version>\n    </dependency>\n  </dependencies>',
  );
  const result = writeSecurityPatch(baseRequest({ sourceContent: duplicatePom }));
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, 'MULTIPLE_CANDIDATE_DEPENDENCY_BLOCKS');
}
console.log('maven-security-patch-writer E) multiple matching <dependency> blocks -> reject: PASS');

// ============================================================================
// F. multiple matching properties -> reject
// ============================================================================
{
  const syntheticPom = `<project>\n  <properties>\n    <jackson.version>2.13.3</jackson.version>\n    <jackson.version>2.13.3</jackson.version>\n  </properties>\n</project>`;
  const request = baseRequest({ provenanceKind: 'PROPERTY_MANAGED', installedVersion: '2.13.3', targetVersion: '2.13.5', controllingProperty: 'jackson.version', sourceContent: syntheticPom });
  const result = writeSecurityPatch(request);
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, 'MULTIPLE_CANDIDATE_PROPERTY_DECLARATIONS');
}
console.log('maven-security-patch-writer F) multiple matching property declarations -> reject: PASS');

// ============================================================================
// G. TRANSITIVE provenance -> reject (never even attempted)
// ============================================================================
{
  const result = writeSecurityPatch(baseRequest({ provenanceKind: 'TRANSITIVE', package: 'org.apache.tomcat.embed:tomcat-embed-core', installedVersion: '9.0.63', targetVersion: '9.0.99' }));
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, 'UNSUPPORTED_PROVENANCE_KIND');
}
console.log('maven-security-patch-writer G) TRANSITIVE provenance -> reject: PASS');

// ============================================================================
// H. BOM_MANAGED -> reject
// ============================================================================
{
  const result = writeSecurityPatch(baseRequest({ provenanceKind: 'BOM_MANAGED', package: 'org.springframework.boot:spring-boot-starter-web', installedVersion: '2.7.0', targetVersion: '2.7.18' }));
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, 'UNSUPPORTED_PROVENANCE_KIND');
}
console.log('maven-security-patch-writer H) BOM_MANAGED -> reject: PASS');

// ============================================================================
// I. cross-major target -> reject
// ============================================================================
{
  const result = writeSecurityPatch(baseRequest({ installedVersion: '1.2.11', targetVersion: '2.0.0' }));
  assert.equal(result.ok, false);
  assert.equal((result as any).reason, 'CROSS_MAJOR_TARGET_REJECTED');
}
console.log('maven-security-patch-writer I) cross-major target -> reject: PASS');

// ── Additional fail-closed cases (not letter-numbered but part of §3) ──────
{
  // absent <dependency> entirely
  const r1 = writeSecurityPatch(baseRequest({ package: 'com.example:absent' }));
  assert.equal(r1.ok, false);
  assert.equal((r1 as any).reason, 'CONTROLLING_DECLARATION_NOT_FOUND');

  // PROPERTY_MANAGED with no controllingProperty supplied
  const r2 = writeSecurityPatch(baseRequest({ provenanceKind: 'PROPERTY_MANAGED', controllingProperty: null }));
  assert.equal(r2.ok, false);
  assert.equal((r2 as any).reason, 'CONTROLLING_PROPERTY_MISSING');

  // UNRESOLVED/PLUGIN never attempted either
  assert.equal((writeSecurityPatch(baseRequest({ provenanceKind: 'UNRESOLVED' })) as any).reason, 'UNSUPPORTED_PROVENANCE_KIND');
  assert.equal((writeSecurityPatch(baseRequest({ provenanceKind: 'PLUGIN' })) as any).reason, 'UNSUPPORTED_PROVENANCE_KIND');
}
console.log('maven-security-patch-writer) additional fail-closed cases (absent declaration, missing property, UNRESOLVED/PLUGIN): PASS');

console.log('maven-security-patch-writer.spec.ts: ALL CHECKS PASS');
