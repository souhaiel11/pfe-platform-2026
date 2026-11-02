/** Calcule, de façon déterministe et sans texte fourni par l'appelant, le nom de la branche Git d'une remédiation de sécurité à partir de deux empreintes déjà fiables. */
import { createHash } from 'crypto';

const HEX_PREFIX_LENGTH = 12;

/**
 * Construit le nom de branche "security/fix/<préfixe-finding>-<préfixe-candidat>" à partir de deux empreintes SHA-256 hexadécimales.
 * Avec `baseSha` (commit évalué) et `launchId` (lot WF6, identique pour toutes les étapes d'une même exécution), le préfixe
 * candidat est propre à chaque lancement : le même correctif relancé après un retour arrière de pom.xml ouvre une nouvelle
 * branche au lieu de retomber sur la PR déjà fusionnée (ALREADY_MERGED). Le commit évalué seul ne suffit pas : c'est celui du
 * dernier build analysé, inchangé tant qu'aucun build n'est relancé.
 */
export function computeSecurityBranchName(findingFingerprint: string, candidateIdentity: string, baseSha?: string | null, launchId?: string | null): string {
  if (!/^[0-9a-f]{64}$/.test(findingFingerprint)) {
    throw new Error(`computeSecurityBranchName: findingFingerprint must be a 64-hex sha256 digest, got ${JSON.stringify(findingFingerprint)}.`);
  }
  if (!/^[0-9a-f]{64}$/.test(candidateIdentity)) {
    throw new Error(`computeSecurityBranchName: candidateIdentity must be a 64-hex sha256 digest, got ${JSON.stringify(candidateIdentity)}.`);
  }
  if (baseSha != null && !/^[0-9a-f]{40}$/.test(baseSha)) {
    throw new Error(`computeSecurityBranchName: baseSha must be a 40-hex git sha, got ${JSON.stringify(baseSha)}.`);
  }
  const salt = [baseSha, launchId].filter(Boolean).join(':');
  const candidatePart = salt ? createHash('sha256').update(`${candidateIdentity}:${salt}`).digest('hex') : candidateIdentity;
  return `security/fix/${findingFingerprint.slice(0, HEX_PREFIX_LENGTH)}-${candidatePart.slice(0, HEX_PREFIX_LENGTH)}`;
}
