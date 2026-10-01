import { Injectable } from '@nestjs/common';

// Explicit allowlist: never serialize environment/configuration objects.
// Repository/branch are project-specific. Trivy configuration and DB metadata
// live in the isolated scanner; no server-side source is available here.
export function buildEffectiveConfig(env: NodeJS.ProcessEnv = process.env) {
  const transportConfigured = !!env.N8N_INTERNAL_SECRET;
  const database = () => ({ ageMs: null, maxAgeMs: null, available: null });
  return {
    generatedAt: new Date().toISOString(),
    platform: {
      environment: ['development', 'production', 'test'].includes(env.NODE_ENV || '') ? env.NODE_ENV : null,
      targetRepository: null,
      defaultBranch: null,
      projectConfigurationReason: 'Le dépôt et la branche sont définis par projet, sans valeur globale de plateforme.',
      wf2: { configured: transportConfigured },
      wf6: { configured: transportConfigured },
      workflowConfigurationReason: 'Présence de la configuration d’authentification du transport existant ; ne prouve pas que les workflows sont actifs ou joignables.',
    },
    scanners: {
      trivy: {
        severityThresholds: null,
        available: null,
        vulnDb: database(),
        javaDb: database(),
        unavailableReason: 'La configuration et les métadonnées des bases du scanner isolé ne sont pas accessibles depuis ce backend.',
      },
    },
    policies: {
      // Architecture invariants, not inferred runtime status or editable flags.
      invariants: [
        'Aucune fusion automatique : la fusion des Pull Requests reste humaine.',
        'Verdict par vulnérabilité, jamais par lot agrégé.',
        'Blocage sur régression prouvée uniquement, jamais sur une simple absence de preuve.',
        'Validation humaine des actions à risque.',
      ],
    },
  };
}

@Injectable()
export class EffectiveConfigService {
  getEffectiveConfig() { return buildEffectiveConfig(); }
}
