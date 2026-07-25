import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { RiskStateService } from '../../core/services/risk-state.service';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './project-detail.component.html',
  styleUrls: ['./project-detail.component.scss'],
})
export class ProjectDetailComponent implements OnInit {
  approving = false;
  @Input() id!: string;

  project: any = null;
  incidents: any[] = [];
  allReports: any[] = [];
  latestReport: any = null;
  loading = true;
  activeTab = 'rapport';

  // Parsed report
  rp: any = {};
  ed: any = {}; // enrichedData du dernier rapport
  devTasks: any[] = [];
  checkedTasks = 0;

  // Score affiché dans le header (du dernier rapport)
  lastScore = 100;
  lastRisk = 'low';

  // Jenkins builds
  jenkinsBuilds: any[] = [];

  // Analyse IA SonarQube extraite
  sonarAiAnalysis = '';

  // Correction manuelle (section 3, colonne droite) — recommandations réparties par priorité
  manualHigh: { text: string; high: boolean }[] = [];
  manualNormal: { text: string; high: boolean }[] = [];

  constructor(private api: ApiService, private toast: ToastService, private riskState: RiskStateService) {}

  ngOnInit() {
    this.api.getProject(this.id).subscribe({
      next: p => {
        this.project = p;
        this.loading = false;
        this.loadIncidents();
        this.loadReports();
        this.loadJenkinsBuilds();
      },
      error: () => {
        this.toast.error('Erreur', 'Projet introuvable');
        this.loading = false;
      }
    });
  }

  loadIncidents() {
    this.api.getIncidents({ projectId: this.id, size: 20 }).subscribe((r: any) => {
      this.incidents = r.content || r;
    });
  }

  loadReports() {
    this.api.getDecisions({ projectId: this.id }).subscribe({
      next: (r: any) => {
        const list: any[] = Array.isArray(r) ? r : [];
        this.allReports = list
          .filter(x => x.aiAnalysis)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (this.allReports.length > 0) this.selectReport(this.allReports[0]);
      },
      error: () => {}
    });
  }

  loadJenkinsBuilds() {
    if (!this.project?.jenkinsJobName) return;
    this.api.getJenkins(this.id).subscribe({
      next: (d: any) => { this.jenkinsBuilds = d?.builds || []; },
      error: () => {}
    });
  }

  selectReport(r: any) {
    this.latestReport = r;
    this.rp = this.parseReport(r.aiAnalysis);
    // Charger enrichedData
    this.ed = (r.metadata?.enrichedData) ?? (r.rawData?.enrichedData) ?? {};
    // Score depuis le rapport
    const _lvl = (this.rp.security || r.riskLevel || "low").toUpperCase(); this.lastScore = _lvl === "CRITICAL" ? 10 : _lvl === "HIGH" ? 30 : _lvl === "MEDIUM" ? 60 : 90;
    this.lastRisk = _lvl.toLowerCase();
    this.riskState.setLevel(this.lastRisk);
    // Tâches développeur
    this.devTasks = this.parseDevTasks(this.rp.developerActions);
    this.checkedTasks = 0;
    // Extraire analyse IA SonarQube depuis agentActions
    this.sonarAiAnalysis = this.extractSonarAnalysis(this.rp.agentActions);
    // Recommandations de correction manuelle, réparties par priorité
    const manualItems = this.parseManualItems(this.rp.recommendations);
    this.manualHigh = manualItems.filter(m => m.high);
    this.manualNormal = manualItems.filter(m => !m.high);
  }

  extractSonarAnalysis(agentActions: string): string {
    if (!agentActions) return '';
    const parts = agentActions.split('|');
    const sonarPart = parts.find(p => p.toLowerCase().includes('sonar') || p.toLowerCase().includes('quality') || p.toLowerCase().includes('code smell'));
    return sonarPart ? sonarPart.trim() : '';
  }

