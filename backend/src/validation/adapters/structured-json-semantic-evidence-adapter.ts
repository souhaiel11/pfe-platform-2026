// Second adaptateur de preuve sémantique, pour tout format de rapport structuré en JSON qui porte déjà des métadonnées personnalisées par résultat de test (ex.

import { CanonicalCase, CanonicalExecutedEvidence, RULE_REGISTRY, SemanticEvidenceAdapter, computeCanonicalEvidenceResult } from '../semantic-evidence-core';

export interface StructuredJsonTestResult {
  ruleType: string;
  subjectIdentity: Record<string, string>;
  caseId: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
}

export interface StructuredJsonSemanticEvidenceInput {
  results: StructuredJsonTestResult[];
}

const STATUS_MAP: Record<StructuredJsonTestResult['status'], CanonicalCase['status']> = {
  passed: 'PASS', failed: 'FAIL', error: 'ERROR', skipped: 'SKIPPED',
};

export class StructuredJsonSemanticEvidenceAdapter implements SemanticEvidenceAdapter {
  readonly reportFormat = 'STRUCTURED_JSON_PROPERTIES';

  // Indique si ce format de rapport est bien celui que cet adaptateur sait lire.
  supports(reportFormat: string): boolean {
    return reportFormat === this.reportFormat;
  }

  /** Lit les données et les convertit au format attendu. */
  parse(rawInput: unknown, context: { evaluatedSha: string; executionIdentity: { provider: string; buildId: string | number } }): CanonicalExecutedEvidence[] {
    const input = rawInput as StructuredJsonSemanticEvidenceInput | null | undefined;
    if (!input || !Array.isArray(input.results)) return [];

    const groups = new Map<string, { ruleType: string; subjectIdentity: Record<string, string>; cases: CanonicalCase[] }>();
    for (const entry of input.results) {
      const rule = RULE_REGISTRY[entry.ruleType];
      if (!rule) continue;
      if (!rule.identityKeys.every(k => typeof entry.subjectIdentity?.[k] === 'string')) continue;
      if (!rule.requiredCaseIds.includes(entry.caseId)) continue;
      const key = entry.ruleType + '|' + rule.identityKeys.map(k => entry.subjectIdentity[k]).join('|');
      if (!groups.has(key)) groups.set(key, { ruleType: entry.ruleType, subjectIdentity: entry.subjectIdentity, cases: [] });
      groups.get(key)!.cases.push({ caseId: entry.caseId, status: STATUS_MAP[entry.status] ?? 'FAIL' });
    }

    const result: CanonicalExecutedEvidence[] = [];
    for (const group of groups.values()) {
      const rule = RULE_REGISTRY[group.ruleType];
      result.push({
        evidenceType: 'EXECUTED_TEST', ruleType: group.ruleType, subjectIdentity: group.subjectIdentity,
        cases: group.cases, result: computeCanonicalEvidenceResult(rule, group.cases),
        evaluatedSha: context.evaluatedSha, executionIdentity: context.executionIdentity,
        provenance: { adapter: 'STRUCTURED_JSON_PROPERTIES', reportFormat: 'STRUCTURED_JSON_PROPERTIES' },
      });
    }
    return result;
  }
}
