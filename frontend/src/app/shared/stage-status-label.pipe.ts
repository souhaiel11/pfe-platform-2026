// Pipe Angular exposant stageStatusLabel() dans les templates : {{ status | stageStatusLabel }}

import { Pipe, PipeTransform } from '@angular/core';
import { stageStatusLabel } from './status-labels';

@Pipe({ name: 'stageStatusLabel', standalone: true })
export class StageStatusLabelPipe implements PipeTransform {
  // Traduit un statut technique brut en libellé français via stageStatusLabel().
  transform(value: string | null | undefined): string {
    return stageStatusLabel(value);
  }
}
