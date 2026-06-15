import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-kubernetes',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="page-icon" style="background:#0c1c2e"><i class="ti ti-ship" style="color:#58a6ff"></i></div>
        <div><h2>Kubernetes — Minikube</h2><div class="page-sub">Namespace pfe-devsecops · Node 192.168.49.2</div></div>
      </div>

      <div class="kpi-grid">
        <div class="kpi g"><div class="kpi-l">Pods Running</div><div class="kpi-v">4/4</div></div>
        <div class="kpi g"><div class="kpi-l">Restarts</div><div class="kpi-v">0</div><div class="kpi-s">aujourd'hui</div></div>
        <div class="kpi b"><div class="kpi-l">Namespace</div><div class="kpi-v" style="font-size:12px">pfe-devsecops</div></div>
        <div class="kpi b"><div class="kpi-l">Node IP</div><div class="kpi-v" style="font-size:12px">192.168.49.2</div></div>
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-title"><i class="ti ti-box"></i> Pods</div>
          <div class="pod-list">
            <div class="pod-item" *ngFor="let p of pods">
              <div class="pod-dot" [style.background]="p.status==='Running'?'#3fb950':'#f85149'"></div>
              <div class="pod-name">{{p.name}}</div>
              <span class="pod-status" [style.color]="p.status==='Running'?'#3fb950':'#f85149'">{{p.status}}</span>
              <div class="pod-meta">{{p.meta}}</div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-title"><i class="ti ti-network"></i> Services</div>
          <div class="pod-list">
            <div class="pod-item" *ngFor="let s of services">
              <div class="pod-dot" style="background:#58a6ff"></div>
              <div class="pod-name">{{s.name}}</div>
              <span style="color:#58a6ff;font-size:9px">{{s.type}}</span>
              <div class="pod-meta">{{s.port}}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-clock"></i> Événements récents</div>
        <div class="event-list">
          <div class="event-item" *ngFor="let e of events">
            <div class="event-dot" [style.background]="e.color"></div>
            <div class="event-text">{{e.text}}</div>
            <div class="event-meta">{{e.meta}}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-info-circle"></i> Commandes utiles</div>
        <div class="cmd-list">
          <div class="cmd-item" *ngFor="let c of commands">
            <div class="cmd-desc">{{c.desc}}</div>
            <code class="cmd-code">{{c.cmd}}</code>
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
    .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
    .kpi{background:#161b22;border:1px solid #30363d;border-radius:7px;padding:10px 12px}
    .kpi-l{font-size:9px;color:#8b949e;margin-bottom:4px}
    .kpi-v{font-size:20px;font-weight:700}
    .kpi-s{font-size:9px;color:#8b949e;margin-top:2px}
    .kpi.g .kpi-v{color:#3fb950}.kpi.b .kpi-v{color:#58a6ff}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
    .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;margin-bottom:12px}
    .card-title{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
    .pod-list{display:flex;flex-direction:column;gap:5px}
    .pod-item{display:flex;align-items:center;gap:7px;padding:6px 8px;background:#21262d;border-radius:5px;font-size:10px}
    .pod-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
    .pod-name{flex:1;font-weight:500}
    .pod-meta{font-size:9px;color:#8b949e}
    .event-list{display:flex;flex-direction:column;gap:5px}
    .event-item{display:flex;align-items:center;gap:8px;padding:7px 9px;background:#21262d;border-radius:5px;font-size:10px}
    .event-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
    .event-text{flex:1}
    .event-meta{font-size:9px;color:#8b949e}
    .cmd-list{display:flex;flex-direction:column;gap:7px}
    .cmd-item{background:#21262d;border-radius:5px;padding:8px 10px}
    .cmd-desc{font-size:10px;color:#8b949e;margin-bottom:4px}
    .cmd-code{font-size:10px;color:#3fb950;font-family:monospace;display:block}
  `]
})
export class KubernetesComponent {
  pods = [
    { name: 'frontend-5ffd87d65c', status: 'Running', meta: 'Angular · :30002' },
    { name: 'backend-684bd59c9', status: 'Running', meta: 'NestJS · :30001' },
    { name: 'app-test-678b5bff5d', status: 'Running', meta: 'Spring Boot · main-132 · :30003' },
    { name: 'postgres-0', status: 'Running', meta: 'StatefulSet · ClusterIP :5432' },
  ];
  services = [
    { name: 'frontend', type: 'NodePort', port: ':30002 → 80' },
    { name: 'backend', type: 'NodePort', port: ':30001 → 3000' },
    { name: 'app-test', type: 'NodePort', port: ':30003 → 8080' },
    { name: 'postgres', type: 'ClusterIP', port: ':5432 (interne)' },
  ];
  events = [
    { color: '#3fb950', text: 'app-test rollout completed — image main-132', meta: 'il y a 2h' },
    { color: '#d29922', text: 'app-test CrashLoopBackOff — DB_HOST pfe-postgres', meta: 'il y a 6h · Corrigé' },
    { color: '#3fb950', text: 'minikube restart après network conflict', meta: 'aujourd\'hui 11:30' },
  ];
  commands = [
    { desc: 'État des pods', cmd: 'kubectl get pods -n pfe-devsecops' },
    { desc: 'Logs app-test', cmd: 'kubectl logs -n pfe-devsecops -l app=app-test --tail=50' },
    { desc: 'Déployer nouvelle image', cmd: 'kubectl set image deployment/app-test app-test=souhaiel11/pfe-devsecops-2026:TAG -n pfe-devsecops' },
    { desc: 'Port-forward backend', cmd: 'kubectl port-forward svc/backend 3002:3000 -n pfe-devsecops' },
  ];
}
