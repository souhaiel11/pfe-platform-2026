import { Component, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-prediction',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './prediction.component.html',
  styleUrls: ['./prediction.component.scss'],
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
