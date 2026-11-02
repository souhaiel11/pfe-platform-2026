// Gère l’affichage et les actions de zone libellé.
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// ───────────────────────────────────────────────────────────────────── <app-zone-label> — déclare la NATURE d'une zone d'écran.

export type ZoneKind = 'information' | 'action';

@Component({
  selector: 'app-zone-label',
  standalone: true,
  imports: [CommonModule],
  template: `
    <p class="zl" [attr.data-kind]="kind">
      <span class="zl-tag">
        <span class="zl-glyph" aria-hidden="true">{{ kind === 'action' ? '◆' : '◇' }}</span>
        {{ kind === 'action' ? 'Action' : 'Information' }}
      </span>
      <span class="zl-note" *ngIf="note">{{ note }}</span>
    </p>
  `,
  styles: [`
    .zl {
      display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px;
      margin: 0 0 12px; font-size: 11px; line-height: 1.5;
    }
    .zl-tag {
      display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto;
      padding: 2px 9px; border-radius: 999px;
      font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
      font-family: var(--font-mono);
      border: 1px solid currentColor;
    }
    .zl-glyph { font-size: 9px; }
    /* Repère non chromatique : le glyphe (◇ creux / ◆ plein) et le libellé
       portent la distinction, la couleur ne fait que la renforcer (§24). */
    .zl[data-kind="information"] .zl-tag { color: var(--text-muted); background: var(--bg-tertiary); }
    .zl[data-kind="action"]      .zl-tag { color: var(--accent-blue); background: var(--accent-blue-bg); }
    .zl-note { color: var(--text-muted); min-width: 0; }
  `],
})
export class ZoneLabelComponent {
  @Input() kind: ZoneKind = 'information';
  /** Phrase courte : ce qu'on lit ici, ou ce qu'on y engage. */
  @Input() note = '';
}
