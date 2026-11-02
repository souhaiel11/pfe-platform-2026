// Recherche les versions du parent/BOM à partir des métadonnées Maven et distingue les candidats de même majeure des autres versions observées.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { classifyCandidateVersionPolicy, isAutomationEligiblePolicy, CandidateVersionPolicy } from './candidate-version-policy';
import { compareMavenVersions } from './maven-qualifier-comparator';

export interface OwnerVersionCandidate {
  version: string;
  policy: CandidateVersionPolicy;
}

export type OwnerVersionDiscoveryStatus =
  | 'DISCOVERED'
  | 'OWNER_VERSION_NOT_FOUND'
  | 'DEPENDENCY_RESOLUTION_FAILED'
  | 'PROJECT_CONTEXT_INSUFFICIENT';

export interface OwnerVersionDiscoveryResult {
  ownerCoordinate: string; // groupId:artifactId
  currentVersion: string;
  status: OwnerVersionDiscoveryStatus;
  /** The single highest version Maven's own metadata reports, of ANY major -- kept purely as evidence, never a sandbox candidate by itself unless it also lands in sameMajorCandidates. */
  latestOverall: OwnerVersionCandidate | null;
  /** Bounded (see maxSameMajorCandidates), ascending by minimal safe change -- the ONLY versions this module ever proposes for a real sandbox trial. */
  sameMajorCandidates: OwnerVersionCandidate[];
  /** Bounded (see maxCrossMajorEvidence). "developer-review evidence only" per the ticket -- never sent to a sandbox from here. */
  crossMajorEvidence: OwnerVersionCandidate[];
  evidence: string[];
}

const DEFAULT_MAX_SAME_MAJOR_CANDIDATES = 5;
const DEFAULT_MAX_CROSS_MAJOR_EVIDENCE = 2;

/** Masque les identifiants dans les messages produits. */
function scrubCredentials(output: string): string {
  return output
    .split('\n')
    .filter(line => !/(username|password|token|authorization)\s*[:=]/i.test(line))
    .slice(-6)
    .join('\n')
    .slice(0, 800);
}

