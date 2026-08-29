import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/services/api.service';

@Component({
  selector: 'app-monitoring',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="page-icon" style="background:var(--accent-orange-bg)"><i class="ti ti-activity" style="color:var(--accent-orange)"></i></div>
        <div><h2>Supervision — Grafana</h2><div class="page-sub">Métriques des pods Kubernetes · Prometheus</div></div>
        <a *ngIf="grafanaUrl" [href]="grafanaUrl" target="_blank" rel="noopener" class="ext-btn"><i class="ti ti-external-link"></i> Ouvrir Grafana</a>
      </div>

      <div class="grafana-embed">
        <div class="grafana-header"><i class="ti ti-chart-bar"></i> Tableau de bord Grafana</div>
        <div class="grafana-body">
          <i class="ti ti-external-link grafana-ico"></i>
          <div class="grafana-msg">Tableau de bord complet disponible dans Grafana</div>
          <a *ngIf="grafanaUrl" [href]="grafanaUrl" target="_blank" rel="noopener" class="grafana-link">Ouvrir le tableau de bord →</a>
          <div *ngIf="!loading && !grafanaUrl" class="grafana-msg">Grafana n'est pas configuré dans les intégrations.</div>
          <button *ngIf="!loading && !grafanaUrl" class="retry" (click)="load()">Réessayer</button>
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
    .ext-btn{margin-left:auto;display:flex;align-items:center;gap:5px;padding:6px 12px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:6px;color:var(--accent-blue);font-size:11px;text-decoration:none}
    .grafana-embed{background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;overflow:hidden}
    .grafana-header{padding:10px 14px;border-bottom:1px solid var(--border-color);font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:5px}
    .grafana-body{padding:30px;text-align:center}
    .grafana-ico{font-size:28px;color:var(--accent-orange);display:block;margin-bottom:8px}
    .grafana-msg{font-size:12px;color:var(--text-secondary);margin-bottom:10px}
    .grafana-link{color:var(--accent-blue);font-size:11px;text-decoration:none}
    .grafana-link:hover{text-decoration:underline}
    .retry{border:1px solid var(--border-color);background:var(--bg-tertiary);color:var(--text-primary);padding:6px 10px;border-radius:6px;cursor:pointer}
  `]
})
export class MonitoringComponent implements OnInit {
  grafanaUrl: string | null = null;
  loading = true;
  constructor(private api: ApiService) {}
  ngOnInit() { this.load(); }
  load() {
    this.loading = true;
    this.api.getIntegrations().subscribe({
      next: rows => {
        const configured = (rows || []).find((x: any) => x.toolType === 'grafana' && x.enabled !== false);
        this.grafanaUrl = configured?.url && /^https?:\/\//i.test(configured.url) ? configured.url : null;
        this.loading = false;
      },
      error: () => { this.grafanaUrl = null; this.loading = false; },
    });
  }
}
