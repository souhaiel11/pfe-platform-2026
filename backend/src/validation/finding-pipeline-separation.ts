// R22-A Phase 7 — WF3 data separation.
//
// The raw `metadata.validation` payload (persisted verbatim from Jenkins/WF3
// since before this change, see incidents.service.ts#saveValidation) mixes
// two things that must never be conflated: whether an individual approved
// finding is still a real problem (scanner-produced, per-finding), and
// whether the pipeline that ran around it was healthy (build/tests/docker/
// scanners). `deriveFindingsAndHealth` is a pure, additive projection of the
// existing raw shape into the two — it changes no existing field and is not
// itself the source of truth; the raw payload remains that (Phase 8
// compatibility).
//
// Invariant this file exists to make mechanically true, not just documented:
// a finding's verdict here can NEVER be influenced by pipelineHealth, and
// pipelineHealth can never be influenced by finding verdicts. Proven live on
// PR-25 build #2 (docker/build FAILED, both target S4684 findings still
// correctly VALID) and build #3 (build/docker SUCCESS, Sonar Quality Gate
// ERROR, findings still VALID) -- see finding-pipeline-separation.spec.ts.

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

/**
 * Pure projection of the raw persisted validation payload. Never throws;
 * absent/malformed input degrades to empty findings and UNKNOWN health
 * fields, never a fabricated VALID/PASSED.
 */
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
