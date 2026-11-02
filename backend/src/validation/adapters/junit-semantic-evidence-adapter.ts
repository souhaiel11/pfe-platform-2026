// Premier adaptateur concret de preuve sémantique, pour les rapports Surefire/JUnit.

import { CanonicalCase, CanonicalExecutedEvidence, RULE_REGISTRY, SemanticEvidenceAdapter, computeCanonicalEvidenceResult } from '../semantic-evidence-core';

export type JUnitTestcaseStatus = 'PASS' | 'FAILURE' | 'ERROR' | 'SKIPPED';

export interface RawJUnitTestcase {
  classname: string;
  name: string;
  status: JUnitTestcaseStatus;
}

export interface JUnitSemanticEvidenceInput {
  testcases: RawJUnitTestcase[];
}

const STATUS_MAP: Record<JUnitTestcaseStatus, CanonicalCase['status']> = {
  PASS: 'PASS', FAILURE: 'FAIL', ERROR: 'ERROR', SKIPPED: 'SKIPPED',
};

const NAME_PREFIX = /^semantic_v1__([A-Za-z0-9_]+?)__(.+)$/;
const CASE_MARKER = '__case_';

interface ParsedJUnitIdentity {
  ruleType: string;
  subjectIdentity: Record<string, string>;
  caseId: string;
}

/** Décode un nom de méthode de test suivant la grammaire semantic_v1__<ruleType>__<id1>__...__<idN>__case_<caseId>[__<suffixe>]. */
export function parseJUnitSemanticName(testMethodName: string): ParsedJUnitIdentity | null {
  const prefixMatch = NAME_PREFIX.exec(String(testMethodName || ''));
  if (!prefixMatch) return null;
  const [, ruleType, rest] = prefixMatch;
  const rule = RULE_REGISTRY[ruleType];
  if (!rule) return null;

  const caseIdx = rest.indexOf(CASE_MARKER);
  if (caseIdx === -1) return null;
  const identitySegment = rest.slice(0, caseIdx);
  const afterCase = rest.slice(caseIdx + CASE_MARKER.length);
  const caseId = [...rule.requiredCaseIds].sort((a, b) => b.length - a.length)
    .find(id => afterCase === id || afterCase.startsWith(id + '__'));
  if (!caseId) return null;

  const values = identitySegment.split('__').filter(Boolean);
  if (values.length !== rule.identityKeys.length) return null;

  const subjectIdentity: Record<string, string> = {};
  rule.identityKeys.forEach((key, i) => { subjectIdentity[key] = values[i]; });
  return { ruleType, subjectIdentity, caseId };
}

// Construit la clé de regroupement d'une identité de sujet pour une règle donnée.
function identityKey(ruleType: string, subjectIdentity: Record<string, string>, keys: string[]): string {
  return ruleType + '|' + keys.map(k => subjectIdentity[k]).join('|');
}

export class JUnitSemanticEvidenceAdapter implements SemanticEvidenceAdapter {
  readonly reportFormat = 'JUNIT_XML';

  // Indique si ce format de rapport est bien celui que cet adaptateur sait lire.
  supports(reportFormat: string): boolean {
    return reportFormat === this.reportFormat;
  }

  /** Lit les données et les convertit au format attendu. */
  parse(rawInput: unknown, context: { evaluatedSha: string; executionIdentity: { provider: string; buildId: string | number } }): CanonicalExecutedEvidence[] {
    const input = rawInput as JUnitSemanticEvidenceInput | null | undefined;
    if (!input || !Array.isArray(input.testcases)) return [];

    const groups = new Map<string, { ruleType: string; subjectIdentity: Record<string, string>; cases: CanonicalCase[]; classnames: Set<string> }>();
    for (const testcase of input.testcases) {
      const parsed = parseJUnitSemanticName(testcase.name);
      if (!parsed) continue;
      const rule = RULE_REGISTRY[parsed.ruleType];
      const key = identityKey(parsed.ruleType, parsed.subjectIdentity, rule.identityKeys);
      if (!groups.has(key)) groups.set(key, { ruleType: parsed.ruleType, subjectIdentity: parsed.subjectIdentity, cases: [], classnames: new Set() });
      const group = groups.get(key)!;
      group.cases.push({ caseId: parsed.caseId, status: STATUS_MAP[testcase.status] ?? 'FAIL' });
      group.classnames.add(testcase.classname);
    }

    const result: CanonicalExecutedEvidence[] = [];
    for (const group of groups.values()) {
      const rule = RULE_REGISTRY[group.ruleType];
      result.push({
        evidenceType: 'EXECUTED_TEST',
        ruleType: group.ruleType,
        subjectIdentity: group.subjectIdentity,
        cases: group.cases,
        result: computeCanonicalEvidenceResult(rule, group.cases),
        evaluatedSha: context.evaluatedSha,
        executionIdentity: context.executionIdentity,
        provenance: { adapter: 'JUNIT_XML', reportFormat: 'JUNIT_XML', junitClassnames: [...group.classnames] },
      });
    }
    return result;
  }
}
