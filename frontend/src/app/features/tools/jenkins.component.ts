import { Component, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { HttpClientModule } from '@angular/common/http';

@Component({
  selector: 'app-jenkins',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="page-icon" style="background:#0d2119"><i class="ti ti-git-branch" style="color:#3fb950"></i></div>
        <div>
          <h2>Jenkins CI/CD</h2>
          <div class="page-sub">{{jobName}} · Build #{{lastBuild?.buildNumber || '...'}}</div>
        </div>
        <a href="http://172.31.172.61:8082" target="_blank" class="ext-btn"><i class="ti ti-external-link"></i> Ouvrir Jenkins</a>
      </div>

      <div class="kpi-grid">
        <div class="kpi" [class.r]="lastBuild?.result!=='SUCCESS'" [class.g]="lastBuild?.result==='SUCCESS'">
          <div class="kpi-l">Build actuel</div>
          <div class="kpi-v">#{{lastBuild?.buildNumber || '...'}}</div>
          <div class="kpi-s" [style.color]="lastBuild?.result==='SUCCESS'?'#3fb950':'#f85149'">{{lastBuild?.result || '...'}}</div>
        </div>
        <div class="kpi g"><div class="kpi-l">Taux succès</div><div class="kpi-v">{{successRate}}%</div><div class="kpi-s">{{builds.length}} derniers builds</div></div>
        <div class="kpi b"><div class="kpi-l">Durée moy.</div><div class="kpi-v">{{avgDuration}}s</div></div>
        <div class="kpi o"><div class="kpi-l">Échecs consec.</div><div class="kpi-v">{{consecutiveFails}}</div></div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-chart-bar"></i> Historique builds</div>
        <div style="height:120px"><canvas id="jenkins-chart"></canvas></div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-list"></i> Derniers builds</div>
        <div class="build-list">
          <div class="build-item" *ngFor="let b of builds">
            <div class="build-dot" [style.background]="b.status==='SUCCESS'?'#3fb950':'#f85149'"></div>
            <div class="build-num">#{{b.num}}</div>
            <div class="build-msg">{{b.msg}}</div>
            <div class="build-dur">{{b.dur}}</div>
            <div class="build-time">{{b.time}}</div>
            <span class="build-badge" [style.background]="b.status==='SUCCESS'?'#0d2119':'#2d1117'" [style.color]="b.status==='SUCCESS'?'#3fb950':'#f85149'">{{b.status}}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-settings"></i> Configuration pipeline</div>
        <div class="conf-list">
          <div class="conf-row"><span class="conf-k">Job</span><span class="conf-v">{{jobName}}</span></div>
          <div class="conf-row"><span class="conf-k">Branch</span><span class="conf-v">origin/main</span></div>
          <div class="conf-row"><span class="conf-k">Webhook URL</span><span class="conf-v">http://n8n:5678/webhook/jenkins-event</span></div>
          <div class="conf-row"><span class="conf-k">Deploy</span><span class="conf-v">kubectl set image → K8s</span></div>
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
    .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
    .kpi{background:#161b22;border:1px solid #30363d;border-radius:7px;padding:10px 12px}
    .kpi-l{font-size:9px;color:#8b949e;margin-bottom:4px}
    .kpi-v{font-size:20px;font-weight:700}
    .kpi-s{font-size:9px;margin-top:2px}
    .kpi.r .kpi-v{color:#f85149}.kpi.g .kpi-v{color:#3fb950}.kpi.b .kpi-v{color:#58a6ff}.kpi.o .kpi-v{color:#d29922}
    .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;margin-bottom:12px}
    .card-title{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
    .build-list{display:flex;flex-direction:column;gap:5px}
    .build-item{display:flex;align-items:center;gap:10px;padding:8px 10px;background:#21262d;border-radius:5px;font-size:10px}
    .build-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
    .build-num{font-weight:600;color:#58a6ff;width:30px}
    .build-msg{flex:1;color:#e6edf3}
    .build-dur{color:#8b949e;width:50px}
    .build-time{color:#8b949e;width:80px}
    .build-badge{padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700}
    .conf-list{display:flex;flex-direction:column;gap:6px}
    .conf-row{display:flex;gap:12px;padding:6px 0;border-bottom:1px solid #30363d;font-size:11px}
    .conf-row:last-child{border:none}
    .conf-k{color:#8b949e;width:120px;flex-shrink:0}
    .conf-v{color:#e6edf3;font-family:monospace}
  `]
})
export class JenkinsComponent implements OnInit, AfterViewInit, OnDestroy {
  builds: any[] = [];
  lastBuild: any = {};
  jobName = 'pfe-devsecops-pipeline';
  successRate = 0;
  avgDuration = 0;
  consecutiveFails = 0;
  private projectId = '54192eca-43da-4d8f-9b49-30c143983fdd';
  private chart: any;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.http.get<any>(`http://172.31.172.61:3001/api/projects/${this.projectId}/jenkins`, { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } }).subscribe((data: any) => {
      this.lastBuild = data;
      this.jobName = data.jobName || 'pfe-devsecops-pipeline';
      this.builds = (data.builds || []).map((b: any) => ({
        num: b.number,
        msg: b.result === 'SUCCESS' ? 'Build réussi · Deploy K8s' : 'Build échoué',
        dur: b.duration + 's',
        time: this.timeAgo(b.timestamp),
        status: b.result || 'UNKNOWN',
      }));
      const success = this.builds.filter(b => b.status === 'SUCCESS').length;
      this.successRate = this.builds.length ? Math.round(success / this.builds.length * 100) : 0;
      const durations = (data.builds || []).map((b: any) => b.duration).filter((d: number) => d > 0);
      this.avgDuration = durations.length ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0;
      let fails = 0;
      for (const b of this.builds) {
        if (b.status !== 'SUCCESS') fails++;
        else break;
      }
      this.consecutiveFails = fails;
      setTimeout(() => this.buildChart(), 100);
    });
  }

  timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor(diff / 60000);
    if (h > 24) return 'il y a ' + Math.floor(h/24) + 'j';
    if (h > 0) return 'il y a ' + h + 'h';
    return 'il y a ' + m + 'min';
  }

  buildChart() {
    const c = document.getElementById('jenkins-chart') as HTMLCanvasElement;
    if (!c || !(window as any).Chart) return;
    if (this.chart) this.chart.destroy();
    const rev = this.builds.slice().reverse();
    this.chart = new (window as any).Chart(c, {
      type: 'bar',
      data: {
        labels: rev.map(b => '#' + b.num),
        datasets: [{ data: rev.map(b => b.status === 'SUCCESS' ? 200 : 60), backgroundColor: rev.map(b => b.status === 'SUCCESS' ? '#3fb950' : '#f85149'), borderRadius: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#8b949e', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { display: false } } }
    });
  }

  ngAfterViewInit() {}
  ngOnDestroy() { if (this.chart) this.chart.destroy(); }
}
