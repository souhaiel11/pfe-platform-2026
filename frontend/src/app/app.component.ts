// Composant racine de l'application : héberge le routeur et le conteneur global des notifications toast.
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ToastComponent } from './shared/toast/toast.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterModule, ToastComponent],
  template: `
    <router-outlet></router-outlet>
    <app-toast></app-toast>
  `
})
export class AppComponent {}
