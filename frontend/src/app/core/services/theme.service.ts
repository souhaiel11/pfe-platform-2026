import { Injectable, signal } from '@angular/core';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'vermeg-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this.storedTheme());

  constructor() {
    this.apply(this.theme());
  }

  toggleTheme(): void {
    const next: Theme = this.theme() === 'light' ? 'dark' : 'light';
    this.theme.set(next);
    this.apply(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  private storedTheme(): Theme {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  }

  private apply(theme: Theme): void {
    document.body.classList.toggle('dark-theme', theme === 'dark');
  }
}
