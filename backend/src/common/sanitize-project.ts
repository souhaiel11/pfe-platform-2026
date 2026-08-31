// Assainissement de la relation Project embarquée dans les réponses API
// (reports, incidents, bugs...) — SEULE définition des champs sensibles,
// réutilisée partout au lieu d'être redéfinie service par service (avant ce
// fichier : 3 copies indépendantes de la même liste, dont une carrément
// absente sur bugs.service.ts).
//
// Deny-list par construction : un champ secret AJOUTÉ à Project sans être
// ajouté ici fuiterait silencieusement (voir sanitize-project.spec.ts, qui
// documente cette limite). Une allow-list explicite des champs publics
// serait fail-closed (plus sûre) — à envisager si Project accumule d'autres
// catégories de données sensibles à l'avenir.
const SENSITIVE_PROJECT_FIELDS = ['jenkinsToken', 'sonarqubeToken', 'githubToken', 'slackToken', 'azureDeploymentState'] as const;

export function sanitizeProject<T extends Record<string, any>>(
  project: T | null | undefined,
): T | null | undefined {
  if (!project) return project;
  const clone: any = { ...project };
  // Dérivé AVANT suppression — jamais le contenu du token, seulement sa
  // présence, pour que l'UI sache afficher "Identifiants Jenkins configurés"
  // sans jamais recevoir la valeur.
  clone.jenkinsCredentialConfigured = !!clone.jenkinsToken;
  for (const field of SENSITIVE_PROJECT_FIELDS) delete clone[field];
  return clone;
}

// Assainit la relation `project` d'une entité (report, incident, bug...) sans
// toucher au reste de l'entité.
export function sanitizeEntityProject<T extends { project?: any }>(entity: T): T {
  if (!entity || !(entity as any).project) return entity;
  return { ...entity, project: sanitizeProject((entity as any).project) };
}
