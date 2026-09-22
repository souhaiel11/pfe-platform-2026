// R-SEC-V1 §4 — pure Maven provenance resolver. Deliberately takes
// ALREADY-FETCHED text (pom.xml content + `mvn dependency:tree` output) as
// input rather than doing any I/O itself, exactly the same separation of
// concerns as generated-comment-guard.ts/write-guard.ts: the *decision*
// logic is pure and unit-testable against real captured fixtures; the
// actual `mvn`/git invocation is a thin wrapper (candidate-verifier, which
// already runs real Maven — see MavenBuildAdapter — and is the only place
// in this platform with git/mvn/java, per R22-E2C2), not implemented here.
//
// Validated against REAL fixtures captured from the actual target
// repository (souhaiel11/pfe-app-test), not synthetic guesses — see
// fixtures/pfe-app-test.pom.xml and fixtures/pfe-app-test.dependency-tree.txt,
// both produced by literally running `mvn dependency:tree`/reading the real
// pom.xml against that repo's real HEAD (read-only, this session).

import { DependencyProvenance, DependencyProvenanceKind } from './dependency-provenance.types';

export interface MavenProvenanceInput {
  /** groupId:artifactId — must already be a real Maven coordinate, never a jar filename (see report-normalizer's OWASP `pkg` gap, documented in the eligibility classifier). */
  package: string;
  installedVersion: string;
  pomXmlText: string;
  dependencyTreeText: string;
  controllingFilePath: string;
  groundedSha: string;
}

function splitCoordinate(pkg: string): { groupId: string; artifactId: string } | null {
  const parts = String(pkg || '').trim().split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { groupId: parts[0], artifactId: parts[1] };
}

interface XmlDependencyBlock {
  raw: string;
  groupId: string | null;
  artifactId: string | null;
  versionRaw: string | null; // the literal text inside <version>...</version>, or null if absent
}

function extractGroupId(block: string): string | null {
  return /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(block)?.[1] ?? null;
}
function extractArtifactId(block: string): string | null {
  return /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(block)?.[1] ?? null;
}
function extractVersion(block: string): string | null {
  return /<version>\s*([^<\s]+)\s*<\/version>/.exec(block)?.[1] ?? null;
}

/** All <dependency>...</dependency> blocks within a given region of pom.xml text. */
function extractDependencyBlocks(regionText: string): XmlDependencyBlock[] {
  const blocks: XmlDependencyBlock[] = [];
  const re = /<dependency>([\s\S]*?)<\/dependency>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(regionText))) {
    const raw = match[1];
    blocks.push({ raw, groupId: extractGroupId(raw), artifactId: extractArtifactId(raw), versionRaw: extractVersion(raw) });
  }
  return blocks;
}

/** Narrow slice of pom.xml text between two top-level tag boundaries, non-greedy, first occurrence only. */
function sliceBetween(text: string, openTag: string, closeTag: string): string | null {
  const openIdx = text.indexOf(openTag);
  if (openIdx === -1) return null;
  const closeIdx = text.indexOf(closeTag, openIdx);
  if (closeIdx === -1) return null;
  return text.slice(openIdx + openTag.length, closeIdx);
}

function findPropertyDeclaration(pomXmlText: string, propertyName: string): { value: string; raw: string } | null {
  const propertiesRegion = sliceBetween(pomXmlText, '<properties>', '</properties>');
  if (!propertiesRegion) return null;
  const re = new RegExp(`<${propertyName}>\\s*([^<]*?)\\s*<\\/${propertyName}>`);
  const match = re.exec(propertiesRegion);
  if (!match) return null;
  return { value: match[1], raw: `<${propertyName}>${match[1]}</${propertyName}>` };
}

interface TreeMatch {
  depth: number; // 0 = direct child of the project; >=1 = transitive
  line: string;
  version: string;
}

/**
 * Locates groupId:artifactId in `mvn dependency:tree` text output and
 * returns its nesting depth. Maven's ASCII tree indents each level with a
 * 3-character group, either "|  " (an ancestor still has siblings below) or
 * "   " (an ancestor was the last child) — both count as one depth level.
 * The root project line itself (no leading marker) is never matched.
 */
