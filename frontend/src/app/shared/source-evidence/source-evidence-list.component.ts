import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SourceEvidenceLinkComponent } from './source-evidence-link.component';
import { EvidenceLoadState, EvidenceSection, SourceEvidence } from './source-evidence.types';

// ─────────────────────────────────────────────────────────────────────
//  <app-source-evidence-list> — bloc « Sources & preuves ».
//
//  Rend les SECTIONS fournies par le backend, dans l'ordre fourni. Les
//  sections représentent des ÉTAPES de preuve distinctes (constat d'origine,
//  correctif vérifié, livraison…) et ne sont jamais fusionnées en une
//  « Source » unique : ce sont des faits différents, vérifiables séparément.
//
//  Une section dont AUCUN emplacement ne porte d'information est masquée par
//  défaut (`hideEmptySections`), pour ne pas noyer la vue sous des « Source
//  non disponible ». Le bloc le dit alors explicitement plutôt que de
//  disparaître sans explication.
// ─────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-source-evidence-list',
  standalone: true,
  imports: [CommonModule, SourceEvidenceLinkComponent],
  template: `
    <section class="sev-block" *ngIf="state !== 'ready' || sections?.length">
      <header class="sev-block-head" *ngIf="title">
        <h4 class="sev-block-title">{{ title }}</h4>
        <p class="sev-block-note" *ngIf="note && state === 'ready'">{{ note }}</p>
      </header>

      <!-- Chargement : des squelettes, jamais un état vide provisoire qui
           ressemblerait à « aucune source ». -->
      <ul class="sev-items" *ngIf="state === 'loading'" aria-busy="true">
        <li class="sev-item" *ngFor="let i of [1,2,3]">
          <app-source-evidence-link state="loading"></app-source-evidence-link>
        </li>
      </ul>

      <!-- Échec de requête ≠ absence de preuve (§17). On le dit, et on offre
           l'action qui peut le résoudre. -->
      <div class="sev-block-error" *ngIf="state === 'error'" role="alert">
        <p>Impossible de charger les sources de cet élément.</p>
        <button type="button" class="sev-block-retry" (click)="retry.emit()">Réessayer</button>
      </div>

      <div class="sev-section" *ngFor="let section of visibleSections()" [hidden]="state !== 'ready'">
        <div class="sev-section-title">{{ section.title }}</div>
        <ul class="sev-items">
          <li class="sev-item" *ngFor="let slot of section.slots">
            <app-source-evidence-link
              [item]="slotOf(slot)"
              [showProvider]="showProvider"
              [showReason]="showReason">
            </app-source-evidence-link>
          </li>
        </ul>
      </div>

      <!-- Vide discret (§15/§16) : une preuve facultative absente n'est pas un
           problème, et ne doit pas occuper l'écran comme s'il s'agissait d'une
           erreur. On ne laisse pas croire au succès pour autant. -->
      <p class="sev-block-empty" *ngIf="state === 'ready' && !visibleSections().length">
        Aucune source n’a été enregistrée pour cet élément.
      </p>
    </section>
  `,
  styles: [`
    .sev-block {
      border: 1px solid var(--border-color); border-radius: 6px;
      background: var(--bg-secondary); padding: 14px 16px;
    }
    .sev-block-head { margin-bottom: 10px; }
    .sev-block-title {
      margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .03em;
      text-transform: uppercase; color: var(--text-secondary);
    }
    .sev-block-note { margin: 4px 0 0; font-size: 11px; color: var(--text-muted); }
    .sev-section + .sev-section { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-color); }
    .sev-section-title {
      font-size: 10px; font-family: var(--font-mono); letter-spacing: .05em;
      text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;
    }
    .sev-items { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .sev-item { display: flex; flex-wrap: wrap; align-items: baseline; }
    .sev-block-empty { margin: 0; font-size: 11px; color: var(--text-muted); font-style: italic; }
    .sev-block-error { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .sev-block-error p { margin: 0; font-size: 12px; color: var(--color-warning); }
    .sev-block-retry {
      border: 1px solid var(--color-warning); background: transparent; color: var(--color-warning);
      border-radius: 4px; padding: 2px 10px; font-size: 11px; cursor: pointer; font-family: inherit;
    }
    .sev-block-retry:hover { background: var(--bg-hover); }
  `],
})
export class SourceEvidenceListComponent {
  @Input() title: string | null = 'Sources & preuves';
  @Input() note: string | null = null;
  @Input() sections: EvidenceSection[] | null = null;
  @Input() slots: Record<string, SourceEvidence> | null = null;
  @Input() showProvider = true;
  @Input() showReason = false;
  /** Masque les sections entièrement dépourvues d'information de source. */
  @Input() hideEmptySections = true;
  /** État du chargement, distinct de la disponibilité des preuves (§17/§18). */
  @Input() state: EvidenceLoadState = 'ready';
  @Output() retry = new EventEmitter<void>();

  slotOf(slot: string): SourceEvidence | null {
    return (this.slots && this.slots[slot]) || null;
  }

  visibleSections(): EvidenceSection[] {
    const sections = this.sections || [];
    if (!this.hideEmptySections) return sections;
    return sections.filter(section =>
      (section.slots || []).some(slot => {
        const item = this.slotOf(slot);
        return !!item && item.availability !== 'UNAVAILABLE';
      }));
  }
}
