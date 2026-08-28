import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterModule],
  template: `
    <main class="not-found" aria-labelledby="not-found-title">
      <div class="code">404</div>
      <h1 id="not-found-title">Page introuvable</h1>
      <p>Cette route n'existe pas ou n'est plus disponible.</p>
      <a routerLink="/dashboard" class="btn btn-primary">Retour au tableau de bord</a>
    </main>
  `,
  styles: [`
    :host{display:block;min-height:60vh}
    .not-found{min-height:60vh;display:grid;place-content:center;text-align:center;padding:32px;color:var(--text-primary)}
    .code{font:800 clamp(54px,10vw,96px)/1 var(--font-mono);color:var(--accent-blue);opacity:.32}
    h1{margin:12px 0 6px;font-size:24px} p{margin:0 0 22px;color:var(--text-secondary)}
    a{justify-self:center;text-decoration:none}
  `],
})
export class NotFoundComponent {}
