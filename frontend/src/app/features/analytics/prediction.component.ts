import { Component, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-prediction',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="page-icon" style="background:var(--accent-purple-bg)"><i class="ti ti-brain" style="color:var(--accent-purple)"></i></div>
        <div><h2>Prédiction IA — Analyse de risque</h2><div class="page-sub">Judge Agent Claude · Basé sur les 10 derniers builds</div></div>
      </div>

      <div class="pred-hero">
        <div class="pred-pct-wrap">
          <div class="pred-pct">73%</div>
          <div class="pred-pct-label">Probabilité d'incident<br>dans les 48h</div>
        </div>
        <div class="pred-info">
          <div class="pred-level">⚠️ Risque ÉLEVÉ détecté sur pfe-app-test</div>
          <div class="pred-desc">Le Judge Agent a analysé les 10 derniers builds et les incidents historiques. Basé sur les patterns détectés, un incident est probable si les CVE HIGH ne sont pas corrigées dans les 48h.</div>
          <div class="pred-conf">Confiance de la prédiction : <strong style="color:var(--accent-purple)">87%</strong></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-list-check"></i> Facteurs de risque identifiés</div>
        <div class="factor-list">
          <div class="factor-item" *ngFor="let f of factors">
            <div class="factor-bar-wrap">
              <div class="factor-bar" [style.width]="f.weight+'%'" [style.background]="f.color"></div>
            </div>
            <div class="factor-info">
              <div class="factor-name">{{f.name}}</div>
              <div class="factor-detail">{{f.detail}}</div>
            </div>
            <div class="factor-weight" [style.color]="f.color">{{f.weight}}%</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-chart-line"></i> Évolution du risque — 5 builds</div>
        <canvas style="max-height:120px" id="pred-chart" height="100"></canvas>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-shield-check"></i> Actions recommandées</div>
        <div class="action-list">
          <div class="action-item" *ngFor="let a of actions">
            <span class="action-pri" [style.background]="a.priBg" [style.color]="a.priColor">{{a.priority}}</span>
            <div class="action-text">{{a.text}}</div>
            <div class="action-impact">Impact : {{a.impact}}</div>
          </div>
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
    .pred-hero{display:flex;align-items:center;gap:20px;background:var(--accent-purple-bg);border:1px solid var(--accent-purple);border-radius:10px;padding:18px;margin-bottom:16px}
    .pred-pct{font-size:48px;font-weight:700;color:var(--accent-orange);line-height:1}
    .pred-pct-label{font-size:10px;color:var(--text-secondary);margin-top:4px;line-height:1.4}
    .pred-info{flex:1}
    .pred-level{font-size:13px;font-weight:600;color:var(--accent-orange);margin-bottom:6px}
    .pred-desc{font-size:11px;color:var(--text-secondary);line-height:1.6;margin-bottom:6px}
    .pred-conf{font-size:11px;color:var(--text-secondary)}
    .card{background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:14px;margin-bottom:12px}
    .card-title{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
    .factor-list{display:flex;flex-direction:column;gap:8px}
    .factor-item{display:flex;align-items:center;gap:12px}
    .factor-bar-wrap{width:120px;height:4px;background:var(--bg-tertiary);border-radius:2px;overflow:hidden;flex-shrink:0}
    .factor-bar{height:100%;border-radius:2px}
    .factor-info{flex:1}
    .factor-name{font-size:11px;font-weight:500}
    .factor-detail{font-size:9px;color:var(--text-secondary);margin-top:1px}
    .factor-weight{font-size:12px;font-weight:700;width:35px;text-align:right}
    .action-list{display:flex;flex-direction:column;gap:6px}
    .action-item{display:flex;align-items:center;gap:10px;padding:9px 11px;background:var(--bg-tertiary);border-radius:6px;font-size:10px}
    .action-pri{padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;flex-shrink:0}
    .action-text{flex:1}
    .action-impact{font-size:9px;color:var(--text-secondary)}
  `]
})
export class PredictionComponent implements AfterViewInit, OnDestroy {
  factors = [
    { name: '2 CVE HIGH non corrigées', detail: 'eclipse-temurin:17 + alpine:3.18', weight: 35, color: 'var(--accent-orange)' },
    { name: 'Taux d\'échec builds : 18%', detail: '2 failures sur 10 derniers builds', weight: 28, color: 'var(--accent-orange)' },
    { name: 'OWASP ZAP non configuré', detail: 'Scan DAST absent sur K8s NodePort', weight: 20, color: 'var(--accent-blue)' },
    { name: '4 code smells SonarQube', detail: 'Complexité cognitive élevée', weight: 17, color: 'var(--accent-green)' },
  ];

  actions = [
    { priority: 'URGENT', priBg: 'var(--accent-red-bg)', priColor: 'var(--accent-red)', text: 'Mettre à jour eclipse-temurin vers version patchée', impact: '-22% risque' },
    { priority: 'HAUTE', priBg: 'var(--accent-orange-bg)', priColor: 'var(--accent-orange)', text: 'Configurer OWASP ZAP sur http://192.168.49.2:30003', impact: '-15% risque' },
    { priority: 'MOYENNE', priBg: 'var(--accent-blue-bg)', priColor: 'var(--accent-blue)', text: 'Corriger les 4 code smells SonarQube', impact: '-8% risque' },
    { priority: 'BASSE', priBg: 'var(--accent-green-bg)', priColor: 'var(--accent-green)', text: 'Améliorer la couverture tests de 74% → 80%', impact: '-5% risque' },
  ];

  private chart: any;

  ngOnDestroy() { if (this.chart) this.chart.destroy(); }

  ngAfterViewInit() {
    setTimeout(() => {
      const c = document.getElementById('pred-chart') as HTMLCanvasElement;
      if (!c || !(window as any).Chart) return;
      const ex = (window as any).Chart.getChart(c);
      if (ex) ex.destroy();
      const purple = getComputedStyle(document.body).getPropertyValue('--accent-purple').trim() || '#bc8cff';
      const muted = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim() || '#8b949e';
      this.chart = new (window as any).Chart(c, {
        type: 'line',
        data: {
          labels: ['#128','#129','#130','#131','#132'],
          datasets: [{ label: 'Score risque %', data: [45,52,38,71,73], borderColor: purple, borderWidth: 2, pointRadius: 3, fill: true, backgroundColor: 'rgba(188,140,255,.1)', tension: .4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: muted, font: { size: 9 } }, grid: { color: 'rgba(128,128,128,.1)' } }, y: { min: 0, max: 100, ticks: { color: muted, font: { size: 9 } }, grid: { color: 'rgba(128,128,128,.1)' } } } }
      });
    }, 100);
  }
}
