// Modèle noyau, agnostique de tout framework, des preuves sémantiques d'exécution, plus leur logique de fusion avec un audit statique.

export interface SemanticRuleDefinition {
  ruleType: string;
  identityKeys: string[];
  requiredCaseIds: string[];
}

export const RULE_REGISTRY: Record<string, SemanticRuleDefinition> = {
  DEFAULT_VALUE_SEMANTICS_DEFECT: {
    ruleType: 'DEFAULT_VALUE_SEMANTICS_DEFECT',
    identityKeys: ['sourceType', 'sourceField', 'candidateType', 'candidateField'],
    requiredCaseIds: ['ABSENT', 'EXPLICIT_NULL', 'EXPLICIT_VALUE', 'INVALID_VALUE'],
  },
};

export type CaseStatus = 'PASS' | 'FAIL' | 'ERROR' | 'SKIPPED';
export type SemanticEvidenceResult = 'PROVEN_DEFECT' | 'VERIFICATION_REQUIRED' | 'NO_DEFECT';

export interface CanonicalCase {
  caseId: string;
  status: CaseStatus;
}

export interface CanonicalExecutedEvidence {
  evidenceType: 'EXECUTED_TEST';
  ruleType: string;
  subjectIdentity: Record<string, string>;
  cases: CanonicalCase[];
  result: SemanticEvidenceResult;
  evaluatedSha: string;
  executionIdentity: { provider: string; buildId: string | number };
  provenance: { adapter: string; reportFormat: string; [key: string]: unknown };
}

/** Calcule le verdict d'une règle à partir de ses cas observés : PROVEN_DEFECT si un cas requis a échoué, NO_DEFECT si tous les cas requis sont PASS, sinon VERIFICATION_REQUIRED. */
export function computeCanonicalEvidenceResult(rule: SemanticRuleDefinition, cases: CanonicalCase[]): SemanticEvidenceResult {
  /** Détermine la sévérité du résultat. */
  const severity = (s: CaseStatus | undefined) => s === 'FAIL' || s === 'ERROR' ? 3 : s === 'SKIPPED' ? 2 : s === 'PASS' ? 1 : 0;
  const byId = new Map<string, CaseStatus>();
  for (const c of cases) {
    if (severity(c.status) > severity(byId.get(c.caseId))) byId.set(c.caseId, c.status);
  }
  const observed = rule.requiredCaseIds.map(id => byId.get(id));
  if (observed.some(s => s === 'FAIL' || s === 'ERROR')) return 'PROVEN_DEFECT';
  if (observed.every(s => s === 'PASS')) return 'NO_DEFECT';
  return 'VERIFICATION_REQUIRED';
}

/** Vérifie que la preuve correspond bien au SHA et à l'identité d'exécution déjà vérifiés indépendamment par l'appelant. */
export function validateCanonicalEvidenceBinding(
  evidence: CanonicalExecutedEvidence | null | undefined,
  expectedSha: string,
  expectedExecutionIdentity: { provider: string; buildId: string | number },
): CanonicalExecutedEvidence | null {
  if (!evidence) return null;
  const shaOk = /^[a-f0-9]{40}$/i.test(String(evidence.evaluatedSha || ''))
    && String(evidence.evaluatedSha).toLowerCase() === String(expectedSha || '').toLowerCase();
  const providerOk = String(evidence.executionIdentity?.provider) === String(expectedExecutionIdentity.provider);
  const buildOk = String(evidence.executionIdentity?.buildId) === String(expectedExecutionIdentity.buildId);
  return (shaOk && providerOk && buildOk) ? evidence : null;
}

// Vérifie que l'identité du sujet correspond exactement, pour chaque clé déclarée
// par la règle, à l'identité portée par la cause.
export function identityMatches(rule: SemanticRuleDefinition, subjectIdentity: Record<string, string>, causeIdentity: Record<string, unknown>): boolean {
  return rule.identityKeys.every(key => String(subjectIdentity[key] ?? '') === String((causeIdentity as any)[key] ?? '') && subjectIdentity[key] !== undefined);
}

export interface StaticPolicyPair {
  ruleType?: string;
  verdict: SemanticEvidenceResult;
  source?: 'STATIC_ANALYSIS' | 'EXECUTED_TEST';
  [key: string]: unknown;
}

interface MergeableStaticAudit {
  verdict: SemanticEvidenceResult;
  checkedPairs: number;
  checkedFieldPairs: StaticPolicyPair[];
}

/** Combine l'audit statique avec les preuves d'exécution canoniques. */
export function mergeCanonicalEvidenceWithStatic<T extends MergeableStaticAudit>(
  staticAudit: T,
  evidenceList: CanonicalExecutedEvidence[],
  identityToStaticPair: (identity: Record<string, string>, ruleType: string) => StaticPolicyPair | undefined,
): T {
  if (!evidenceList.length) return staticAudit;
  const mergedPairs = [...(staticAudit.checkedFieldPairs || [])];
  let anyProvenDefect = staticAudit.verdict === 'PROVEN_DEFECT';
  let anyNewNoDefect = false;

  for (const evidence of evidenceList) {
    const staticMatch = identityToStaticPair(evidence.subjectIdentity, evidence.ruleType);
    if (staticMatch?.verdict === 'PROVEN_DEFECT') continue;
    mergedPairs.push({ ...evidence.subjectIdentity, ruleType: evidence.ruleType, verdict: evidence.result, source: 'EXECUTED_TEST' } as StaticPolicyPair);
    if (evidence.result === 'PROVEN_DEFECT') anyProvenDefect = true;
    if (evidence.result === 'NO_DEFECT') anyNewNoDefect = true;
  }

  const verdict: SemanticEvidenceResult = anyProvenDefect
    ? 'PROVEN_DEFECT'
    : (staticAudit.verdict === 'NO_DEFECT' || anyNewNoDefect) ? 'NO_DEFECT' : staticAudit.verdict;

  return { ...staticAudit, verdict, checkedFieldPairs: mergedPairs, checkedPairs: mergedPairs.length };
}

export interface SemanticEvidenceAdapter {
  readonly reportFormat: string;
  /** Indique si cet adaptateur prend en charge les données. */
  supports(reportFormat: string): boolean;
  /** Lit les données et les convertit au format attendu. */
  parse(rawInput: unknown, context: { evaluatedSha: string; executionIdentity: { provider: string; buildId: string | number } }): CanonicalExecutedEvidence[];
}
