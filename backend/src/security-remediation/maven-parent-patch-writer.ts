// V1.8 Phase 7 — deterministic <parent> version patch writer. Mirrors
// maven-security-patch-writer.ts's own discipline exactly (exact-offset
// splice located via regex, never a blind find-and-replace-first-
// occurrence; fails closed on anything ambiguous or unexpected) but is a
// SEPARATE function/type family, not a branch inside that file: a
// PARENT_VERSION edit's target (the <parent> groupId:artifactId) is a
// fundamentally different coordinate than the CVE's own affected package
// (finding.package) that writeSecurityPatch()/DependencyProvenanceKind is
// built around -- conflating the two would mean stretching
// DependencyProvenanceKind ('DIRECT_EXPLICIT'/'PROPERTY_MANAGED') to cover
// a case it was never designed for, or lying about `provenanceKind` on the
// resulting candidate. This is the ONLY place PARENT_VERSION plans are
// actually executed; nothing here discovers or chooses a parent version --
// every field is taken from an already-validated V1.8 plan (editType,
// actualEditTarget, fromVersion, toVersion) and re-verified fail-closed
// against the real pom.xml text, never trusted blindly, never guessed.
import { CandidateFile } from '../candidate-verification/candidate-verification.types';
import { computeContentSha256, computeGitBlobSha1 } from '../candidate-verification/candidate-digest';
import { majorOf, parseVersion } from './version-selection-policy';

export type ParentPatchWriteFailureReason =
  | 'UNSUPPORTED_ECOSYSTEM'
  | 'INVALID_EDIT_TARGET'
  | 'TARGET_VERSION_INVALID'
  | 'CROSS_MAJOR_TARGET_REJECTED'
  | 'PARENT_BLOCK_NOT_FOUND'
  | 'PARENT_BLOCK_AMBIGUOUS'
  | 'PARENT_COORDINATE_INCOMPLETE'
  | 'PARENT_GROUP_MISMATCH'
  | 'PARENT_ARTIFACT_MISMATCH'
  | 'PARENT_VERSION_ELEMENT_NOT_FOUND'
  | 'PARENT_VERSION_NOT_LITERAL'
  | 'PARENT_VERSION_MISMATCH'
  | 'POST_WRITE_VERIFICATION_FAILED';

export interface ParentVersionPatchRequest {
  findingIdentity: string;
  evaluatedSha: string;
  ecosystem: 'MAVEN';
  editType: 'PARENT_VERSION';
  /** groupId:artifactId of the <parent> this ALREADY-VALIDATED V1.8 plan targets -- never discovered here, always supplied by the caller from the plan. */
  actualEditTarget: string;
  fromVersion: string;
  toVersion: string;
  /** Always 'pom.xml' in practice; kept explicit (not hardcoded) for the same reason SecurityPatchRequest.controllingFile is. */
  controllingFile: string;
  /** The exact, real pom.xml text at `evaluatedSha`. Never LLM-authored, never synthesized. */
  sourceContent: string;
}

export interface ParentVersionPatchCandidate {
  file: CandidateFile;
  findingIdentity: string;
  evaluatedSha: string;
  editType: 'PARENT_VERSION';
  actualEditTarget: string;
  oldVersion: string;
  targetVersion: string;
}

export type ParentPatchWriteResult =
  | { ok: true; candidate: ParentVersionPatchCandidate }
  | { ok: false; reason: ParentPatchWriteFailureReason; detail: string };

function fail(reason: ParentPatchWriteFailureReason, detail: string): ParentPatchWriteResult {
  return { ok: false, reason, detail };
}

function splitCoordinate(pkg: string): { groupId: string; artifactId: string } | null {
  const parts = String(pkg || '').trim().split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { groupId: parts[0], artifactId: parts[1] };
}

/** Same non-`d`-flag offset-location technique as maven-security-patch-writer.ts's own groupOffsetWithin(). */
function groupOffsetWithin(fullMatchText: string, groupText: string, searchFrom: number): number {
  const idx = fullMatchText.indexOf(groupText, searchFrom);
  if (idx === -1) throw new Error('Internal error: capture group text not found within its own match.');
  return idx;
}

