import { Component, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sonarqube',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="page-icon" style="background:var(--accent-blue-bg)"><i class="ti ti-wave-sine" style="color:var(--accent-blue)"></i></div>
        <div><h2>SonarQube SAST</h2><div class="page-sub">pfe-devsecops-2026 · Build #132</div></div>
        <a href="http://172.31.172.61:9000" target="_blank" class="ext-btn"><i class="ti ti-external-link"></i> Ouvrir SonarQube</a>
      </div>

      <div class="gate-banner">
        <i class="ti ti-circle-check gate-icon"></i>
        <div><div class="gate-title">Quality Gate : PASSED</div><div class="gate-sub">Tous les critères qualité sont satisfaits</div></div>
      </div>

      <div class="kpi-grid">
        <div class="kpi g"><div class="kpi-l">Bugs</div><div class="kpi-v">0</div></div>
        <div class="kpi g"><div class="kpi-l">Vulnérabilités</div><div class="kpi-v">0</div></div>
        <div class="kpi o"><div class="kpi-l">Code smells</div><div class="kpi-v">4</div></div>
        <div class="kpi b"><div class="kpi-l">Coverage</div><div class="kpi-v">74%</div></div>
        <div class="kpi g"><div class="kpi-l">Duplications</div><div class="kpi-v">0%</div></div>
        <div class="kpi b"><div class="kpi-l">Lignes</div><div class="kpi-v">847</div></div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-chart-line"></i> Évolution coverage</div>
        <canvas style="max-height:120px" id="sonar-chart" height="80"></canvas>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-bug"></i> Code smells détectés</div>
        <div class="issue-list">
          <div class="issue-item" *ngFor="let i of issues">
            <span class="issue-sev" [style.background]="i.sevBg" [style.color]="i.sevColor">{{i.sev}}</span>
            <div class="issue-msg">{{i.msg}}</div>
            <div class="issue-file">{{i.file}}</div>
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
    .ext-btn{margin-left:auto;display:flex;align-items:center;gap:5px;padding:6px 12px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:6px;color:var(--accent-blue);font-size:11px;text-decoration:none}
    .gate-banner{display:flex;align-items:center;gap:12px;background:var(--accent-green-bg);border:1px solid var(--accent-green);border-radius:8px;padding:12px 16px;margin-bottom:14px}
    .gate-icon{font-size:24px;color:var(--accent-green)}
    .gate-title{font-size:13px;font-weight:600;color:var(--accent-green)}
    .gate-sub{font-size:10px;color:var(--text-secondary);margin-top:2px}
    .kpi-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px}
    .kpi{background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:7px;padding:10px 12px}
    .kpi-l{font-size:9px;color:var(--text-secondary);margin-bottom:4px}
    .kpi-v{font-size:20px;font-weight:700}
    .kpi.g .kpi-v{color:var(--accent-green)}.kpi.o .kpi-v{color:var(--accent-orange)}.kpi.b .kpi-v{color:var(--accent-blue)}
    .card{background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:14px;margin-bottom:12px}
    .card-title{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
    .issue-list{display:flex;flex-direction:column;gap:5px}
    .issue-item{display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-tertiary);border-radius:5px;font-size:10px}
    .issue-sev{padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;flex-shrink:0}
    .issue-msg{flex:1}
    .issue-file{color:var(--text-secondary);font-size:9px;font-family:monospace}
  `]
})
export class SonarqubeComponent implements AfterViewInit, OnDestroy {
  issues = [
    { sev: 'MINOR', sevBg: 'var(--accent-blue-bg)', sevColor: 'var(--accent-blue)', msg: 'Remove unused import', file: 'TaskService.java:12' },
    { sev: 'MINOR', sevBg: 'var(--accent-blue-bg)', sevColor: 'var(--accent-blue)', msg: 'Add missing javadoc', file: 'TaskController.java:34' },
    { sev: 'MINOR', sevBg: 'var(--accent-orange-bg)', sevColor: 'var(--accent-orange)', msg: 'Cognitive complexity too high', file: 'DevSecOpsApplication.java:8' },
    { sev: 'MINOR', sevBg: 'var(--accent-blue-bg)', sevColor: 'var(--accent-blue)', msg: 'Use StringBuilder instead of concatenation', file: 'TaskRepository.java:67' },
  ];

  private chart: any;

  ngOnDestroy() { if (this.chart) this.chart.destroy(); }

  ngAfterViewInit() {
    setTimeout(() => {
      const c = document.getElementById('sonar-chart') as HTMLCanvasElement;
      if (!c || !(window as any).Chart) return;
      const ex = (window as any).Chart.getChart(c);
      if (ex) ex.destroy();
      const blue = getComputedStyle(document.body).getPropertyValue('--accent-blue').trim() || '#58a6ff';
      const muted = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim() || '#8b949e';
      this.chart = new (window as any).Chart(c, {
        type: 'line',
        data: { labels: ['#128','#129','#130','#131','#132'], datasets: [{ label: 'Coverage %', data: [68,70,72,71,74], borderColor: blue, borderWidth: 2, pointRadius: 3, fill: true, backgroundColor: 'rgba(88,166,255,.1)', tension: .4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: muted, font: { size: 9 } }, grid: { color: 'rgba(128,128,128,.1)' } }, y: { ticks: { color: muted, font: { size: 9 } }, grid: { color: 'rgba(128,128,128,.1)' } } } }
      });
    }, 100);
  }
}
