// Construit les preuves de vérification persistables en limitant leur taille et en masquant les informations sensibles.
import { CandidateVerification, VerificationEvidence } from './candidate-verification.types';

const MAX_EVIDENCE_LENGTH = 500;
const SECRET_PATTERN = /(token|password|secret|authorization|api[_-]?key)\s*[=:]\s*[^ ,;]+/ig;

/** Nettoie une valeur de preuve avant exposition : masque les motifs qui ressemblent à un secret (token/mot de passe/clé API), aplatit les retours à la ligne et tronque à maxLength. */
export function redactAndCapEvidence(value: unknown, maxLength: number = MAX_EVIDENCE_LENGTH): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[\r\n]+/g, ' ').replace(SECRET_PATTERN, '$1=[REDACTED]');
  if (!text.trim()) return null;
  return text.slice(0, maxLength);
}

// Construit un résumé borné et nettoyé d'une vérification candidate (statut global,
// classe d'échec, et pour chaque étape : statut + extrait de preuve rédigé).
export function buildVerificationEvidence(verification: CandidateVerification): VerificationEvidence {
  return {
    overall: verification?.overall ?? null,
    failureClass: verification?.failureClass ?? null,
    compile: {
      status: verification?.compile?.status ?? null,
      exitCode: typeof verification?.compile?.exitCode === 'number' ? verification.compile.exitCode : null,
      evidenceTail: redactAndCapEvidence(verification?.compile?.evidenceRef),
    },
    tests: {
      regressionStatus: verification?.tests?.regression?.status ?? null,
      evidenceTail: redactAndCapEvidence(verification?.tests?.regression?.evidenceRef),
    },
    staticAnalysis: {
      status: verification?.staticAnalysis?.status ?? null,
    },
  };
}
