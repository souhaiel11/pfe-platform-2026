import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

// Émet un événement à chaque création/suppression de projet, pour que les
// vues globales (dashboard, sécurité...) qui agrègent tous les projets
// puissent se re-fetch sans reload manuel de la page.
@Injectable({ providedIn: 'root' })
export class ProjectEventsService {
  private readonly changed$ = new Subject<void>();
  readonly projectsChanged$ = this.changed$.asObservable();

  notifyChanged(): void {
    this.changed$.next();
  }
}
