import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/services/api.service';

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

// ─────────────────────────────────────────────────────────────────
// Indicateur de risque par projet — calculé côté backend
// (GET /dashboard/risk-indicators, common/risk-score.ts), affiché ici
// tel quel. Aucun calcul de scoring côté frontend : une seule source
// de vérité, réutilisée partout.
// ─────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-prediction',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './prediction.component.html',
  styleUrls: ['./prediction.component.scss'],
})
export class PredictionComponent implements OnInit {
  projects: ProjectRisk[] = [];
  loading = true;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading = true;
    this.api.getRiskIndicators().subscribe({
      next: (data: any) => {
        this.projects = (data.projects || []).map((p: any) => ({
          projectId: p.projectId,
          projectName: p.projectName,
          score: p.risk,
          level: p.level,
          levelClass: p.levelClass,
          rules: p.rules || [],
        }));
        this.loading = false;
      },
      error: () => { this.projects = []; this.loading = false; },
    });
  }
}
