import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'frenchDate', standalone: true })
export class FrenchDatePipe implements PipeTransform {
  transform(value: string | number | Date | null | undefined, includeTime = true): string {
    if (!value) return 'Non disponible';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Non disponible';
    return new Intl.DateTimeFormat('fr-FR', includeTime
      ? { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: 'numeric', month: 'long', year: 'numeric' }).format(date).replace(' à ', ' à ');
  }
}
