import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeParentVersionPatch } from './maven-parent-patch-writer';
import { computeGitBlobSha1 } from '../candidate-verification/candidate-digest';
import { ParentVersionPatchRequest } from './maven-parent-patch-writer';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const realPomXmlText = readFileSync(join(FIXTURES_DIR, 'pfe-app-test.pom.xml'), 'utf8');
const EVALUATED_SHA = 'a'.repeat(40);

function baseRequest(overrides: Partial<ParentVersionPatchRequest> = {}): ParentVersionPatchRequest {
  return {
    findingIdentity: 'fp-parent-1', evaluatedSha: EVALUATED_SHA, ecosystem: 'MAVEN', editType: 'PARENT_VERSION',
    actualEditTarget: 'org.springframework.boot:spring-boot-starter-parent',
    fromVersion: '2.7.0', toVersion: '2.7.18',
    controllingFile: 'pom.xml', sourceContent: realPomXmlText,
    ...overrides,
  };
}

// ============================================================================
// 1. literal Maven parent version 2.7.0 -> 2.7.18, REAL fixture -> PASS, only
// the parent's <version> changes (contiguous single diff region).
// ============================================================================
{
  const result = writeParentVersionPatch(baseRequest());
  assert.equal(result.ok, true, `1: ${JSON.stringify(result)}`);
  if (result.ok) {
    const { file } = result.candidate;
    assert.notEqual(file.content, realPomXmlText, '1: content actually changed');
    // Length-changing edit (2.7.0 -> 2.7.18): prove "exactly one contiguous
    // changed region" via common-prefix/common-suffix, not raw index
    // equality (which only works for same-length replacements).
    let prefix = 0;
    while (prefix < realPomXmlText.length && realPomXmlText[prefix] === file.content[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < realPomXmlText.length - prefix && suffix < file.content.length - prefix
      && realPomXmlText[realPomXmlText.length - 1 - suffix] === file.content[file.content.length - 1 - suffix]
    ) suffix++;
    const oldMiddle = realPomXmlText.slice(prefix, realPomXmlText.length - suffix);
    const newMiddle = file.content.slice(prefix, file.content.length - suffix);
    // The minimal (prefix/suffix-collapsed) diff region must be entirely
    // digits/dots -- i.e. confined to inside the version number itself,
    // never touching any XML tag or unrelated text -- and must be a valid
    // decomposition of fromVersion/toVersion (their shared "2.7." prefix
    // collapses into the common-prefix scan above, leaving just the
    // differing tail digits on each side).
    assert.match(oldMiddle, /^[0-9.]*$/, `1: removed text is purely numeric/dots: "${oldMiddle}"`);
    assert.match(newMiddle, /^[0-9.]*$/, `1: inserted text is purely numeric/dots: "${newMiddle}"`);
    assert.equal('2.7.0'.endsWith(oldMiddle) || oldMiddle === '', true, `1: removed text is a suffix of fromVersion: "${oldMiddle}"`);
    assert.equal('2.7.18'.endsWith(newMiddle) || newMiddle === '', true, `1: inserted text is a suffix of toVersion: "${newMiddle}"`);
    assert.match(file.content, /<parent>[\s\S]*?<version>2\.7\.18<\/version>[\s\S]*?<\/parent>/);
    assert.doesNotMatch(file.content, /<parent>[\s\S]*?<version>2\.7\.0<\/version>[\s\S]*?<\/parent>/);
    assert.equal(file.sourceContent, realPomXmlText);
    assert.equal(file.originalBlobSha, computeGitBlobSha1(realPomXmlText));
    assert.equal(result.candidate.oldVersion, '2.7.0');
    assert.equal(result.candidate.targetVersion, '2.7.18');
    assert.equal(result.candidate.editType, 'PARENT_VERSION');
    assert.equal(result.candidate.actualEditTarget, 'org.springframework.boot:spring-boot-starter-parent');
  }
}
console.log('maven-parent-patch-writer 1) literal parent version 2.7.0 -> 2.7.18, real fixture -> PASS: PASS');

// ============================================================================
// 2. wrong current parent version (plan claims fromVersion that does not
// match the real pom) -> BLOCK, named reason, never guesses.
// ============================================================================
{
  const result = writeParentVersionPatch(baseRequest({ fromVersion: '2.7.5' }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'PARENT_VERSION_MISMATCH');
}
console.log('maven-parent-patch-writer 2) wrong current parent version -> BLOCK (PARENT_VERSION_MISMATCH): PASS');

// ============================================================================
// 3. wrong parent artifactId -> BLOCK, named reason.
// ============================================================================
{
  const result = writeParentVersionPatch(baseRequest({ actualEditTarget: 'org.springframework.boot:spring-boot-parent-WRONG' }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'PARENT_ARTIFACT_MISMATCH');
}
console.log('maven-parent-patch-writer 3) wrong parent artifactId -> BLOCK (PARENT_ARTIFACT_MISMATCH): PASS');

// 3b. wrong parent groupId -> BLOCK, distinct reason.
{
  const result = writeParentVersionPatch(baseRequest({ actualEditTarget: 'com.example.wrong:spring-boot-starter-parent' }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'PARENT_GROUP_MISMATCH');
}
console.log('maven-parent-patch-writer 3b) wrong parent groupId -> BLOCK (PARENT_GROUP_MISMATCH): PASS');

// ============================================================================
// 4. parent missing entirely -> BLOCK.
// ============================================================================
{
  const noParentPom = realPomXmlText.replace(/<parent>[\s\S]*?<\/parent>/, '');
  const result = writeParentVersionPatch(baseRequest({ sourceContent: noParentPom }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'PARENT_BLOCK_NOT_FOUND');
}
console.log('maven-parent-patch-writer 4) parent missing entirely -> BLOCK (PARENT_BLOCK_NOT_FOUND): PASS');

// ============================================================================
// 5. dependency has the SAME version string (2.7.0) elsewhere in the pom ->
// only the parent's own <version> changes, the unrelated dependency's
// identical version string is left untouched.
// ============================================================================
{
  const withCoincidentalVersion = realPomXmlText.replace(
    '</dependencies>',
    '  <dependency>\n      <groupId>com.example</groupId>\n      <artifactId>coincidental-version-dep</artifactId>\n      <version>2.7.0</version>\n    </dependency>\n  </dependencies>',
  );
  assert.match(withCoincidentalVersion, /coincidental-version-dep[\s\S]*?<version>2\.7\.0<\/version>/, 'fixture setup sanity: the coincidental dependency is present with the SAME version string as the parent');
  const result = writeParentVersionPatch(baseRequest({ sourceContent: withCoincidentalVersion }));
  assert.equal(result.ok, true, `5: ${JSON.stringify(result)}`);
  if (result.ok) {
    assert.match(result.candidate.file.content, /<parent>[\s\S]*?<version>2\.7\.18<\/version>[\s\S]*?<\/parent>/, '5: parent version changed');
    // The unrelated dependency's OWN <version>2.7.0</version> must survive
    // completely untouched -- not incidentally bumped alongside the parent.
    assert.match(result.candidate.file.content, /coincidental-version-dep<\/artifactId>\s*<version>2\.7\.0<\/version>/, '5: unrelated dependency sharing the SAME version string is left completely untouched');
  }
}
console.log('maven-parent-patch-writer 5) dependency has the same version string elsewhere -> only parent changes: PASS');

// ============================================================================
// 6. malformed pom (parent block missing its closing tag / not well-formed)
// -> BLOCK. The regex-based locator finds no complete <parent>...</parent>
// match at all, so this fails closed as PARENT_BLOCK_NOT_FOUND rather than
// matching a truncated/garbled block.
// ============================================================================
{
  const malformed = realPomXmlText.replace('</parent>', '');
  const result = writeParentVersionPatch(baseRequest({ sourceContent: malformed }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'PARENT_BLOCK_NOT_FOUND');
}
console.log('maven-parent-patch-writer 6) malformed pom (parent block never closes) -> BLOCK: PASS');

// ============================================================================
// 7. parent version is a property/expression, not a literal -> BLOCK unless
// explicitly supported (it is not, by design -- property-based parent
// versions are a different, still-unproven-safe shape this phase does not
// claim to handle).
// ============================================================================
{
  const propertyVersionPom = realPomXmlText.replace('<version>2.7.0</version>', '<version>${revision}</version>');
  const result = writeParentVersionPatch(baseRequest({ sourceContent: propertyVersionPom }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'PARENT_VERSION_NOT_LITERAL');
}
console.log('maven-parent-patch-writer 7) parent version is a property/expression -> BLOCK (PARENT_VERSION_NOT_LITERAL): PASS');

// ============================================================================
// 8. exact diff contains ONLY the expected parent version change -- proven
// by the writer's OWN post-write round-trip verification succeeding (it
// would have failed closed with POST_WRITE_VERIFICATION_FAILED otherwise),
// plus an explicit independent re-derivation here.
// ============================================================================
{
  const result = writeParentVersionPatch(baseRequest());
  assert.equal(result.ok, true);
  if (result.ok) {
    const roundTrip = result.candidate.file.content.replace('<version>2.7.18</version>', '<version>2.7.0</version>');
    assert.equal(roundTrip, realPomXmlText, '8: re-splicing toVersion back to fromVersion reconstructs the ORIGINAL byte-for-byte -- proves no other mutation occurred');
  }
}
console.log('maven-parent-patch-writer 8) exact diff contains only the expected parent version change: PASS');

// ============================================================================
// Additional fail-closed cases beyond the phase brief's own 8, matching this
// writer's own stated discipline (ambiguous block, cross-major, missing
// version element, non-Maven ecosystem).
// ============================================================================
{
  const twoParents = realPomXmlText + '\n<parent><groupId>x</groupId><artifactId>y</artifactId><version>1.0.0</version></parent>';
  const result = writeParentVersionPatch(baseRequest({ sourceContent: twoParents }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'PARENT_BLOCK_AMBIGUOUS');
}
console.log('maven-parent-patch-writer 9) two <parent> blocks -> BLOCK (PARENT_BLOCK_AMBIGUOUS), never guesses which: PASS');

{
  const result = writeParentVersionPatch(baseRequest({ toVersion: '3.0.0' }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'CROSS_MAJOR_TARGET_REJECTED');
}
console.log('maven-parent-patch-writer 10) cross-major target (2.7.0 -> 3.0.0) -> BLOCK (CROSS_MAJOR_TARGET_REJECTED): PASS');

{
  const noVersionElement = realPomXmlText.replace('<version>2.7.0</version>', '');
  const result = writeParentVersionPatch(baseRequest({ sourceContent: noVersionElement }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'PARENT_VERSION_ELEMENT_NOT_FOUND');
}
console.log('maven-parent-patch-writer 11) <parent> with no literal <version> element -> BLOCK: PASS');

{
  const result = writeParentVersionPatch(baseRequest({ ecosystem: 'NPM' as any }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'UNSUPPORTED_ECOSYSTEM');
}
console.log('maven-parent-patch-writer 12) non-Maven ecosystem -> BLOCK (UNSUPPORTED_ECOSYSTEM): PASS');

console.log('maven-parent-patch-writer.spec.ts: ALL CHECKS PASS');
