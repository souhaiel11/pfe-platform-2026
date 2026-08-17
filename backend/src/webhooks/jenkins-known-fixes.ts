// Base de connaissance déterministe (zéro LLM) : erreur de build Jenkins connue
// -> classification + solution. Aucune correspondance trouvée = type='unknown',
// solution=null, jamais une réponse inventée.
//
// MIROIR MANUEL de frontend/src/app/features/incidents/jenkins-known-fixes.ts —
// nécessaire car le backend (NestJS) et le frontend (Angular) sont deux apps
// distinctes sans package partagé configuré. Toute modification des patterns/
// types doit être répercutée dans LES DEUX fichiers, sous peine de divergence
// entre ce que le backend route automatiquement (ce fichier) et ce que le
// frontend affiche/propose à l'utilisateur (l'original).
//
// type détermine ce que la plateforme a le droit de proposer :
//   - 'jenkinsfile'   : erreur DANS le pipeline (syntaxe, chemin, wrapper absent)
//     -> WF4 peut proposer une correction automatique du Jenkinsfile.
//   - 'dockerfile'    : erreur DANS le Dockerfile (image de base incompatible,
//     chemin COPY incohérent, syntaxe invalide) -> WF5 peut proposer une
//     correction automatique du Dockerfile. Jamais WF4 : éditer le Jenkinsfile
//     ne corrige rien ici, le problème est dans l'image/le fichier Docker.
//   - 'vulnerability' : CVE / vulnérabilité détectée (Trivy) -> signalement
//     SEULEMENT. GARDE-FOU CRITIQUE : ni WF4 ni WF5 ne doivent jamais être
//     déclenchés sur ce type. Le vrai fix est dans le code applicatif ou les
//     dépendances, pas dans le Jenkinsfile ni le Dockerfile — "corriger" en
//     éditant l'un ou l'autre masquerait la vraie vulnérabilité.
//   - 'infra'         : plugin Jenkins manquant, agent/service injoignable ->
//     signalement seulement. Ni WF4 ni WF5 ne peuvent installer un plugin ni
//     réparer un agent en éditant un fichier.
//   - 'code'          : test applicatif échoué -> signalement seulement.
//     GARDE-FOU CRITIQUE : ne JAMAIS proposer de "corriger" en modifiant le
//     pipeline ou le Dockerfile — ça masquerait le vrai problème.
type FixType = 'jenkinsfile' | 'dockerfile' | 'vulnerability' | 'infra' | 'code';
const KNOWN_FIXES: { pattern: RegExp; type: FixType; solution: string | null }[] = [
  {
    pattern: /cannot access ['"]?mvnw['"]?|no such file or directory.*mvnw/i,
    type: 'jenkinsfile',
    solution: "Le wrapper Maven mvnw est absent du dépôt. Utilisez 'mvn' (si un tool Maven est configuré dans Jenkins) ou committez le wrapper avec 'mvn -N wrapper:wrapper'.",
  },
  // GARDE-FOU : vérifié AVANT les patterns 'dockerfile' — une sortie Trivy
  // peut mentionner une image ou un chemin, mais reste une vulnérabilité,
  // jamais une correction Dockerfile/Jenkinsfile.
  {
    pattern: /Trivy.*CRITICAL|vulnerabilities found|CVE-\d+/i,
    type: 'vulnerability',
    solution: null, // jamais de "solution" pour une vulnérabilité — signalement seul, voir garde-fou
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
    solution: null, // jamais de "solution" pour du code applicatif — signalement seul, voir garde-fou
  },
];

export function classify(
  errorMessage: string | null | undefined,
): { type: FixType | 'unknown'; solution: string | null } {
  if (!errorMessage) return { type: 'unknown', solution: null };
  const hit = KNOWN_FIXES.find(k => k.pattern.test(errorMessage));
  return hit ? { type: hit.type, solution: hit.solution } : { type: 'unknown', solution: null };
}