function findInDependencyTree(dependencyTreeText: string, groupId: string, artifactId: string): TreeMatch | null {
  const lineRe = /^((?:(?:\|  )|(?:   ))*)[+\\]- ([^\s:]+):([^\s:]+):[^\s:]+:([^\s:]+):[^\s:]+$/gm;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(dependencyTreeText))) {
    const [, prefix, g, a, version] = match;
    if (g === groupId && a === artifactId) {
      return { depth: prefix.length / 3, line: match[0], version };
    }
  }
  return null;
}

function findInPlugins(pomXmlText: string, groupId: string, artifactId: string): XmlDependencyBlock | null {
  const buildRegion = sliceBetween(pomXmlText, '<build>', '</build>');
  if (!buildRegion) return null;
  const re = /<plugin>([\s\S]*?)<\/plugin>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(buildRegion))) {
    const raw = match[1];
    if (extractGroupId(raw) === groupId && extractArtifactId(raw) === artifactId) {
      return { raw, groupId, artifactId, versionRaw: extractVersion(raw) };
    }
  }
  return null;
}

function unresolved(input: MavenProvenanceInput, evidence: string): DependencyProvenance {
  return {
    ecosystem: 'MAVEN', kind: 'UNRESOLVED', package: input.package, installedVersion: input.installedVersion,
    controllingFile: null, controllingElement: null, controllingProperty: null,
    groundedSha: input.groundedSha, evidence,
  };
}

/**
 * R-SEC-V1.1 §6 — "old version must match the scanner's installedVersion or
 * [resolution] fails closed": the scanner's claim about what is installed
 * is never trusted on its own. Whatever version this resolver actually
 * finds at the grounded SHA (a literal <version>, a resolved property
 * value, or the version `mvn dependency:tree` itself reports) MUST match
 * `input.installedVersion` exactly, or the whole result degrades to
 * UNRESOLVED — never silently proceeds on a mismatched claim.
 */
function checkInstalledVersionMatches(input: MavenProvenanceInput, resolvedVersion: string, resolvedVersionSource: string): string | null {
  if (resolvedVersion === input.installedVersion) return null;
  return `Scanner-claimed installedVersion "${input.installedVersion}" does not match the version actually found at ${input.groundedSha} (${resolvedVersionSource}: "${resolvedVersion}") — never trusted blindly, resolution fails closed.`;
}

/**
 * Pure classification. Order of checks mirrors §4 A-F exactly:
 *   1. <dependencies> block with a literal <version> -> DIRECT_EXPLICIT.
 *   2. <dependencies> block with <version>${prop}</version>, prop declared
 *      in THIS pom's own <properties> -> PROPERTY_MANAGED. Prop not
 *      declared locally (inherited from parent) -> UNRESOLVED (ambiguous
 *      origin, never guessed).
 *   3. Found in dependency:tree at depth 0 (direct child of the project)
 *      but no explicit <version> in this pom -> BOM_MANAGED.
 *   4. Found in dependency:tree at depth >= 1 -> TRANSITIVE.
 *   5. Found only as a <build><plugins><plugin> -> PLUGIN.
 *   6. Not found anywhere -> UNRESOLVED.
 * At every branch that would otherwise succeed, the grounded resolved
 * version is cross-checked against input.installedVersion (see
 * checkInstalledVersionMatches) before returning — a mismatch always wins
 * and degrades the result to UNRESOLVED, regardless of how confidently the
 * declaration itself was located.
 */
