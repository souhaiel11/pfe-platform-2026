// Classe certains messages Jenkins en familles de correctifs connus, par exemple liés au pipeline ou à la construction d'image.
import { RemediationMode } from './remediation-card.component';

/**
 * Base de connaissance déterministe (zéro LLM) pour classifier une erreur de
 * build Jenkins (type : jenkinsfile/dockerfile/vulnerability/infra/code) et,
 * quand c'est pertinent, proposer une solution — ainsi que le mode de
 * remédiation fixe associé à chaque phase de pipeline.
 */
type FixType = 'jenkinsfile' | 'dockerfile' | 'vulnerability' | 'infra' | 'code';
const KNOWN_FIXES: { pattern: RegExp; type: FixType; solution: string | null }[] = [
  {
    pattern: /cannot access ['"]?mvnw['"]?|no such file or directory.*mvnw/i,
    type: 'jenkinsfile',
    solution: "Le wrapper Maven mvnw est absent du dépôt. Utilisez 'mvn' (si un tool Maven est configuré dans Jenkins) ou committez le wrapper avec 'mvn -N wrapper:wrapper'.",
  },
  {
    pattern: /Trivy.*CRITICAL|vulnerabilities found|CVE-\d+/i,
    type: 'vulnerability',
    solution: null,
  },
  {
    pattern: /COPY failed|failed to compute cache key|no source files/i,
    type: 'dockerfile',
    solution: "Chemin COPY du Dockerfile incohérent avec l'artefact réel produit par le build.",
  },
  {
    pattern: /cannot locate specified Dockerfile|Dockerfile.*not found/i,
    type: 'dockerfile',
    solution: "Dockerfile introuvable au chemin attendu.",
  },
  {
    pattern: /UnsupportedClassVersionError/,
    type: 'dockerfile',
    solution: "Version Java de l'image de base incompatible avec le bytecode compilé. Alignez l'image FROM sur la version du build.",
  },
  {
    pattern: /dockerfile parse error|unknown instruction/i,
    type: 'dockerfile',
    solution: "Instruction Dockerfile invalide.",
  },
  {
    pattern: /No such DSL method ['"]?[\w-]+['"]? found among steps/i,
    type: 'infra',
    solution: "Plugin Jenkins manquant : le step utilisé n'est fourni par aucun plugin installé sur cet agent. Installez le plugin correspondant puis redémarrez Jenkins — ce n'est pas une erreur de Jenkinsfile, aucun réarrangement de pipeline ne peut la corriger.",
  },
  {
    pattern: /Invalid option type ['"]?[\w-]+['"]?/i,
    type: 'infra',
    solution: "Directive options{} invalide ou plugin associé manquant. Vérifiez que le plugin fournissant cette directive est installé.",
  },
  {
    pattern: /connection refused|no route to host|could not resolve host/i,
    type: 'infra',
    solution: "Service cible injoignable depuis l'agent Jenkins (réseau/DNS). Vérifiez que le service est démarré et sur le même réseau Docker.",
  },
  {
    pattern: /There are test failures|Tests run:\s*\d+,\s*Failures:\s*[1-9]|Tests run:\s*\d+,.*Errors:\s*[1-9]/i,
    type: 'code',
    solution: null,
  },
];

/** Renvoie uniquement le texte de solution pour un message d'erreur donné (ou null si inconnu/non-corrigeable). */
export function suggestFix(errorMessage: string | null | undefined): string | null {
  const result = classify(errorMessage);
  return result.solution;
}

/** Teste le message d'erreur contre la base de connaissance déterministe et renvoie son type + sa solution (ou 'unknown'/null si rien ne correspond). */
export function classify(
  errorMessage: string | null | undefined,
): { type: FixType | 'unknown'; solution: string | null } {
  if (!errorMessage) return { type: 'unknown', solution: null };
  const hit = KNOWN_FIXES.find(k => k.pattern.test(errorMessage));
  return hit ? { type: hit.type, solution: hit.solution } : { type: 'unknown', solution: null };
}

export const PHASE_MODE: Record<string, RemediationMode> = {
  jenkins: 'auto-fix-selective',
  docker: 'auto-fix-selective',
  sonar: 'auto-fix-bulk',
  trivy: 'signal-only',
  owasp: 'signal-only',
  zap: 'signal-only',
};

/** Donne le mode de remédiation fixe d'une phase de pipeline (jamais déduit d'un texte d'erreur). */
export function remediationModeForPhase(phaseKey: string): RemediationMode {
  return PHASE_MODE[phaseKey] || 'signal-only';
}
