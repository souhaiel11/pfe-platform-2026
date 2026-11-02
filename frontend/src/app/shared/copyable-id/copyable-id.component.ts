// Composant d'affichage d'un identifiant technique long (digest, UUID, référence d'image) :
// montre une forme courte lisible, garde la valeur complète dans l'attribut title et un bouton copier.

import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-copyable-id',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="cid" *ngIf="value">
      <code class="cid-val" [attr.title]="value">{{ shortForm() }}</code>
      <button type="button" class="cid-copy" *ngIf="canCopy()" (click)="doCopy()"
              [attr.aria-label]="copied ? 'Copié' : ('Copier ' + (label || 'la valeur') + ' : ' + value)">
        <span aria-hidden="true">{{ copied ? '✓' : '⧉' }}</span>
      </button>
    </span>
  `,
  styles: [`
    .cid { display: inline-flex; align-items: baseline; gap: 5px; min-width: 0; max-width: 100%; }
    .cid-val {
      font-family: var(--font-mono); font-size: 11px; color: var(--text-primary);
      overflow-wrap: anywhere; min-width: 0;
    }
    .cid-copy {
      flex: 0 0 auto; border: 1px solid var(--border-color); background: transparent;
      color: var(--text-muted); border-radius: 3px; padding: 0 4px;
      font-size: 10px; line-height: 1.5; cursor: pointer; font-family: inherit;
    }
    .cid-copy:hover, .cid-copy:focus-visible { color: var(--accent-blue); border-color: var(--accent-blue); }
  `],
})
export class CopyableIdComponent {
  @Input() value: string | null = null;
  // Nombre de caractères conservés dans la forme courte.
  @Input() length = 12;
  // Nommé dans l'aria-label du bouton — « Copier le digest … ».
  @Input() label = '';
  // Préfixe gardé intact (« sha256: ») avant la troncature.
  @Input() keepPrefix = '';

  copied = false;

  // Construit la forme courte affichée : garde le préfixe connu intact, tronque le reste à `length`
  // caractères avec une ellipse ; une valeur déjà assez courte est renvoyée telle quelle.
  shortForm(): string | null {
    const raw = this.value;
    if (!raw) return null;
    const prefix = this.keepPrefix && raw.startsWith(this.keepPrefix) ? this.keepPrefix : '';
    const body = raw.slice(prefix.length);
    if (body.length <= this.length) return raw;
    return `${prefix}${body.slice(0, this.length)}…`;
  }

  // Indique si la copie est possible (valeur présente et API presse-papiers disponible).
  canCopy(): boolean {
    return !!(this.value && (navigator as any)?.clipboard?.writeText);
  }

  // Copie la valeur complète (non tronquée) dans le presse-papiers et affiche brièvement une confirmation visuelle.
  doCopy() {
    const raw = this.value;
    if (!raw) return;
    const clipboard = (navigator as any)?.clipboard;
    if (!clipboard?.writeText) return;
    clipboard.writeText(raw).then(
      () => { this.copied = true; setTimeout(() => { this.copied = false; }, 1600); },
      () => { this.copied = false; },
    );
  }
}