export function resolveMavenProvenance(input: MavenProvenanceInput): DependencyProvenance {
  const coordinate = splitCoordinate(input.package);
  if (!coordinate) {
    return unresolved(input, `"${input.package}" is not a groupId:artifactId Maven coordinate (e.g. a scanner-supplied jar filename) — cannot resolve provenance without a real coordinate.`);
  }
  const { groupId, artifactId } = coordinate;

  const dependenciesRegion = sliceBetween(input.pomXmlText, '<dependencies>', '</dependencies>');
  const directBlock = dependenciesRegion
    ? extractDependencyBlocks(dependenciesRegion).find(b => b.groupId === groupId && b.artifactId === artifactId)
    : undefined;

  if (directBlock?.versionRaw) {
    const versionRaw = directBlock.versionRaw;
    const propMatch = /^\$\{([^}]+)\}$/.exec(versionRaw);
    if (!propMatch) {
      const mismatch = checkInstalledVersionMatches(input, versionRaw, '<version> literal');
      if (mismatch) return unresolved(input, mismatch);
      return {
        ecosystem: 'MAVEN', kind: 'DIRECT_EXPLICIT', package: input.package, installedVersion: input.installedVersion,
        controllingFile: input.controllingFilePath, controllingElement: `<version>${versionRaw}</version>`, controllingProperty: null,
        groundedSha: input.groundedSha,
        evidence: `<dependency><groupId>${groupId}</groupId><artifactId>${artifactId}</artifactId><version>${versionRaw}</version></dependency> found directly in <dependencies> of ${input.controllingFilePath}.`,
      };
    }
    const propertyName = propMatch[1];
    const property = findPropertyDeclaration(input.pomXmlText, propertyName);
    if (property) {
      const mismatch = checkInstalledVersionMatches(input, property.value, `property \${${propertyName}}`);
      if (mismatch) return unresolved(input, mismatch);
      return {
        ecosystem: 'MAVEN', kind: 'PROPERTY_MANAGED', package: input.package, installedVersion: input.installedVersion,
        controllingFile: input.controllingFilePath, controllingElement: property.raw, controllingProperty: propertyName,
        groundedSha: input.groundedSha,
        evidence: `<version>\${${propertyName}}</version> in <dependencies>, resolved via <properties><${propertyName}>${property.value}</${propertyName}></properties> in the same ${input.controllingFilePath}.`,
      };
    }
    return unresolved(input, `<version>\${${propertyName}}</version> found in <dependencies>, but "${propertyName}" is not declared in ${input.controllingFilePath}'s own <properties> — likely inherited from the parent POM, ambiguous origin, never guessed.`);
  }

  const treeMatch = findInDependencyTree(input.dependencyTreeText, groupId, artifactId);
  if (treeMatch) {
    const mismatch = checkInstalledVersionMatches(input, treeMatch.version, '`mvn dependency:tree`');
    if (mismatch) return unresolved(input, mismatch);
    if (treeMatch.depth === 0) {
      return {
        ecosystem: 'MAVEN', kind: 'BOM_MANAGED', package: input.package, installedVersion: input.installedVersion,
        controllingFile: null, controllingElement: null, controllingProperty: null,
        groundedSha: input.groundedSha,
        evidence: `Direct child of the project in \`mvn dependency:tree\` ("${treeMatch.line.trim()}") with no explicit <version> in ${input.controllingFilePath} — version is resolved from a BOM/parent, not locally controllable.`,
      };
    }
    return {
      ecosystem: 'MAVEN', kind: 'TRANSITIVE', package: input.package, installedVersion: input.installedVersion,
      controllingFile: null, controllingElement: null, controllingProperty: null,
      groundedSha: input.groundedSha,
      evidence: `Found at depth ${treeMatch.depth} in \`mvn dependency:tree\` ("${treeMatch.line.trim()}") — never declared directly in ${input.controllingFilePath}; never add a new direct dependency solely to silence this finding.`,
    };
  }

  const pluginBlock = findInPlugins(input.pomXmlText, groupId, artifactId);
  if (pluginBlock) {
    if (pluginBlock.versionRaw) {
      const mismatch = checkInstalledVersionMatches(input, pluginBlock.versionRaw, '<plugin><version> literal');
      if (mismatch) return unresolved(input, mismatch);
    }
    return {
      ecosystem: 'MAVEN', kind: 'PLUGIN', package: input.package, installedVersion: input.installedVersion,
      controllingFile: input.controllingFilePath,
      controllingElement: pluginBlock.versionRaw ? `<version>${pluginBlock.versionRaw}</version>` : null,
      controllingProperty: null,
      groundedSha: input.groundedSha,
      evidence: `<plugin><groupId>${groupId}</groupId><artifactId>${artifactId}</artifactId></plugin> in <build><plugins> of ${input.controllingFilePath} — distinct declaration subtree from library <dependencies>.`,
    };
  }

  return unresolved(input, `"${groupId}:${artifactId}" not found in <dependencies>, \`mvn dependency:tree\`, or <build><plugins> of ${input.controllingFilePath} at ${input.groundedSha}.`);
}
