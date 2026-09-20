// R80 §5 — SECOND-STACK PROOF. A concrete (not merely conceptual) second
// adapter, deliberately trivial, proving the core/policy layer needs zero
// changes for a genuinely different report format and framework family.
//
// Represents any test runner whose structured report format ALREADY
// carries arbitrary custom metadata per test result — e.g. Python's
// `pytest --json-report` (each result's `user_properties`/`keywords`), or
// a Jest custom reporter emitting `testResults[].properties`. Unlike
// JUnit's XML (empirically proven to drop @Tag/@DisplayName — see the
// JUnit adapter), these formats commonly preserve exactly the semantic
// identity this platform needs WITHOUT any method-name-grammar encoding
// at all — a stack-specific advantage the JUnit adapter cannot rely on.
// This is intentionally a DIFFERENT decoding strategy from the JUnit
// adapter, to prove semantic-metadata encoding really is adapter-specific
// (R80 §6), not a universal platform concept.

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

  supports(reportFormat: string): boolean {
    return reportFormat === this.reportFormat;
  }

  parse(rawInput: unknown, context: { evaluatedSha: string; executionIdentity: { provider: string; buildId: string | number } }): CanonicalExecutedEvidence[] {
    const input = rawInput as StructuredJsonSemanticEvidenceInput | null | undefined;
    if (!input || !Array.isArray(input.results)) return [];

    const groups = new Map<string, { ruleType: string; subjectIdentity: Record<string, string>; cases: CanonicalCase[] }>();
    for (const entry of input.results) {
      const rule = RULE_REGISTRY[entry.ruleType];
      if (!rule) continue; // unregistered rule type -- never guessed
      if (!rule.identityKeys.every(k => typeof entry.subjectIdentity?.[k] === 'string')) continue; // incomplete identity -- ignored, never guessed
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