  triggerBuild() {
    this.api.triggerBuild(this.project.id).subscribe({
      next: (r: any) => {
        if (r.success) this.toast.success('Build lancé', 'Build ' + (r.job || '') + ' démarré');
        else this.toast.error('Erreur', r.error || 'Echec du déclenchement');
      },
      error: () => this.toast.error('Erreur', 'Impossible de contacter le backend'),
    });
  }

  rollbackDeployment() {
    this.toast.success('Rollback', 'Commande kubectl rollout undo envoyée');
    // À connecter à un endpoint backend qui exécute kubectl
  }

  createFixPR() {
    this.toast.success('PR', 'Création de la PR en cours via WF2');
    // À connecter au WF2 n8n Auto-Fix
  }

  splitItems(text: string): string[] {
    if (!text) return [];
    return text.split('|').map(s => s.trim()).filter(s => s.length > 0);
  }

  getSevColor(item: string): string {
    if (!item) return 'var(--text-tertiary)';
    const s = item.toUpperCase();
    if (s.includes('CRITICAL')) return 'var(--color-critical)';
    if (s.includes('HIGH'))     return 'var(--color-high)';
    if (s.includes('MEDIUM'))   return 'var(--color-warning)';
    if (s.includes('LOW'))      return 'var(--accent-blue)';
    return 'var(--text-tertiary)';
  }

  getSevBadge(item: string): string {
    if (!item) return '';
    const s = item.toUpperCase();
    if (s.includes('CRITICAL')) return 'CRITICAL';
    if (s.includes('HIGH'))     return 'HIGH';
    if (s.includes('MEDIUM'))   return 'MEDIUM';
    if (s.includes('LOW'))      return 'LOW';
    return '';
  }

  parseReport(summary: string): any {
    if (!summary) return {};
    try {
      const json = JSON.parse(summary);
      return {
        build:            json.build || json.build_number || 'N/A',
        job:              json.job   || 'N/A',
        status:           json.status || 'N/A',
        decision:         json.decision || 'NOTIFY_ONLY',
        confidence:       (json.confidenceScore || 0) + '%',
        errors:           this.fmt(json.errorsSummary),
        cicdIssues:       this.fmt(json.cicdIssues),
        securityIssues:   this.fmt(json.securityIssues),
        agentActions:     this.fmt(json.agentActions),
        developerActions: this.fmt(json.developerActions),
        security:         json.securityLevel || 'LOW',
        recommendations:  this.fmt(json.recommendations),
        justification:    json.justification || '',
        warning:          json.warning || '',
        developerReviewPoints: Array.isArray(json.developerReviewPoints)
          ? json.developerReviewPoints
          : (json.developerReviewPoints ? [json.developerReviewPoints] : []),
        _raw:             json
      };
    } catch(e) { return {}; }
  }

  fmt(val: any): string {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val.map((x: any) => typeof x === 'string' ? x : JSON.stringify(x)).join(' | ');
    return JSON.stringify(val);
  }

  parseDevTasks(raw: string): any[] {
    if (!raw) return [];
    const lines = raw.split(/\d+\.\s+/).filter(l => l.trim());
    if (lines.length > 1) {
      return lines.map(l => {
        const pm = l.match(/\[(HAUTE|MOYENNE|BASSE)\]/i);
        return { text: l.replace(/\[.*?\]/g, '').trim(), priority: pm?.[1]?.toUpperCase() || null, done: false };
      });
    }
    return raw.split('|').map(l => ({ text: l.trim(), priority: null, done: false })).filter(t => t.text);
  }

  toggleTask(i: number) {
    this.devTasks[i].done = !this.devTasks[i].done;
    this.checkedTasks = this.devTasks.filter(t => t.done).length;
  }

  approveFix(id: string) {
    this.approving = true;
    this.api.approveFix(id).subscribe({
      next: () => { this.approving = false; this.loadReports(); },
      error: () => { this.approving = false; alert('Erreur approbation'); },
    });
  }

