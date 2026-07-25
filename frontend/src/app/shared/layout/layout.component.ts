import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';
import { ThemeService } from '../../core/services/theme.service';
import { RiskStateService } from '../../core/services/risk-state.service';
import { ChatWidgetComponent } from '../chat-widget/chat-widget.component';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, ChatWidgetComponent],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.scss'],
})
export class LayoutComponent implements OnInit {
  openCount = 0;
  notifCount = 0;
  pageTitle = "Vue d'ensemble";

  private pageTitles: Record<string, string> = {
    '/dashboard':     "Vue d'ensemble",
    '/projects':      'Projets',
    '/incidents':     'Incidents',
    '/analysis':      'Agents IA',
    '/notifications': 'Notifications',
    '/settings':      'Paramètres',
    '/admin':         'Administration',
  };

  constructor(
    private auth: AuthService,
    private api: ApiService,
    private router: Router,
    public themeService: ThemeService,
    public riskState: RiskStateService,
  ) {}

  get sidebarRiskStyle() {
    const map = {
      CRITICAL: { background: 'rgba(226,75,74,0.08)', 'border-right': '3px solid rgba(226,75,74,0.4)' },
      HIGH:     { background: 'rgba(239,159,39,0.08)', 'border-right': '3px solid rgba(239,159,39,0.4)' },
      MEDIUM:   { background: 'rgba(250,199,117,0.08)', 'border-right': '3px solid rgba(250,199,117,0.4)' },
      LOW:      { background: '', 'border-right': '' },
    };
    return map[this.riskState.level() as keyof typeof map] || map.LOW;
  }

  ngOnInit() {
    this.loadCounts();
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: any) => {
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