interface ParentBlockLocation {
  /** Absolute [start,end) of the ENTIRE <parent>...</parent> text, for the post-write round-trip proof only -- never spliced directly. */
  blockRange: [number, number];
  groupId: string | null;
  artifactId: string | null;
  versionValueRange: [number, number] | null;
  versionValue: string | null;
}

/**
 * Locates every top-level <parent>...</parent> block in the FULL pom.xml
 * text. A POM has at most one <parent> by the Maven model itself, but this
 * never assumes that -- more than one match (a genuinely malformed/unusual
 * pom) is reported to the caller as ambiguous, exactly like
 * locateDependencyBlocks() refuses multiple <dependency> candidates rather
 * than picking the first.
 */
function locateParentBlocks(pomXmlText: string): ParentBlockLocation[] {
  const blocks: ParentBlockLocation[] = [];
  const blockRe = /<parent>[\s\S]*?<\/parent>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(pomXmlText))) {
    const blockText = m[0];
    const blockAbsoluteStart = m.index;
    const groupId = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(blockText)?.[1] ?? null;
    const artifactId = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(blockText)?.[1] ?? null;
    const versionRe = /<version>\s*([^<\s]+)\s*<\/version>/;
    const vMatch = versionRe.exec(blockText);
    let versionValueRange: [number, number] | null = null;
    let versionValue: string | null = null;
    if (vMatch) {
      versionValue = vMatch[1];
      const openTagEnd = vMatch.index + '<version>'.length;
      const relStart = groupOffsetWithin(blockText, versionValue, openTagEnd);
      versionValueRange = [blockAbsoluteStart + relStart, blockAbsoluteStart + relStart + versionValue.length];
    }
    blocks.push({ blockRange: [blockAbsoluteStart, blockAbsoluteStart + blockText.length], groupId, artifactId, versionValueRange, versionValue });
  }
  return blocks;
}

function checkSameMajor(oldVersion: string, targetVersion: string): ParentPatchWriteFailureReason | null {
  const oldParsed = parseVersion(oldVersion);
  const targetParsed = parseVersion(targetVersion);
  if (!oldParsed || !targetParsed) return 'TARGET_VERSION_INVALID';
  if (majorOf(oldParsed) !== majorOf(targetParsed)) return 'CROSS_MAJOR_TARGET_REJECTED';
  return null;
}

function spliceValue(text: string, range: [number, number], replacement: string): string {
  return text.slice(0, range[0]) + replacement + text.slice(range[1]);
}

function buildCandidateFile(request: ParentVersionPatchRequest, content: string): CandidateFile {
  const sourceContent = request.sourceContent;
  return {
    path: request.controllingFile,
    operation: 'MODIFY',
    content,
    contentSha256: computeContentSha256(content),
    sourceContent,
    originalBlobSha: computeGitBlobSha1(sourceContent),
  };
}

/**
 * Pure. Executes an ALREADY-VALIDATED V1.8 PARENT_VERSION plan against the
 * real pom.xml text -- discovers nothing, chooses nothing: every
 * groupId/artifactId/fromVersion/toVersion re-check below exists ONLY to
 * fail closed the moment the real file no longer matches what V1.8
 * validated, never to pick a different target/version than the plan says.
 */
