import { Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/services/api.service';
import { MetricsChartComponent, MetricSeries } from './metrics-chart.component';
import { presentationText } from './status-labels';

@Component({
  selector: 'app-project-metrics', standalone: true,
  imports: [CommonModule, RouterModule, MetricsChartComponent],
  template: `
    <section class="project-metrics" aria-label="Graphiques du projet sélectionné" aria-live="polite">
      <header><div><p class="eyebrow">PROJET SÉLECTIONNÉ</p><h3>{{projectName}}</h3><p>Résultats propres à ce projet · dernière analyse disponible.</p></div>
        <a [routerLink]="['/projects', projectId]" [queryParams]="{tab:'securite'}">Ouvrir les rapports du projet ↗</a>
      </header>
      <p *ngIf="securityLoading || riskLoading" role="status">Chargement des graphiques du projet…</p>
      <div *ngIf="securityError" role="alert"><p>{{securityError}}</p><button class="btn btn-secondary btn-sm" (click)="loadSecurity()">Réessayer les scanners</button></div>
      <div class="metrics-charts" *ngIf="!securityLoading && !securityError">
        <app-metrics-chart [title]="'Trivy · ' + projectName" description="CVE critiques et élevées de la dernière analyse Trivy. Les catégories sont des sévérités, pas des dates." type="line" categoryLabel="Sévérité" [labels]="severityLabels" [series]="trivySeries"></app-metrics-chart>
        <app-metrics-chart [title]="'OWASP · ' + projectName" description="CVE critiques et élevées de la dernière analyse OWASP. Les catégories sont des sévérités, pas des dates." type="line" categoryLabel="Sévérité" [labels]="severityLabels" [series]="owaspSeries"></app-metrics-chart>
      </div>
      <div *ngIf="riskError" role="alert"><p>{{riskError}}</p><button class="btn btn-secondary btn-sm" (click)="loadRisk()">Réessayer le risque</button></div>
      <div class="risk-detail" *ngIf="!riskLoading && !riskError">
        <div class="risk-indicator"><p>Indicateur de risque</p><strong>{{risk?.risk ?? '—'}}<small *ngIf="risk?.risk != null">/100</small></strong><span>{{risk?.level || 'Non disponible'}}</span><p>Plus le score est élevé, plus le risque est important.</p></div>
        <app-metrics-chart [title]="'Facteurs de risque · ' + projectName" description="Points apportés par les règles déclenchées pour ce projet. Aucune règle déclenchée signifie qu’aucun facteur n’est présent dans les données disponibles." categoryLabel="Facteur" [labels]="ruleLabels" [series]="ruleSeries"></app-metrics-chart>
      </div>
    </section>
  `,
  styleUrls: ['./metrics-charts.scss'],
  styles: [`
    .project-metrics{margin:18px 0 24px;padding:22px;border:1px solid var(--atelier-copper);border-radius:9px;background:var(--bg-tertiary);scroll-margin-top:20px}
    header{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}h3{margin:4px 0;font-size:20px;color:var(--text-primary)}p{font-size:11px;line-height:1.7;color:var(--text-secondary)}.eyebrow{font:10px var(--font-mono);letter-spacing:.12em;color:var(--atelier-copper);margin:0}a{font-size:12px;color:var(--accent-blue)}
    .risk-detail{display:grid;grid-template-columns:minmax(160px,1fr) 2fr;gap:18px}.risk-indicator{padding:24px;border:1px solid var(--border-color);border-radius:9px;background:var(--bg-secondary);display:flex;flex-direction:column;justify-content:center;align-items:flex-start}.risk-indicator strong{font-size:52px;font-weight:500;color:var(--accent-orange)}.risk-indicator small{font-size:18px;color:var(--text-muted)}.risk-indicator span{font-size:12px;color:var(--text-primary);margin:12px 0}
    @media(max-width:800px){.project-metrics{padding:14px}.risk-detail{grid-template-columns:minmax(0,1fr)}}
  `],
})
export class ProjectMetricsComponent implements OnChanges, OnDestroy {
  @Input() projectId = '';
  @Input() projectName = '';
  severityLabels = ['Critiques', 'Élevées'];
  trivySeries: MetricSeries[] = [];
  owaspSeries: MetricSeries[] = [];
  ruleLabels: string[] = [];
  ruleSeries: MetricSeries[] = [];
  risk: any = null;
  securityLoading = true;
  riskLoading = true;
  securityError = '';
  riskError = '';
  private securitySub?: Subscription;
  private riskSub?: Subscription;
  constructor(private api: ApiService) {}
  ngOnChanges() { if (this.projectId) { this.loadSecurity(); this.loadRisk(); } }
  ngOnDestroy() { this.securitySub?.unsubscribe(); this.riskSub?.unsubscribe(); }
  loadSecurity() {
    this.securitySub?.unsubscribe(); this.securityLoading = true; this.securityError = '';
    this.trivySeries = []; this.owaspSeries = [];
    this.securitySub = this.api.getSecurityGlobal().subscribe({
      next: data => {
        const project = (data?.byProject || []).find((p: any) => p.projectId === this.projectId);
        const noData = !project || (data?.projectsWithoutData || []).includes(project.projectName);
        const series = (source: string, label: string, color: string): MetricSeries[] => [{
          label, color, values: ['critical', 'high'].map(key => {
            const value = project?.[source]?.[key];
            return noData || (project?.missingScanners || []).includes(source) || typeof value !== 'number' || !Number.isFinite(value) ? null : value;
          }),
        }];
        this.trivySeries = series('trivy', 'CVE Trivy', '--accent-blue');
        this.owaspSeries = series('owasp', 'CVE OWASP', '--accent-orange');
        this.securityLoading = false;
      },
      error: () => { this.securityLoading = false; this.securityError = 'Impossible de charger les résultats Trivy et OWASP de ce projet.'; },
    });
  }
  loadRisk() {
    this.riskSub?.unsubscribe(); this.riskLoading = true; this.riskError = ''; this.risk = null;
    this.ruleLabels = []; this.ruleSeries = [];
    this.riskSub = this.api.getRiskIndicators().subscribe({
      next: data => {
        this.risk = (data?.projects || []).find((p: any) => p.projectId === this.projectId) || null;
        const rules = this.risk?.rules || [];
        this.ruleLabels = rules.map((r: any) => presentationText(r.label));
        this.ruleSeries = [{ label: 'Points de risque', values: rules.map((r: any) => typeof r.points === 'number' && Number.isFinite(r.points) ? r.points : null), color: '--accent-orange' }];
        this.riskLoading = false;
      },
      error: () => { this.riskLoading = false; this.riskError = 'Impossible de charger le risque de ce projet.'; },
    });
  }
}
