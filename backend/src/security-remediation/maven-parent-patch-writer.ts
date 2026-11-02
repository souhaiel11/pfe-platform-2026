/** Écrit de façon déterministe un patch de version sur le bloc `<parent>` d'un pom.xml, en exécutant un plan V1.8 déjà validé (ne découvre et ne choisit rien lui-même). */
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
  /** groupId:artifactId du `<parent>` ciblé par ce plan V1.8 déjà validé — jamais découvert ici. */
  actualEditTarget: string;
  fromVersion: string;
  toVersion: string;
  /** Toujours 'pom.xml' en pratique ; gardé explicite plutôt que codé en dur. */
  controllingFile: string;
  /** Texte réel et exact du pom.xml à `evaluatedSha`. Jamais généré par une IA, jamais synthétisé. */
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

/** Construit un résultat d'échec typé avec son détail explicatif. */
function fail(reason: ParentPatchWriteFailureReason, detail: string): ParentPatchWriteResult {
  return { ok: false, reason, detail };
}

/** Découpe une coordonnée Maven "groupId:artifactId" en ses deux parties, ou null si le format est invalide. */
function splitCoordinate(pkg: string): { groupId: string; artifactId: string } | null {
  const parts = String(pkg || '').trim().split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { groupId: parts[0], artifactId: parts[1] };
}

/** Localise la position exacte d'un texte capturé à l'intérieur de son match complet, pour spliccer sans décalage. */
function groupOffsetWithin(fullMatchText: string, groupText: string, searchFrom: number): number {
  const idx = fullMatchText.indexOf(groupText, searchFrom);
  if (idx === -1) throw new Error('Internal error: capture group text not found within its own match.');
  return idx;
}

interface ParentBlockLocation {
  /** Bornes absolues [début,fin) du bloc `<parent>...</parent>` entier, pour la preuve de round-trip uniquement. */
  blockRange: [number, number];
  groupId: string | null;
  artifactId: string | null;
  versionValueRange: [number, number] | null;
  versionValue: string | null;
}

/** Localise chaque bloc `<parent>...</parent>` de premier niveau dans le texte complet du pom.xml, en refusant plutôt que de choisir si plusieurs existent. */
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

/** Vérifie que l'ancienne et la nouvelle version appartiennent à la même version majeure, refuse sinon. */
function checkSameMajor(oldVersion: string, targetVersion: string): ParentPatchWriteFailureReason | null {
  const oldParsed = parseVersion(oldVersion);
  const targetParsed = parseVersion(targetVersion);
  if (!oldParsed || !targetParsed) return 'TARGET_VERSION_INVALID';
  if (majorOf(oldParsed) !== majorOf(targetParsed)) return 'CROSS_MAJOR_TARGET_REJECTED';
  return null;
}

/** Remplace le contenu d'une plage de texte par une valeur de remplacement. */
function spliceValue(text: string, range: [number, number], replacement: string): string {
  return text.slice(0, range[0]) + replacement + text.slice(range[1]);
}

/** Construit l'objet CandidateFile final (chemin, contenu, empreintes) à partir du patch produit. */
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

/** Exécute un plan V1.8 PARENT_VERSION déjà validé contre le vrai texte du pom.xml, en revérifiant chaque coordonnée/version et en refusant au moindre écart. */
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
  if (!parseVersion(block.versionValue)) {
    return fail('PARENT_VERSION_NOT_LITERAL', `<parent> version for ${request.actualEditTarget} is "${block.versionValue}" -- not a literal Maven version (property/expression forms are unsupported).`);
  }
  if (block.versionValue !== request.fromVersion) {
    return fail('PARENT_VERSION_MISMATCH', `Grounded <parent> version is "${block.versionValue}", but the plan's fromVersion="${request.fromVersion}".`);
  }

  const content = spliceValue(request.sourceContent, block.versionValueRange, request.toVersion);

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
