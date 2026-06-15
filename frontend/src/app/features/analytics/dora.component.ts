import { Component, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dora',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="page-icon" style="background:#0c1c2e"><i class="ti ti-chart-bar" style="color:#58a6ff"></i></div>
        <div><h2>Métriques DORA</h2><div class="page-sub">DevOps Research & Assessment · 4 indicateurs clés</div></div>
      </div>

      <div class="info-banner">
        <i class="ti ti-info-circle"></i>
        Les métriques DORA sont les 4 indicateurs utilisés par Google et les grandes entreprises pour mesurer la performance DevOps. Un score <strong>ELITE</strong> = top 10% mondial.
      </div>

      <div class="dora-grid">
        <div class="dora-card" *ngFor="let d of doraMetrics">
          <div class="dora-icon">{{d.icon}}</div>
          <div class="dora-val" [style.color]="d.color">{{d.value}}</div>
          <div class="dora-label">{{d.label}}</div>
          <div class="dora-desc">{{d.desc}}</div>
          <span class="dora-badge" [style.background]="d.badgeBg" [style.color]="d.color">{{d.level}}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-chart-line"></i> Évolution sur 5 builds</div>
        <canvas style="max-height:120px" id="dora-chart" height="100"></canvas>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-target"></i> Objectifs & amélioration</div>
        <div class="goal-list">
          <div class="goal-item" *ngFor="let g of goals">
            <div class="goal-metric">{{g.metric}}</div>
            <div class="goal-current" [style.color]="g.color">{{g.current}}</div>
            <div class="goal-arrow">→</div>
            <div class="goal-target">Objectif : {{g.target}}</div>
            <div class="goal-action">{{g.action}}</div>
          </div>
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
    .info-banner{display:flex;align-items:flex-start;gap:10px;background:#0c1c2e;border:1px solid #58a6ff;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:11px;color:#8b949e;line-height:1.5}
    .info-banner i{color:#58a6ff;font-size:16px;flex-shrink:0;margin-top:1px}
    .info-banner strong{color:#e6edf3}
    .dora-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
    .dora-card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;text-align:center}
    .dora-icon{font-size:24px;margin-bottom:6px}
    .dora-val{font-size:22px;font-weight:700;margin-bottom:3px}
    .dora-label{font-size:10px;font-weight:600;color:#e6edf3;margin-bottom:4px}
    .dora-desc{font-size:9px;color:#8b949e;margin-bottom:6px;line-height:1.4}
    .dora-badge{display:inline-block;padding:2px 8px;border-radius:8px;font-size:9px;font-weight:700}
    .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;margin-bottom:12px}
    .card-title{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
    .goal-list{display:flex;flex-direction:column;gap:6px}
    .goal-item{display:flex;align-items:center;gap:10px;padding:8px 10px;background:#21262d;border-radius:5px;font-size:10px}
    .goal-metric{width:160px;font-weight:600;color:#e6edf3}
    .goal-current{width:60px;font-weight:700}
    .goal-arrow{color:#8b949e}
    .goal-target{color:#8b949e;flex:1}
    .goal-action{font-size:9px;color:#58a6ff}
  `]
})
export class DoraComponent implements AfterViewInit, OnDestroy {
  doraMetrics = [
    { icon: '🚀', value: '3.2/j', label: 'Deployment Frequency', desc: 'Fréquence de déploiement en production', level: 'ELITE', color: '#3fb950', badgeBg: '#0d2119' },
    { icon: '⏱️', value: '4h20', label: 'Lead Time for Changes', desc: 'Du commit au déploiement K8s', level: 'HIGH', color: '#3fb950', badgeBg: '#0d2119' },
    { icon: '📉', value: '18%', label: 'Change Failure Rate', desc: '% de déploiements causant un incident', level: 'MEDIUM', color: '#d29922', badgeBg: '#271d0a' },
    { icon: '🔧', value: '45min', label: 'MTTR', desc: 'Temps moyen pour corriger un incident', level: 'ELITE', color: '#3fb950', badgeBg: '#0d2119' },
  ];

  goals = [
    { metric: 'Change Failure Rate', current: '18%', target: '< 15%', color: '#d29922', action: 'Améliorer les tests unitaires' },
    { metric: 'Lead Time', current: '4h20', target: '< 1h', color: '#3fb950', action: 'Optimiser le pipeline Jenkins' },
    { metric: 'Deployment Frequency', current: '3.2/j', target: '> 5/j', color: '#3fb950', action: 'Automatiser les déploiements' },
  ];

  private chart: any;

  ngOnDestroy() { if (this.chart) this.chart.destroy(); }

  ngAfterViewInit() {
    setTimeout(() => {
      const c = document.getElementById('dora-chart') as HTMLCanvasElement;
      if (!c || !(window as any).Chart) return;
      const ex = (window as any).Chart.getChart(c);
      if (ex) ex.destroy();
      this.chart = new (window as any).Chart(c, {
        type: 'line',
        data: {
          labels: ['#128','#129','#130','#131','#132'],
          datasets: [
            { label: 'Lead Time (min)', data: [280,260,270,240,260], borderColor: '#58a6ff', borderWidth: 2, pointRadius: 3, fill: false, tension: .4 },
            { label: 'CFR %', data: [20,15,18,22,18], borderColor: '#d29922', borderWidth: 2, pointRadius: 3, fill: false, tension: .4 },
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, labels: { color: '#8b949e', font: { size: 9 } } } }, scales: { x: { ticks: { color: '#8b949e', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { ticks: { color: '#8b949e', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.04)' } } } }
      });
    }, 100);
  }
}
