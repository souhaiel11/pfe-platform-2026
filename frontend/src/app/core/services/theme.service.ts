// Gère le thème clair/sombre de l'application : signal courant, persistance en localStorage, application de la classe CSS.
import { Injectable, signal } from '@angular/core';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'vermeg-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this.storedTheme());

  /** Applique immédiatement le thème restauré depuis localStorage au démarrage du service. */
  constructor() {
    this.apply(this.theme());
  }

  /** Bascule clair/sombre, applique la classe CSS correspondante et persiste le choix en localStorage. */
  toggleTheme(): void {
    const next: Theme = this.theme() === 'light' ? 'dark' : 'light';
    this.theme.set(next);
    this.apply(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  /** Lit le thème précédemment choisi en localStorage ; 'light' par défaut si rien n'est stocké. */
  private storedTheme(): Theme {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  }

  /** Applique/retire la classe CSS 'dark-theme' sur le body selon le thème demandé. */
  private apply(theme: Theme): void {
    document.body.classList.toggle('dark-theme', theme === 'dark');
  }
}
