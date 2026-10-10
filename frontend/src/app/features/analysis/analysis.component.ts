import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { PresentationLabelPipe } from '../../shared/presentation-label.pipe';
import { FrenchDatePipe } from '../../shared/french-date.pipe';
import { presentationLabel } from '../../shared/status-labels';
import { StatusChipComponent } from '../../shared/status-chip/status-chip.component';
import { InfoHintComponent } from '../../shared/info-hint/info-hint.component';
import { ZoneLabelComponent } from '../../shared/zone-label/zone-label.component';
import { statusColor } from '../../shared/status-chip/status-tone';

// ═══════════════════════════════════════════════════════════════════
//  AGENTS IA — Performance Dashboard v2.0
//  Remplace la liste plate de rapports (redondante avec /incidents)
//  par une vue analytique transversale : KPIs, tendances, top incidents
// ═══════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-analysis',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, PresentationLabelPipe, FrenchDatePipe, StatusChipComponent, InfoHintComponent, ZoneLabelComponent],
  templateUrl: './analysis.component.html',
  styleUrls: ['./analysis.component.scss'],
})
export class AnalysisComponent implements OnInit {
  loadError = '';
  loading = true;

  stats = {
    total: 0,
    avgConfidence: null as number | null,
    autoFixablePct: null as number | null,
    criticalCount: 0,
  };

  decisionBars: any[] = [];
  severityBars: any[] = [];
  recentReports: any[] = [];

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loadError = '';
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
              projectName: inc.project?.name || 'Projet non disponible',
              createdAt: inc.createdAt,
              decision: (a.decision || '').toUpperCase(),
              securityLevel: (a.securityLevel || '').toUpperCase(),
              confidence: typeof a.confidenceScore === 'number' ? a.confidenceScore : null,
            };
          })
          .filter(x => x !== null) as any[];

        this.computeStats(parsed);
        this.recentReports = parsed
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 10);

        this.loading = false;
      },
      error: () => { this.loadError = 'Impossible de charger les analyses.'; this.loading = false; }
    });
  }

  private computeStats(parsed: any[]) {
    const total = parsed.length;
    this.stats.total = total;

    if (total === 0) {
      this.stats.avgConfidence = null;
      this.stats.autoFixablePct = null;
      this.stats.criticalCount = 0;
      this.decisionBars = [];
      this.severityBars = [];
      return;
    }

    // Confiance moyenne
    const measured = parsed.filter(x => x.confidence !== null);
    this.stats.avgConfidence = measured.length ? Math.round(measured.reduce((s, x) => s + x.confidence, 0) / measured.length) : null;

    // % correctifs auto-proposés (FIX_PROPOSED + AUTO_FIX)
    const autoFixable = parsed.filter(x => x.decision === 'FIX_PROPOSED' || x.decision === 'AUTO_FIX').length;
    this.stats.autoFixablePct = Math.round((autoFixable / total) * 100);

    // Incidents CRITICAL
    this.stats.criticalCount = parsed.filter(x => x.securityLevel === 'CRITICAL').length;

    // Répartition décisions.
    //
    // Les couleurs viennent de la table de tonalités partagée
    // (shared/status-chip/status-tone.ts) et non d'un barème local en
    // hexadécimal : les anciennes valeurs (#38bdf8, #22c55e…) ne suivaient
    // ni le thème clair ni le thème sombre, et donnaient à cet écran une
    // sémantique de couleur différente de tous les autres.
    const decisionCounts: any = {};
    parsed.forEach(x => {
      const key = x.decision || 'INCONNU';
      decisionCounts[key] = (decisionCounts[key] || 0) + 1;
    });
    const maxDecision = Math.max(...Object.values(decisionCounts) as number[]);
    this.decisionBars = Object.entries(decisionCounts)
      .sort((a: any, b: any) => b[1] - a[1])
      .map(([raw, count]: any) => ({
        label: presentationLabel(raw), count,
        pct: Math.round((count / maxDecision) * 100),
        color: statusColor(raw),
      }));

    // Répartition sévérité — même table de tonalités partagée.
    const severityCounts: any = {};
    parsed.forEach(x => {
      const key = x.securityLevel || 'INCONNU';
      severityCounts[key] = (severityCounts[key] || 0) + 1;
    });
    const maxSeverity = Math.max(...Object.values(severityCounts) as number[]);
    this.severityBars = Object.entries(severityCounts)
      .sort((a: any, b: any) => b[1] - a[1])
      .map(([raw, count]: any) => ({
        label: presentationLabel(raw), count,
        pct: Math.round((count / maxSeverity) * 100),
        color: statusColor(raw),
      }));
  }

}
