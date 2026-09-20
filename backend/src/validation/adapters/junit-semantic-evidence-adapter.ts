// R80 — the FIRST concrete SemanticEvidenceAdapter. Everything JUnit/
// Surefire/Maven-specific lives in this one file; semantic-evidence-core.ts
// and the merge-authorization policy never import from here and never see
// a classname, a test method name, or a report file path.
//
// EMPIRICAL BASIS (verified, not assumed — see R80 report): a real probe
// test proved neither JUnit 5 @Tag nor @DisplayName survive into this
// project's Maven Surefire XML output — only <testcase classname="..."
// name="..."/> does. The only Surefire-safe metadata channel is therefore
// a documented, versioned naming GRAMMAR applied to the test method name
// itself. Grammar v2 is rule-type-aware and identity-arity-generic: it
// looks up how many positional identity values to expect, and in what
// order, from RULE_REGISTRY — it does not hardcode any specific rule's
// identity field count or names.

import { CanonicalCase, CanonicalExecutedEvidence, RULE_REGISTRY, SemanticEvidenceAdapter, computeCanonicalEvidenceResult } from '../semantic-evidence-core';

export type JUnitTestcaseStatus = 'PASS' | 'FAILURE' | 'ERROR' | 'SKIPPED';

/** One <testcase> fact as extracted (CI-side) from a Surefire XML report. Never inferred, never fabricated. */
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

/**
 * Grammar v2: semantic_v1__<ruleType>__<id1>__<id2>__...__<idN>__case_<caseId>[__<humanSuffix>]
 * The number of <idK> segments is read from RULE_REGISTRY[ruleType].identityKeys.length
 * — this parser has no fixed arity of its own and no rule-specific literal.
 */
const NAME_PREFIX = /^semantic_v1__([A-Za-z0-9_]+?)__(.+)$/;
const CASE_MARKER = '__case_';

interface ParsedJUnitIdentity {
  ruleType: string;
  subjectIdentity: Record<string, string>;
  caseId: string;
}

/**
 * caseId itself may legitimately contain underscores (e.g. EXPLICIT_NULL),
 * so it cannot be delimited by a fixed character-class regex the way
 * ruleType/identity segments are — a case ID is only ever recognized by
 * exact membership in the OWN rule's registered requiredCaseIds (never
 * guessed from a generic pattern), matched against the LONGEST registered
 * id that is a genuine prefix of what follows "__case_", so an optional
 * "__<humanSuffix>" after it can never be mistaken for part of the id.
 */
export function parseJUnitSemanticName(testMethodName: string): ParsedJUnitIdentity | null {
  const prefixMatch = NAME_PREFIX.exec(String(testMethodName || ''));
  if (!prefixMatch) return null;
  const [, ruleType, rest] = prefixMatch;
  const rule = RULE_REGISTRY[ruleType];
  if (!rule) return null; // unregistered rule type -- never guessed, never processed

  const caseIdx = rest.indexOf(CASE_MARKER);
  if (caseIdx === -1) return null;
  const identitySegment = rest.slice(0, caseIdx);
  const afterCase = rest.slice(caseIdx + CASE_MARKER.length);
  const caseId = [...rule.requiredCaseIds].sort((a, b) => b.length - a.length)
    .find(id => afterCase === id || afterCase.startsWith(id + '__'));
  if (!caseId) return null;

  const values = identitySegment.split('__').filter(Boolean);
  if (values.length !== rule.identityKeys.length) return null; // arity mismatch -- never guessed

  const subjectIdentity: Record<string, string> = {};
  rule.identityKeys.forEach((key, i) => { subjectIdentity[key] = values[i]; });
  return { ruleType, subjectIdentity, caseId };
}

function identityKey(ruleType: string, subjectIdentity: Record<string, string>, keys: string[]): string {
  return ruleType + '|' + keys.map(k => subjectIdentity[k]).join('|');
}

export class JUnitSemanticEvidenceAdapter implements SemanticEvidenceAdapter {
  readonly reportFormat = 'JUNIT_XML';

  supports(reportFormat: string): boolean {
    return reportFormat === this.reportFormat;
  }

  parse(rawInput: unknown, context: { evaluatedSha: string; executionIdentity: { provider: string; buildId: string | number } }): CanonicalExecutedEvidence[] {
    const input = rawInput as JUnitSemanticEvidenceInput | null | undefined;
    if (!input || !Array.isArray(input.testcases)) return [];

    const groups = new Map<string, { ruleType: string; subjectIdentity: Record<string, string>; cases: CanonicalCase[]; classnames: Set<string> }>();
    for (const testcase of input.testcases) {
      const parsed = parseJUnitSemanticName(testcase.name);
      if (!parsed) continue; // does not match the grammar -- not semantic evidence, silently ignored
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
