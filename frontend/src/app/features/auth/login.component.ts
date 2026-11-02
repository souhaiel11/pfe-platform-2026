// Gère l’affichage et les actions de login.
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';

/**
 * Page de connexion : formulaire email/mot de passe, authentification et
 * redirection vers la page demandée (ou le tableau de bord).
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-shell">
      <div class="login-left">
        <div class="brand">
          <div class="brand-icon" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M6 6h10v10H6zM24 6h10v10H24zM15 23h10v10H15zM16 11h8M11 16v12h4M29 16v12h-4" stroke="currentColor" stroke-width="1.5"/></svg></div>
          <div class="brand-name">DevSecOps <span>/ IA</span></div>
          <div class="brand-sub">VERMEG · L’ATELIER DE LA SÉCURITÉ</div>
        </div>
        <div class="login-manifesto"><p>OBSERVER. DÉCIDER. AVANCER.</p><h1>La confiance <br><em>se construit.</em></h1><span>Une décision à la fois.</span></div>
        <div class="feature-list">
          <div class="feature" *ngFor="let f of features">
            <span class="feature-icon">{{f.icon}}</span>
            <div>
              <div class="feature-title">{{f.title}}</div>
              <div class="feature-desc">{{f.desc}}</div>
            </div>
          </div>
        </div>
        <div class="brand-footer">Vermeg · ESPRIT · PFE 2026</div>
      </div>
      <div class="login-right">
        <div class="login-access-label">ESPACE DE TRAVAIL <span>/ 01</span></div>
        <form class="login-card" (ngSubmit)="login()">
          <div class="login-header">
            <div class="login-kicker">BIENVENUE À L’ATELIER</div><h2 class="login-title">Reprenons le fil.</h2>
            <div class="login-sub">Connectez-vous pour retrouver vos projets, vos analyses et vos décisions.</div>
          </div>
          <div class="form-group">
            <label class="form-label" for="atelier-email">Adresse courriel</label>
            <input id="atelier-email" class="form-control" type="email" name="email" autocomplete="username" [(ngModel)]="email"
                   placeholder="vous@entreprise.fr" />
          </div>
          <div class="form-group">
            <label class="form-label" for="atelier-password">Mot de passe</label>
            <input id="atelier-password" class="form-control" type="password" name="password" autocomplete="current-password" [(ngModel)]="password"
                   placeholder="Votre mot de passe" />
          </div>
          <button type="submit" class="btn btn-primary login-submit" [disabled]="loading">
            <span *ngIf="loading" class="spinner" style="width:14px;height:14px;border-width:1.5px;"></span>
            <span *ngIf="!loading">Entrer dans l’atelier <span aria-hidden="true">↗</span></span>
          </button>
          <div class="login-error" role="alert" *ngIf="error">{{error}}</div>
          <p class="login-footnote">L’intelligence éclaire. Vous gardez la décision.</p>
        </form>
      </div>
    </div>
  `,
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  email    = '';
  password = '';
  loading  = false;
  error    = '';

  features = [
    { icon: '◈', title: 'Analyse IA automatique',    desc: '4 agents spécialisés analysent chaque incident en parallèle' },
    { icon: '⬡', title: 'Détection sécurité',         desc: 'Trivy + SonarQube intégrés dans le pipeline CI/CD' },
    { icon: '◆', title: 'Corrections gouvernées',      desc: 'Pull Request uniquement après approbation utilisateur explicite' },
    { icon: '◉', title: 'Supervision en temps réel',  desc: 'Tableau de bord actualisé avec WebSocket et alertes instantanées' }
  ];

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(
    private auth: AuthService,
    private router: Router,
    private toast: ToastService,
    private route: ActivatedRoute,
  ) {}

  /** Authentifie l'utilisateur puis redirige vers `returnUrl` (validée) ou vers le tableau de bord par défaut. */
  login() {
    if (!this.email || !this.password) {
      this.error = 'Veuillez remplir tous les champs.';
      return;
    }
    this.loading = true;
    this.error   = '';

    this.auth.login(this.email, this.password).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: () => {
        this.toast.success('Connexion réussie', `Bienvenue !`);
        const returnUrl = this.route?.snapshot.queryParamMap.get('returnUrl') || '';
        if (returnUrl.startsWith('/') && !returnUrl.startsWith('//') && !returnUrl.includes('\\') && !/^\/login(?:[/?#]|$)/.test(returnUrl)) {
          this.router.navigateByUrl(returnUrl);
        } else this.router.navigate(['/dashboard']);
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: err => {
        this.loading = false;
        this.error = err.status === 401
          ? 'Email ou mot de passe incorrect.'
          : 'Erreur de connexion au serveur.';
      }
    });
  }
}
