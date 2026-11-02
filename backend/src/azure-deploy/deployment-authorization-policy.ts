// Évalue une demande d'autorisation humaine de déploiement, sans I/O ni accès base.
import { GovernanceClass } from './deployment-identity.types';

export type AuthorizationMode = 'NORMAL' | 'CONDITIONAL_EXCEPTION' | 'CRITICAL_OVERRIDE';

export const REQUIRED_MODE_FOR_DECISION: Record<GovernanceClass, AuthorizationMode | null> = {
  READY: 'NORMAL',
  CONDITIONAL: 'CONDITIONAL_EXCEPTION',
  CRITICAL_RISK: 'CRITICAL_OVERRIDE',
  TECHNICALLY_IMPOSSIBLE: null,
};

export const ROLES_ALLOWED_FOR_MODE: Record<AuthorizationMode, string[]> = {
  NORMAL: ['admin', 'developer'],
  CONDITIONAL_EXCEPTION: ['admin', 'developer'],
  CRITICAL_OVERRIDE: ['admin'],
};

export const CRITICAL_OVERRIDE_CONFIRMATION_PHRASE = 'DEPLOYER MALGRÉ LES RISQUES';

export const REQUIRED_CRITICAL_ACKNOWLEDGEMENTS = ['criticalRiskAccepted', 'securityControlsMayHaveFailed', 'deploymentMayExposeKnownRisk'] as const;
export const REQUIRED_CONDITIONAL_ACKNOWLEDGEMENTS = ['conditionalRiskAccepted'] as const;

const MIN_MEANINGFUL_REASON_LENGTH = 10;

export type AuthorizationDenialCode =
  | 'DEPLOY_TECHNICALLY_IMPOSSIBLE_NO_OVERRIDE'
  | 'DEPLOY_AUTHORIZATION_MODE_MISMATCH'
  | 'DEPLOY_AUTHORIZATION_ROLE_FORBIDDEN'
  | 'DEPLOY_AUTHORIZATION_REASON_REQUIRED'
  | 'DEPLOY_AUTHORIZATION_ACKNOWLEDGEMENT_MISSING'
  | 'DEPLOY_AUTHORIZATION_PHRASE_MISMATCH';

/** Entrée d'une demande d'autorisation : mode revendiqué, motif, accusés de réception, rôle du demandeur. */
export interface AuthorizationRequestInput {
  mode: AuthorizationMode | null | undefined;
  reason?: string | null;
  acknowledgements?: Record<string, boolean> | null;
  confirmationPhrase?: string | null;
  requestedByRole: string;
}

/** Verdict de l'évaluation d'une demande d'autorisation. */
export interface AuthorizationRequestEvaluation {
  ok: boolean;
  failureCode: AuthorizationDenialCode | null;
  reason: string | null;
}

/** Vérifie qu'une demande d'autorisation humaine satisfait exactement ce que sa classe de gouvernance exige. */
export function evaluateAuthorizationRequest(governanceClass: GovernanceClass, input: AuthorizationRequestInput): AuthorizationRequestEvaluation {
  /** Construit le résultat deny. */
  const deny = (failureCode: AuthorizationDenialCode, reason: string): AuthorizationRequestEvaluation => ({ ok: false, failureCode, reason });

  if (governanceClass === 'TECHNICALLY_IMPOSSIBLE') {
    return deny('DEPLOY_TECHNICALLY_IMPOSSIBLE_NO_OVERRIDE', 'Décision TECHNICALLY_IMPOSSIBLE — aucun mode d’autorisation ne peut la satisfaire, y compris pour un administrateur.');
  }

  const requiredMode = REQUIRED_MODE_FOR_DECISION[governanceClass];
  if (input.mode !== requiredMode) {
    return deny('DEPLOY_AUTHORIZATION_MODE_MISMATCH', `Décision ${governanceClass} requiert le mode ${requiredMode}, mode fourni : ${input.mode ?? '(absent)'}.`);
  }

  const role = String(input.requestedByRole || '').toLowerCase();
  if (!ROLES_ALLOWED_FOR_MODE[requiredMode as AuthorizationMode].includes(role)) {
    return deny('DEPLOY_AUTHORIZATION_ROLE_FORBIDDEN', `Rôle "${role}" non autorisé pour le mode ${requiredMode}.`);
  }

  if (requiredMode === 'CONDITIONAL_EXCEPTION') {
    if (!input.reason || input.reason.trim().length < MIN_MEANINGFUL_REASON_LENGTH) {
      return deny('DEPLOY_AUTHORIZATION_REASON_REQUIRED', 'Un motif explicite et significatif est requis pour une exception conditionnelle.');
    }
    const acks = input.acknowledgements || {};
    for (const key of REQUIRED_CONDITIONAL_ACKNOWLEDGEMENTS) {
      if (acks[key] !== true) return deny('DEPLOY_AUTHORIZATION_ACKNOWLEDGEMENT_MISSING', `Accusé de réception manquant ou faux : "${key}".`);
    }
    return { ok: true, failureCode: null, reason: null };
  }

  if (requiredMode === 'CRITICAL_OVERRIDE') {
    if (!input.reason || input.reason.trim().length < MIN_MEANINGFUL_REASON_LENGTH) {
      return deny('DEPLOY_AUTHORIZATION_REASON_REQUIRED', 'Un motif explicite et significatif est requis pour une dérogation critique.');
    }
    const acks = input.acknowledgements || {};
    for (const key of REQUIRED_CRITICAL_ACKNOWLEDGEMENTS) {
      if (acks[key] !== true) return deny('DEPLOY_AUTHORIZATION_ACKNOWLEDGEMENT_MISSING', `Accusé de réception manquant ou faux : "${key}".`);
    }
    if (input.confirmationPhrase !== CRITICAL_OVERRIDE_CONFIRMATION_PHRASE) {
      return deny('DEPLOY_AUTHORIZATION_PHRASE_MISMATCH', `La phrase de confirmation ne correspond pas exactement à "${CRITICAL_OVERRIDE_CONFIRMATION_PHRASE}".`);
    }
    return { ok: true, failureCode: null, reason: null };
  }

  return { ok: true, failureCode: null, reason: null };
}
