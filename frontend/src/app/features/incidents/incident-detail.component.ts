import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { DeveloperGuideTabComponent } from './developer-guide/developer-guide-tab.component';
import { DeveloperGuide } from './developer-guide/developer-guide.model';

// ═══════════════════════════════════════════════════════════════════
//  INCIDENT DETAIL — v2.0
//  Ajouts : timeline cycle de vie + onglet Validation WF3
//  Données WF1 : incident.metadata.enrichedData + incident.aiAnalysis
//  Données WF3 : incident.metadata.validation
// ═══════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-incident-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, DeveloperGuideTabComponent],
  templateUrl: './incident-detail.component.html',
  styleUrls: ['./incident-detail.component.scss'],
})
export class IncidentDetailComponent implements OnInit {
  @Input() id!: string;

  incident:    any  = null;
  reports:     any[] = [];
  aiAnalysis:  any  = null;   // colonne aiAnalysis (WF1)
  developerGuide: DeveloperGuide | null = null;
  enrichedData: any = null;   // metadata.enrichedData (WF1)
  validation:  any  = null;   // metadata.validation (WF3)
  decision:    any  = null;   // legacy
  loading      = true;
  activeTab    = 'analysis';

  // ── Tabs (mis à jour dans load()) ──
  tabs: any[] = [];

  private updateTabs() {
    this.tabs = [
      { id: 'analysis',   label: 'Analyse IA', dot: null },
      { id: 'guide', label: 'Guide correction', dot: this.developerGuide?.issues?.length ? '#3b82f6' : null },
      { id: 'validation', label: 'Validation PR',
        dot: this.validation ? (this.validation.passed ? '#22c55e' : '#e24b4a') : null },
      { id: 'raw',        label: 'Données brutes', dot: null },
    ];
  }

  // ── Timeline étapes (mis à jour dans load()) ──
  lifecycleSteps: any[] = [];

  private updateLifecycle() {
    const s = this.incident?.status || '';
    const ORDER = ['pending','analyzing','analyzed','fix_generated','validating','approved','completed'];

    // Etats terminaux qui interrompent le chemin normal apres l'analyse.
    // Le Judge a tranche (Detecte + Analyse sont donc acquis), mais la suite
    // ne suit pas la sequence standard fix_generated -> validating -> approved.
    const TERMINAL_AFTER_ANALYSIS = ['blocked', 'rejected', 'failed'];
    const isTerminal = TERMINAL_AFTER_ANALYSIS.includes(s);

    const idx = isTerminal ? 2 : ORDER.indexOf(s);

    this.lifecycleSteps = [
      { label: 'Détecté',     sub: 'WF1',   done: idx >= 0, active: idx === 0 },
      { label: 'Analysé',     sub: 'WF1',   done: idx >= 2, active: idx === 1 || idx === 2 },
      {
        label: isTerminal ? 'Bloqué' : 'Fix proposé',
        sub: isTerminal ? 'judge' : 'WF2',
        done: isTerminal ? false : idx >= 3,
        active: isTerminal ? true : idx === 3,
        terminal: isTerminal,
      },
      { label: 'Validé',      sub: 'WF3',   done: !isTerminal && idx >= 5, active: !isTerminal && (idx === 4 || idx === 5) },
      { label: 'Résolu',      sub: 'merge', done: !isTerminal && idx >= 6, active: !isTerminal && idx === 6 },
    ];
  }

  // Onglet demandé explicitement via ?tab=... (ex: lien depuis le Rapport IA d'un projet)
  private requestedTab: string | null = null;

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  goBack(): void {
    const projectId = this.incident?.projectId;
    this.router.navigate(projectId ? ['/projects', projectId] : ['/projects']);
  }

  ngOnInit() {
    const tabParam = this.route.snapshot.queryParamMap.get('tab');
    const validTabs = ['analysis', 'guide', 'validation', 'raw'];
    if (tabParam && validTabs.includes(tabParam)) {
      this.requestedTab = tabParam;
      this.activeTab = tabParam;
    }
    this.load();
  }

