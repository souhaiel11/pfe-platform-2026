import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sb-logo">
          <div class="logo-mark">D</div>
          <div>
            <div class="logo-title">DevSecOps AI</div>
            <div class="logo-sub">Vermeg · PFE 2026</div>
          </div>
        </div>
        <nav class="sb-nav">
          <div class="nav-section">Plateforme</div>
          <a class="nav-item" routerLink="/dashboard" routerLinkActive="active"><i class="ti ti-layout-dashboard"></i> Dashboard</a>
          <a class="nav-item" routerLink="/projects" routerLinkActive="active"><i class="ti ti-folder"></i> Projets</a>
          <a class="nav-item" routerLink="/incidents" routerLinkActive="active"><i class="ti ti-alert-triangle"></i> Incidents<span class="nav-badge red" *ngIf="openCount > 0">{{openCount}}</span></a>
          <a class="nav-item" routerLink="/analysis" routerLinkActive="active"><i class="ti ti-robot"></i> Agents IA</a>
          <div class="nav-section">CI/CD & Sécurité</div>
          <a class="nav-item" routerLink="/jenkins" routerLinkActive="active"><i class="ti ti-git-branch"></i> Jenkins</a>
          <a class="nav-item" routerLink="/sonarqube" routerLinkActive="active"><i class="ti ti-wave-sine"></i> SonarQube</a>
          <a class="nav-item" routerLink="/security" routerLinkActive="active"><i class="ti ti-bug"></i> Trivy / OWASP</a>
          <div class="nav-section">Infrastructure</div>
          <a class="nav-item" routerLink="/kubernetes" routerLinkActive="active"><i class="ti ti-ship"></i> Kubernetes</a>
          <a class="nav-item" routerLink="/monitoring" routerLinkActive="active"><i class="ti ti-activity"></i> Grafana</a>
          <div class="nav-section">Analytics</div>
          <a class="nav-item" routerLink="/dora" routerLinkActive="active"><i class="ti ti-chart-bar"></i> DORA</a>
          <a class="nav-item" routerLink="/prediction" routerLinkActive="active"><i class="ti ti-brain"></i> Prédiction IA</a>
          <div class="nav-section">Système</div>
          <a class="nav-item" routerLink="/notifications" routerLinkActive="active"><i class="ti ti-bell"></i> Notifications</a>
          <a class="nav-item" routerLink="/settings" routerLinkActive="active"><i class="ti ti-settings"></i> Paramètres</a>
          <a class="nav-item" routerLink="/admin" routerLinkActive="active" *ngIf="isAdmin"><i class="ti ti-shield"></i> Admin</a>
        </nav>
        <div class="sb-footer">
          <div class="user-row">
            <div class="user-av">{{userInitials}}</div>
            <div class="user-info">
              <div class="user-name">{{currentUser?.username}}</div>
              <div class="user-role">{{currentUser?.role}}</div>
            </div>
            <button class="logout-btn" (click)="logout()"><i class="ti ti-logout"></i></button>
          </div>
        </div>
      </aside>
      <div class="main-content">
        <header class="topbar">
          <div class="topbar-title">{{pageTitle}}</div>
          <div class="topbar-right">
            <div class="live-badge"><span class="live-dot"></span> LIVE</div>
            <div class="uav">{{userInitials}}</div>
          </div>
        </header>
        <div class="page-wrap"><router-outlet></router-outlet></div>
      </div>
    </div>
  `,
  styles: [`
    :host{display:block}
    .app-shell{display:flex;min-height:100vh;background:#0d1117;color:#e6edf3;font-family:'JetBrains Mono',monospace}
    .sidebar{width:210px;background:#161b22;border-right:1px solid #30363d;display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:100}
    .sb-logo{display:flex;align-items:center;gap:9px;padding:13px 11px;border-bottom:1px solid #30363d}
    .logo-mark{width:26px;height:26px;background:#58a6ff;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:12px}
    .logo-title{font-size:12px;font-weight:600;color:#e6edf3}
    .logo-sub{font-size:9px;color:#8b949e}
    .sb-nav{flex:1;padding:5px 0;overflow-y:auto}
    .nav-section{padding:7px 10px 2px;font-size:9px;color:#484f58;text-transform:uppercase;letter-spacing:.7px;font-weight:600}
    .nav-item{display:flex;align-items:center;gap:7px;padding:6px 10px;font-size:11px;color:#8b949e;text-decoration:none;border-right:2px solid transparent;transition:all .12s}
    .nav-item i{font-size:13px;width:14px}
    .nav-item:hover{background:#21262d;color:#e6edf3}
    .nav-item.active{background:#0c1c2e;color:#58a6ff;border-right-color:#58a6ff}
    .nav-badge{margin-left:auto;border-radius:8px;padding:1px 5px;font-size:9px;font-weight:700}
    .nav-badge.red{background:#2d1117;color:#f85149}
    .sb-footer{padding:9px;border-top:1px solid #30363d}
    .user-row{display:flex;align-items:center;gap:7px}
    .user-av{width:26px;height:26px;background:#0c1c2e;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#58a6ff}
    .user-info{flex:1;min-width:0}
    .user-name{font-size:11px;color:#e6edf3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .user-role{font-size:9px;color:#8b949e}
    .logout-btn{background:none;border:1px solid #30363d;border-radius:5px;color:#8b949e;cursor:pointer;padding:4px 6px;font-size:12px}
    .logout-btn:hover{border-color:#f85149;color:#f85149}
    .main-content{margin-left:210px;flex:1;display:flex;flex-direction:column;min-height:100vh}
    .topbar{height:44px;background:#161b22;border-bottom:1px solid #30363d;display:flex;align-items:center;padding:0 16px;gap:10px;position:sticky;top:0;z-index:50}
    .topbar-title{font-size:13px;font-weight:600;flex:1;color:#e6edf3}
    .topbar-right{display:flex;align-items:center;gap:8px}
    .live-badge{display:flex;align-items:center;gap:5px;padding:3px 9px;background:#0d2119;border:1px solid #3fb950;border-radius:12px;font-size:10px;font-weight:700;color:#3fb950}
    .live-dot{width:6px;height:6px;background:#3fb950;border-radius:50%;animation:pulse 1.5s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .uav{width:28px;height:28px;background:#0c1c2e;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#58a6ff}
    .page-wrap{flex:1;overflow:auto}
  `]
})
export class LayoutComponent implements OnInit {
  openCount = 0;
  notifCount = 0;
  pageTitle = "Vue d'ensemble";
  isDark = true;

  private pageTitles: Record<string, string> = {
    '/dashboard': "Vue d'ensemble",
    '/projects': 'Projets',
    '/incidents': 'Incidents',
    '/analysis': 'Agents IA',
    '/notifications': 'Notifications',
    '/settings': 'Paramètres',
    '/admin': 'Administration',
  };

  constructor(private auth: AuthService, private api: ApiService, private router: Router) {}

  ngOnInit() {
    this.loadCounts();
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe((e: any) => {
      const path = '/' + e.urlAfterRedirects.split('/')[1];
      this.pageTitle = this.pageTitles[path] || 'DevSecOps IA';
    });
    const path = '/' + this.router.url.split('/')[1];
    this.pageTitle = this.pageTitles[path] || 'DevSecOps IA';
  }

  loadCounts() {
    this.api.getIncidents({ status: 'OPEN', size: 1 }).subscribe((r: any) => {
      this.openCount = r.totalElements || r.length || 0;
    });
    this.api.getNotifications().subscribe((n: any[]) => {
      this.notifCount = n.filter((x: any) => !x.read).length;
    });
  }

  logout() { this.auth.logout(); }
  get currentUser() { return this.auth.currentUser; }
  get isAdmin() { return this.auth.isAdmin; }
  get userInitials() {
    const u = this.auth.currentUser;
    if (!u) return 'SA';
    return (u.username || u.email || 'U').substring(0, 2).toUpperCase();
  }
}
