// Coquille de mise en page (barre latérale + barre de navigation + widget de chat) qui enveloppe toutes les pages authentifiées.

import { PresentationLabelPipe } from '../presentation-label.pipe';
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { RiskStateService } from '../../core/services/risk-state.service';
import { ChatWidgetComponent } from '../chat-widget/chat-widget.component';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [PresentationLabelPipe, CommonModule, RouterModule, ChatWidgetComponent],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.scss'],
})
export class LayoutComponent implements OnInit {
  mobileNavOpen = false;
  pageTitle = "Vue d'ensemble";

  private pageTitles: Record<string, string> = {
    '/dashboard':     "Vue d'ensemble",
    '/projects':      'Projets',
    '/incidents':     'Incidents',
    '/analysis':      'Agents IA',
    '/settings':      'Paramètres',
    '/admin':         'Administration',
    '/security':      'Sécurité',
    '/prediction':    'Indicateurs de risque',
  };

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    private auth: AuthService,
    private router: Router,
    public themeService: ThemeService,
    public riskState: RiskStateService,
  ) {}

  // Traduit le niveau de risque global en couleur CSS appliquée au liseré de la barre latérale.
  get sidebarRiskStyle() {
    const colours: Record<string, string> = {
      CRITICAL: '#e58a80', HIGH: '#d4aa6b', MEDIUM: '#c7ba84', LOW: 'transparent',
    };
    return { '--nav-risk-color': colours[this.riskState.level()] || 'transparent' };
  }

  // Dérive le titre de page affiché depuis le premier segment de l'URL active, et le remet à jour à chaque navigation.
  ngOnInit() {
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: any) => {
        const path = '/' + e.urlAfterRedirects.split('/')[1];
        this.pageTitle = this.pageTitles[path] || 'DevSecOps IA';
      });
    const path = '/' + this.router.url.split('/')[1];
    this.pageTitle = this.pageTitles[path] || 'DevSecOps IA';
  }

  // Déconnecte l'utilisateur courant.
  logout() { this.auth.logout(); }
  // Referme le menu de navigation mobile.
  closeMobileNav() { this.mobileNavOpen = false; }
  // Expose l'utilisateur courant du service d'authentification.
  get currentUser() { return this.auth.currentUser; }
  // Expose si l'utilisateur courant est administrateur.
  get isAdmin() { return this.auth.isAdmin; }
  // Dérive les initiales affichées dans l'avatar depuis le nom d'utilisateur ou l'email.
  get userInitials() {
    const u = this.auth.currentUser;
    if (!u) return '—';
    return (u.username || u.email || 'U').substring(0, 2).toUpperCase();
  }
}