  load() {
    this.loading = true;
    this.api.getIncident(this.id).subscribe({
      next: (inc: any) => {
        this.incident     = inc;
        // Rapports agents depuis metadata (rootCause, security, remediation)
        const meta = inc.metadata || {};
        this.reports = [
          meta.rootCause && Object.keys(meta.rootCause).length > 0
            ? { agentType: 'ROOT_CAUSE', analysis: meta.rootCause.rootCause || meta.rootCause.analysisSummary || '', confidence: meta.rootCause.confidence || 0 }
            : null,
          meta.security && Object.keys(meta.security).length > 0
            ? { agentType: 'SECURITY', analysis: meta.security.securitySummary || '', confidence: meta.security.confidence || 0 }
            : null,
          meta.remediation && Object.keys(meta.remediation).length > 0
            ? { agentType: 'REMEDIATION', analysis: meta.remediation.fixDescription || (meta.remediation.fixSteps || []).join('\n') || '', confidence: meta.remediation.confidence || 0 }
            : null,
        ].filter(r => r !== null);
        this.decision     = inc.decision || null;
        // ── Données WF1 ──
        // aiAnalysis peut être du JSON string OU du texte brut — parse sûr
        if (inc.aiAnalysis && typeof inc.aiAnalysis === 'string') {
          try {
            this.aiAnalysis = JSON.parse(inc.aiAnalysis);
          } catch (e) {
            // texte brut : on l'enveloppe pour l'affichage
            this.aiAnalysis = { justification: inc.aiAnalysis };
          }
        } else {
          this.aiAnalysis = inc.aiAnalysis || null;
        }
        this.developerGuide = this.aiAnalysis?.developerGuide ?? null;
        this.enrichedData = inc.metadata?.enrichedData || null;
        // ── Données WF3 ──
        this.validation   = inc.metadata?.validation || null;
        this.updateLifecycle();
        this.updateTabs();
        this.loading = false;
        // Si validé, ouvrir directement l'onglet validation — sauf si un onglet a été demandé explicitement via l'URL
        if (!this.requestedTab && this.validation) this.activeTab = 'validation';
      },
      error: () => { this.toast.error('Erreur', 'Incident introuvable'); this.loading = false; }
    });
  }

  approveFix() {
    this.api.approveFix(this.id).subscribe({
      next: () => { this.toast.success('Fix approuvé — WF2 déclenché'); this.load(); },
      error: () => this.toast.error('Erreur', 'Impossible d\'approuver')
    });
  }

  rejectFix() {
    this.api.rejectFix(this.id).subscribe({
      next: () => { this.toast.success('Fix rejeté'); this.load(); },
      error: () => this.toast.error('Erreur', 'Impossible de rejeter')
    });
  }

  getSeverityColor(s: string) {
    const map: any = { CRITICAL:'var(--accent-red)', HIGH:'var(--accent-red)',
      MEDIUM:'var(--accent-orange)', LOW:'var(--accent-green)' };
    return map[s] || 'var(--border)';
  }
  getSeverityBadgeClass(s: string) {
    const map: any = { CRITICAL:'high', HIGH:'high', MEDIUM:'medium', LOW:'info' };
    return map[s] || '';
  }
  getStatusBadgeClass(s: string) {
    const map: any = { approved:'info', analyzed:'medium', failed:'high',
      pending:'', completed:'info', validating:'medium' };
    return map[s] || '';
  }
  getDecisionBadgeClass(d: string) {
    const map: any = { FIX_PROPOSED:'info', BLOCK:'high', NOTIFY_ONLY:'medium' };
    return map[d] || '';
  }
  getSonarGateBadgeClass(s: string) {
    if (s === 'OK') return 'info';
    if (s === 'ERROR') return 'high';
    if (s === 'SKIPPED') return 'medium';
    return '';
  }
  getAgentColor(t: string) {
    const map: any = { ROOT_CAUSE:'#38bdf8', SECURITY:'#e24b4a',
      REMEDIATION:'#22c55e', JUDGE:'#f59e0b' };
    return map[t] || '#7ba8c8';
  }
  getAgentIcon(t: string) {
    const map: any = { ROOT_CAUSE:'◈', SECURITY:'⬡', REMEDIATION:'◆', JUDGE:'▣' };
    return map[t] || '◉';
  }
  getAgentLabel(t: string) {
    const map: any = { ROOT_CAUSE:'Root Cause Analysis', SECURITY:'Security Risk',
      REMEDIATION:'Remediation', JUDGE:'Judge Agent' };
    return map[t] || t;
  }
}
