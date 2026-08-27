import { Pipe, PipeTransform } from '@angular/core';
import { stageStatusLabel } from './status-labels';

// Présentation uniquement (voir status-labels.ts) : {{ status | stageStatusLabel }}
@Pipe({ name: 'stageStatusLabel', standalone: true })
export class StageStatusLabelPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return stageStatusLabel(value);
  }
}
