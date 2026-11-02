// Détermine ce qui contrôle la version effective d'une dépendance : déclaration directe, propriété, dependencyManagement, BOM ou parent Maven.
import { resolveMavenProvenance, MavenProvenanceInput } from '../security-remediation/maven-provenance-resolver';
import { DependencyControlProfile, VersionControl } from './dependency-control-profile.types';

export interface DependencyControlProfileInput extends MavenProvenanceInput {
  /** Local pom.xml text again, explicitly named here since this module reasons about <parent>/<dependencyManagement>, not just <dependencies> (resolveMavenProvenance only ever reads the latter). */
  pomXmlText: string;
  effectivePomXmlText?: string;
}

/** Recherche dans effectif dépendance Management. */
function findInEffectiveDependencyManagement(effectivePomXmlText: string, groupId: string, artifactId: string): string | null {
  const dmRegion = sliceBetween(effectivePomXmlText, '<dependencyManagement>', '</dependencyManagement>');
  const entries = extractDependencyBlocks(dmRegion).filter(d => d.groupId === groupId && d.artifactId === artifactId && d.version);
  if (entries.length !== 1) return null; // 0 -> not managed there; >1 -> ambiguous, never guessed.
  return entries[0].version;
}

/** Extrait le texte situé entre les délimiteurs fournis. */
function sliceBetween(text: string, openTag: string, closeTag: string): string | null {
  const openIdx = text.indexOf(openTag);
  if (openIdx === -1) return null;
  const closeIdx = text.indexOf(closeTag, openIdx);
  if (closeIdx === -1) return null;
  return text.slice(openIdx + openTag.length, closeIdx);
}
/** Lit la première balise XML correspondante. */
function firstTag(regionText: string | null, tag: string): string | null {
  if (!regionText) return null;
  const m = new RegExp(`<${tag}>\\s*([^<]*?)\\s*<\\/${tag}>`).exec(regionText);
  return m ? m[1] : null;
}
interface DepBlock { raw: string; groupId: string | null; artifactId: string | null; version: string | null; scope: string | null }
/** Extrait dépendance Blocks. */
function extractDependencyBlocks(regionText: string | null): DepBlock[] {
  if (!regionText) return [];
  const out: DepBlock[] = [];
  const re = /<dependency>([\s\S]*?)<\/dependency>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(regionText))) {
    const raw = m[1];
    out.push({
      raw,
      groupId: firstTag(raw, 'groupId'),
      artifactId: firstTag(raw, 'artifactId'),
      version: firstTag(raw, 'version'),
      scope: firstTag(raw, 'scope'),
    });
  }
  return out;
}

/** Extrait parent. */
function extractParent(pomXmlText: string): { groupId: string; artifactId: string; version: string } | null {
  const region = sliceBetween(pomXmlText, '<parent>', '</parent>');
  if (!region) return null;
  const groupId = firstTag(region, 'groupId');
  const artifactId = firstTag(region, 'artifactId');
  const version = firstTag(region, 'version');
  if (!groupId || !artifactId || !version) return null;
  return { groupId, artifactId, version };
}

/** Vérifie l’état suivant : Spring Boot parent. */
function isSpringBootParent(parent: { groupId: string; artifactId: string } | null): boolean {
  return !!parent && parent.groupId === 'org.springframework.boot';
}

