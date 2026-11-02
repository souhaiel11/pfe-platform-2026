// Encadre la construction et le scan des images de vérification.
export { SecurityArtifactScan, ArtifactRuntimeError, trackedSourceDigest, cveTargets, provesSecurityClosure, countHighCriticalVulnerabilities } from '../../backend/src/security-remediation/security-artifact-scan';
import { SecurityArtifactScan } from '../../backend/src/security-remediation/security-artifact-scan';

export interface SecurityArtifactValidator {
  /** Inspecte les données ou l’artefact pour en tirer des preuves. */
  inspect(workspace: string, budgetMs?: number, targetCves?: string[]): SecurityArtifactScan;
}
