// Issue d'un échec WF2 « revue humaine requise » (2026-10-26).
// Quand le planificateur de WF2 classe un constat MANUAL_OR_SPECIALIST (ex. java:S2068, mot de
// passe écrit en dur : il faut externaliser le secret, décision humaine), l'échec n'est pas une
// erreur technique : c'est un mauvais type de correction annoncé par WF1. On reclasse donc les
// constats du lot en DEVELOPER_ACTION_REQUIRED dans l'incident, pour que l'interface les affiche
// « Nécessite une action humaine » et ne permette plus de relancer WF2 dessus.

export const WF2_MANUAL_REVIEW_CODE = 'WF2_MANUAL_REVIEW_REQUIRED';
export const MANUAL_REVIEW_SUMMARY =
  'Correction humaine requise : l’agent de planification a jugé que ce constat ne peut pas être corrigé '
  + 'automatiquement sans risque (décision de conception ou secret à externaliser). Aucune PR n’a été créée.';

/** Vrai si le callback WF2 signale un refus de planification « revue humaine », et non une panne. */
export function isManualReviewFailure(input: { failureCode?: unknown; manualReviewRequired?: unknown }): boolean {
  return input?.manualReviewRequired === true || String(input?.failureCode || '') === WF2_MANUAL_REVIEW_CODE;
}

/** Reclasse, dans toutes les copies du constat présentes dans les métadonnées, les ids donnés en action humaine. */
export function reclassifyFindingsAsManual(metadata: any, findingIds: string[]): any {
  const ids = new Set((findingIds || []).map(String));
  if (!ids.size || !metadata || typeof metadata !== 'object') return metadata;
  const mark = (list: unknown) => Array.isArray(list)
    ? list.map((f: any) => f && ids.has(String(f.id ?? f.findingId ?? ''))
      ? { ...f, remediationType: 'DEVELOPER_ACTION_REQUIRED', remediationReason: WF2_MANUAL_REVIEW_CODE }
      : f)
    : list;
  const enriched = metadata.enrichedData;
  const sonar = enriched?.sonar;
  const stageSonar = enriched?.stages?.sonar;
  return {
    ...metadata,
    ...(enriched ? {
      enrichedData: {
        ...enriched,
        ...(sonar ? { sonar: { ...sonar, issues: mark(sonar.issues) } } : {}),
        ...(stageSonar ? { stages: { ...enriched.stages, sonar: { ...stageSonar, findings: mark(stageSonar.findings) } } } : {}),
      },
    } : {}),
  };
}
