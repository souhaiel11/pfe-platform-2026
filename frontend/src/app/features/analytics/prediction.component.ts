import { ProjectMetricsComponent } from '../../shared/project-metrics.component';
import { MetricsChartComponent, MetricSeries } from '../../shared/metrics-chart.component';
// Gère l’affichage et les actions de prediction.
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { PresentationTextPipe } from '../../shared/presentation-label.pipe';
import { ZoneLabelComponent } from '../../shared/zone-label/zone-label.component';

interface RiskRule {
  label: string;
  points: number;
}

interface ProjectRisk {
  projectId: string;
  projectName: string;
  score: number;
  level: string;
  levelClass: string;
  rules: RiskRule[];
}

/**
 * Page d'indicateurs de risque par projet. Affiche tel quel le score déjà
 * calculé côté backend (GET /dashboard/risk-indicators) — aucun calcul de
 * scoring ici.
 */
@Component({
  selector: 'app-prediction',
  standalone: true,
  imports: [CommonModule, RouterModule, PresentationTextPipe, ZoneLabelComponent, MetricsChartComponent, ProjectMetricsComponent],
  templateUrl: './prediction.component.html',
  styleUrls: ['./prediction.component.scss', '../../shared/metrics-charts.scss'],
})
export class PredictionComponent implements OnInit {
  selectedProject: ProjectRisk | null = null;
  selectProject(project: ProjectRisk) {
    this.selectedProject = project;
    setTimeout(() => document.getElementById('selected-risk-project')?.scrollIntoView({ behavior: 'auto', block: 'start' }));
  }
  chartLabels: string[] = [];
  riskSeries: MetricSeries[] = [];
  levelLabels = ['Faible', 'Modéré', 'Élevé', 'Critique'];
  levelSeries: MetricSeries[] = [];
  projects: ProjectRisk[] = [];
  loadError = '';
  loading = true;

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private api: ApiService) {}

  /** Renvoie un symbole non chromatique représentant le niveau de risque, pour rester lisible sans distinction de couleur. */
  riskGlyph(levelClass: string): string {
    const glyphs: Record<string, string> = { faible: '✓', modere: '!', eleve: '!!', critique: '✕' };
    return glyphs[levelClass] || '–';
  }

  /** Charge les indicateurs de risque dès l'affichage de la page. */
  ngOnInit() {
    this.load();
  }

  /** Récupère les indicateurs de risque par projet et les met en forme pour l'affichage. */
  load() {
    this.loadError = '';
    this.loading = true;
    this.api.getRiskIndicators().subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (data: any) => {
        this.projects = (data.projects || []).map((p: any) => ({
          projectId: p.projectId,
          projectName: p.projectName,
          score: p.risk,
          level: p.level,
          levelClass: p.levelClass,
          rules: p.rules || [],
        }));
        this.chartLabels = this.projects.map(p => p.projectName);
        this.riskSeries = [{ label: 'Risque /100', values: this.projects.map(p => typeof p.score === 'number' && Number.isFinite(p.score) ? p.score : null), color: '--accent-orange' }];
        this.levelSeries = [{ label: 'Projets', values: ['faible', 'modere', 'eleve', 'critique'].map(level => this.projects.filter(p => p.levelClass === level).length), color: '--accent-blue', colors: ['--accent-green', '--color-warning', '--accent-orange', '--accent-red'] }];
        this.loading = false;
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => { this.loadError = 'Impossible de charger les indicateurs de risque.'; this.projects = []; this.loading = false; },
    });
  }
}
