// R-SEC-V1.2 §3/§6 — DETERMINISTIC XML/property patch writer. No LLM
// involved anywhere in this file (see §6 audit in the spec: neither
// DIRECT_EXPLICIT nor PROPERTY_MANAGED needs one — the controlling
// declaration is already grounded deterministically by
// maven-provenance-resolver.ts, so there is nothing left for an LLM to
// decide). A single targeted string splice, computed from EXACT character
// offsets located via regex `d` (indices) matching, never a blind
// find-and-replace-first-occurrence.
//
// Fails closed (never guesses, never edits "close enough"):
//   - more than one candidate <dependency> block for the same
//     groupId:artifactId, or more than one <properties> declaration for the
//     same property name -> reject (an ambiguous pom is not something this
//     writer will pick an occurrence from).
//   - the located old value does not exactly equal request.installedVersion
//     -> reject (mirrors resolveMavenProvenance's own installed-version
//     grounding check -- defense in depth, this writer trusts nothing blindly
//     either).
//   - old/target version not same-major -> reject (independent re-check of
//     the same-major policy, never assumes the caller already enforced it).
import { CandidateFile } from '../candidate-verification/candidate-verification.types';
import { computeContentSha256, computeGitBlobSha1 } from '../candidate-verification/candidate-digest';
import { majorOf, parseVersion } from './version-selection-policy';
import { SecurityPatchCandidate, SecurityPatchRequest } from './security-patch-request.types';

export type SecurityPatchWriteFailureReason =
  | 'UNSUPPORTED_PROVENANCE_KIND'
  | 'MULTIPLE_CANDIDATE_DEPENDENCY_BLOCKS'
  | 'MULTIPLE_CANDIDATE_PROPERTY_DECLARATIONS'
  | 'CONTROLLING_DECLARATION_NOT_FOUND'
  | 'OLD_VERSION_MISMATCH'
  | 'CROSS_MAJOR_TARGET_REJECTED'
  | 'TARGET_VERSION_INVALID'
  | 'CONTROLLING_PROPERTY_MISSING';

export type SecurityPatchWriteResult =
  | { ok: true; candidate: SecurityPatchCandidate }
  | { ok: false; reason: SecurityPatchWriteFailureReason; detail: string };

function fail(reason: SecurityPatchWriteFailureReason, detail: string): SecurityPatchWriteResult {
  return { ok: false, reason, detail };
}

function splitCoordinate(pkg: string): { groupId: string; artifactId: string } | null {
  const parts = String(pkg || '').trim().split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { groupId: parts[0], artifactId: parts[1] };
}

/** Every <dependency>...</dependency> block within <dependencies> (not <dependencyManagement>), with absolute offsets in the FULL pomXmlText. */
// Locates the absolute offset of `groupMatch` (a regex capture group's own
// matched text) within the full match, WITHOUT relying on the regex `d`
// (indices) flag -- this project's tsconfig target (ES2021) predates `d`
// flag support in TypeScript's type-checker (a compile-time-only
// restriction; not a runtime one), and changing that global, shared target
// is out of scope for this one file. `searchFrom` skips past the opening
// tag so a value that could coincidentally recur earlier in the match is
// never found first.
function groupOffsetWithin(fullMatchText: string, groupText: string, searchFrom: number): number {
  const idx = fullMatchText.indexOf(groupText, searchFrom);
  if (idx === -1) throw new Error('Internal error: capture group text not found within its own match.');
  return idx;
}

interface DependencyBlockLocation {
  groupId: string | null;
  artifactId: string | null;
  /** Absolute [start,end) of the <version>VALUE</version> text's VALUE only, or null if this block has no literal <version>. */
  versionValueRange: [number, number] | null;
  versionValue: string | null;
}

