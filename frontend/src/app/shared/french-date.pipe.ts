// Pipe Angular exposant frenchDate() dans les templates pour afficher une date au format français.

import { frenchDate } from './french-format';
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'frenchDate', standalone: true })
export class FrenchDatePipe implements PipeTransform {
  // Délègue le formatage à frenchDate() (date + heure optionnelle, en français).
  transform(value: string | number | Date | null | undefined, includeTime = true): string {
    return frenchDate(value, includeTime);
  }
}
