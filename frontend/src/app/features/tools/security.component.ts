import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { ProjectEventsService } from '../../core/services/project-events.service';

@Component({
  selector: 'app-security',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="page-icon" style="background:var(--accent-red-bg)"><i class="ti ti-shield-check" style="color:var(--accent-red)"></i></div>
        <div><h2>Sécurité — Trivy & OWASP</h2><div class="page-sub">Vue plateforme — dernière analyse de chaque projet</div></div>
      </div>

      <p *ngIf="loading" role="status">Chargement des résultats…</p>
      <div *ngIf="loadError" role="alert">{{loadError}} <button (click)="load()">Réessayer</button></div>
      <div class="kpi-grid" *ngIf="summary">
        <div class="kpi r"><div class="kpi-l">CRITIQUES (plateforme)</div><div class="kpi-v">{{summary.totalCriticalCves}}</div></div>
        <div class="kpi o"><div class="kpi-l">ÉLEVÉES (plateforme)</div><div class="kpi-v">{{summary.totalHighCves}}</div></div>
        <div class="kpi o"><div class="kpi-l">MOYENNES</div><div class="kpi-v">{{summary.totalMediumCves}}</div></div>
        <div class="kpi o"><div class="kpi-l">ZAP — ÉLEVÉES</div><div class="kpi-v">{{summary.zapHighAlerts}}</div></div>
        <div class="kpi o"><div class="kpi-l">ZAP — MOYENNES</div><div class="kpi-v">{{summary.zapMediumAlerts}}</div></div>
        <div class="kpi g"><div class="kpi-l">SCORE MOYEN</div><div class="kpi-v">{{summary.avgSecurityScore ?? '—'}}</div></div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-list-details"></i> Par projet — trié par CVE critiques décroissant</div>

        <div class="empty" *ngIf="!loading && !loadError && !byProject.length">Aucun projet à afficher.</div>

        <ng-template #missingScanner>Résultat non disponible</ng-template>
        <table class="proj-table" *ngIf="byProject.length">
          <thead>
            <tr>
              <th>Projet</th>
              <th>Score</th>
              <th>Critiques</th>
              <th>Élevées</th>
              <th>Trivy</th>
              <th>OWASP</th>
              <th>ZAP</th>
            </tr>
          </thead>
          <tbody>
            <tr class="proj-row" *ngFor="let p of byProject" (click)="goToProject(p.projectId)">
              <td class="proj-name">{{p.projectName}}</td>
              <td><span class="score-badge" [style.color]="p.incomplete ? 'var(--text-muted)' : getScoreColor(p.securityScore)" [title]="p.incomplete ? ('Scanner(s) requis sans résultat : ' + (p.missingScanners || []).join(', ')) : ''">{{p.incomplete ? 'non vérifié' : p.securityScore}}</span></td>
              <td><span class="cnt" [class.alert]="p.criticalCves>0">{{p.criticalCves}}</span></td>
              <td><span class="cnt" [class.warn]="p.highCves>0">{{p.highCves}}</span></td>
              <td class="sub"><ng-container *ngIf="!(p.missingScanners || []).includes('trivy'); else missingScanner">{{p.trivy.critical}}C / {{p.trivy.high}}H</ng-container></td>
              <td class="sub"><ng-container *ngIf="!(p.missingScanners || []).includes('owasp'); else missingScanner">{{p.owasp.critical}}C / {{p.owasp.high}}H</ng-container></td>
              <td class="sub"><ng-container *ngIf="!(p.missingScanners || []).includes('zap'); else missingScanner">{{p.zap.high}}H / {{p.zap.medium}}M</ng-container></td>
            </tr>
          </tbody>
        </table>

        <div class="no-data-note" *ngIf="projectsWithoutData.length">
          <i class="ti ti-alert-triangle"></i>
          Données scanner non disponibles pour : {{projectsWithoutData.join(', ')}}
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host{display:block}
    .page{padding:18px 20px;background:var(--bg-primary);min-height:100vh;color:var(--text-primary);font-family:'JetBrains Mono',monospace}
    .page-header{display:flex;align-items:center;gap:12px;margin-bottom:18px}
    .page-icon{width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px}
    h2{font-size:16px;font-weight:700;margin:0}
    .page-sub{font-size:10px;color:var(--text-secondary);margin-top:2px}
    .kpi-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px}
    .kpi{background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:7px;padding:10px 12px}
    .kpi-l{font-size:9px;color:var(--text-secondary);margin-bottom:4px}
    .kpi-v{font-size:20px;font-weight:700}
    .kpi.g .kpi-v{color:var(--accent-green)}.kpi.o .kpi-v{color:var(--accent-orange)}.kpi.r .kpi-v{color:var(--accent-red)}
    .card{background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:14px;margin-bottom:12px}
    .card-title{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
    .empty{font-size:11px;color:var(--text-secondary);padding:10px 0}
    .proj-table{width:100%;border-collapse:collapse;font-size:11px}
    .proj-table th{text-align:left;font-size:9px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px;padding:6px 8px;border-bottom:1px solid var(--border-color)}
    .proj-table td{padding:8px;border-bottom:1px solid var(--border-color)}
    .proj-row{cursor:pointer}
    .proj-row:hover{background:var(--bg-hover)}
    .proj-name{font-weight:600}
    .sub{color:var(--text-secondary);font-size:10px}
    .cnt{font-weight:700}
    .cnt.alert{color:var(--accent-red)}
    .cnt.warn{color:var(--accent-orange)}
    .score-badge{font-weight:700}
    .no-data-note{margin-top:12px;padding:8px 10px;font-size:10px;color:var(--accent-orange);background:var(--accent-orange-bg);border-radius:5px;display:flex;align-items:center;gap:6px}
  `]
})
export class SecurityComponent implements OnInit, OnDestroy {
  summary: any = null;
  byProject: any[] = [];
  projectsWithoutData: string[] = [];
  loadError = '';
  loading = true;
  private projectEventsSub?: Subscription;

  constructor(
    private api: ApiService,
    private router: Router,
    private projectEvents: ProjectEventsService,
  ) {}

  ngOnInit() {
    this.load();
    // Re-fetch après création/suppression d'un projet, sans reload manuel.
    this.projectEventsSub = this.projectEvents.projectsChanged$.subscribe(() => this.load());
  }

  ngOnDestroy() {
    this.projectEventsSub?.unsubscribe();
  }

  load() {
    this.loadError = '';
    this.loading = true;
    this.api.getSecurityGlobal().subscribe({
      next: (data: any) => {
        this.summary = data.summary;
        this.byProject = data.byProject || [];
        this.projectsWithoutData = data.projectsWithoutData || [];
        this.loading = false;
      },
      error: () => {
        this.loadError = 'Impossible de charger les résultats de sécurité.';
        this.summary = null;
        this.byProject = [];
        this.projectsWithoutData = [];
        this.loading = false;
      },
    });
  }

  goToProject(projectId: string) {
    this.router.navigate(['/projects', projectId]);
  }

  getScoreColor(score: number): string {
    if (score >= 80) return 'var(--accent-green)';
    if (score >= 60) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  }
}
