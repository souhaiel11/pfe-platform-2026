// Décision pure de transition pour le chemin de déploiement legacy (sans authorizationId).
export interface LegacyDeployTransitionResult {
  allowed: boolean;
  failureCode: 'DEPLOY_AUTHORIZATION_REQUIRED' | null;
}

/** Gate du chemin legacy (sans authorizationId) : bloque si une autorisation est exigée globalement et qu'aucune n'a été fournie ; le chemin gouverné a ses propres vérifications indépendantes. */
export function evaluateLegacyDeployTransition(authorizationRequired: boolean, hasAuthorizationId: boolean): LegacyDeployTransitionResult {
  if (hasAuthorizationId) return { allowed: true, failureCode: null };
  if (authorizationRequired) return { allowed: false, failureCode: 'DEPLOY_AUTHORIZATION_REQUIRED' };
  return { allowed: true, failureCode: null };
}
