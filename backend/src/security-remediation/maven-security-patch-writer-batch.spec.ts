import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeSecurityPatchBatch, SecurityPatchBatchItem } from './maven-security-patch-writer-batch';
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
// A. Batch of 1 — non-regression. The output MUST be byte-identical to
// calling writeSecurityPatch() directly (execution 2060 / PR #37's real
// case, replayed as a singleton batch).
// ============================================================================
{
  const direct = writeSecurityPatch(baseRequest({}));
  assert.equal(direct.ok, true);
  const items: SecurityPatchBatchItem[] = [{ cveId: 'CVE-2023-6378', request: baseRequest({}) }];
  const batch = writeSecurityPatchBatch(items);
  assert.equal(batch.ok, true, `A: ${JSON.stringify(batch)}`);
  assert.equal(batch.file.content, direct.candidate.file.content, 'A: singleton batch produces the EXACT same content as the direct call');
  assert.equal(batch.file.contentSha256, direct.candidate.file.contentSha256);
  assert.equal(batch.file.originalBlobSha, direct.candidate.file.originalBlobSha);
  assert.equal(batch.perFinding.length, 1);
  assert.equal(batch.perFinding[0].cveId, 'CVE-2023-6378');
  assert.equal(batch.perFinding[0].oldVersion, '1.2.11');
  assert.equal(batch.perFinding[0].targetVersion, '1.2.13');
}
console.log('maven-security-patch-writer-batch A) singleton batch == direct writeSecurityPatch() call (non-regression, PR #37 shape): PASS');

// ============================================================================
// B. Two DISTINCT, non-conflicting CVEs in the SAME synthetic pom.xml — one
// DIRECT_EXPLICIT dependency, one PROPERTY_MANAGED property. Both land in
// the SAME resulting file.
// ============================================================================
{
  const syntheticPom = `<project>\n  <properties>\n    <jackson.version>2.13.3</jackson.version>\n  </properties>\n  <dependencies>\n    <dependency>\n      <groupId>ch.qos.logback</groupId>\n      <artifactId>logback-classic</artifactId>\n      <version>1.2.11</version>\n    </dependency>\n    <dependency>\n      <groupId>com.fasterxml.jackson.core</groupId>\n      <artifactId>jackson-databind</artifactId>\n      <version>\${jackson.version}</version>\n    </dependency>\n  </dependencies>\n</project>`;
  const items: SecurityPatchBatchItem[] = [
    { cveId: 'CVE-2023-6378', request: baseRequest({ findingIdentity: 'fp-logback', sourceContent: syntheticPom }) },
    { cveId: 'CVE-2020-36518', request: baseRequest({
      findingIdentity: 'fp-jackson', provenanceKind: 'PROPERTY_MANAGED', package: 'com.fasterxml.jackson.core:jackson-databind',
      installedVersion: '2.13.3', targetVersion: '2.13.5', controllingProperty: 'jackson.version', controllingElement: null, sourceContent: syntheticPom,
    }) },
  ];
  const batch = writeSecurityPatchBatch(items);
  assert.equal(batch.ok, true, `B: ${JSON.stringify(batch)}`);
  assert.match(batch.file.content, /<version>1\.2\.13<\/version>/, 'B: logback version bumped');
  assert.match(batch.file.content, /<jackson\.version>2\.13\.5<\/jackson\.version>/, 'B: jackson property bumped');
  assert.doesNotMatch(batch.file.content, /1\.2\.11/, 'B: old logback version gone');
  assert.doesNotMatch(batch.file.content, /2\.13\.3/, 'B: old jackson version gone');
  assert.equal(batch.perFinding.length, 2, 'B: both findings recorded');
  const cves = batch.perFinding.map(f => f.cveId).sort();
  assert.deepEqual(cves, ['CVE-2020-36518', 'CVE-2023-6378']);
  assert.equal(batch.file.sourceContent, syntheticPom, 'B: sourceContent is the ORIGINAL pre-batch content, not an intermediate link');
  assert.equal(batch.file.originalBlobSha, computeGitBlobSha1(syntheticPom));
}
console.log('maven-security-patch-writer-batch B) two distinct non-conflicting CVEs (direct + property) -> one file, both applied: PASS');

