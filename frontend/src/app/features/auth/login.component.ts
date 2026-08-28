import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-shell">
      <div class="login-left">
        <div class="brand">
          <div class="brand-icon">⬡</div>
          <div class="brand-name">DevSecOps IA</div>
          <div class="brand-sub">Plateforme d'orchestration intelligente</div>
        </div>
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
        <div class="login-card">
          <div class="login-header">
            <div class="login-title">Connexion</div>
            <div class="login-sub">Accédez à la plateforme DevSecOps</div>
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input class="form-control" [(ngModel)]="email"
                   placeholder="admin@devsecops.local" (keydown.enter)="login()" />
          </div>
          <div class="form-group">
            <label class="form-label">Mot de passe</label>
            <input class="form-control" type="password" [(ngModel)]="password"
                   placeholder="••••••••" (keydown.enter)="login()" />
          </div>
          <button class="btn btn-primary" style="width:100%;justify-content:center;padding:10px;"
                  (click)="login()" [disabled]="loading">
            <span *ngIf="loading" class="spinner" style="width:14px;height:14px;border-width:1.5px;"></span>
            <span *ngIf="!loading">Se connecter →</span>
          </button>
          <div class="login-error" *ngIf="error">{{error}}</div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .login-shell { display:flex; height:100vh; background:var(--bg-primary); }
    .login-left { width:420px; background:var(--bg-secondary); border-right:1px solid var(--border); padding:48px 40px; display:flex; flex-direction:column; }
    .brand { margin-bottom:48px; }
    .brand-icon { font-size:36px; color:var(--accent-blue); margin-bottom:12px; }
    .brand-name { font-size:22px; font-weight:700; color:var(--text-primary); font-family:var(--font-mono); letter-spacing:2px; text-transform:uppercase; }
    .brand-sub { font-size:12px; color:var(--text-muted); margin-top:4px; }
    .feature-list { display:flex; flex-direction:column; gap:24px; flex:1; }
    .feature { display:flex; gap:14px; align-items:flex-start; }
    .feature-icon { font-size:20px; width:36px; height:36px; background:var(--bg-hover); border:1px solid var(--border); border-radius:var(--radius-md); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    .feature-title { font-size:13px; font-weight:600; color:var(--text-primary); margin-bottom:3px; }
    .feature-desc { font-size:11px; color:var(--text-muted); line-height:1.4; }
    .brand-footer { font-size:11px; color:var(--text-faint); font-family:var(--font-mono); }
    @media (max-width: 760px) {
      .login-shell { min-height:100vh; height:auto; }
      .login-left { display:none; }
      .login-right { padding:20px; }
      .login-card { width:min(100%,380px); padding:26px 22px; }
    }
    .login-right { flex:1; display:flex; align-items:center; justify-content:center; }
    .login-card { width:380px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-lg); padding:36px; }
    .login-header { margin-bottom:28px; }
    .login-title { font-size:20px; font-weight:700; color:var(--text-primary); font-family:var(--font-mono); }
    .login-sub { font-size:12px; color:var(--text-muted); margin-top:4px; }
    .login-error { margin-top:12px; padding:10px 12px; background:var(--accent-red-bg); border:1px solid var(--accent-red); border-radius:var(--radius-md); color:var(--accent-red); font-size:12px; }
  `]
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
    { icon: '◉', title: 'Monitoring temps réel',      desc: 'Dashboard live avec WebSocket et alertes instantanées' }
  ];

  constructor(
    private auth: AuthService,
    private router: Router,
    private toast: ToastService
  ) {}

  login() {
    if (!this.email || !this.password) {
      this.error = 'Veuillez remplir tous les champs.';
      return;
    }
    this.loading = true;
    this.error   = '';

    this.auth.login(this.email, this.password).subscribe({
      next: () => {
        this.toast.success('Connexion réussie', `Bienvenue !`);
        this.router.navigate(['/dashboard']);
      },
      error: err => {
        this.loading = false;
        this.error = err.status === 401
          ? 'Email ou mot de passe incorrect.'
          : 'Erreur de connexion au serveur.';
      }
    });
  }
}
