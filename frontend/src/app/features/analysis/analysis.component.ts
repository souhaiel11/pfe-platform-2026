import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';

// ═══════════════════════════════════════════════════════════════════
//  AGENTS IA — Performance Dashboard v2.0
//  Remplace la liste plate de rapports (redondante avec /incidents)
//  par une vue analytique transversale : KPIs, tendances, top incidents
// ═══════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-analysis',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="page-container">
      <div class="page-header">
        <h1 class="page-title">// agents_ia</h1>
        <p class="page-subtitle">Performance et activité des agents IA — Root Cause, Security, Remediation, Judge</p>
      </div>

      <div *ngIf="loading" class="loading-overlay"><div class="spinner"></div></div>

      <ng-container *ngIf="!loading">

        <!-- ─── KPIs ─── -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-icon" style="background:#a78bfa22;color:#a78bfa;">📊</div>
            <div>
              <div class="kpi-value">{{ stats.total }}</div>
              <div class="kpi-label">Analyses effectuées</div>
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-icon" style="background:#22c55e22;color:#22c55e;">◈</div>
            <div>
              <div class="kpi-value">{{ stats.avgConfidence }}%</div>
              <div class="kpi-label">Confiance moyenne IA</div>
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-icon" style="background:#38bdf822;color:#38bdf8;">◆</div>
            <div>
              <div class="kpi-value">{{ stats.autoFixablePct }}%</div>
              <div class="kpi-label">Correctifs auto-proposés</div>
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-icon" style="background:#e24b4a22;color:#e24b4a;">⬡</div>
            <div>
              <div class="kpi-value">{{ stats.criticalCount }}</div>
              <div class="kpi-label">Incidents CRITICAL</div>
            </div>
          </div>
        </div>

        <!-- ─── GRAPHIQUES ─── -->
        <div class="charts-grid">

          <!-- Décisions du Judge -->
          <div class="card">
            <div class="card-header" style="margin-bottom:14px;">
              <span class="card-title">▣ Décisions du Judge Agent</span>
            </div>
            <div class="bar-chart">
              <div *ngFor="let d of decisionBars" class="bar-row">
                <div class="bar-label">{{ d.label }}</div>
                <div class="bar-track">
                  <div class="bar-fill" [style.width]="d.pct + '%'" [style.background]="d.color"></div>
                </div>
                <div class="bar-value">{{ d.count }}</div>
              </div>
              <div *ngIf="decisionBars.length === 0" class="empty-mini">Aucune donnée</div>
            </div>
          </div>

          <!-- Niveaux de sévérité -->
          <div class="card">
            <div class="card-header" style="margin-bottom:14px;">
              <span class="card-title">⬡ Niveaux de sévérité détectés</span>
            </div>
            <div class="bar-chart">
              <div *ngFor="let s of severityBars" class="bar-row">
                <div class="bar-label">{{ s.label }}</div>
                <div class="bar-track">
                  <div class="bar-fill" [style.width]="s.pct + '%'" [style.background]="s.color"></div>
                </div>
                <div class="bar-value">{{ s.count }}</div>
              </div>
              <div *ngIf="severityBars.length === 0" class="empty-mini">Aucune donnée</div>
            </div>
          </div>

        </div>

        <!-- ─── ACTIVITÉ RÉCENTE ─── -->
        <div style="margin-top:20px;">
          <div class="card-header" style="margin-bottom:12px;">
            <span class="card-title">Activité récente des agents</span>
            <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">
              {{ recentReports.length }} derniers rapports
            </span>
          </div>

          <div *ngIf="recentReports.length === 0" class="empty-state">
            <div class="empty-icon">📋</div>
            <div class="empty-title">Aucun rapport disponible</div>
            <div class="empty-sub">Lancez un build Jenkins pour générer une analyse IA</div>
          </div>

          <div class="activity-list">
            <a *ngFor="let r of recentReports" [routerLink]="['/incidents', r.id]" class="activity-row">
              <span class="badge" [class]="getDecisionBadgeClass(r.decision)" style="min-width:110px;text-align:center;">
                {{ r.decision || 'N/A' }}
              </span>
              <div class="activity-main">
                <div class="activity-title">{{ r.title }}</div>
                <div class="activity-sub">{{ r.projectName }} · {{ r.securityLevel }} · confiance {{ r.confidence }}%</div>
              </div>
              <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-faint);">
                {{ r.createdAt | date:'dd/MM HH:mm' }}
              </span>
              <span style="color:var(--text-muted);">→</span>
            </a>
          </div>
        </div>

      </ng-container>
    </div>
  `,
  styles: [`
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .kpi-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 16px;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .kpi-icon {
      width: 40px; height: 40px;
      border-radius: var(--radius-md);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; flex-shrink: 0;
    }
    .kpi-value { font-size: 22px; font-weight: 700; color: var(--text-primary); font-family: var(--font-mono); line-height: 1; }
    .kpi-label { font-size: 11px; color: var(--text-muted); margin-top: 4px; }

    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 12px;
    }

    .bar-chart { display: flex; flex-direction: column; gap: 10px; }
    .bar-row { display: flex; align-items: center; gap: 10px; }
    .bar-label { width: 110px; font-size: 11px; color: var(--text-secondary); flex-shrink: 0; }
    .bar-track { flex: 1; height: 8px; background: var(--bg-primary); border-radius: 4px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 4px; transition: width 0.6s ease; }
    .bar-value { width: 28px; text-align: right; font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); flex-shrink: 0; }
    .empty-mini { font-size: 12px; color: var(--text-faint); text-align: center; padding: 20px 0; }

    .activity-list { display: flex; flex-direction: column; gap: 6px; }
    .activity-row {
      display: flex; align-items: center; gap: 14px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 10px 14px;
      text-decoration: none;
      transition: border-color 0.15s;
    }
    .activity-row:hover { border-color: var(--border-light); }
    .activity-main { flex: 1; min-width: 0; }
    .activity-title { font-size: 12px; color: var(--text-primary); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .activity-sub { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
  `]
})
export class AnalysisComponent implements OnInit {
  loading = true;

  stats = {
    total: 0,
    avgConfidence: 0,
    autoFixablePct: 0,
    criticalCount: 0,
  };

  decisionBars: any[] = [];
  severityBars: any[] = [];
  recentReports: any[] = [];

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.api.getDecisions().subscribe({
      next: (r: any) => {
        const list: any[] = Array.isArray(r) ? r : (r?.data || []);

        // Ne garder que les incidents avec une vraie analyse JSON valide
        const parsed = list
          .filter(inc => inc.aiAnalysis && typeof inc.aiAnalysis === 'string' && inc.aiAnalysis.trim().startsWith('{'))
          .map(inc => {
            let a: any = {};
            try { a = JSON.parse(inc.aiAnalysis); } catch (e) { return null; }
            return {
              id: inc.id,
              title: inc.title,
              projectName: inc.project?.name || '—',
              createdAt: inc.createdAt,
              decision: (a.decision || '').toUpperCase(),
              securityLevel: (a.securityLevel || '').toUpperCase(),
              confidence: a.confidenceScore || 0,
            };
          })
          .filter(x => x !== null) as any[];

        this.computeStats(parsed);
        this.recentReports = parsed
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 10);

        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  private computeStats(parsed: any[]) {
    const total = parsed.length;
    this.stats.total = total;

    if (total === 0) {
      this.stats.avgConfidence = 0;
      this.stats.autoFixablePct = 0;
      this.stats.criticalCount = 0;
      this.decisionBars = [];
      this.severityBars = [];
      return;
    }

    // Confiance moyenne
    const confSum = parsed.reduce((s, x) => s + (x.confidence || 0), 0);
    this.stats.avgConfidence = Math.round(confSum / total);

    // % correctifs auto-proposés (FIX_PROPOSED + AUTO_FIX)
    const autoFixable = parsed.filter(x => x.decision === 'FIX_PROPOSED' || x.decision === 'AUTO_FIX').length;
    this.stats.autoFixablePct = Math.round((autoFixable / total) * 100);

    // Incidents CRITICAL
    this.stats.criticalCount = parsed.filter(x => x.securityLevel === 'CRITICAL').length;

    // Répartition décisions
    const decisionColors: any = {
      FIX_PROPOSED: '#38bdf8', AUTO_FIX: '#22c55e', BLOCK: '#e24b4a', NOTIFY_ONLY: '#f59e0b',
    };
    const decisionCounts: any = {};
    parsed.forEach(x => {
      const key = x.decision || 'INCONNU';
      decisionCounts[key] = (decisionCounts[key] || 0) + 1;
    });
    const maxDecision = Math.max(...Object.values(decisionCounts) as number[]);
    this.decisionBars = Object.entries(decisionCounts)
      .sort((a: any, b: any) => b[1] - a[1])
      .map(([label, count]: any) => ({
        label, count,
        pct: Math.round((count / maxDecision) * 100),
        color: decisionColors[label] || '#7ba8c8',
      }));

    // Répartition sévérité
    const severityColors: any = {
      CRITICAL: '#e24b4a', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#22c55e',
    };
    const severityCounts: any = {};
    parsed.forEach(x => {
      const key = x.securityLevel || 'INCONNU';
      severityCounts[key] = (severityCounts[key] || 0) + 1;
    });
    const maxSeverity = Math.max(...Object.values(severityCounts) as number[]);
    this.severityBars = Object.entries(severityCounts)
      .sort((a: any, b: any) => b[1] - a[1])
      .map(([label, count]: any) => ({
        label, count,
        pct: Math.round((count / maxSeverity) * 100),
        color: severityColors[label] || '#7ba8c8',
      }));
  }

  getDecisionBadgeClass(d: string) {
    const map: any = { FIX_PROPOSED: 'info', AUTO_FIX: 'info', BLOCK: 'high', NOTIFY_ONLY: 'medium' };
    return map[d] || '';
  }
}
