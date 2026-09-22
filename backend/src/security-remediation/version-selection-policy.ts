// R-SEC-V1 §5 — pure, deterministic version-selection policy. No SemVer
// library assumed (Maven/Debian-style versions routinely violate strict
// SemVer — e.g. "1:8.2.2+ds-0ubuntu1.4"): this is a defensive, numeric-
// prefix comparator, never a full SemVer parser.
//
// "Major" = the first numeric segment only (e.g. major(9.0.63) = 9,
// major(1.2.11) = 1). This is deliberately the same convention already
// used by the platform's own severity/risk tiering elsewhere (small,
// explicit, no external dependency) rather than importing a SemVer package
// for a domain (Maven versions) SemVer doesn't fully cover anyway.

export interface ParsedVersion {
  raw: string;
  /** Leading dot-separated numeric run, e.g. "1.2.11" -> [1,2,11]. */
  numericSegments: number[];
  /** Everything after the numeric run, e.g. "-jre", ".Final". Never used for major/greater-than beyond a last-resort tiebreak. */
  qualifier: string;
}

/** Ambiguous/unparseable input (no leading digit) -> null, never a guessed number. */
export function parseVersion(raw: unknown): ParsedVersion | null {
  const trimmed = String(raw ?? '').trim();
  const match = /^(\d+(?:\.\d+)*)(.*)$/s.exec(trimmed);
  if (!match) return null;
  const numericSegments = match[1].split('.').map(s => parseInt(s, 10));
  if (numericSegments.some(n => Number.isNaN(n))) return null;
  return { raw: trimmed, numericSegments, qualifier: match[2] };
}

function compareNumericSegments(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** -1 / 0 / 1, numeric-prefix first, qualifier as a last-resort lexical tiebreak. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const numeric = compareNumericSegments(a.numericSegments, b.numericSegments);
  if (numeric !== 0) return numeric > 0 ? 1 : -1;
  if (a.qualifier === b.qualifier) return 0;
  return a.qualifier > b.qualifier ? 1 : -1;
}

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

/**
 * Pure. Picks the LOWEST fixed version that is (a) strictly greater than
 * installedVersion and (b) same major as installedVersion. Never crosses a
 * major boundary automatically (rule 6) — CROSS_MAJOR_ONLY is returned
 * (target null) when the only remediating versions require a major jump,
 * so the caller can distinguish "no fix needed direction exists" from
 * "a fix exists but needs human approval for the major jump".
 * Ambiguous/unparseable installedVersion fails closed (rule 7): never
 * guesses a major from a malformed string.
 */
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
