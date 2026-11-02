// Gère l’affichage et les actions de analysis.
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

/**
 * Tableau de bord analytique des décisions des agents IA : KPIs globaux,
 * répartition par décision/sévérité et liste des incidents récents.
 */
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

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private api: ApiService, private toast: ToastService) {}

  /** Charge les statistiques d'analyse IA dès l'affichage de la page. */
  ngOnInit() { this.load(); }

  /** Récupère les décisions d'incidents, ne garde que celles à l'analyse JSON valide, puis dérive les statistiques et la liste des rapports récents. */
  load() {
    this.loadError = '';
    this.loading = true;
    this.api.getDecisions().subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (r: any) => {
        const list: any[] = Array.isArray(r) ? r : (r?.data || []);

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
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.loadError = 'Impossible de charger les analyses.'; this.loading = false; }
    });
  }

  /** Calcule les KPIs (confiance moyenne, % auto-corrigeable, nb CRITICAL) et les répartitions décision/sévérité à partir des incidents déjà analysés. */
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

    const measured = parsed.filter(x => x.confidence !== null);
    this.stats.avgConfidence = measured.length ? Math.round(measured.reduce((s, x) => s + x.confidence, 0) / measured.length) : null;

    const autoFixable = parsed.filter(x => x.decision === 'FIX_PROPOSED' || x.decision === 'AUTO_FIX').length;
    this.stats.autoFixablePct = Math.round((autoFixable / total) * 100);

    this.stats.criticalCount = parsed.filter(x => x.securityLevel === 'CRITICAL').length;

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
