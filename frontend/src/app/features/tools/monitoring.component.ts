import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-monitoring',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="page-icon" style="background:var(--accent-orange-bg)"><i class="ti ti-activity" style="color:var(--accent-orange)"></i></div>
        <div><h2>Monitoring — Grafana</h2><div class="page-sub">Métriques pods Kubernetes · Prometheus</div></div>
        <a href="http://172.31.172.61:3000" target="_blank" class="ext-btn"><i class="ti ti-external-link"></i> Ouvrir Grafana</a>
      </div>

      <div class="grafana-embed">
        <div class="grafana-header"><i class="ti ti-chart-bar"></i> Dashboard Grafana</div>
        <div class="grafana-body">
          <i class="ti ti-external-link grafana-ico"></i>
          <div class="grafana-msg">Dashboard complet disponible sur Grafana</div>
          <a href="http://172.31.172.61:3000" target="_blank" class="grafana-link">Ouvrir le dashboard →</a>
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
  `]
})
export class MonitoringComponent {}
