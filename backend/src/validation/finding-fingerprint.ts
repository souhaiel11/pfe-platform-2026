// BRIQUE 3 — canonical, technology-neutral finding identity.
//
// Phase 0 audit (see pr-regression-engine.ts header) found no existing
// stable cross-scan identity to reuse as-is: a backend/scanner-native
// database id is never proven stable, and WF3's own proven approved-finding
// matcher (n8n-workflows/active/wf3-post-pr-validation-v4-...json,
// "Consolidate Validation Result", R67) already uses exactly (rule,
// normalized path) as its PRIMARY key -- line number there is only ever a
// secondary near-match, never load-bearing alone. This fingerprint reuses
// that same primary key, generalized across scanners via an explicit
// `source`, and deliberately drops the line-number tie-breaker entirely:
// Brique 3 must never misclassify a finding as new merely because a line
// moved when surrounding code changed (Phase 11 Case D).
//
// Sonar-native issue `key`s are NOT used here either: baseline and
// candidate are two INDEPENDENTLY-KEYED Sonar analyses by design (R45
// COMMUNITY_EXACT_SHA isolation -- the PR-scoped analysis runs under
// `<baseSonarProjectKey>-pr-<prNumber>`, a different Sonar project from the
// baseline's `baseSonarProjectKey`), so Sonar never assigns the same issue
// key to the "same" logical finding across the two. A structural identity
// is the only thing that can survive that boundary.

export interface FingerprintableFinding {
  /** Generic scanner family, e.g. 'SONARQUBE' | 'TRIVY' | 'OWASP' | 'ZAP'. Case-insensitive. */
  source: string;
  /** Scanner-native rule/check identifier, e.g. 'java:S4684' or a CVE id. */
  rule: string;
  /** Raw scanner-reported path/component (may carry a "<projectKey>:" prefix). */
  path: string;
}

// Sonar's `component` field is "<projectKey>:<repo-relative-path>" -- the
// project-key prefix must never be part of the identity, or a baseline and
// candidate finding for the exact same file could never match (they live
// under different project keys). Ported from WF3's own `normalizeFile`.
export function normalizeFindingPath(path: string): string {
  return String(path || '')
    .replace(/^[^:]*:/, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
    .toLowerCase();
}

/**
 * Deterministic, pure. Returns null when any required component is missing
 * -- the caller must treat a null fingerprint as "cannot be identified
 * confidently" (AMBIGUOUS), never silently fall back to a partial identity.
 */
export function computeFindingFingerprint(finding: FingerprintableFinding): string | null {
  const source = String(finding.source || '').trim().toUpperCase();
  const rule = String(finding.rule || '').trim();
  const path = normalizeFindingPath(finding.path);
  if (!source || !rule || !path) return null;
  return `${source}::${rule}::${path}`;
}