/** Résout local dépôt chemin. */
export function resolveLocalRepositoryPath(cwd: string, timeoutMs = 30000): string | null {
  try {
    const out = execFileSync('mvn', ['-q', '-B', 'help:evaluate', '-Dexpression=settings.localRepository', '-DforceStdout'],
      { cwd, timeout: timeoutMs, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const trimmed = out.trim();
    return trimmed && fs.existsSync(trimmed) ? trimmed : null;
  } catch {
    return null;
  }
}

/** Déclenche Metadata rafraîchissement. */
function triggerMetadataRefresh(cwd: string, groupId: string, artifactId: string, timeoutMs: number): { ok: boolean; detail: string } {
  const gav = `${groupId}:${artifactId}:LATEST:pom`;
  try {
    execFileSync('mvn', ['-q', '-B', 'dependency:get', `-Dartifact=${gav}`, '-Dtransitive=false'],
      { cwd, timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, detail: `mvn dependency:get refreshed metadata for ${gav}.` };
  } catch (err: any) {
    const output = String(err?.stdout ?? '') + String(err?.stderr ?? '');
    return { ok: false, detail: `mvn dependency:get for ${gav} did not succeed (metadata may still be locally cached from a prior resolution): ${scrubCredentials(output)}` };
  }
}

/** Recherche Metadata fichiers. */
function findMetadataFiles(localRepoRoot: string, groupId: string, artifactId: string): string[] {
  const dir = path.join(localRepoRoot, ...groupId.split('.'), artifactId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => /^maven-metadata-.+\.xml$/.test(name))
    .map(name => path.join(dir, name));
}

/** Analyse versions depuis Metadata XML. */
export function parseVersionsFromMetadataXml(xmlText: string): string[] {
  const versioningMatch = xmlText.match(/<versioning>([\s\S]*?)<\/versioning>/);
  const region = versioningMatch ? versioningMatch[1] : xmlText;
  const versions: string[] = [];
  const re = /<version>([^<]+)<\/version>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(region))) versions.push(m[1].trim());
  return versions;
}

/** Classe propriétaire versions. */
export function classifyOwnerVersions(
  currentVersion: string,
  rawVersions: string[],
  options: { maxSameMajorCandidates?: number; maxCrossMajorEvidence?: number } = {},
): { latestOverall: OwnerVersionCandidate | null; sameMajorCandidates: OwnerVersionCandidate[]; crossMajorEvidence: OwnerVersionCandidate[] } {
  const maxSameMajor = options.maxSameMajorCandidates ?? DEFAULT_MAX_SAME_MAJOR_CANDIDATES;
  const maxCrossMajor = options.maxCrossMajorEvidence ?? DEFAULT_MAX_CROSS_MAJOR_EVIDENCE;

  const distinct = [...new Set(rawVersions.map(v => v.trim()).filter(Boolean))];
  const classified: OwnerVersionCandidate[] = distinct.map(version => ({ version, policy: classifyCandidateVersionPolicy(currentVersion, version) }));

  // "never infer compatibility merely from version numbers" -- classification
  // here decides only whether a version STEP is safe to automate (the exact
  // same policy production's own eligibility gate already enforces), never
  // whether the owner bump actually closes any CVE (Phase 6/7/8's job).
  const sameMajor = classified.filter(c => isAutomationEligiblePolicy(c.policy));
  const crossMajor = classified.filter(c => c.policy.state === 'CROSS_MAJOR');

  /** Compare les versions pour les trier de la plus récente à la plus ancienne. */
  const descending = (a: OwnerVersionCandidate, b: OwnerVersionCandidate) => {
    const cmp = compareMavenVersions(a.version, b.version);
    return cmp === 'INCOMPARABLE' ? 0 : -cmp;
  };
  sameMajor.sort(descending);
  crossMajor.sort(descending);

  let latestOverall: OwnerVersionCandidate | null = null;
  for (const c of classified) {
    if (c.policy.state !== 'SAFE_SAME_LINE' && c.policy.state !== 'SAFE_SAME_MAJOR' && c.policy.state !== 'CROSS_MAJOR') continue;
    if (!latestOverall || compareMavenVersions(c.version, latestOverall.version) === 1) latestOverall = c;
  }

  return {
    latestOverall,
    sameMajorCandidates: sameMajor.slice(0, maxSameMajor),
    crossMajorEvidence: crossMajor.slice(0, maxCrossMajor), // already descending: the ceiling(s) worth showing a developer, never the whole history.
  };
}

/** Prépare le résultat lié à discover propriétaire version candidats. */
export function discoverOwnerVersionCandidates(input: {
  groupId: string;
  artifactId: string;
  currentVersion: string;
  cwd: string;
  timeoutMs?: number;
  maxSameMajorCandidates?: number;
  maxCrossMajorEvidence?: number;
}): OwnerVersionDiscoveryResult {
  const ownerCoordinate = `${input.groupId}:${input.artifactId}`;
  const timeoutMs = input.timeoutMs ?? 60000;
  const evidence: string[] = [];

  const localRepoRoot = resolveLocalRepositoryPath(input.cwd, timeoutMs);
  if (!localRepoRoot) {
    return {
      ownerCoordinate, currentVersion: input.currentVersion, status: 'PROJECT_CONTEXT_INSUFFICIENT',
      latestOverall: null, sameMajorCandidates: [], crossMajorEvidence: [],
      evidence: ['mvn help:evaluate -Dexpression=settings.localRepository did not resolve a usable local repository path -- cannot locate any maven-metadata.xml, never guessed as ~/.m2/repository.'],
    };
  }
  evidence.push(`Local repository (project-configured, via mvn help:evaluate): ${localRepoRoot}`);

  const refresh = triggerMetadataRefresh(input.cwd, input.groupId, input.artifactId, timeoutMs);
  evidence.push(refresh.detail);

  const metadataFiles = findMetadataFiles(localRepoRoot, input.groupId, input.artifactId);
  if (!metadataFiles.length) {
    return {
      ownerCoordinate, currentVersion: input.currentVersion,
      status: refresh.ok ? 'OWNER_VERSION_NOT_FOUND' : 'DEPENDENCY_RESOLUTION_FAILED',
      latestOverall: null, sameMajorCandidates: [], crossMajorEvidence: [], evidence,
    };
  }

  const rawVersions: string[] = [];
  for (const file of metadataFiles) {
    try {
      rawVersions.push(...parseVersionsFromMetadataXml(fs.readFileSync(file, 'utf8')));
      evidence.push(`Read real repository metadata: ${file}`);
    } catch (err: any) {
      evidence.push(`Failed to read metadata file ${file}: ${err?.message || 'unknown error'} (skipped, not fatal -- other metadata files may still cover this owner).`);
    }
  }
  if (!rawVersions.length) {
    return {
      ownerCoordinate, currentVersion: input.currentVersion, status: 'OWNER_VERSION_NOT_FOUND',
      latestOverall: null, sameMajorCandidates: [], crossMajorEvidence: [], evidence,
    };
  }

  const { latestOverall, sameMajorCandidates, crossMajorEvidence } = classifyOwnerVersions(input.currentVersion, rawVersions, input);
  evidence.push(`${rawVersions.length} real published version(s) found across ${metadataFiles.length} metadata file(s); ${sameMajorCandidates.length} same-major automation-eligible candidate(s) kept (bounded to ${input.maxSameMajorCandidates ?? DEFAULT_MAX_SAME_MAJOR_CANDIDATES}), ${crossMajorEvidence.length} cross-major kept as developer-review evidence only.`);

  return { ownerCoordinate, currentVersion: input.currentVersion, status: 'DISCOVERED', latestOverall, sameMajorCandidates, crossMajorEvidence, evidence };
}
