import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-analysis',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">// analyses_ia</h1>
        <p class="page-subtitle">Rapports générés par les agents IA — Root Cause, Security, Remediation, Judge</p>
      </div>
      <div class="agent-tabs" style="margin-bottom:16px;">
        <button *ngFor="let t of tabs" class="agent-tab"
                [class.active]="activeTab === t.key"
                [style.--tab-color]="t.color"
                (click)="activeTab = t.key; load()">
          <span>{{t.icon}}</span> {{t.label}}
        </button>
      </div>
      <div *ngIf="loading" class="loading-overlay"><div class="spinner"></div></div>

      <!-- RAPPORTS IA -->
      <div *ngIf="activeTab === 'rapports' && !loading">
        <div *ngIf="combinedReports.length === 0" class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-title">Aucun rapport disponible</div>
          <div class="empty-sub">Lancez un build Jenkins pour générer un rapport IA</div>
        </div>
        <div *ngFor="let r of combinedReports" class="report-ia-card">
          <div class="report-ia-header">
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="font-size:24px;">📋</span>
              <div>
                <div style="font-family:var(--font-mono);font-weight:700;font-size:15px;color:var(--text-primary);">
                  RAPPORT DEVSECOPS IA — Build #{{ r.p?.build || '?' }}
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                  {{ r.createdAt | date:'dd/MM/yyyy HH:mm' }} &nbsp;·&nbsp; {{ r.project?.name }}
                </div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="decision-badge" [style.color]="getRiskColor(r.p?.decision)"
                    [style.background]="getRiskColor(r.p?.decision) + '22'"
                    [style.border-color]="getRiskColor(r.p?.decision)">
                {{ r.p?.decision || 'N/A' }}
              </span>
              <span style="font-size:10px;font-family:var(--font-mono);color:var(--text-faint);">
                Score: {{ r.securityScore }}%
              </span>
            </div>
          </div>

          <div class="report-ia-grid">
            <div class="report-ia-section">
              <div class="section-title">🔧 BUILD INFO</div>
              <div class="section-row"><span>Job</span><span>{{ r.p?.job || 'N/A' }}</span></div>
              <div class="section-row"><span>Build #</span><span>{{ r.p?.build || 'N/A' }}</span></div>
              <div class="section-row"><span>Branche</span><span>{{ r.p?.branch || 'N/A' }}</span></div>
            </div>
            <div class="report-ia-section">
              <div class="section-title">🤖 DÉCISION IA</div>
              <div class="section-row">
                <span>Action</span>
                <span [style.color]="getRiskColor(r.p?.decision)" style="font-weight:700;">{{ r.p?.decision || 'N/A' }}</span>
              </div>
              <div class="section-row"><span>Confiance</span><span>{{ r.p?.confidence || '0%' }}</span></div>
              <div class="section-row"><span>Niveau sécurité</span>
                <span [style.color]="getSecurityColor(r.p?.security)">{{ r.p?.security || 'N/A' }}</span>
              </div>
            </div>

            <div class="report-ia-section full-width" *ngIf="r.p?.errors">
              <div class="section-title">❌ ERREURS DÉTECTÉES</div>
              <div class="section-content" style="white-space:pre-line;">{{ r.p?.errors }}</div>
            </div>

            <div class="report-ia-section full-width" style="border-left:3px solid var(--accent-orange)" *ngIf="r.p?.cicdIssues">
              <div class="section-title">⚠️ PROBLÈMES CI/CD (non critiques)</div>
              <div class="section-content" style="white-space:pre-line;">{{ r.p?.cicdIssues }}</div>
            </div>

            <div class="report-ia-section full-width" style="border-left:3px solid var(--accent-red)" *ngIf="r.p?.securityIssues">
              <div class="section-title">🔒 PROBLÈMES SÉCURITÉ</div>
              <div class="section-content" style="white-space:pre-line;">{{ r.p?.securityIssues }}</div>
            </div>

            <div class="report-ia-section full-width">
              <div class="section-title">🤖 CE QUE LES AGENTS IA ONT FAIT</div>
              <div class="section-content" style="white-space:pre-line;">{{ r.p?.agentActions || 'Non disponible' }}</div>
            </div>

            <div class="report-ia-section full-width developer-section">
              <div class="section-title">👨‍💻 CE QUE LE DÉVELOPPEUR DOIT FAIRE</div>
              <div class="section-content" style="white-space:pre-line;">{{ r.p?.developerActions || 'Non disponible' }}</div>
            </div>

            <div class="report-ia-section full-width">
              <div class="section-title">💡 RECOMMANDATIONS</div>
              <div class="section-content" style="white-space:pre-line;">{{ r.p?.recommendations || 'Non disponible' }}</div>
            </div>

            <div class="report-ia-section full-width" *ngIf="r.p?.reason">
              <div class="section-title">📝 RAISON DE LA DÉCISION</div>
              <div class="section-content">{{ r.p?.reason }}</div>
            </div>
          </div>

          <div class="report-ia-footer">
            <span style="font-size:10px;color:var(--text-faint);font-family:var(--font-mono);">
              Risque: {{ r.riskLevel }} · Généré par llama3.2:3b via Ollama
            </span>
            <button class="btn btn-secondary btn-sm" (click)="copyReport(r)">📋 Copier</button>
          </div>
        </div>
      </div>

      <!-- DECISIONS -->
      <div *ngIf="activeTab === 'decisions' && !loading">
        <div class="card" style="padding:0;overflow:hidden;">
          <table class="data-table">
            <thead><tr><th>Incident</th><th>Action</th><th>Confiance</th><th>Raisonnement</th><th>Date</th><th></th></tr></thead>
            <tbody>
              <tr *ngIf="decisions.length === 0">
                <td colspan="6" style="text-align:center;padding:40px;color:var(--text-faint);">Aucune décision</td>
              </tr>
              <tr *ngFor="let d of decisions">
                <td style="font-family:var(--font-mono);font-size:10px;color:var(--accent-blue);">{{d.incidentId?.substring(0,20)}}...</td>
                <td><span class="badge" [class]="d.action === 'APPROVE' ? 'info' : 'high'">{{d.action}}</span></td>
                <td>
                  <div style="display:flex;align-items:center;gap:6px;">
                    <div class="mini-bar"><div [style.width]="(d.confidence||0)*100+'%'" [style.background]="getConfidenceColor(d.confidence)"></div></div>
                    <span style="font-size:10px;font-family:var(--font-mono);color:var(--text-muted);">{{((d.confidence||0)*100)|number:'1.0-0'}}%</span>
                  </div>
                </td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;">{{d.reasoning}}</td>
                <td style="font-family:var(--font-mono);font-size:10px;">{{d.createdAt | date:'dd/MM HH:mm'}}</td>
                <td><a [routerLink]="['/incidents', d.incidentId]" class="btn btn-secondary btn-sm">→</a></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- REPORTS AGENTS -->
      <div *ngIf="activeTab !== 'decisions' && activeTab !== 'rapports' && !loading">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;">
          <div *ngIf="reports.length === 0" style="grid-column:1/-1;" class="empty-state"><div class="empty-title">Aucun rapport</div></div>
          <div *ngFor="let r of reports" class="report-card">
            <div class="report-header">
              <span class="agent-pill" [style.color]="getAgentColor(r.agentType)" [style.background]="getAgentColor(r.agentType)+'11'">
                {{getAgentIcon(r.agentType)}} {{getAgentLabel(r.agentType)}}
              </span>
            </div>
            <div class="report-body">{{r.analysis || r.content || r.aiSummary}}</div>
            <div class="report-footer">
              <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-faint);">{{r.createdAt | date:'dd/MM/yyyy HH:mm'}}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .agent-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
    .agent-tab {
      display: flex; align-items: center; gap: 6px; padding: 7px 14px;
      border-radius: var(--radius-md); font-size: 12px; color: var(--text-muted);
      background: var(--bg-secondary); border: 1px solid var(--border); cursor: pointer; transition: all 0.15s;
      &:hover { border-color: var(--border-light); color: var(--text-secondary); }
      &.active { background: var(--tab-color, var(--accent-blue)); color: #080c14; border-color: transparent; }
    }
    .mini-bar { width: 50px; height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; div { height: 100%; border-radius: 2px; } }
    .report-ia-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 16px; transition: border-color 0.2s; &:hover { border-color: var(--border-light); } }
    .report-ia-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
    .decision-badge { font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 20px; border: 1px solid; font-family: var(--font-mono); }
    .report-ia-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    .report-ia-section { background: var(--bg-hover); border-radius: var(--radius-md); padding: 12px; &.full-width { grid-column: 1 / -1; } &.developer-section { border-left: 3px solid var(--accent-orange); } }
    .section-title { font-size: 10px; font-weight: 700; color: var(--text-muted); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; font-family: var(--font-mono); }
    .section-row { display: flex; justify-content: space-between; font-size: 11px; padding: 4px 0; border-bottom: 1px solid var(--border); &:last-child { border-bottom: none; } span:first-child { color: var(--text-muted); } span:last-child { font-weight: 600; color: var(--text-primary); text-align: right; } }
    .section-content { font-size: 12px; color: var(--text-secondary); line-height: 1.7; }
    .report-ia-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid var(--border); }
    .report-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .report-header { display: flex; align-items: center; justify-content: space-between; }
    .agent-pill { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; font-family: var(--font-mono); }
    .report-body { font-size: 12px; color: var(--text-secondary); line-height: 1.6; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
    .report-footer { display: flex; align-items: center; justify-content: space-between; }
  `]
})
export class AnalysisComponent implements OnInit {
  reports: any[]         = [];
  decisions: any[]       = [];
  combinedReports: any[] = [];
  loading   = false;
  activeTab = 'rapports';

  tabs = [
    { key: 'rapports',    label: 'Rapports IA',     icon: '📋', color: '#a78bfa' },
    { key: 'decisions',   label: 'Décisions Judge', icon: '▣',  color: '#f59e0b' },
    { key: 'ROOT_CAUSE',  label: 'Root Cause',      icon: '◈',  color: '#38bdf8' },
    { key: 'SECURITY',    label: 'Security Risk',   icon: '⬡',  color: '#e24b4a' },
    { key: 'REMEDIATION', label: 'Remediation',     icon: '◆',  color: '#22c55e' },
  ];

  constructor(private api: ApiService, private toast: ToastService) {}
  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    if (this.activeTab === 'rapports') {
      this.api.getDecisions().subscribe({
        next: (r: any) => {
          const list: any[] = Array.isArray(r) ? r : [];
          this.combinedReports = list
            .filter(x => x.type === 'combined')
            .map(x => ({ ...x, p: this.parseReport(x.aiSummary) }));
          this.loading = false;
        },
        error: () => { this.loading = false; }
      });
    } else if (this.activeTab === 'decisions') {
      this.api.getDecisions().subscribe({
        next: (d: any) => { this.decisions = Array.isArray(d) ? d : []; this.loading = false; },
        error: () => { this.loading = false; }
      });
    } else {
      this.api.getReports({ agentType: this.activeTab }).subscribe({
        next: (r: any) => { this.reports = Array.isArray(r) ? r : []; this.loading = false; },
        error: () => { this.loading = false; }
      });
    }
  }

  parseReport(summary: string): any {
    if (!summary) return {};
    try {
      const json = JSON.parse(summary);
      return {
        build:            json.build || json.build_number || 'N/A',
        job:              json.job || 'N/A',
        branch:           json.branch || 'N/A',
        decision:         json.decision || 'NOTIFY_ONLY',
        confidence:       (json.confidenceScore || 0) + '%',
        reason:           json.decisionReason || json.reasoning || json.raison || '',
        errors:           this.formatField(json.errorsSummary),
        cicdIssues:       this.formatField(json.cicdIssues),
        securityIssues:   this.formatField(json.securityIssues),
        agentActions:     this.formatField(json.agentActions),
        developerActions: this.formatField(json.developerActions),
        security:         json.securityLevel || 'LOW',
        recommendations:  this.formatField(json.recommendations),
        _raw:             json
      };
    } catch(e) {}
    const p: any = {};
    summary.split(' | ').forEach((part: string) => {
      part = part.trim();
      const buildMatch = part.match(/^Build #(\d+)$/);
      if (buildMatch) { p['build'] = buildMatch[1]; return; }
      if (part.startsWith('RAPPORT')) { return; }
      const idx = part.indexOf(':');
      if (idx > 0) {
        const key = part.substring(0, idx).trim();
        const val = part.substring(idx + 1).trim();
        if (key === 'Job')                p['job']              = val;
        else if (key === 'Branche')       p['branch']           = val;
        else if (key === 'DECISION')      p['decision']         = val;
        else if (key === 'Confiance')     p['confidence']       = val;
        else if (key === 'Raison')        p['reason']           = val;
        else if (key === 'ERREURS')       p['errors']           = val;
        else if (key === 'CICD')          p['cicdIssues']       = val;
        else if (key === 'AGENTS IA')     p['agentActions']     = val;
        else if (key === 'DEVELOPPEUR')   p['developerActions'] = val;
        else if (key === 'SECURITE')      p['security']         = val;
        else if (key === 'RECOMMANDATIONS') p['recommendations']= val;
      }
    });
    return p;
  }

  formatField(val: any): string {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) {
      return val.map((item: any) => {
        if (typeof item === 'string') return item;
        const p = item.priorite || item.priority || '';
        const t = item.action || item.titre || item.title || item.text || '';
        const c = item.commande || item.command ? ' → ' + (item.commande || item.command) : '';
        const d = Array.isArray(item.details) ? ' | ' + item.details.join(' | ') : '';
        return (p ? '[' + p + '] ' : '') + t + c + d;
      }).join('\n');
    }
    if (typeof val === 'object') {
      return Object.entries(val).map(([k, v]) => k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join('\n');
    }
    return String(val);
  }

  getRiskColor(decision: string): string {
    if (!decision) return 'var(--accent-blue)';
    if (decision === 'AUTO_FIX') return 'var(--accent-green)';
    if (decision === 'BLOCK')    return 'var(--accent-red)';
    return 'var(--accent-orange)';
  }

  getSecurityColor(level: string): string {
    if (!level) return 'var(--text-muted)';
    if (level === 'CRITICAL') return 'var(--accent-red)';
    if (level === 'HIGH')     return 'var(--accent-orange)';
    if (level === 'MEDIUM')   return 'var(--accent-yellow, #f59e0b)';
    return 'var(--accent-green)';
  }

  copyReport(r: any) {
    navigator.clipboard.writeText(r.aiSummary || '').then(() => {
      this.toast.success('Copié', 'Rapport copié dans le presse-papiers');
    });
  }

  getAgentColor(t: string) { const m: any = { ROOT_CAUSE: '#38bdf8', SECURITY: '#e24b4a', REMEDIATION: '#22c55e', JUDGE: '#f59e0b' }; return m[t] || '#7ba8c8'; }
  getAgentIcon(t: string)  { const m: any = { ROOT_CAUSE: '◈', SECURITY: '⬡', REMEDIATION: '◆', JUDGE: '▣' }; return m[t] || '◉'; }
  getAgentLabel(t: string) { const m: any = { ROOT_CAUSE: 'Root Cause', SECURITY: 'Security Risk', REMEDIATION: 'Remediation', JUDGE: 'Judge' }; return m[t] || t; }
  getConfidenceColor(c: number) { if (c >= 0.8) return 'var(--accent-green)'; if (c >= 0.6) return 'var(--accent-orange)'; return 'var(--accent-red)'; }
}
