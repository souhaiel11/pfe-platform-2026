// Diffuse un événement global quand un projet est créé/supprimé, pour que les vues agrégées (dashboard, sécurité...) se rechargent sans action manuelle.
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ProjectEventsService {
  private readonly changed$ = new Subject<void>();
  readonly projectsChanged$ = this.changed$.asObservable();

  /** Signale à tous les abonnés qu'un projet a été créé/supprimé. */
  notifyChanged(): void {
    this.changed$.next();
  }
}
