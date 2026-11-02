// Lit V1_8_SECURITY_ENFORCEMENT. SHADOW est le mode par défaut : observation/comparaison ; ENFORCED rend le contrôle V1.8 bloquant avant dispatch.
export type V1_8EnforcementMode = 'SHADOW' | 'ENFORCED';

/** Lit le mode SHADOW ou ENFORCED du contrôle de compatibilité. */
export function v1_8EnforcementMode(): V1_8EnforcementMode {
  return process.env.V1_8_SECURITY_ENFORCEMENT === 'ENFORCED' ? 'ENFORCED' : 'SHADOW';
}
