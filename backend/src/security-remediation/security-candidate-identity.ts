/** Calcule l'identité déterministe (SHA-256) d'un candidat de remédiation, seule ou agrégée sur un lot, à partir uniquement de faits déjà fiables (jamais de hasard ni d'IA). */
import { createHash } from 'crypto';

import { MavenRemediationScope } from './maven-remediation-scope';

export interface SecurityCandidateIdentityInput {
  remediationScope?: MavenRemediationScope;
  findingIdentity: string;
  evaluatedSha: string;
  package: string;
  installedVersion: string;
  targetVersion: string;
  controllingFile: string;
}

/** Normalise une valeur en chaîne de comparaison (texte vide si absente). */
function norm(value: string): string {
  return String(value ?? '').trim();
}

/** Calcule l'identité d'un candidat de remédiation unique : même requête + même SHA + même preuve groundée produit toujours la même identité. */
export function computeSecurityCandidateIdentity(input: SecurityCandidateIdentityInput): string {
  const parts = [
    norm(input.findingIdentity),
    norm(input.evaluatedSha).toLowerCase(),
    norm(input.package),
    norm(input.installedVersion),
    norm(input.targetVersion),
    norm(input.controllingFile),
  ];
  if (input.remediationScope) parts.push('security-remediation-v1.7', JSON.stringify(input.remediationScope));
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

/** Combine plusieurs empreintes en une seule : un élément unique passe inchangé (pour rester identique au cas mono-CVE), plusieurs sont hachés ensemble après tri. */
function combineIdentities(hashes: string[]): string {
  const sorted = [...hashes].sort();
  return sorted.length === 1 ? sorted[0] : createHash('sha256').update(sorted.join('\n')).digest('hex');
}

/** Calcule l'identité combinée d'un lot de candidats de remédiation, à partir de l'identité individuelle de chacun. */
export function computeSecurityBatchCandidateIdentity(perFindingInputs: SecurityCandidateIdentityInput[]): string {
  return combineIdentities(perFindingInputs.map(computeSecurityCandidateIdentity));
}

/** Calcule l'empreinte combinée des identités de finding d'un lot, pour le premier argument de computeSecurityBranchName(). */
export function computeSecurityBatchFindingsFingerprint(findingIdentities: string[]): string {
  return combineIdentities(findingIdentities);
}
