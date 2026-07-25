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
  templateUrl: './analysis.component.html',
  styleUrls: ['./analysis.component.scss'],
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
