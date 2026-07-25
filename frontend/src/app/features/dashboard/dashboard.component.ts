import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, AfterViewInit {

  notifOpen = false;
  chatOpen = false;
  chatInput = '';
  unreadChat = 1;
  showPrediction = true;

  notifications = [
    { level: 'error', title: 'CRITICAL — Pod app-test CrashLoopBackOff', meta: 'il y a 6h · Corrigé → DB_HOST=postgres' },
    { level: 'warn',  title: 'WARN — 2 CVE HIGH Trivy · eclipse-temurin', meta: 'il y a 5h · Patch recommandé' },
    { level: 'info',  title: 'INFO — Build #132 SUCCESS · Deploy K8s OK', meta: 'il y a 2h · main-132 déployé' },
  ];

  kpis = [
    { label: 'Incidents actifs', value: '3', sub: '+2 depuis hier',  icon: 'ti-alert-circle',       color: 'red' },
    { label: 'Builds réussis',   value: '12', sub: "aujourd'hui",    icon: 'ti-circle-check',        color: 'green' },
    { label: 'Décisions IA',     value: '7',  sub: 'cette semaine',  icon: 'ti-robot',               color: 'blue' },
    { label: 'CVE HIGH',         value: '2',  sub: 'en attente',     icon: 'ti-shield-exclamation',  color: 'orange' },
  ];

  projects: any[] = [];
  projectsLoading = true;

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

  activities = [
    { color: 'var(--accent-green)',  title: 'Build #132 — pfe-app-test — SUCCESS',        meta: 'il y a 2h · kubectl rollout OK' },
    { color: 'var(--accent-orange)', title: 'Incident #45 — Tests cassés — NOTIFY_ONLY',  meta: 'il y a 3h · Judge Agent Claude' },
    { color: 'var(--accent-red)',    title: 'CVE-2024-1234 HIGH — eclipse-temurin:17',    meta: 'il y a 5h · Trivy scan' },
    { color: 'var(--accent-green)',  title: 'Quality Gate SonarQube — PASSED',            meta: 'il y a 5h · Coverage 74%' },
    { color: 'var(--accent-primary)',title: 'DB_HOST corrigé — kubectl set env',          meta: 'il y a 6h · K8s pod Running' },
  ];

  chatMessages: { role: string; content: string }[] = [
    { role: 'ai', content: "Bonjour Souhaiel ! 3 incidents actifs · Build #132 OK · Score risque 62/100. Comment puis-je t'aider ?" }
  ];

  chatSuggestions = ['Score risque', 'Pods K8s', 'CVE Trivy', 'DORA', 'Incidents'];

  private chatReplies: Record<string, string> = {
    'score risque': 'pfe-app-test : 62/100 MEDIUM\npfe-platform : 91/100 LOW\nScore = Jenkins 40% + SonarQube 30% + Trivy 20% + OWASP 10%',
    'pods k8s':     '4/4 pods Running :\n• frontend :30002 ✓\n• backend :30001 ✓\n• app-test :30003 ✓\n• postgres ClusterIP ✓',
    'cve trivy':    '0 CRITICAL · 2 HIGH\n• CVE-2024-1234 eclipse-temurin (CVSS 7.5)\n• CVE-2024-5678 alpine:3.18 (CVSS 7.1)',
    'dora':         'Deployment: 3.2/j (ELITE)\nLead Time: 4h20 (HIGH)\nCFR: 18% (MEDIUM)\nMTTR: 45min (ELITE)',
    'incidents':    '3 incidents actifs :\n• Tests cassés → NOTIFY_ONLY\n• OWASP ZAP → OPEN\n• CVE HIGH → en attente',
  };

  constructor(private api: ApiService, public themeService: ThemeService) {}

  ngOnInit() { this.loadProjects(); }

  ngAfterViewInit() {
    setTimeout(() => this.buildHeatmap(), 100);
  }

  loadProjects() {
    this.projectsLoading = true;
    this.api.getProjects().subscribe({
      next: (data: any[]) => {
        this.projects = (data || []).map((p, i) => this.mapProject(p, i));
        this.projectsLoading = false;
        setTimeout(() => this.buildRiskRings(), 50);
      },
      error: () => { this.projects = []; this.projectsLoading = false; },
    });
  }

  private mapProject(p: any, index: number) {
    const initials = (p.name || '?').substring(0, 2).toUpperCase();
    const avatar = this.avatarPalette[index % this.avatarPalette.length];
    const score = Math.round(p.securityScore ?? 0);
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
      riskBreakdown: [{ label: 'Score sécurité', value: score }],
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
    const reply = this.chatReplies[key] || `Connecte le vrai endpoint n8n+Claude pour des réponses live sur "${q}".`;
    setTimeout(() => { this.chatMessages.push({ role: 'ai', content: reply }); }, 500);
  }

  exportPDF() {
    alert('📄 Export PDF — À implémenter avec jsPDF ou WeasyPrint côté NestJS backend.\n\nContenus : Score risque · Décisions IA · SonarQube · Trivy · DORA · Incidents');
  }
}
