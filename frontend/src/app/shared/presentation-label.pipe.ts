import { Pipe, PipeTransform } from '@angular/core';
import { presentationLabel } from './status-labels';

@Pipe({ name: 'presentationLabel', standalone: true })
export class PresentationLabelPipe implements PipeTransform {
  transform(value: unknown): string { return presentationLabel(value == null ? null : String(value)); }
}