  rejectFix(id: string) {
    this.approving = true;
    this.api.rejectFix(id).subscribe({
      next: () => { this.approving = false; this.loadReports(); },
      error: () => { this.approving = false; alert('Erreur rejet'); },
    });
  }

  copyReport() {
    navigator.clipboard.writeText(this.latestReport?.aiAnalysis || this.latestReport?.aiSummary || '').then(() => {
      this.toast.success('Copié', 'Rapport copié dans le presse-papiers');
    });
  }

  copyText(text: string) {
    navigator.clipboard.writeText(text || '').then(() => {
      this.toast.success('Copié', 'Commande copiée dans le presse-papiers');
    });
  }

  countIssues(severity: 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'BUG'): number {
    const issues = this.ed?.sonar?.issues || [];
    if (severity === 'BUG') return issues.filter((i: any) => i.type === 'BUG').length;
    return issues.filter((i: any) => i.severity === severity).length;
  }

  parseManualItems(raw: string): { text: string; high: boolean }[] {
    return this.splitItems(raw).map(text => ({
      text: text.replace(/\[.*?\]/g, '').trim(),
      high: /\[(HAUTE|CRITIQUE|URGENT|BLOQUANT)\]/i.test(text)
    }));
  }

  getAgentText(kind: 'root' | 'security' | 'remediation'): string {
    if (!this.rp.agentActions) return '';
    const parts = this.splitItems(this.rp.agentActions);
    const keywords: Record<string, string[]> = {
      root:        ['root cause', 'cause racine', 'root-cause'],
      security:    ['security risk', 'risque sécurité', 'risque de sécurité', 'security'],
      remediation: ['remediation', 'remédiation', 'correction']
    };
    const found = parts.find(p => keywords[kind].some(k => p.toLowerCase().includes(k)));
    if (found) return found;
    const idx = kind === 'root' ? 0 : kind === 'security' ? 1 : 2;
    return parts[idx] || '';
  }

  getInfoRows() {
    if (!this.project) return [];
    return [
      { label: 'ID',             value: this.project.id },
      { label: 'Environnement',  value: this.project.environment || '—' },
      { label: 'Créé le',        value: this.project.createdAt ? new Date(this.project.createdAt).toLocaleDateString('fr-FR') : '—' },
      { label: 'CI/CD Tool',     value: this.project.cicdTool || '—' },
      { label: 'Jenkins Job',    value: this.project.jenkinsJobName || '—' },
      { label: 'Jenkins URL',    value: this.project.jenkinsUrl || '—' },
      { label: 'SonarQube Key',  value: this.project.sonarqubeKey || '—' },
      { label: 'GitHub Repo',    value: this.project.githubRepo || '—' },
      { label: 'Description',    value: this.project.description || '—' },
    ];
  }

  getAvatarBg(name: string): string {
    const colors = ['var(--accent-blue-bg)', 'var(--accent-green-bg)', 'var(--accent-orange-bg)', 'var(--accent-purple-bg)', 'var(--accent-red-bg)'];
    if (!name) return colors[0];
    return colors[name.charCodeAt(0) % colors.length];
  }

  getDecisionColor(d: string): string {
    if (d === 'FIX_PROPOSED' || d === 'AUTO_FIX') return '#1D9E75';
    if (d === 'BLOCK')       return '#E24B4A';
    if (d === 'NOTIFY_ONLY') return '#888780';
    return '#888780';
  }

  getSecColor(level: string): string {
    const l = (level || '').toUpperCase();
    if (l === 'CRITICAL') return 'var(--accent-red)';
    if (l === 'HIGH')     return 'var(--accent-orange)';
    if (l === 'MEDIUM')   return '#f59e0b';
    return 'var(--accent-green)';
  }

  getPriColor(p: string): string {
    if (p === 'HAUTE')   return 'var(--accent-red)';
    if (p === 'MOYENNE') return 'var(--accent-orange)';
    return 'var(--accent-blue)';
  }
}
