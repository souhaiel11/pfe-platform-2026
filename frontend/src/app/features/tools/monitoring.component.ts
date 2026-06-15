import { Component, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-monitoring',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="page-icon" style="background:#271d0a"><i class="ti ti-activity" style="color:#d29922"></i></div>
        <div><h2>Monitoring — Grafana</h2><div class="page-sub">Métriques pods Kubernetes · Prometheus</div></div>
        <a href="http://172.31.172.61:3000" target="_blank" class="ext-btn"><i class="ti ti-external-link"></i> Ouvrir Grafana</a>
      </div>

      <div class="kpi-grid">
        <div class="kpi g"><div class="kpi-l">CPU global</div><div class="kpi-v">12%</div><div class="kpi-s">500m alloués</div></div>
        <div class="kpi g"><div class="kpi-l">RAM utilisée</div><div class="kpi-v">310Mi</div><div class="kpi-s">512Mi alloués</div></div>
        <div class="kpi b"><div class="kpi-l">Req/s</div><div class="kpi-v">24</div></div>
        <div class="kpi g"><div class="kpi-l">Latence p95</div><div class="kpi-v">48ms</div></div>
        <div class="kpi g"><div class="kpi-l">Erreurs 5xx</div><div class="kpi-v">0</div></div>
        <div class="kpi g"><div class="kpi-l">Uptime</div><div class="kpi-v">99.8%</div></div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-cpu"></i> CPU & RAM — 6 dernières minutes</div>
        <canvas style="max-height:120px" id="monitor-chart" height="100"></canvas>
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
    .page{padding:18px 20px;background:#0d1117;min-height:100vh;color:#e6edf3;font-family:'JetBrains Mono',monospace}
    .page-header{display:flex;align-items:center;gap:12px;margin-bottom:18px}
    .page-icon{width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px}
    h2{font-size:16px;font-weight:700;margin:0}
    .page-sub{font-size:10px;color:#8b949e;margin-top:2px}
    .ext-btn{margin-left:auto;display:flex;align-items:center;gap:5px;padding:6px 12px;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#58a6ff;font-size:11px;text-decoration:none}
    .kpi-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px}
    .kpi{background:#161b22;border:1px solid #30363d;border-radius:7px;padding:10px 12px}
    .kpi-l{font-size:9px;color:#8b949e;margin-bottom:4px}
    .kpi-v{font-size:20px;font-weight:700}
    .kpi-s{font-size:9px;color:#8b949e;margin-top:2px}
    .kpi.g .kpi-v{color:#3fb950}.kpi.b .kpi-v{color:#58a6ff}
    .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;margin-bottom:12px}
    .card-title{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
    .grafana-embed{background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}
    .grafana-header{padding:10px 14px;border-bottom:1px solid #30363d;font-size:10px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:5px}
    .grafana-body{padding:30px;text-align:center}
    .grafana-ico{font-size:28px;color:#d29922;display:block;margin-bottom:8px}
    .grafana-msg{font-size:12px;color:#8b949e;margin-bottom:10px}
    .grafana-link{color:#58a6ff;font-size:11px;text-decoration:none}
    .grafana-link:hover{text-decoration:underline}
  `]
})
export class MonitoringComponent implements AfterViewInit, OnDestroy {
  private chart: any;

  ngOnDestroy() { if (this.chart) this.chart.destroy(); }

  ngAfterViewInit() {
    setTimeout(() => {
      const c = document.getElementById('monitor-chart') as HTMLCanvasElement;
      if (!c || !(window as any).Chart) return;
      const ex = (window as any).Chart.getChart(c);
      if (ex) ex.destroy();
      this.chart = new (window as any).Chart(c, {
        type: 'line',
        data: {
          labels: ['6m','5m','4m','3m','2m','1m','0'],
          datasets: [
            { label: 'CPU %', data: [10,14,11,16,12,13,12], borderColor: '#58a6ff', borderWidth: 2, pointRadius: 2, fill: false, tension: .4 },
            { label: 'RAM Mi', data: [295,305,310,308,312,310,310], borderColor: '#3fb950', borderWidth: 2, pointRadius: 2, fill: false, tension: .4 },
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, labels: { color: '#8b949e', font: { size: 9 } } } }, scales: { x: { ticks: { color: '#8b949e', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#8b949e', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.04)' } } } }
      });
    }, 100);
  }
}
