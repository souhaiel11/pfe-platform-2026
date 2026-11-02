// Regroupe les traitements de sanitize projet.
const SENSITIVE_PROJECT_FIELDS = ['jenkinsToken', 'sonarqubeToken', 'githubToken', 'slackToken', 'azureDeploymentState'] as const;

/** Retire tous les champs sensibles (tokens, identifiants dans les URL, config Azure complète...) d'un objet Project avant de le renvoyer dans une réponse API. */
export function sanitizeProject<T extends Record<string, any>>(
  project: T | null | undefined,
): T | null | undefined {
  if (!project) return project;
  const clone: any = { ...project };
  clone.jenkinsCredentialConfigured = !!clone.jenkinsToken;
  clone.githubCredentialConfigured = !!clone.githubToken;
  clone.sonarqubeCredentialConfigured = !!clone.sonarqubeToken;
  for (const field of ['jenkinsUrl','jenkinsInternalUrl','jenkinsPublicUrl','sonarqubeUrl']) {
    if (!clone[field]) continue;
    try {
      const url = new URL(clone[field]);
      if (url.username || url.password || url.search || url.hash) clone[field] = null;
    } catch { clone[field] = null; }
  }
  if (clone.azureConfig) {
    clone.azureConfig = Object.fromEntries(['provider','resourceGroup','targetName','registry','imageRepository','region','subscriptionRef','cpu','memoryInGb','ports'].filter(key => Object.prototype.hasOwnProperty.call(clone.azureConfig,key)).map(key => [key,clone.azureConfig[key]]));
  }
  if (clone.validationStatus) {
    clone.validationStatus = Object.fromEntries(['jenkins','sonarqube'].filter(key => clone.validationStatus[key]).map(key => {
      const result = clone.validationStatus[key];
      return [key, {valid: result.valid === true, checkedAt: result.checkedAt,
        message: result.valid === true ? 'Connexion vérifiée.' : 'Échec de la vérification.'}];
    }));
  }
  for (const field of SENSITIVE_PROJECT_FIELDS) delete clone[field];
  return clone;
}

/** Assainit la relation `project` d'une entité (report, incident, bug...) sans toucher au reste de l'entité. */
export function sanitizeEntityProject<T extends { project?: any }>(entity: T): T {
  if (!entity || !(entity as any).project) return entity;
  return { ...entity, project: sanitizeProject((entity as any).project) };
}
