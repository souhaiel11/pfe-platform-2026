// Alignement de sécurité sur le changement de version majeure.
import { parseVersion, compareVersions, majorOf, ParsedVersion } from '../security-remediation/version-selection-policy';

export type CandidateVersionPolicyState =
  | 'SAFE_SAME_LINE'
  | 'SAFE_SAME_MAJOR'
  | 'CROSS_MAJOR'
  | 'INCOMPARABLE'
  | 'UNKNOWN';

export interface CandidateVersionPolicy {
  state: CandidateVersionPolicyState;
  currentVersion: string;
  candidateVersion: string;
  reason: string;
}

/** Classe une étape (version actuelle -> version candidate). */
export function classifyCandidateVersionPolicy(currentVersion: string, candidateVersion: string): CandidateVersionPolicy {
  const current = parseVersion(currentVersion);
  const candidate = parseVersion(candidateVersion);
  if (!current || !candidate) {
    return {
      state: 'INCOMPARABLE', currentVersion, candidateVersion,
      reason: `Cannot parse "${!current ? currentVersion : candidateVersion}" as a version -- never guessed, same fail-closed rule as version-selection-policy.ts's own INSTALLED_VERSION_UNPARSEABLE/NO_PARSEABLE_FIXED_VERSION.`,
    };
  }
  if (compareVersions(candidate, current) <= 0) {
    return { state: 'UNKNOWN', currentVersion, candidateVersion, reason: `"${candidateVersion}" is not strictly greater than "${currentVersion}" -- not an upgrade, never classified as safe.` };
  }
  const currentMajor = majorOf(current);
  const candidateMajor = majorOf(candidate);
  if (currentMajor !== candidateMajor) {
    return { state: 'CROSS_MAJOR', currentVersion, candidateVersion, reason: `CROSS_MAJOR_ONLY: major ${currentMajor} -> ${candidateMajor} -- production's own version-selection-policy.ts never crosses a major version automatically.` };
  }
  const sameLine = sameMajorMinor(current, candidate);
  return {
    state: sameLine ? 'SAFE_SAME_LINE' : 'SAFE_SAME_MAJOR', currentVersion, candidateVersion,
    reason: sameLine ? `Same major.minor line (${current.numericSegments.slice(0, 2).join('.')}) -- smallest possible safe step.` : `Same major (${currentMajor}) -- eligible per production's existing same-major policy.`,
  };
}

// Vérifie si deux versions partagent le même couple major.minor.
function sameMajorMinor(a: ParsedVersion, b: ParsedVersion): boolean {
  return (a.numericSegments[0] ?? 0) === (b.numericSegments[0] ?? 0) && (a.numericSegments[1] ?? 0) === (b.numericSegments[1] ?? 0);
}

// Vrai uniquement pour les deux états que la production considère déjà
// automatisables (SAFE_SAME_LINE/SAFE_SAME_MAJOR).
export function isAutomationEligiblePolicy(policy: CandidateVersionPolicy): boolean {
  return policy.state === 'SAFE_SAME_LINE' || policy.state === 'SAFE_SAME_MAJOR';
}
