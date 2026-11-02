// Adaptateur SonarQube pour le moteur générique de régression : le seul fichier autorisé à connaître la forme d'un issue Sonar.

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

/** Détermine si un issue Sonar est toujours actif. */
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

// Convertit un tableau brut d'issues Sonar en RegressionFinding[] génériques, en
// écartant au passage les issues qui ne sont plus actives.
export function normalizeSonarFindings(issues: readonly RawSonarIssue[] | null | undefined): RegressionFinding[] {
  if (!Array.isArray(issues)) return [];
  return issues.filter(isActiveSonarIssue).map(issue => ({
    source: 'SONARQUBE',
    rule: String(issue.rule || ''),
    path: String(issue.component || ''),
    message: issue.message ?? null,
    severity: issue.severity ?? null,
    line: typeof issue.line === 'number' ? issue.line : null,
  }));
}