function locateDependencyBlocks(pomXmlText: string): DependencyBlockLocation[] {
  const openTag = '<dependencies>';
  const closeTag = '</dependencies>';
  const openIdx = pomXmlText.indexOf(openTag);
  if (openIdx === -1) return [];
  const closeIdx = pomXmlText.indexOf(closeTag, openIdx);
  if (closeIdx === -1) return [];
  const regionStart = openIdx + openTag.length;
  const region = pomXmlText.slice(regionStart, closeIdx);

  const blocks: DependencyBlockLocation[] = [];
  const blockRe = /<dependency>[\s\S]*?<\/dependency>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(region))) {
    const blockText = m[0];
    const blockAbsoluteStart = regionStart + m.index;
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
    blocks.push({ groupId, artifactId, versionValueRange, versionValue });
  }
  return blocks;
}

interface PropertyDeclarationLocation {
  /** Absolute [start,end) of the property VALUE text only. */
  valueRange: [number, number];
  value: string;
}

function locatePropertyDeclarations(pomXmlText: string, propertyName: string): PropertyDeclarationLocation[] {
  const openTag = '<properties>';
  const closeTag = '</properties>';
  const openIdx = pomXmlText.indexOf(openTag);
  if (openIdx === -1) return [];
  const closeIdx = pomXmlText.indexOf(closeTag, openIdx);
  if (closeIdx === -1) return [];
  const regionStart = openIdx + openTag.length;
  const region = pomXmlText.slice(regionStart, closeIdx);

  // propertyName is always the identifier already extracted deterministically
  // by resolveMavenProvenance() (a `${...}` placeholder body) -- escape only
  // as defense in depth, never a source of arbitrary regex injection.
  const escaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const propRe = new RegExp(`<${escaped}>\\s*([^<]*?)\\s*<\\/${escaped}>`, 'g');
  const results: PropertyDeclarationLocation[] = [];
  let m: RegExpExecArray | null;
  while ((m = propRe.exec(region))) {
    const value = m[1];
    const openTagEnd = m.index + `<${propertyName}>`.length;
    const relStart = groupOffsetWithin(region, value, openTagEnd);
    results.push({ valueRange: [regionStart + relStart, regionStart + relStart + value.length], value });
  }
  return results;
}

function checkSameMajor(oldVersion: string, targetVersion: string): SecurityPatchWriteFailureReason | null {
  const oldParsed = parseVersion(oldVersion);
  const targetParsed = parseVersion(targetVersion);
  if (!oldParsed || !targetParsed) return 'TARGET_VERSION_INVALID';
  if (majorOf(oldParsed) !== majorOf(targetParsed)) return 'CROSS_MAJOR_TARGET_REJECTED';
  return null;
}

function spliceValue(text: string, range: [number, number], replacement: string): string {
  return text.slice(0, range[0]) + replacement + text.slice(range[1]);
}

function buildCandidateFile(request: SecurityPatchRequest, content: string): CandidateFile {
  const sourceContent = request.sourceContent;
  return {
    path: request.controllingFile,
    operation: 'MODIFY',
    content,
    contentSha256: computeContentSha256(content),
    sourceContent,
    // Never accepted as an input claim -- always derived, here, from the
    // exact sourceContent this writer just edited (same algorithm the
    // R81.3 write-guard itself uses to verify it), so file.originalBlobSha
    // is internally consistent with file.sourceContent by construction.
    originalBlobSha: computeGitBlobSha1(sourceContent),
  };
}

/**
 * Pure. Supports ONLY provenanceKind 'DIRECT_EXPLICIT' and
 * 'PROPERTY_MANAGED' (§3) -- anything else is rejected outright, never
 * attempted. No LLM call anywhere in this function (§6).
 */
