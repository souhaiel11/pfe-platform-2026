import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatusTone, statusGlyph, statusTone } from './status-tone';
import { stageStatusLabel } from '../status-labels';

// ─────────────────────────────────────────────────────────────────────
//  <app-status-chip> — pastille de statut unique et cohérente.
//
//  Trois canaux d'information, jamais la couleur seule (§6) :
//    glyphe  — repère non chromatique (✓ ✕ ! … – ○)
//    libellé — français humain, via la table partagée status-labels.ts
//    couleur — tonalité dérivée en UN endroit (status-tone.ts)
//
//  La valeur TECHNIQUE reste accessible sans être primaire : `showRaw`
//  l'affiche en police mono sous le libellé, et elle est toujours dans
//  l'attribut title. Le libellé humain reste l'information principale (§5).
//
//  Usage :
//    <app-status-chip [status]="build.status"></app-status-chip>
//    <app-status-chip [status]="'PROVENANCE_VERIFIED'" [showRaw]="true">
// ─────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-status-chip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="sc" [attr.data-tone]="tone()" [attr.title]="titleText()">
      <span class="sc-glyph" aria-hidden="true">{{ glyph() }}</span>
      <span class="sc-label">{{ label() }}</span>
      <code class="sc-raw" *ngIf="showRaw && rawValue()">{{ rawValue() }}</code>
    </span>
  `,
  styles: [`
    .sc {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 2px 8px; border-radius: var(--radius-sm, 4px);
      font-size: 11px; line-height: 1.6; white-space: nowrap;
      border: 1px solid currentColor; background: transparent;
    }
    .sc-glyph { font-weight: 700; font-size: 10px; }
    .sc-label { font-weight: 600; letter-spacing: .01em; }
    .sc-raw {
      font-family: var(--font-mono); font-size: 9px; opacity: .75;
      padding-left: 5px; border-left: 1px solid currentColor;
    }
    .sc[data-tone="success"]  { color: var(--accent-green); background: var(--accent-green-bg); }
    .sc[data-tone="error"]    { color: var(--accent-red); background: var(--accent-red-bg); }
    .sc[data-tone="warning"]  { color: var(--color-warning); background: var(--color-warning-bg); }
    .sc[data-tone="pending"]  { color: var(--accent-blue); background: var(--accent-blue-bg); }
    .sc[data-tone="neutral"]  { color: var(--text-muted); background: var(--bg-tertiary); }
    .sc[data-tone="disabled"] { color: var(--text-muted); background: transparent; border-style: dashed; }
  `],
})
export class StatusChipComponent {
  @Input() status: unknown = null;
  /** Libellé imposé — sinon dérivé de la table partagée. */
  @Input() labelOverride: string | null = null;
  /** Affiche la valeur canonique à côté du libellé humain (§5). */
  @Input() showRaw = false;

  tone(): StatusTone { return statusTone(this.status); }
  glyph(): string { return statusGlyph(this.tone()); }

  label(): string {
    if (this.labelOverride) return this.labelOverride;
    return stageStatusLabel(this.rawValue());
  }

  rawValue(): string | null {
    const raw = String(this.status ?? '').trim();
    return raw ? raw : null;
  }

  /** La valeur technique reste toujours consultable, même non affichée. */
  titleText(): string | null {
    const raw = this.rawValue();
    if (!raw) return null;
    const label = this.label();
    return label === raw ? raw : `${label} — ${raw}`;
  }
}
