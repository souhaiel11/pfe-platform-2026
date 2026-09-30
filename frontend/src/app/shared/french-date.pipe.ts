import { frenchDate } from './french-format';
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'frenchDate', standalone: true })
export class FrenchDatePipe implements PipeTransform {
  transform(value: string | number | Date | null | undefined, includeTime = true): string {
    return frenchDate(value, includeTime);
  }
}
