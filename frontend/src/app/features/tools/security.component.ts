import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-security',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="page-icon" style="background:var(--accent-red-bg)"><i class="ti ti-shield-check" style="color:var(--accent-red)"></i></div>
        <div><h2>Sécurité — Trivy & OWASP</h2><div class="page-sub">Container scan + DAST · Image main-132</div></div>
      </div>

      <div class="kpi-grid">
        <div class="kpi g"><div class="kpi-l">CRITICAL</div><div class="kpi-v">0</div></div>
        <div class="kpi o"><div class="kpi-l">HIGH</div><div class="kpi-v">2</div></div>
        <div class="kpi o"><div class="kpi-l">MEDIUM</div><div class="kpi-v">5</div></div>
        <div class="kpi g"><div class="kpi-l">LOW</div><div class="kpi-v">11</div></div>
        <div class="kpi o"><div class="kpi-l">DAST MEDIUM</div><div class="kpi-v">1</div></div>
        <div class="kpi g"><div class="kpi-l">DAST HIGH</div><div class="kpi-v">0</div></div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-bug"></i> CVE Trivy — Image souhaiel11/pfe-devsecops-2026:main-132</div>
        <div class="cve-list">
          <div class="cve-item" *ngFor="let c of cves">
            <span class="cve-sev" [style.background]="c.bg" [style.color]="c.color">{{c.sev}}</span>
            <div class="cve-id">{{c.id}}</div>
            <div class="cve-pkg">{{c.pkg}}</div>
            <div class="cve-cvss">CVSS {{c.cvss}}</div>
            <span class="cve-patch" [style.color]="c.patch?'var(--accent-green)':'var(--text-secondary)'">{{c.patch?'✓ Patch dispo':'Pas de patch'}}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-world"></i> OWASP ZAP — DAST</div>
        <div class="zap-info">
          <div class="zap-row"><span class="zap-k">Cible</span><span class="zap-v">http://192.168.49.2:30003</span></div>
          <div class="zap-row"><span class="zap-k">Statut</span><span class="zap-v" style="color:var(--accent-orange)">À configurer — NodePort K8s</span></div>
          <div class="zap-row"><span class="zap-k">Alertes HIGH</span><span class="zap-v" style="color:var(--accent-green)">0</span></div>
          <div class="zap-row"><span class="zap-k">Alertes MEDIUM</span><span class="zap-v" style="color:var(--accent-orange)">1</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><i class="ti ti-shield"></i> OWASP Dependency Check — SCA</div>
        <div class="zap-row"><span class="zap-k">Statut</span><span class="zap-v" style="color:var(--accent-orange)">NVD API expirée — à renouveler</span></div>
        <div class="zap-row"><span class="zap-k">Dernière analyse</span><span class="zap-v">Build #132</span></div>
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
    .kpi-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:14px}
    .kpi{background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:7px;padding:10px 12px}
    .kpi-l{font-size:9px;color:var(--text-secondary);margin-bottom:4px}
    .kpi-v{font-size:20px;font-weight:700}
    .kpi.g .kpi-v{color:var(--accent-green)}.kpi.o .kpi-v{color:var(--accent-orange)}.kpi.r .kpi-v{color:var(--accent-red)}
    .card{background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:14px;margin-bottom:12px}
    .card-title{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
    .cve-list{display:flex;flex-direction:column;gap:5px}
    .cve-item{display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-tertiary);border-radius:5px;font-size:10px}
    .cve-sev{padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;flex-shrink:0}
    .cve-id{font-weight:600;color:var(--accent-blue);width:130px}
    .cve-pkg{flex:1;color:var(--text-secondary)}
    .cve-cvss{font-weight:600;width:60px}
    .cve-patch{font-size:9px;font-weight:600}
    .zap-info{display:flex;flex-direction:column;gap:5px}
    .zap-row{display:flex;gap:12px;padding:5px 0;border-bottom:1px solid var(--border-color);font-size:11px}
    .zap-row:last-child{border:none}
    .zap-k{color:var(--text-secondary);width:140px;flex-shrink:0}
    .zap-v{color:var(--text-primary)}
  `]
})
export class SecurityComponent {
  cves = [
    { sev: 'HIGH', bg: 'var(--accent-orange-bg)', color: 'var(--accent-orange)', id: 'CVE-2024-1234', pkg: 'eclipse-temurin:17', cvss: 7.5, patch: true },
    { sev: 'HIGH', bg: 'var(--accent-orange-bg)', color: 'var(--accent-orange)', id: 'CVE-2024-5678', pkg: 'alpine:3.18', cvss: 7.1, patch: true },
    { sev: 'MEDIUM', bg: 'var(--accent-blue-bg)', color: 'var(--accent-blue)', id: 'CVE-2023-9999', pkg: 'openssl:3.0.7', cvss: 5.3, patch: false },
    { sev: 'MEDIUM', bg: 'var(--accent-blue-bg)', color: 'var(--accent-blue)', id: 'CVE-2023-8888', pkg: 'libssl3', cvss: 4.9, patch: false },
    { sev: 'LOW', bg: 'var(--bg-hover)', color: 'var(--text-secondary)', id: 'CVE-2022-7777', pkg: 'zlib:1.2.11', cvss: 3.1, patch: false },
  ];
}
