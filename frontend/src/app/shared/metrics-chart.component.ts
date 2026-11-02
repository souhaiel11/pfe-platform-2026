import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, ChartDataset, registerables } from 'chart.js';

Chart.register(...registerables);

export interface MetricSeries {
  label: string;
  values: (number | null)[];
  color: string;
  colors?: string[];
}

@Component({
  selector: 'app-metrics-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <figure>
      <figcaption><h3>{{title}}</h3><p>{{description}}</p></figcaption>
      <div class="plot" *ngIf="hasValues; else empty">
        <canvas #canvas role="img" [attr.aria-label]="title + '. ' + description + ' Valeurs disponibles dans le détail sous le graphique.'"></canvas>
      </div>
      <ng-template #empty><p class="empty">Aucune donnée disponible pour ce graphique.</p></ng-template>
      <details *ngIf="hasValues">
        <summary>Consulter les valeurs du graphique</summary>
        <div class="values"><table><thead><tr><th scope="col">{{categoryLabel}}</th><th scope="col" *ngFor="let item of series">{{item.label}}</th></tr></thead>
          <tbody><tr *ngFor="let label of labels; let i = index"><th scope="row">{{label}}</th><td *ngFor="let item of series">{{item.values[i] ?? 'Non disponible'}}</td></tr></tbody>
        </table></div>
      </details>
    </figure>
  `,
  styles: [`
    :host{display:block;min-width:0;height:100%}
    figure{margin:0;padding:22px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:9px;height:100%;box-sizing:border-box;box-shadow:var(--atelier-shadow)}
    h3{font-size:14px;font-weight:600;color:var(--text-primary);margin:0 0 8px}
    figcaption p,.empty{font-size:11px;line-height:1.6;color:var(--text-secondary);margin:0 0 18px}
    .plot{position:relative;height:280px;min-width:0}
    details{margin-top:16px;color:var(--text-secondary);font-size:11px}
    summary{cursor:pointer;padding:4px 0}summary:focus-visible{outline:2px solid var(--accent-blue);outline-offset:3px}
    .values{overflow-x:auto;margin-top:10px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--border-color)}
    .empty{padding:40px 0;text-align:center}
    @media(max-width:600px){figure{padding:16px}.plot{height:250px}}
  `],
})
export class MetricsChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() title = '';
  @Input() description = '';
  @Input() categoryLabel = 'Projet';
  @Input() type: 'bar' | 'line' | 'doughnut' = 'bar';
  @Input() labels: string[] = [];
  @Input() series: MetricSeries[] = [];
  @Input() maximum?: number;
  @Input() integerTicks = true;
  private canvas?: ElementRef<HTMLCanvasElement>;
  private chart?: Chart;
  private ready = false;
  @ViewChild('canvas') set chartCanvas(value: ElementRef<HTMLCanvasElement> | undefined) {
    this.canvas = value;
    if (this.ready) this.render();
  }
  get hasValues() { return this.labels.length > 0 && this.series.some(s => s.values.some(v => v !== null && Number.isFinite(v))); }
  ngAfterViewInit() { this.ready = true; this.render(); }
  ngOnChanges() { if (this.ready) this.render(); }
  ngOnDestroy() { this.chart?.destroy(); }
  private render() {
    this.chart?.destroy();
    this.chart = undefined;
    if (!this.canvas || !this.hasValues) return;
    const css = getComputedStyle(this.canvas.nativeElement);
    const color = (value: string) => css.getPropertyValue(value).trim() || '#888888';
    const text = color('--text-secondary');
    const datasets: ChartDataset[] = this.series.map(s => ({
      label: s.label, data: s.values,
      backgroundColor: s.colors ? s.colors.map(color) : color(s.color),
      borderColor: color(s.color), borderWidth: this.type === 'line' ? 2 : 0,
      pointRadius: 4, pointHoverRadius: 6, tension: 0, spanGaps: false,
    }));
    this.chart = new Chart(this.canvas.nativeElement, {
      type: this.type,
      data: { labels: this.labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { color: text, boxWidth: 10, padding: 16 } } },
        scales: this.type === 'doughnut' ? {} : {
          x: { ticks: { color: text, maxRotation: 25, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
          y: { beginAtZero: true, max: this.maximum, ticks: { color: text, precision: this.integerTicks ? 0 : undefined }, grid: { color: color('--border-color') } },
        },
      },
    });
  }
}
