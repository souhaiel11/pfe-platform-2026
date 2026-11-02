// Garde de désactivation : empêche de quitter une page sans confirmation si elle contient des modifications non enregistrées.
import { CanDeactivateFn } from '@angular/router';

/** Contrat qu'un composant doit implémenter pour être protégé par ce guard. */
export interface HasUnsavedChanges {
  /** Vérifie la présence de non enregistré modifications. */
  hasUnsavedChanges(): boolean;
}

/** Demande confirmation avant de quitter la page si le composant signale des modifications non enregistrées. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = component =>
  !component.hasUnsavedChanges()
  || window.confirm('Des modifications ne sont pas enregistrées. Voulez-vous quitter cette page ?');
