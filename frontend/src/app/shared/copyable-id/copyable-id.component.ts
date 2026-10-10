import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// ─────────────────────────────────────────────────────────────────────
//  <app-copyable-id> — un identifiant technique long, sans casser la mise
//  en page (§20) et avec une copie là où elle sert vraiment (§21).
//
//  Un digest sha256 fait 71 caractères, un UUID 36, une référence d'image
//  publiée davantage encore. Collés tels quels dans une <dd> ou une cellule,
//  ils débordent de la grille et poussent la colonne voisine hors de l'écran
//  — c'est exactement ce que §23 interdit. Mais les tronquer SANS donner
//  accès à la valeur complète casse l'auditabilité : un digest à moitié lu
//  ne prouve rien.
//
//  Donc les deux : forme courte lisible à l'écran, valeur intégrale dans
//  l'attribut `title` ET derrière le bouton copier.
//
//  Discipline de données : une valeur absente n'affiche RIEN (pas de « — »
//  décoratif, pas de bouton copier inerte). Un appelant qui veut dire
//  « non disponible » l'écrit lui-même, car lui seul sait si l'absence est
//  un échec de lecture ou une donnée jamais enregistrée (§17).
// ─────────────────────────────────────────────────────────────────────

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
  /** Nombre de caractères conservés dans la forme courte. */
  @Input() length = 12;
  /** Nommé dans l'aria-label du bouton — « Copier le digest … ». */
  @Input() label = '';
  /** Préfixe gardé intact (« sha256: ») avant la troncature. */
  @Input() keepPrefix = '';

  copied = false;

  /**
   * Forme courte. Une valeur déjà assez courte n'est JAMAIS tronquée ni
   * suffixée d'une ellipse qui laisserait croire qu'il manque quelque chose.
   */
  shortForm(): string | null {
    const raw = this.value;
    if (!raw) return null;
    const prefix = this.keepPrefix && raw.startsWith(this.keepPrefix) ? this.keepPrefix : '';
    const body = raw.slice(prefix.length);
    if (body.length <= this.length) return raw;
    return `${prefix}${body.slice(0, this.length)}…`;
  }

  /** Pas de bouton inerte sur un navigateur sans presse-papiers. */
  canCopy(): boolean {
    return !!(this.value && (navigator as any)?.clipboard?.writeText);
  }

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
