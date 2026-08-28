import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Subscription, forkJoin, of, catchError } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ThemeService } from '../../core/services/theme.service';
import { ProjectEventsService } from '../../core/services/project-events.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {

  notifOpen = false;

  notifications: Array<{ level: string; title: string; meta: string }> = [];

  projects: any[] = [];
  projectsLoading = true;

  securitySummary: any = null;
  securitySummaryLoading = true;
  private projectEventsSub?: Subscription;

  private readonly avatarPalette = [
    { bg: 'var(--accent-blue-bg)',   color: 'var(--accent-primary)' },
    { bg: 'var(--accent-purple-bg)', color: 'var(--accent-purple)' },
    { bg: 'var(--accent-green-bg)',  color: 'var(--accent-green)' },
    { bg: 'var(--accent-orange-bg)', color: 'var(--accent-orange)' },
  ];

  activities: Array<{ color: string; title: string; meta: string }> = [];
  activitiesLoading = true;

  // Taux de réussite des builds — même source que l'onglet Jenkins
  // (GET /dashboard/jenkins-global::summary, lui-même bâti sur
  // getJenkinsStatus). rate=null => "Non disponible", jamais un chiffre
  // dérivé de builds fabriqués (getMockJenkinsStatus).
  buildReliability: { rate: number | null; sampleSize: number } | null = null;
  private jenkinsByProject = new Map<string, any>();

  constructor(
    private api: ApiService,
    public themeService: ThemeService,
    private router: Router,
    private projectEvents: ProjectEventsService,
    public auth: AuthService,
  ) {}

  ngOnInit() {
    this.loadProjects();
    this.loadSecuritySummary();
    this.loadIncidentFeeds();
    this.loadBuildReliability();
    this.projectEventsSub = this.projectEvents.projectsChanged$.subscribe(() => {
      this.loadProjects();
      this.loadSecuritySummary();
      this.loadIncidentFeeds();
      this.loadBuildReliability();
    });
  }

  ngOnDestroy() {
    this.projectEventsSub?.unsubscribe();
  }

  /* ── Data loading ── */
  loadSecuritySummary() {
    this.securitySummaryLoading = true;
    this.api.getSecurityGlobal().subscribe({
      next: (data: any) => { this.securitySummary = data.summary; this.securitySummaryLoading = false; },
      error: () => { this.securitySummary = null; this.securitySummaryLoading = false; },
    });
  }

  goToSecurity() { this.router.navigate(['/security']); }

  loadBuildReliability() {
    this.api.getJenkinsGlobal().subscribe({
      next: (data: any) => {
        const s = data?.summary;
        this.buildReliability = s
          ? { rate: s.aggregateSuccessRate ?? null, sampleSize: s.aggregateSampleSize ?? 0 }
          : null;
        this.jenkinsByProject = new Map((data?.projects || []).map((p: any) => [p.projectId, p]));
        this.projects = this.projects.map(p => {
          const j: any = this.jenkinsByProject.get(p.id);
          return { ...p, buildStatus: j?.lastBuild?.result || null, buildNumber: j?.lastBuild?.number || null };
        });
      },
      error: () => { this.buildReliability = null; this.jenkinsByProject.clear(); },
    });
  }

  loadIncidentFeeds() {
    this.activitiesLoading = true;
    this.api.getIncidents({ size: 20 }).subscribe({
      next: (data: any[]) => {
        const incidents = data || [];
        this.activities = incidents.slice(0, 5).map(i => ({
          color: this.getIncidentColor(i.status),
          title: i.title,
          meta: `${this.timeAgo(new Date(i.createdAt).getTime())} · ${i.project?.name || 'projet inconnu'} · ${i.status}`,
        }));
        const OPEN_STATUSES = ['pending', 'blocked', 'failed'];
        this.notifications = incidents
          .filter(i => OPEN_STATUSES.includes(i.status))
          .slice(0, 5)
          .map(i => ({
            level: i.status === 'failed' ? 'error' : 'warn',
            title: `${i.status.toUpperCase()} — ${i.title}`,
            meta: `${this.timeAgo(new Date(i.createdAt).getTime())} · ${i.project?.name || 'projet inconnu'}`,
          }));
        this.activitiesLoading = false;
      },
      error: () => { this.activities = []; this.notifications = []; this.activitiesLoading = false; },
    });
  }

  private getIncidentColor(status: string): string {
    if (['completed', 'approved'].includes(status)) return 'var(--accent-green)';
    if (['failed', 'blocked', 'rejected'].includes(status)) return 'var(--accent-red)';
    return 'var(--accent-orange)';
  }

  loadProjects() {
    this.projectsLoading = true;
    forkJoin({
      projects: this.api.getProjects(),
      security: this.api.getSecurityGlobal().pipe(catchError(() => of({ byProject: [] }))),
    }).subscribe({
      next: ({ projects, security }) => {
        const liveScores = new Map<string, number>(
          (security?.byProject || []).map((p: any) => [p.projectId, p.securityScore]),
        );
        this.projects = (projects || []).map((p, i) => this.mapProject(p, i, liveScores));
        this.projectsLoading = false;
        setTimeout(() => this.buildRiskRings(), 50);
      },
      error: () => { this.projects = []; this.projectsLoading = false; },
    });
  }

  private mapProject(p: any, index: number, liveScores: Map<string, number>) {
    const initials = (p.name || '?').substring(0, 2).toUpperCase();
    const avatar = this.avatarPalette[index % this.avatarPalette.length];
    const score = liveScores.has(p.id) ? Math.round(liveScores.get(p.id)!) : null;
    return {
      id: p.id, name: p.name,
      tech: `${p.cicdTool || 'jenkins'} · ${p.environment || 'dev'}`,
      initials, avatarBg: avatar.bg, avatarColor: avatar.color,
      incidents: (p.openIncidents || 0) + (p.analyzingIncidents || 0),
      buildStatus: this.jenkinsByProject.get(p.id)?.lastBuild?.result || null,
      buildNumber: this.jenkinsByProject.get(p.id)?.lastBuild?.number || null,
      health: score, riskScore: score,
      lastUpdate: p.updatedAt ? this.timeAgo(new Date(p.updatedAt).getTime()) : '—',
      riskBreakdown: score !== null ? [{ label: 'Score sécurité', value: score }] : [],
    };
  }

  private timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor(diff / 60000);
    if (h > 24) return 'il y a ' + Math.floor(h / 24) + 'j';
    if (h > 0) return 'il y a ' + h + 'h';
    return 'il y a ' + m + 'min';
  }

  private cssVar(name: string): string {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }

  buildRiskRings() {
    this.projects.forEach(p => {
      const canvas = document.getElementById('risk-' + p.id) as HTMLCanvasElement;
      if (!canvas || !(window as any).Chart) return;
      const ex = (window as any).Chart.getChart(canvas);
      if (ex) ex.destroy();
      if (p.riskScore === null) return;
      const color = this.cssVar(this.getRiskCssVar(p.riskScore));
      const bg = this.cssVar('--bg-tertiary') || '#F1F4F9';
      new (window as any).Chart(canvas, {
        type: 'doughnut',
        data: { datasets: [{ data: [p.riskScore, 100 - p.riskScore], backgroundColor: [color, bg], borderWidth: 0 }] },
        options: { responsive: false, cutout: '72%', plugins: { legend: { display: false } } }
      });
    });
  }

  getRiskColor(score: number): string {
    if (score >= 80) return 'var(--accent-green)';
    if (score >= 60) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  }

  getBarColor(val: number): string {
    if (val >= 75) return 'var(--accent-green)';
    if (val >= 50) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  }

  private getRiskCssVar(score: number): string {
    if (score >= 80) return '--accent-green';
    if (score >= 60) return '--accent-orange';
    return '--accent-red';
  }

  toggleNotif() { this.notifOpen = !this.notifOpen; }

  toggleTheme() {
    this.themeService.toggleTheme();
    setTimeout(() => this.buildRiskRings(), 50);
  }
}