/** Prépare le résultat lié à refine BOM Ownership. */
function refineBomOwnership(pomXmlText: string, groupId: string, artifactId: string, evidence: string[]): {
  versionControl: VersionControl;
  managementOwner: string | null; managementOwnerVersion: string | null;
  bomGroupId: string | null; bomArtifactId: string | null; bomVersion: string | null;
  parentGroupId: string | null; parentArtifactId: string | null; parentVersion: string | null;
} {
  const dmRegion = sliceBetween(pomXmlText, '<dependencyManagement>', '</dependencyManagement>');
  const dmDeps = extractDependencyBlocks(dmRegion);
  const localEntry = dmDeps.find(d => d.groupId === groupId && d.artifactId === artifactId && d.scope !== 'import');
  if (localEntry?.version) {
    evidence.push(`Found in this pom's own <dependencyManagement><dependency> for ${groupId}:${artifactId} (version ${localEntry.version}) -- this local declaration is what actually controls the version, not a parent or imported BOM.`);
    return {
      versionControl: 'DEPENDENCY_MANAGEMENT',
      managementOwner: 'local pom <dependencyManagement>', managementOwnerVersion: localEntry.version,
      bomGroupId: null, bomArtifactId: null, bomVersion: null,
      parentGroupId: null, parentArtifactId: null, parentVersion: null,
    };
  }

  const importedBoms = dmDeps.filter(d => d.scope === 'import' && d.groupId && d.artifactId);
  const parent = extractParent(pomXmlText);
  if (importedBoms.length === 1) {
    const bom = importedBoms[0];
    evidence.push(`No local <dependencyManagement> entry for ${groupId}:${artifactId}; this pom imports exactly one BOM (${bom.groupId}:${bom.artifactId}:${bom.version}) via <dependencyManagement><dependency><scope>import</scope> -- attributed to it as the sole candidate owner.`);
    return {
      versionControl: 'IMPORTED_BOM',
      managementOwner: `${bom.groupId}:${bom.artifactId}`, managementOwnerVersion: bom.version,
      bomGroupId: bom.groupId, bomArtifactId: bom.artifactId, bomVersion: bom.version,
      parentGroupId: parent?.groupId ?? null, parentArtifactId: parent?.artifactId ?? null, parentVersion: parent?.version ?? null,
    };
  }
  if (importedBoms.length > 1) {
    evidence.push(`No local <dependencyManagement> entry for ${groupId}:${artifactId}; ${importedBoms.length} imported BOMs are present locally (${importedBoms.map(b => `${b.groupId}:${b.artifactId}`).join(', ')}) -- cannot deterministically attribute ownership to one without per-entry effective-pom cross-reference, never guessed.`);
    return {
      versionControl: 'UNKNOWN',
      managementOwner: null, managementOwnerVersion: null, bomGroupId: null, bomArtifactId: null, bomVersion: null,
      parentGroupId: parent?.groupId ?? null, parentArtifactId: parent?.artifactId ?? null, parentVersion: parent?.version ?? null,
    };
  }

  if (parent) {
    evidence.push(`No local <dependencyManagement> entry or imported BOM for ${groupId}:${artifactId}; this pom declares <parent>${parent.groupId}:${parent.artifactId}:${parent.version}</parent> -- attributed to the parent's own (transitively imported) dependency management.`);
    return {
      versionControl: 'PARENT',
      managementOwner: `${parent.groupId}:${parent.artifactId}`, managementOwnerVersion: parent.version,
      bomGroupId: null, bomArtifactId: null, bomVersion: null,
      parentGroupId: parent.groupId, parentArtifactId: parent.artifactId, parentVersion: parent.version,
    };
  }

  evidence.push(`No local <dependencyManagement> entry, no imported BOM, and no <parent> found for ${groupId}:${artifactId} despite dependency:tree showing it as depth-0 with no explicit version -- cannot attribute ownership, never guessed.`);
  return {
    versionControl: 'UNKNOWN',
    managementOwner: null, managementOwnerVersion: null, bomGroupId: null, bomArtifactId: null, bomVersion: null,
    parentGroupId: null, parentArtifactId: null, parentVersion: null,
  };
}

