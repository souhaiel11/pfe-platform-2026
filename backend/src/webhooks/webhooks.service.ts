// webhooks.service.ts
import { Injectable } from '@nestjs/common';
import { BugsService } from '../bugs/bugs.service';
import { IncidentsService } from '../incidents/incidents.service';
import { BugSource, BugSeverity } from '../bugs/bug.entity';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly bugs: BugsService,
    private readonly incidents: IncidentsService,
  ) {}

  async handleSonarqube(projectId: string, payload: any) {
    const issues = payload?.issues || [];
    for (const issue of issues.slice(0, 20)) {
      await this.bugs.create({
        projectId,
        title: issue.message || 'SonarQube Issue',
        rawMessage: JSON.stringify(issue),
        filePath: issue.component,
        lineNumber: issue.line,
        ruleId: issue.rule,
        severity: this.mapSonarSeverity(issue.severity),
        source: BugSource.SONARQUBE,
        metadata: issue,
      });
    }
    return { processed: issues.length };
  }

  async handleJenkins(projectId: string, payload: any) {
    // Créer un incident pour tout payload Jenkins valide
    const buildNumber = payload?.build_number || payload?.build?.number || payload?.buildNumber || null;
    const buildStatus = payload?.status || payload?.build?.status || 'UNKNOWN';
    const jobName     = payload?.job || payload?.jenkinsJobName || null;
    const title       = payload?.title
                      || (jobName ? `Jenkins Build #${buildNumber}: ${buildStatus}` : 'Jenkins Build');

    const incident = await this.incidents.create({
      projectId,
      title,
      description: payload?.build_url || payload?.build?.url || payload?.metadata?.buildUrl || '',
      source: 'jenkins',
      jenkinsJobName: jobName,
      buildNumber: buildNumber ? parseInt(buildNumber) : null,
      status: 'pending' as any,
      metadata: payload,
    });
    return { received: true, incidentId: incident.id, id: incident.id };
  }

  async handleTrivy(projectId: string, payload: any) {
    const vulns = payload?.Results?.flatMap((r: any) => r.Vulnerabilities || []) || [];
    for (const v of vulns.filter((v: any) => ['CRITICAL', 'HIGH'].includes(v.Severity)).slice(0, 10)) {
      await this.bugs.create({
        projectId,
        title: `${v.VulnerabilityID}: ${v.Title || v.PkgName}`,
        rawMessage: v.Description,
        ruleId: v.VulnerabilityID,
        severity: v.Severity === 'CRITICAL' ? BugSeverity.CRITICAL : BugSeverity.HIGH,
        source: BugSource.TRIVY,
        metadata: v,
      });
    }
    return { processed: vulns.length };
  }

  private mapSonarSeverity(s: string): BugSeverity {
    const map: any = { BLOCKER: BugSeverity.CRITICAL, CRITICAL: BugSeverity.HIGH, MAJOR: BugSeverity.MEDIUM, MINOR: BugSeverity.LOW };
    return map[s] || BugSeverity.LOW;
  }
}