// ============================================================================
// C. Three DISTINCT, non-conflicting CVEs on three independent direct
// dependencies -- proves the chain scales past two and order (input array
// order, not cveId-sorted order) never affects the final content.
// ============================================================================
{
  const syntheticPom = `<project>\n  <dependencies>\n    <dependency><groupId>ch.qos.logback</groupId><artifactId>logback-classic</artifactId><version>1.2.11</version></dependency>\n    <dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId><version>2.13.3</version></dependency>\n    <dependency><groupId>org.yaml</groupId><artifactId>snakeyaml</artifactId><version>1.30</version></dependency>\n  </dependencies>\n</project>`;
  const make = (): SecurityPatchBatchItem[] => [
    { cveId: 'CVE-2023-6378', request: baseRequest({ findingIdentity: 'fp-logback', sourceContent: syntheticPom }) },
    { cveId: 'CVE-2020-36518', request: baseRequest({ findingIdentity: 'fp-jackson', package: 'com.fasterxml.jackson.core:jackson-databind', installedVersion: '2.13.3', targetVersion: '2.13.5', controllingElement: '<version>2.13.3</version>', sourceContent: syntheticPom }) },
    { cveId: 'CVE-2022-1471', request: baseRequest({ findingIdentity: 'fp-snakeyaml', package: 'org.yaml:snakeyaml', installedVersion: '1.30', targetVersion: '1.33', controllingElement: '<version>1.30</version>', sourceContent: syntheticPom }) },
  ];
  const forward = writeSecurityPatchBatch(make());
  const reversed = writeSecurityPatchBatch([...make()].reverse());
  assert.equal(forward.ok, true); assert.equal(reversed.ok, true);
  assert.equal(forward.file.content, reversed.file.content, 'C: deterministic (cveId-sorted internally) regardless of caller array order');
  assert.match(forward.file.content, /<version>1\.2\.13<\/version>/);
  assert.match(forward.file.content, /<version>2\.13\.5<\/version>/);
  assert.match(forward.file.content, /<version>1\.33<\/version>/);
  assert.equal(forward.perFinding.length, 3);
}
console.log('maven-security-patch-writer-batch C) three independent CVEs -> all applied, order-independent result: PASS');

// ============================================================================
// D. ★ CONFLICT — two CVEs on the SAME shared property, incompatible target
// versions. Detected BEFORE any build, both named, nothing applied.
// ============================================================================
{
  const syntheticPom = `<project>\n  <properties>\n    <jackson.version>2.13.3</jackson.version>\n  </properties>\n  <dependencies>\n    <dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId><version>\${jackson.version}</version></dependency>\n    <dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-annotations</artifactId><version>\${jackson.version}</version></dependency>\n  </dependencies>\n</project>`;
  const items: SecurityPatchBatchItem[] = [
    { cveId: 'CVE-A-0001', request: baseRequest({
      findingIdentity: 'fp-a', provenanceKind: 'PROPERTY_MANAGED', package: 'com.fasterxml.jackson.core:jackson-databind',
      installedVersion: '2.13.3', targetVersion: '2.13.5', controllingProperty: 'jackson.version', controllingElement: null, sourceContent: syntheticPom,
    }) },
    // Same property, but THIS finding's own grounded installedVersion claim
    // (2.13.3) no longer matches reality once A has already bumped it to
    // 2.13.5 in the chain -- OLD_VERSION_MISMATCH, exactly like a stale
    // second writeSecurityPatch() call would fail today.
    { cveId: 'CVE-B-0002', request: baseRequest({
      findingIdentity: 'fp-b', provenanceKind: 'PROPERTY_MANAGED', package: 'com.fasterxml.jackson.core:jackson-annotations',
      installedVersion: '2.13.3', targetVersion: '2.13.4', controllingProperty: 'jackson.version', controllingElement: null, sourceContent: syntheticPom,
    }) },
  ];
  const batch = writeSecurityPatchBatch(items);
  assert.equal(batch.ok, false, 'D: must be rejected, not silently resolved one way');
  assert.equal(batch.conflicts.length, 1, 'D: A (processed first, alphabetically) succeeds internally; B is the one that conflicts');
  assert.equal(batch.conflicts[0].cveId, 'CVE-B-0002', 'D: the CONFLICTING cve is named');
  assert.equal(batch.conflicts[0].reason, 'OLD_VERSION_MISMATCH');
}
console.log('maven-security-patch-writer-batch D) two CVEs sharing one property, incompatible targets -> named conflict, nothing applied: PASS');

// ============================================================================
// E. Every finding independently invalid (e.g. cross-major) is ALSO named
// -- conflicts are not limited to "the first failure", every bad finding
// is reported in one round-trip.
// ============================================================================
{
  const syntheticPom = `<project>\n  <dependencies>\n    <dependency><groupId>ch.qos.logback</groupId><artifactId>logback-classic</artifactId><version>1.2.11</version></dependency>\n    <dependency><groupId>org.yaml</groupId><artifactId>snakeyaml</artifactId><version>1.30</version></dependency>\n  </dependencies>\n</project>`;
  const items: SecurityPatchBatchItem[] = [
    { cveId: 'CVE-2023-6378', request: baseRequest({ findingIdentity: 'fp-logback', targetVersion: '2.0.0', sourceContent: syntheticPom }) }, // cross-major
    { cveId: 'CVE-2022-1471', request: baseRequest({ findingIdentity: 'fp-snakeyaml', package: 'org.yaml:snakeyaml', installedVersion: '9.9.9', targetVersion: '9.9.10', controllingElement: '<version>9.9.9</version>', sourceContent: syntheticPom }) }, // installed version wrong
  ];
  const batch = writeSecurityPatchBatch(items);
  assert.equal(batch.ok, false);
  assert.equal(batch.conflicts.length, 2, 'E: BOTH bad findings named, not just the first');
  const byId = new Map(batch.conflicts.map(c => [c.cveId, c.reason]));
  assert.equal(byId.get('CVE-2023-6378'), 'CROSS_MAJOR_TARGET_REJECTED');
  assert.equal(byId.get('CVE-2022-1471'), 'OLD_VERSION_MISMATCH');
}
console.log('maven-security-patch-writer-batch E) multiple independently-bad findings -> ALL named in one round-trip: PASS');

console.log('maven-security-patch-writer-batch.spec.ts: ALL CHECKS PASS');