/** Résout dépendance contrôle profil. */
export function resolveDependencyControlProfile(input: DependencyControlProfileInput): DependencyControlProfile {
  const provenance = resolveMavenProvenance(input);
  const [groupId, artifactId] = String(input.package).split(':');
  const evidence: string[] = [provenance.evidence];

  const parent = extractParent(input.pomXmlText);
  const javaVersion = firstTag(sliceBetween(input.pomXmlText, '<properties>', '</properties>'), 'java.version');
  const springBootVersion = isSpringBootParent(parent) ? parent!.version : null;
  if (parent) evidence.push(`<parent>${parent.groupId}:${parent.artifactId}:${parent.version}</parent> declared in ${input.controllingFilePath}.`);
  if (javaVersion) evidence.push(`<properties><java.version>${javaVersion}</java.version></properties> declared in ${input.controllingFilePath}.`);

  const base: Omit<DependencyControlProfile, 'versionControl' | 'managementOwner' | 'managementOwnerVersion' | 'bomGroupId' | 'bomArtifactId' | 'bomVersion' | 'parentGroupId' | 'parentArtifactId' | 'parentVersion' | 'dependencyKind' | 'declarationPom' | 'propertyName'> = {
    groupId, artifactId, installedVersion: input.installedVersion,
    javaVersion, springBootVersion, evidence,
  };

  switch (provenance.kind) {
    case 'DIRECT_EXPLICIT':
      return { ...base, dependencyKind: 'DIRECT', versionControl: 'DIRECT_EXPLICIT', declarationPom: provenance.controllingFile, propertyName: null, managementOwner: null, managementOwnerVersion: null, bomGroupId: null, bomArtifactId: null, bomVersion: null, parentGroupId: null, parentArtifactId: null, parentVersion: null };
    case 'PROPERTY_MANAGED':
      return { ...base, dependencyKind: 'DIRECT', versionControl: 'PROPERTY', declarationPom: provenance.controllingFile, propertyName: provenance.controllingProperty, managementOwner: null, managementOwnerVersion: null, bomGroupId: null, bomArtifactId: null, bomVersion: null, parentGroupId: null, parentArtifactId: null, parentVersion: null };
    case 'PLUGIN':
      evidence.push('Found only as a <build><plugins><plugin> declaration -- not a library dependency; out of scope for a dependency-version remediation plan.');
      return { ...base, dependencyKind: 'DIRECT', versionControl: 'UNKNOWN', declarationPom: null, propertyName: null, managementOwner: null, managementOwnerVersion: null, bomGroupId: null, bomArtifactId: null, bomVersion: null, parentGroupId: null, parentArtifactId: null, parentVersion: null };
    case 'UNRESOLVED':
      return { ...base, dependencyKind: 'DIRECT', versionControl: 'UNKNOWN', declarationPom: null, propertyName: null, managementOwner: null, managementOwnerVersion: null, bomGroupId: null, bomArtifactId: null, bomVersion: null, parentGroupId: null, parentArtifactId: null, parentVersion: null };
    case 'TRANSITIVE': {
      if (input.effectivePomXmlText) {
        const managedVersion = findInEffectiveDependencyManagement(input.effectivePomXmlText, groupId, artifactId);
        if (managedVersion && managedVersion === input.installedVersion) {
          evidence.push(`Transitive dependency (depth >= 1 in dependency:tree), but the real effective POM's <dependencyManagement> names ${groupId}:${artifactId} at exactly the installed version (${managedVersion}) -- its version IS controlled by the project's inherited BOM/parent, proven by real \`mvn help:effective-pom\` output, not guessed from the raw tree depth alone.`);
          const refined = refineBomOwnership(input.pomXmlText, groupId, artifactId, evidence);
          return { ...base, dependencyKind: 'TRANSITIVE', ...refined, declarationPom: refined.versionControl === 'DEPENDENCY_MANAGEMENT' ? input.controllingFilePath : null, propertyName: null };
        }
        if (managedVersion) {
          evidence.push(`Effective POM's <dependencyManagement> names ${groupId}:${artifactId} at ${managedVersion}, which does NOT match the scanner-claimed installedVersion ${input.installedVersion} -- never trusted on a mismatch, falls back to conservative TRANSITIVE_MANAGED.`);
        }
      }
      evidence.push('Pure transitive dependency (depth >= 1 in dependency:tree): the nearest controlling parent artifact is visible in the dependency:tree line above (see evidence). Without a real effective-pom cross-reference proving otherwise, this Phase 1 implementation does not further resolve ITS OWN management owner -- always MANUAL_REVIEW, never an arbitrary added direct override.');
      return { ...base, dependencyKind: 'TRANSITIVE', versionControl: 'TRANSITIVE_MANAGED', declarationPom: null, propertyName: null, managementOwner: null, managementOwnerVersion: null, bomGroupId: null, bomArtifactId: null, bomVersion: null, parentGroupId: parent?.groupId ?? null, parentArtifactId: parent?.artifactId ?? null, parentVersion: parent?.version ?? null };
    }
    case 'BOM_MANAGED': {
      const refined = refineBomOwnership(input.pomXmlText, groupId, artifactId, evidence);
      return { ...base, dependencyKind: 'DIRECT', ...refined, declarationPom: refined.versionControl === 'DEPENDENCY_MANAGEMENT' ? input.controllingFilePath : null, propertyName: null };
    }
    default:
      return { ...base, dependencyKind: 'DIRECT', versionControl: 'UNKNOWN', declarationPom: null, propertyName: null, managementOwner: null, managementOwnerVersion: null, bomGroupId: null, bomArtifactId: null, bomVersion: null, parentGroupId: null, parentArtifactId: null, parentVersion: null };
  }
}
