// Analyse et compare les versions candidates, puis sélectionne une cible admissible selon la politique de version.

export interface ParsedVersion {
  raw: string;
  /** Leading dot-separated numeric run, e.g. "1.2.11" -> [1,2,11]. */
  numericSegments: number[];
  /** Everything after the numeric run, e.g. "-jre", ".Final". Never used for major/greater-than beyond a last-resort tiebreak. */
  qualifier: string;
}

/** Analyse la version. */
export function parseVersion(raw: unknown): ParsedVersion | null {
  const trimmed = String(raw ?? '').trim();
  const match = /^(\d+(?:\.\d+)*)(.*)$/s.exec(trimmed);
  if (!match) return null;
  const numericSegments = match[1].split('.').map(s => parseInt(s, 10));
  if (numericSegments.some(n => Number.isNaN(n))) return null;
  return { raw: trimmed, numericSegments, qualifier: match[2] };
}

/** Compare deux suites de segments numériques position par position (segment manquant traité comme 0). */
function compareNumericSegments(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Compare les versions. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const numeric = compareNumericSegments(a.numericSegments, b.numericSegments);
  if (numeric !== 0) return numeric > 0 ? 1 : -1;
  if (a.qualifier === b.qualifier) return 0;
  return a.qualifier > b.qualifier ? 1 : -1;
}

/** Extrait le numéro de version majeure (premier segment numérique). */
export function majorOf(version: ParsedVersion): number {
  return version.numericSegments[0] ?? 0;
}

export type VersionSelectionReason =
  | 'NO_FIXED_VERSIONS'
  | 'INSTALLED_VERSION_UNPARSEABLE'
  | 'NO_PARSEABLE_FIXED_VERSION'
  | 'NO_SAME_MAJOR_CANDIDATE'
  | 'CROSS_MAJOR_ONLY'
  | 'SELECTED';

export interface VersionSelectionResult {
  eligibleTargetVersion: string | null;
  reason: VersionSelectionReason;
}

/** Sélectionne éligible cible version. */
export function selectEligibleTargetVersion(
  installedVersion: string | null | undefined,
  fixedVersions: string[],
): VersionSelectionResult {
  if (!fixedVersions || !fixedVersions.length) {
    return { eligibleTargetVersion: null, reason: 'NO_FIXED_VERSIONS' };
  }
  const installed = parseVersion(installedVersion);
  if (!installed) {
    return { eligibleTargetVersion: null, reason: 'INSTALLED_VERSION_UNPARSEABLE' };
  }

  const candidates = fixedVersions
    .map(raw => ({ raw, parsed: parseVersion(raw) }))
    .filter((c): c is { raw: string; parsed: ParsedVersion } => c.parsed !== null);

  if (!candidates.length) {
    return { eligibleTargetVersion: null, reason: 'NO_PARSEABLE_FIXED_VERSION' };
  }

  const installedMajor = majorOf(installed);
  const sameMajorGreater = candidates
    .filter(c => majorOf(c.parsed) === installedMajor && compareVersions(c.parsed, installed) > 0)
    .sort((x, y) => compareVersions(x.parsed, y.parsed));

  if (sameMajorGreater.length) {
    return { eligibleTargetVersion: sameMajorGreater[0].raw, reason: 'SELECTED' };
  }

  const crossMajorGreaterExists = candidates.some(c => majorOf(c.parsed) !== installedMajor && compareVersions(c.parsed, installed) > 0);
  return { eligibleTargetVersion: null, reason: crossMajorGreaterExists ? 'CROSS_MAJOR_ONLY' : 'NO_SAME_MAJOR_CANDIDATE' };
}
