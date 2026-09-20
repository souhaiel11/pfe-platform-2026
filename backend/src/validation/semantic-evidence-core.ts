// R80 — the CORE, framework-agnostic executed-semantic-evidence model and
// policy-merge logic. This file must NEVER import or reference a specific
// test framework, language, build tool, report format, or application
// domain (no JUnit, Surefire, Maven, Spring, Task, status, or pfe-app-test
// literal anywhere below). A concrete report format is understood only by
// an adapter (see adapters/), which converts its own raw shape into the
// CanonicalExecutedEvidence this file defines and nothing else.
//
// WHY GENERIC: this platform serves multiple projects/stacks; pfe-app-test
// (Java/Spring/JUnit) is only today's E2E fixture. R80's first version
// hardcoded the JUnit method-name grammar and the 4 DEFAULT_VALUE_SEMANTICS
// cases directly into what should be domain-neutral merge/policy logic —
// this file corrects that: every "which cases are required" / "which
// identity fields matter" decision is looked up from RULE_REGISTRY by
// ruleType, never baked into the completeness/merge functions themselves.

/** Every rule type registers exactly one entry here. Adding a brand-new
 * rule (a different kind of behavioral invariant a corrective batch might
 * need to prove) never requires touching computeCanonicalEvidenceResult,
 * mergeCanonicalEvidenceWithStatic, or computeMergeAuthorization — only a
 * new registry entry. */
export interface SemanticRuleDefinition {
  ruleType: string;
  /** The subjectIdentity keys that together uniquely name ONE instance of this rule's subject (e.g. which field, on which type pair). Order matters only for adapters that must encode identity positionally (see the JUnit adapter). */
  identityKeys: string[];
  /** Every one of these caseIds must be present and PASS for a NO_DEFECT verdict — see computeCanonicalEvidenceResult. */
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

/** One canonical, framework-agnostic case observation. */
export interface CanonicalCase {
  caseId: string;
  status: CaseStatus;
}

/**
 * The ONE shape every adapter must produce and every policy consumer must
 * accept. Framework-specific facts (a JUnit classname, a Surefire file
 * path, a Maven module) may exist ONLY inside `provenance` — nothing else
 * in this file, or in merge-authorization.ts, is allowed to read them.
 */
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

/**
 * Pure. Generic four-or-N-case completeness rule, parameterized entirely
 * by the rule's OWN registered requiredCaseIds — never a hardcoded case
 * list. A case appearing more than once (e.g. a flaky rerun) keeps the
 * worse of the two statuses, so a real failure can never be laundered by a
 * later pass.
 */
export function computeCanonicalEvidenceResult(rule: SemanticRuleDefinition, cases: CanonicalCase[]): SemanticEvidenceResult {
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

/**
 * Pure. The generic trust-boundary gate: evidence is only ever considered
 * when its evaluatedSha and executionIdentity match what the ALREADY
 * independently-verified governed build/webhook call supplies — never a
 * value asserted only inside the evidence object itself. A mismatch
 * degrades to "no evidence" (null), never a partial accept.
 */
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

/**
 * Pure. Generic identity match: true iff `subjectIdentity` carries the
 * exact same value for every key the rule's `identityKeys` declare (never
 * assumes a fixed 4-field shape — a future rule with 2 or 6 identity keys
 * works unchanged).
 */
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

/**
 * Pure. Combines a STATIC assembler's audit with canonical EXECUTED
 * evidence, per the platform's precedence rule (domain-neutral):
 *   - a STATIC PROVEN_DEFECT for the exact same subject is authoritative
 *     and is never replaced by executed evidence, related or not;
 *   - an EXECUTED PROVEN_DEFECT (a real observed case failure) always
 *     escalates the merged verdict — a conservative promotion, never a
 *     weakening;
 *   - an EXECUTED NO_DEFECT can raise an otherwise VERIFICATION_REQUIRED/
 *     empty static verdict to NO_DEFECT for that subject;
 *   - every other pair is carried through unchanged.
 * Never mutates its inputs.
 */
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
    if (staticMatch?.verdict === 'PROVEN_DEFECT') continue; // never silently overridden
    mergedPairs.push({ ...evidence.subjectIdentity, ruleType: evidence.ruleType, verdict: evidence.result, source: 'EXECUTED_TEST' } as StaticPolicyPair);
    if (evidence.result === 'PROVEN_DEFECT') anyProvenDefect = true;
    if (evidence.result === 'NO_DEFECT') anyNewNoDefect = true;
  }

  const verdict: SemanticEvidenceResult = anyProvenDefect
    ? 'PROVEN_DEFECT'
    : (staticAudit.verdict === 'NO_DEFECT' || anyNewNoDefect) ? 'NO_DEFECT' : staticAudit.verdict;

  return { ...staticAudit, verdict, checkedFieldPairs: mergedPairs, checkedPairs: mergedPairs.length };
}

/**
 * A platform-approved report-parsing adapter. Core code never imports a
 * concrete adapter directly — see adapters/registry.ts, which incidents
 * service consults by `reportFormat` alone.
 */
export interface SemanticEvidenceAdapter {
  /** The report/producer format this adapter understands, e.g. 'JUNIT_XML'. Matched exactly, never guessed from a file extension or repo name. */
  readonly reportFormat: string;
  supports(reportFormat: string): boolean;
  /** Converts one adapter-specific raw payload into zero or more canonical evidence records. Never throws on a malformed/partial input — returns []. */
  parse(rawInput: unknown, context: { evaluatedSha: string; executionIdentity: { provider: string; buildId: string | number } }): CanonicalExecutedEvidence[];
}
