// Normalise un finding de sécurité en identité Maven/CVE exploitable sans inventer des coordonnées à partir d'un simple nom de JAR.
import { resolveDependencyControlProfile, DependencyControlProfileInput } from './dependency-control-profile-resolver';
import { DependencyControlProfile } from './dependency-control-profile.types';
import { SecurityCandidate, SecurityFixedVersionProvider, collectSecurityCandidates } from './security-candidate-collector';
import { buildRemediationPlans, RemediationPlan } from './remediation-plan';

export interface UnifiedSecurityFinding {
  source: 'OWASP' | 'TRIVY';
  ruleOrCve: string;
  groupId: string;
  artifactId: string;
  packageCoordinate: string;
  installedVersion: string;
  securityCandidates: SecurityCandidate[];
  evidence: string[];
}

/** Sépare Maven coordonnée Maven. */
export function splitMavenCoordinate(pkg: string): { groupId: string; artifactId: string } | null {
  const parts = String(pkg || '').trim().split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { groupId: parts[0], artifactId: parts[1] };
}

/** Convertit vers Unified sécurité finding. */
export function toUnifiedSecurityFinding(
  source: 'OWASP' | 'TRIVY',
  ruleOrCve: string,
  pkg: string,
  installedVersion: string,
  providers: SecurityFixedVersionProvider[],
): UnifiedSecurityFinding | null {
  const coordinate = splitMavenCoordinate(pkg);
  if (!coordinate) return null;
  const securityCandidates = collectSecurityCandidates({ cve: ruleOrCve, pkg, installedVersion }, providers);
  return {
    source, ruleOrCve, groupId: coordinate.groupId, artifactId: coordinate.artifactId,
    packageCoordinate: pkg, installedVersion, securityCandidates,
    evidence: [`Normalized from a real ${source} finding: ${ruleOrCve} / ${pkg} / installed ${installedVersion}.`],
  };
}

export interface UnifiedResolution {
  finding: UnifiedSecurityFinding;
  profile: DependencyControlProfile;
  plans: RemediationPlan[];
  manualReviewReason: string | null;
}

/** Résout Unified finding. */
export function resolveUnifiedFinding(
  finding: UnifiedSecurityFinding,
  projectContext: Pick<DependencyControlProfileInput, 'pomXmlText' | 'dependencyTreeText' | 'controllingFilePath' | 'groundedSha'>,
): UnifiedResolution {
  const profile = resolveDependencyControlProfile({
    package: finding.packageCoordinate, installedVersion: finding.installedVersion, ...projectContext,
  });
  const { plans, manualReviewReason } = buildRemediationPlans(profile, finding.securityCandidates);
  return { finding, profile, plans, manualReviewReason };
}