export function writeParentVersionPatch(request: ParentVersionPatchRequest): ParentPatchWriteResult {
  if (request.ecosystem !== 'MAVEN') {
    return fail('UNSUPPORTED_ECOSYSTEM', `Ecosystem "${request.ecosystem}" is not supported by this writer (Maven only).`);
  }
  const coordinate = splitCoordinate(request.actualEditTarget);
  if (!coordinate) {
    return fail('INVALID_EDIT_TARGET', `actualEditTarget "${request.actualEditTarget}" is not a groupId:artifactId coordinate.`);
  }
  const majorCheck = checkSameMajor(request.fromVersion, request.toVersion);
  if (majorCheck) {
    return fail(majorCheck, `fromVersion="${request.fromVersion}" -> toVersion="${request.toVersion}" failed the same-major re-check (independent of the caller's own plan).`);
  }

  const blocks = locateParentBlocks(request.sourceContent);
  if (blocks.length === 0) {
    return fail('PARENT_BLOCK_NOT_FOUND', `No <parent> block found in ${request.controllingFile}.`);
  }
  if (blocks.length > 1) {
    return fail('PARENT_BLOCK_AMBIGUOUS', `${blocks.length} <parent> blocks found in ${request.controllingFile} -- ambiguous, refusing to guess which one.`);
  }
  const block = blocks[0];
  if (!block.groupId || !block.artifactId) {
    return fail('PARENT_COORDINATE_INCOMPLETE', `<parent> block in ${request.controllingFile} is missing a literal groupId/artifactId.`);
  }
  if (block.groupId !== coordinate.groupId) {
    return fail('PARENT_GROUP_MISMATCH', `<parent> groupId is "${block.groupId}", but the plan targets "${coordinate.groupId}".`);
  }
  if (block.artifactId !== coordinate.artifactId) {
    return fail('PARENT_ARTIFACT_MISMATCH', `<parent> artifactId is "${block.artifactId}", but the plan targets "${coordinate.artifactId}".`);
  }
  if (!block.versionValueRange || block.versionValue === null) {
    return fail('PARENT_VERSION_ELEMENT_NOT_FOUND', `<parent> for ${request.actualEditTarget} has no literal <version> element.`);
  }
  // Fails closed on a property/expression version (e.g. "${revision}") --
  // parseVersion() requires a leading digit run, so a placeholder never
  // parses and this never silently overwrites an inherited/computed value.
  if (!parseVersion(block.versionValue)) {
    return fail('PARENT_VERSION_NOT_LITERAL', `<parent> version for ${request.actualEditTarget} is "${block.versionValue}" -- not a literal Maven version (property/expression forms are unsupported).`);
  }
  if (block.versionValue !== request.fromVersion) {
    return fail('PARENT_VERSION_MISMATCH', `Grounded <parent> version is "${block.versionValue}", but the plan's fromVersion="${request.fromVersion}".`);
  }

  const content = spliceValue(request.sourceContent, block.versionValueRange, request.toVersion);

  // Post-write verification (§5): re-locate the parent block in the
  // PRODUCED content and prove, independently, that (a) groupId/artifactId
  // are unchanged, (b) the new version is exactly toVersion, (c) the old
  // version no longer appears in that node, and (d) a byte-exact round-trip
  // (re-splicing toVersion back to fromVersion) reconstructs the ORIGINAL
  // sourceContent -- the cheapest possible proof that nothing else in the
  // file was touched, since the only authorized edit is this one
  // [start,end) range.
  const reVerifyBlocks = locateParentBlocks(content);
  const rv = reVerifyBlocks[0];
  const roundTrip = rv?.versionValueRange ? spliceValue(content, rv.versionValueRange, request.fromVersion) : null;
  if (
    reVerifyBlocks.length !== 1 || !rv.versionValueRange || rv.versionValue !== request.toVersion
    || rv.groupId !== coordinate.groupId || rv.artifactId !== coordinate.artifactId
    || roundTrip !== request.sourceContent
  ) {
    return fail('POST_WRITE_VERIFICATION_FAILED', 'Post-write re-verification of the produced pom.xml text did not prove an isolated, correct parent-version-only change.');
  }

  const file = buildCandidateFile(request, content);
  return {
    ok: true,
    candidate: {
      file, findingIdentity: request.findingIdentity, evaluatedSha: request.evaluatedSha,
      editType: 'PARENT_VERSION', actualEditTarget: request.actualEditTarget,
      oldVersion: request.fromVersion, targetVersion: request.toVersion,
    },
  };
}
