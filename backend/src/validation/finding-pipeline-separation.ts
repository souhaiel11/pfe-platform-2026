// Sépare le payload brut metadata.validation (persisté tel quel depuis Jenkins/WF3) en deux ensembles qui ne doivent jamais s'influencer.

export type FindingVerdict = 'VALID' | 'INVALID' | 'INCONCLUSIVE';

export interface FindingValidation {
  findingId: string;
  verdict: FindingVerdict;
  scannerEvidence: string;
  analysisId: string | null;
  validatedSha: string | null;
}

export interface PipelineHealth {
  build: string;
  tests: string;
  sonarQualityGate: string;
  trivy: string;
  owasp: string;
  zap: string;
  technicalFailure: unknown;
  requiredStagesStatus: string;
}

export interface FindingPipelineSeparation {
  findings: FindingValidation[];
  pipelineHealth: PipelineHealth;
}

/** Projette le payload brut de validation en deux ensembles séparés : les verdicts par finding et la santé globale du pipeline, sans jamais laisser l'un influencer l'autre. */
export function deriveFindingsAndHealth(raw: any): FindingPipelineSeparation {
  const rawFindingResults = Array.isArray(raw?.findingResults) ? raw.findingResults : [];
  const findings: FindingValidation[] = rawFindingResults.map((entry: any) => {
    const verdict: FindingVerdict = ['VALID', 'INVALID', 'INCONCLUSIVE'].includes(entry?.result)
      ? entry.result
      : 'INCONCLUSIVE';
    return {
      findingId: String(entry?.findingId ?? ''),
      verdict,
      scannerEvidence: entry?.evidence != null ? String(entry.evidence) : '',
      analysisId: raw?.analysisId != null ? String(raw.analysisId) : null,
      validatedSha: raw?.checkoutSha != null ? String(raw.checkoutSha) : null,
    };
  });

  // Lit le statut d'une étape du pipeline, 'UNKNOWN' si absente.
  const stage = (name: string): string => {
    const value = raw?.buildStageStatus?.[name];
    return value != null ? String(value) : 'UNKNOWN';
  };

  const pipelineHealth: PipelineHealth = {
    build: stage('build'),
    tests: stage('tests'),
    sonarQualityGate: raw?.sonarStatus != null ? String(raw.sonarStatus) : 'UNKNOWN',
    trivy: stage('trivy'),
    owasp: stage('owasp'),
    zap: stage('zap'),
    technicalFailure: raw?.technicalFailure ?? null,
    requiredStagesStatus: raw?.requiredStagesStatus != null ? String(raw.requiredStagesStatus) : 'UNKNOWN',
  };

  return { findings, pipelineHealth };
}
