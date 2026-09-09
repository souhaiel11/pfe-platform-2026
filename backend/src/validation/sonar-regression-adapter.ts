// BRIQUE 3 — SonarQube adapter for the generic regression engine
// (pr-regression-engine.ts). This is the ONLY file allowed to know what a
// Sonar issue looks like; the engine itself never mentions Sonar. Per
// Phase 7: an adapter may normalize scanner-specific structures, but it may
// NOT decide global business/lifecycle state -- it never computes
// "blocking" (that is the caller-supplied RegressionPolicy's job) and never
// touches the global Sonar Quality Gate (deliberately unread here: Phase 10
// of Brique 3 requires a QG ERROR caused only by pre-existing findings to
// leave `result` at CLEAN).

import { RegressionFinding } from './pr-regression-engine';

export interface RawSonarIssue {
  key?: string;
  rule?: string;
  component?: string;
  line?: number;
  message?: string;
  severity?: string;
  status?: string;
  resolution?: string;
  issueStatus?: string;
}

/**
 * Ported verbatim (semantics unchanged) from WF3's own proven
 * "Consolidate Validation Result" node (R67): a matching rule/file/line
 * alone never proves a Sonar issue is still open -- a long-lived, reused
 * validation project keeps CLOSED/FIXED issues in its history (proven live
 * on PR-24 build #6). `resolution` set => never active, regardless of
 * status. No usable status field at all => fail closed (treated as still
 * active, never silently dropped without positive proof of resolution).
 */
export function isActiveSonarIssue(issue: RawSonarIssue | null | undefined): boolean {
  if (!issue) return false;
  if (issue.resolution) return false;
  const LIVE_STATUSES = ['OPEN', 'CONFIRMED', 'REOPENED'];
  const status = String(issue.status || '').toUpperCase();
  if (status) return LIVE_STATUSES.includes(status);
  const LIVE_ISSUE_STATUSES = ['OPEN', 'CONFIRMED'];
  const issueStatus = String(issue.issueStatus || '').toUpperCase();
  if (issueStatus) return LIVE_ISSUE_STATUSES.includes(issueStatus);
  return true;
}

/**
 * Normalizes a raw Sonar `issues[]` array (e.g. `api/issues/search`, or the
 * shape already persisted at `incident.metadata.enrichedData.sonar.issues`)
 * into the engine's generic RegressionFinding[]. Filters out inactive
 * issues -- a CLOSED/FIXED issue is not a live finding to compare. Pure,
 * no I/O, no severity/blocking judgement.
 */
export function normalizeSonarFindings(issues: readonly RawSonarIssue[] | null | undefined): RegressionFinding[] {
  if (!Array.isArray(issues)) return [];
  return issues.filter(isActiveSonarIssue).map(issue => ({
    source: 'SONARQUBE',
    rule: String(issue.rule || ''),
    path: String(issue.component || ''),
    message: issue.message ?? null,
    severity: issue.severity ?? null,
  }));
}
