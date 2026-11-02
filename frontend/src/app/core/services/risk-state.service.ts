// Signal partagé exposant le niveau de risque courant, lu par les composants qui doivent adapter leur affichage (ex. thème/couleur globale).
import { Injectable, signal } from '@angular/core';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

@Injectable({ providedIn: 'root' })
export class RiskStateService {
  readonly level = signal<RiskLevel>('LOW');

  /** Normalise une chaîne de niveau de risque et met à jour le signal partagé ; ignore silencieusement toute valeur hors énumération. */
  setLevel(s: string): void {
    const normalized = (s || '').toUpperCase();
    if (['LOW','MEDIUM','HIGH','CRITICAL'].includes(normalized)) {
      this.level.set(normalized as RiskLevel);
    }
  }
}
