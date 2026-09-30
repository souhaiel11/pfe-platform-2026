import { normalizeReport } from '../common/report-normalizer';
import { v1_8EnforcementMode } from '../dependency-compatibility/v1_8-enforcement-mode';
import { LIVE_WRITER_SUPPORTED_EDIT_TYPES } from '../dependency-compatibility/v1_8-security-remediation-gate';

// Projection only: configuration is not health; a previous execution is not
// proof that a scanner/service is currently reachable. No probes or writes.
export function platformCapabilities(projects: any[], reports: any[], env = process.env) {
  const projectIds = new Set(projects.map(p => p.id));
  const scanners = new Map<string, any>();
  for (const report of reports.filter(r => projectIds.has(r.projectId))) {
    const normalized = normalizeReport(report.rawData);
    for (const [key, stage] of Object.entries(normalized.stages || {})) {
      const id = String((stage as any)?.stage || key).toLowerCase();
      if (!['sonar', 'owasp', 'trivy', 'zap'].includes(id)) continue;
      const entry = scanners.get(id) || { id, projectsReported: 0, projectsCompleted: 0, lastObservedAt: null };
      entry.projectsReported++;
      const block = (normalized as any)[id];
      if (block?.status === 'COMPLETED' || (block?.completed === true && block?.resultAvailable === true)) entry.projectsCompleted++;
      if (!entry.lastObservedAt || new Date(report.createdAt) > new Date(entry.lastObservedAt)) entry.lastObservedAt = report.createdAt;
      scanners.set(id, entry);
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    security: [...scanners.values()].sort((a, b) => a.id.localeCompare(b.id)),
    remediation: {
      enforcementMode: v1_8EnforcementMode(),
      supportedEditTypes: [...LIVE_WRITER_SUPPORTED_EDIT_TYPES].sort(),
    },
    ci: { configuredProjects: projects.filter(p => p.cicdTool === 'jenkins' && !!p.jenkinsJobName && !!(p.jenkinsInternalUrl || p.jenkinsUrl)).length },
    deployment: {
      configuredProjects: projects.filter(p => !!p.azureConfig).length,
      agentConfigured: !!env.AZURE_DEPLOY_AGENT_SECRET,
    },
  };
}