export function writeSecurityPatch(request: SecurityPatchRequest): SecurityPatchWriteResult {
  if (request.ecosystem !== 'MAVEN') {
    return fail('UNSUPPORTED_PROVENANCE_KIND', `Ecosystem "${request.ecosystem}" is not supported by this writer (Maven only).`);
  }
  const majorCheck = checkSameMajor(request.installedVersion, request.targetVersion);
  if (majorCheck) {
    return fail(majorCheck, `installedVersion="${request.installedVersion}" -> targetVersion="${request.targetVersion}" failed the same-major re-check (independent of the caller's own selection).`);
  }

  if (request.provenanceKind === 'DIRECT_EXPLICIT') {
    const coordinate = splitCoordinate(request.package);
    if (!coordinate) return fail('CONTROLLING_DECLARATION_NOT_FOUND', `"${request.package}" is not a groupId:artifactId coordinate.`);
    const blocks = locateDependencyBlocks(request.sourceContent)
      .filter(b => b.groupId === coordinate.groupId && b.artifactId === coordinate.artifactId);
    if (blocks.length === 0) {
      return fail('CONTROLLING_DECLARATION_NOT_FOUND', `No <dependency> for ${request.package} found in <dependencies> of ${request.controllingFile}.`);
    }
    if (blocks.length > 1) {
      return fail('MULTIPLE_CANDIDATE_DEPENDENCY_BLOCKS', `${blocks.length} <dependency> blocks for ${request.package} found in ${request.controllingFile} -- ambiguous, refusing to guess which one.`);
    }
    const block = blocks[0];
    if (!block.versionValueRange || block.versionValue === null) {
      return fail('CONTROLLING_DECLARATION_NOT_FOUND', `<dependency> for ${request.package} has no literal <version> element -- not DIRECT_EXPLICIT.`);
    }
    if (block.versionValue !== request.installedVersion) {
      return fail('OLD_VERSION_MISMATCH', `Grounded <version> is "${block.versionValue}", but the request claims installedVersion="${request.installedVersion}".`);
    }
    const content = spliceValue(request.sourceContent, block.versionValueRange, request.targetVersion);
    const file = buildCandidateFile(request, content);
    return {
      ok: true,
      candidate: { file, findingIdentity: request.findingIdentity, evaluatedSha: request.evaluatedSha, provenanceKind: 'DIRECT_EXPLICIT', oldVersion: request.installedVersion, targetVersion: request.targetVersion },
    };
  }

  if (request.provenanceKind === 'PROPERTY_MANAGED') {
    if (!request.controllingProperty) {
      return fail('CONTROLLING_PROPERTY_MISSING', 'provenanceKind is PROPERTY_MANAGED but no controllingProperty was supplied.');
    }
    const declarations = locatePropertyDeclarations(request.sourceContent, request.controllingProperty);
    if (declarations.length === 0) {
      return fail('CONTROLLING_DECLARATION_NOT_FOUND', `Property "${request.controllingProperty}" not found in <properties> of ${request.controllingFile}.`);
    }
    if (declarations.length > 1) {
      return fail('MULTIPLE_CANDIDATE_PROPERTY_DECLARATIONS', `${declarations.length} declarations of property "${request.controllingProperty}" found in ${request.controllingFile} -- ambiguous, refusing to guess which one.`);
    }
    const declaration = declarations[0];
    if (declaration.value !== request.installedVersion) {
      return fail('OLD_VERSION_MISMATCH', `Grounded property "${request.controllingProperty}" is "${declaration.value}", but the request claims installedVersion="${request.installedVersion}".`);
    }
    const content = spliceValue(request.sourceContent, declaration.valueRange, request.targetVersion);
    const file = buildCandidateFile(request, content);
    return {
      ok: true,
      candidate: { file, findingIdentity: request.findingIdentity, evaluatedSha: request.evaluatedSha, provenanceKind: 'PROPERTY_MANAGED', oldVersion: request.installedVersion, targetVersion: request.targetVersion },
    };
  }

  return fail('UNSUPPORTED_PROVENANCE_KIND', `provenanceKind "${request.provenanceKind}" is never auto-fixable -- only DIRECT_EXPLICIT/PROPERTY_MANAGED are supported by this writer.`);
}
