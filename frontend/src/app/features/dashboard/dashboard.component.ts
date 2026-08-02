import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription, forkJoin, of, catchError } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ThemeService } from '../../core/services/theme.service';
import { ProjectEventsService } from '../../core/services/project-events.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {

  notifOpen = false;
  chatOpen = false;
  chatInput = '';
  unreadChat = 1;

  // ── Notifications — incidents ouverts réels (plus de données inventées) ──
  notifications: Array<{ level: string; title: string; meta: string }> = [];

  kpis = [
    { label: 'Incidents actifs', value: '3', sub: '+2 depuis hier',  icon: 'ti-alert-circle',       color: 'red' },
    { label: 'Builds réussis',   value: '12', sub: "aujourd'hui",    icon: 'ti-circle-check',        color: 'green' },
    { label: 'Décisions IA',     value: '7',  sub: 'cette semaine',  icon: 'ti-robot',               color: 'blue' },
    { label: 'CVE HIGH',         value: '2',  sub: 'en attente',     icon: 'ti-shield-exclamation',  color: 'orange' },
  ];

  projects: any[] = [];
  projectsLoading = true;

  // ── Synthèse sécurité plateforme (security-global) ────────
  securitySummary: any = null;
  securitySummaryLoading = true;
  private projectEventsSub?: Subscription;

  private readonly avatarPalette = [
    { bg: 'var(--accent-blue-bg)',   color: 'var(--accent-primary)' },
    { bg: 'var(--accent-purple-bg)', color: 'var(--accent-purple)' },
    { bg: 'var(--accent-green-bg)',  color: 'var(--accent-green)' },
    { bg: 'var(--accent-orange-bg)', color: 'var(--accent-orange)' },
  ];

  doraMetrics = [
    { icon: '🚀', value: '3.2/j',  label: 'Deployment Frequency', level: 'ELITE',  color: 'var(--accent-green)',  badgeBg: 'var(--accent-green-bg)' },
    { icon: '⏱️', value: '4h20',   label: 'Lead Time for Changes', level: 'HIGH',   color: 'var(--accent-green)',  badgeBg: 'var(--accent-green-bg)' },
    { icon: '📉', value: '18%',    label: 'Change Failure Rate',   level: 'MEDIUM', color: 'var(--accent-orange)', badgeBg: 'var(--accent-orange-bg)' },
    { icon: '🔧', value: '45min',  label: 'MTTR',                  level: 'ELITE',  color: 'var(--accent-green)',  badgeBg: 'var(--accent-green-bg)' },
  ];

  // ── Activité récente — incidents réels (plus de données inventées) ──
  activities: Array<{ color: string; title: string; meta: string }> = [];
  activitiesLoading = true;

  chatMessages: { role: string; content: string }[] = [
    { role: 'ai', content: "Bonjour Souhaiel ! 3 incidents actifs · Build #132 OK · Score risque 62/100. Comment puis-je t'aider ?" }
  ];

  chatSuggestions = ['Score risque', 'Pods K8s', 'CVE Trivy', 'DORA', 'Incidents'];

  private chatReplies: Record<string, string> = {
    'score risque': 'pfe-app-test : 62/100 MEDIUM\npfe-platform : 91/100 LOW\nScore = Jenkins 40% + SonarQube 30% + Trivy 20% + OWASP 10%',
    'pods k8s':     '4/4 pods Running :\n• frontend :30002 ✓\n• backend :30001 ✓\n• app-test :30003 ✓\n• postgres ClusterIP ✓',
    'dora':         'Deployment: 3.2/j (ELITE)\nLead Time: 4h20 (HIGH)\nCFR: 18% (MEDIUM)\nMTTR: 45min (ELITE)',
    'incidents':    '3 incidents actifs :\n• Tests cassés → NOTIFY_ONLY\n• OWASP ZAP → OPEN\n• CVE HIGH → en attente',
  };

  constructor(
    private api: ApiService,
    public themeService: ThemeService,
    private router: Router,
    private projectEvents: ProjectEventsService,
  ) {}

  ngOnInit() {
    this.loadProjects();
    this.loadSecuritySummary();
    this.loadIncidentFeeds();
    // Re-fetch les vues globales après création/suppression d'un projet,
    // sans reload manuel de la page.
    this.projectEventsSub = this.projectEvents.projectsChanged$.subscribe(() => {
      this.loadProjects();
      this.loadSecuritySummary();
      this.loadIncidentFeeds();
    });
  }

  ngAfterViewInit() {
    setTimeout(() => this.buildHeatmap(), 100);
  }

  ngOnDestroy() {
    this.projectEventsSub?.unsubscribe();
  }

  loadSecuritySummary() {
    this.securitySummaryLoading = true;
    this.api.getSecurityGlobal().subscribe({
      next: (data: any) => { this.securitySummary = data.summary; this.securitySummaryLoading = false; },
      error: () => { this.securitySummary = null; this.securitySummaryLoading = false; },
    });
  }

  goToSecurity() { this.router.navigate(['/security']); }

  // Un seul fetch d'incidents alimente à la fois "Activité récente" (les
  // plus récents, tous statuts) et la cloche de notifications (uniquement
  // les incidents ouverts — même définition "ouvert" que ProjectsService :
  // pending / blocked / failed — donc de vraies alertes actionnables).
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
    return 'var(--accent-orange)'; // pending / analyzing / analyzed / fix_generated / validating
  }

  // Le score affiché par projet vient TOUJOURS de security-global (live,
  // recalculé depuis le dernier report). Si cet appel échoue, on n'affiche
  // JAMAIS Project.securityScore en repli silencieux (il peut être
  // désynchronisé sans alerte) — le projet passe en état neutre ("—").
  loadProjects() {
    this.projectsLoading = true;
    forkJoin({
      projects: this.api.getProjects(),
      // Ne fait jamais échouer le forkJoin : si security-global tombe, on
      // dégrade en neutre (byProject: []), la liste des projets reste affichée.
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
    // null = security-global n'a pas répondu pour ce projet → état neutre,
    // jamais un repli sur p.securityScore (potentiellement figé/faux).
    const score = liveScores.has(p.id) ? Math.round(liveScores.get(p.id)!) : null;
    return {
      id: p.id,
      name: p.name,
      tech: `${p.cicdTool || 'jenkins'} · ${p.environment || 'dev'}`,
      initials,
      avatarBg: avatar.bg,
      avatarColor: avatar.color,
      incidents: (p.openIncidents || 0) + (p.analyzingIncidents || 0),
      buildStatus: p.status === 'healthy' ? 'SUCCESS' : 'FAILURE',
      health: score,
      riskScore: score,
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

  /* Resolve a CSS custom property to a concrete colour string (for Chart.js) */
  private cssVar(name: string): string {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }

  buildRiskRings() {
    this.projects.forEach(p => {
      const canvas = document.getElementById('risk-' + p.id) as HTMLCanvasElement;
      if (!canvas || !(window as any).Chart) return;
      const ex = (window as any).Chart.getChart(canvas);
      if (ex) ex.destroy();
      // riskScore null = security-global indisponible pour ce projet — pas
      // d'anneau trompeur, on laisse le canvas vide (le "—" du template suffit).
      if (p.riskScore === null) return;
      const color = this.cssVar(this.getRiskCssVar(p.riskScore));
      const bg    = this.cssVar('--bg-tertiary') || '#F1F4F9';
      new (window as any).Chart(canvas, {
        type: 'doughnut',
        data: { datasets: [{ data: [p.riskScore, 100 - p.riskScore], backgroundColor: [color, bg], borderWidth: 0 }] },
        options: { responsive: false, cutout: '72%', plugins: { legend: { display: false } } }
      });
    });
  }

  buildHeatmap() {
    const days  = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    const weeks = 8;
    const colors = [
      'var(--bg-tertiary)',
      'var(--accent-green-bg)',
      'var(--color-success)',
      'var(--accent-green)',
      'var(--accent-red)',
    ];
    const wrap = document.getElementById('heatmap');
    if (!wrap) return;
    let html = '';
    days.forEach((day, di) => {
      html += `<div class="hm-row"><span class="hm-lbl">${day}</span>`;
      for (let w = 0; w < weeks; w++) {
        const r  = Math.random();
        const ci = di >= 5 ? 0 : r < .12 ? 4 : r < .25 ? 1 : r < .55 ? 3 : 2;
        const label = ci === 4 ? 'Échec' : 'Succès';
        html += `<div class="hm-cell" style="background:${colors[ci]}" title="${label}"></div>`;
      }
      html += '</div>';
    });
    wrap.innerHTML = html;
  }

  /* Returns a CSS var string — usable in [style.color] template bindings */
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

  /* Returns the CSS variable name only (for cssVar() resolution in charts) */
  private getRiskCssVar(score: number): string {
    if (score >= 80) return '--accent-green';
    if (score >= 60) return '--accent-orange';
    return '--accent-red';
  }

  toggleNotif() { this.notifOpen = !this.notifOpen; }
  toggleChat()  { this.chatOpen  = !this.chatOpen; this.unreadChat = 0; }

  toggleTheme() {
    this.themeService.toggleTheme();
    /* Rebuild chart colours after the theme class is applied */
    setTimeout(() => this.buildRiskRings(), 50);
  }

  sendSuggestion(s: string) { this.chatInput = s; this.sendChat(); }

  sendChat() {
    const q = this.chatInput.trim();
    if (!q) return;
    this.chatMessages.push({ role: 'user', content: q });
    this.chatInput = '';
    const key   = q.toLowerCase();
    const reply = key === 'cve trivy'
      ? this.buildCveTrivyReply()
      : this.chatReplies[key] || `Connecte le vrai endpoint n8n+Claude pour des réponses live sur "${q}".`;
    setTimeout(() => { this.chatMessages.push({ role: 'ai', content: reply }); }, 500);
  }

  private buildCveTrivyReply(): string {
    if (!this.securitySummary) return 'Données sécurité indisponibles pour le moment.';
    const s = this.securitySummary;
    return `${s.totalCriticalCves} CRITICAL · ${s.totalHighCves} HIGH (plateforme, ${s.totalProjects} projet(s))\nDétail par projet → page Sécurité`;
  }

  exportPDF() {
    alert('📄 Export PDF — À implémenter avec jsPDF ou WeasyPrint côté NestJS backend.\n\nContenus : Score risque · Décisions IA · SonarQube · Trivy · DORA · Incidents');
  }
}
