import { Injectable, signal } from '@angular/core';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

@Injectable({ providedIn: 'root' })
export class RiskStateService {
  readonly level = signal<RiskLevel>('LOW');

  setLevel(s: string): void {
    const normalized = (s || '').toUpperCase();
    if (['LOW','MEDIUM','HIGH','CRITICAL'].includes(normalized)) {
      this.level.set(normalized as RiskLevel);
    }
  }
}
