// Regroupe les traitements de Maven provenance résolveur.
import { DependencyProvenance, DependencyProvenanceKind } from './dependency-provenance.types';

export interface MavenProvenanceInput {
  /** groupId:artifactId — doit déjà être une vraie coordonnée Maven, jamais un nom de fichier jar. */
  package: string;
  installedVersion: string;
  pomXmlText: string;
  dependencyTreeText: string;
  controllingFilePath: string;
  groundedSha: string;
}

/** Sépare une coordonnée Maven "groupId:artifactId" en ses deux parties ; null si le format n'est pas exactement ce format. */
function splitCoordinate(pkg: string): { groupId: string; artifactId: string } | null {
  const parts = String(pkg || '').trim().split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { groupId: parts[0], artifactId: parts[1] };
}

interface XmlDependencyBlock {
  raw: string;
  groupId: string | null;
  artifactId: string | null;
  versionRaw: string | null;
}

/** Extrait le contenu de la balise <groupId> d'un bloc XML, ou null si absente. */
function extractGroupId(block: string): string | null {
  return /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(block)?.[1] ?? null;
}
/** Extrait le contenu de la balise <artifactId> d'un bloc XML, ou null si absente. */
function extractArtifactId(block: string): string | null {
  return /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(block)?.[1] ?? null;
}
/** Extrait le texte brut de la balise <version> d'un bloc XML (littéral ou référence ${propriété}), ou null si absente. */
function extractVersion(block: string): string | null {
  return /<version>\s*([^<\s]+)\s*<\/version>/.exec(block)?.[1] ?? null;
}

/** Extrait tous les blocs <dependency>...</dependency> d'une région donnée du texte pom.xml. */
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

/** Extrait le texte compris entre deux balises de premier niveau du pom.xml (première occurrence uniquement). */
function sliceBetween(text: string, openTag: string, closeTag: string): string | null {
  const openIdx = text.indexOf(openTag);
  if (openIdx === -1) return null;
  const closeIdx = text.indexOf(closeTag, openIdx);
  if (closeIdx === -1) return null;
  return text.slice(openIdx + openTag.length, closeIdx);
}

/** Recherche la déclaration d'une propriété Maven dans le bloc <properties> du pom.xml. */
function findPropertyDeclaration(pomXmlText: string, propertyName: string): { value: string; raw: string } | null {
  const propertiesRegion = sliceBetween(pomXmlText, '<properties>', '</properties>');
  if (!propertiesRegion) return null;
  const re = new RegExp(`<${propertyName}>\\s*([^<]*?)\\s*<\\/${propertyName}>`);
  const match = re.exec(propertiesRegion);
  if (!match) return null;
  return { value: match[1], raw: `<${propertyName}>${match[1]}</${propertyName}>` };
}

interface TreeMatch {
  depth: number;
  line: string;
  version: string;
}

/** Localise une coordonnée groupId:artifactId dans la sortie texte de `mvn dependency:tree` et renvoie sa profondeur d'imbrication. */
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

/** Recherche une coordonnée dans les plugins déclarés sous <build><plugins> du pom.xml. */
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

/** Construit un résultat UNRESOLVED (provenance non déterminable) avec sa preuve explicative. */
function unresolved(input: MavenProvenanceInput, evidence: string): DependencyProvenance {
  return {
    ecosystem: 'MAVEN', kind: 'UNRESOLVED', package: input.package, installedVersion: input.installedVersion,
    controllingFile: null, controllingElement: null, controllingProperty: null,
    groundedSha: input.groundedSha, evidence,
  };
}

/** Vérifie que la version réellement trouvée dans le dépôt correspond exactement à celle déclarée par le scanner ; sinon le résultat dégrade en UNRESOLVED plutôt que de poursuivre sur une donnée non fiable. */
function checkInstalledVersionMatches(input: MavenProvenanceInput, resolvedVersion: string, resolvedVersionSource: string): string | null {
  if (resolvedVersion === input.installedVersion) return null;
  return `Scanner-claimed installedVersion "${input.installedVersion}" does not match the version actually found at ${input.groundedSha} (${resolvedVersionSource}: "${resolvedVersion}") — never trusted blindly, resolution fails closed.`;
}

/** Classe la provenance d'une dépendance Maven en testant, dans l'ordre. */
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
