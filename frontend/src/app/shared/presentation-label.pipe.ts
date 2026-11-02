// Pipes Angular exposant les traducteurs de status-labels.ts (presentationLabel/presentationText) dans les templates.

import { Pipe, PipeTransform } from '@angular/core';
import { presentationLabel } from './status-labels';

@Pipe({ name: 'presentationLabel', standalone: true })
export class PresentationLabelPipe implements PipeTransform {
  // Traduit une valeur technique brute en libellé français court via presentationLabel().
  transform(value: unknown): string { return presentationLabel(value == null ? null : String(value)); }
}

import { presentationText } from './status-labels';
@Pipe({ name: 'presentationText', standalone: true })
export class PresentationTextPipe implements PipeTransform {
  // Traduit une valeur technique brute en texte français via presentationText().
  transform(value: unknown): string { return presentationText(value); }
}
