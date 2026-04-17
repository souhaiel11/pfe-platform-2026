import { Injectable } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { BugsService } from '../bugs/bugs.service';
import { BugSeverity, BugStatus } from '../bugs/bug.entity';

@Injectable()
export class DashboardService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly bugsService: BugsService,
  ) {}

  async getGlobalStats() {
    const projects = await this.projectsService.findAll();
    const bugs = await this.bugsService.findAll();

    const openBugs = bugs.filter(b => b.status === BugStatus.OPEN);
    const criticalBugs = bugs.filter(b => b.severity === BugSeverity.CRITICAL);
    const fixedBugs = bugs.filter(b => b.status === BugStatus.RESOLVED || b.status === BugStatus.PR_CREATED);

    const avgSecurityScore = projects.length
      ? projects.reduce((sum, p) => sum + (p.securityScore || 100), 0) / projects.length
      : 100;

    return {
      totalProjects: projects.length,
      healthyProjects: projects.filter(p => p.status === 'healthy').length,
      warningProjects: projects.filter(p => p.status === 'warning').length,
      criticalProjects: projects.filter(p => p.status === 'critical').length,
      totalBugs: bugs.length,
      openBugs: openBugs.length,
      criticalBugs: criticalBugs.length,
      fixedBugs: fixedBugs.length,
      avgSecurityScore: Math.round(avgSecurityScore),
      recentBugs: bugs.slice(0, 5),
      projects: projects.slice(0, 6),
      bugsByDay: this.getBugsByDay(bugs),
      bugsBySeverity: {
        critical: bugs.filter(b => b.severity === BugSeverity.CRITICAL).length,
        high: bugs.filter(b => b.severity === BugSeverity.HIGH).length,
        medium: bugs.filter(b => b.severity === BugSeverity.MEDIUM).length,
        low: bugs.filter(b => b.severity === BugSeverity.LOW).length,
      },
    };
  }

  async getProjectDashboard(projectId: string) {
    const [sonar, jenkins, trivy, github] = await Promise.all([
      this.projectsService.getSonarMetrics(projectId),
      this.projectsService.getJenkinsStatus(projectId),
      this.projectsService.getTrivyReport(projectId),
      this.projectsService.getGithubStats(projectId),
    ]);
    const bugs = await this.bugsService.findAll(projectId);
    return { sonar, jenkins, trivy, github, bugs };
  }

  private getBugsByDay(bugs: any[]) {
    const days: Record<string, number> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      days[key] = 0;
    }
    bugs.forEach(b => {
      const key = new Date(b.createdAt).toISOString().split('T')[0];
      if (days[key] !== undefined) days[key]++;
    });
    return Object.entries(days).map(([date, count]) => ({ date, count }));
  }
}
