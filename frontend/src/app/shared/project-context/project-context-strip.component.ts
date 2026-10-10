import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatusChipComponent } from '../status-chip/status-chip.component';
import { SourceEvidenceLinkComponent } from '../source-evidence/source-evidence-link.component';
import { EvidenceLoadState, SourceEvidence } from '../source-evidence/source-evidence.types';

// ─────────────────────────────────────────────────────────────────────
//  <app-project-context-strip> — contexte projet persistant et COMPACT (§3).
//
//  Répond en une ligne aux premières questions d'un développeur qui arrive
//  sur l'écran : quelle branche, quel build, quel statut, quel commit, quand,
//  et par où sortir vers la preuve.
//
//  Discipline de données : chaque champ est optionnel et DISPARAÎT quand il
//  n'est pas enregistré. Aucun repli inventé, aucun « — » décoratif qui
//  laisserait croire qu'une valeur a été constatée. Le bandeau ne se répète
//  jamais dans les sous-sections : il appartient à l'en-tête de l'écran.
// ─────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-project-context-strip',
  standalone: true,
  imports: [CommonModule, StatusChipComponent, SourceEvidenceLinkComponent],
  template: `
    <div class="ctx" *ngIf="hasAnything()">
      <span class="ctx-item" *ngIf="branch">
        <span class="ctx-key">Branche</span>
        <code class="ctx-val">{{ branch }}</code>
      </span>

      <span class="ctx-item" *ngIf="buildNumber !== null">
        <span class="ctx-key">Build</span>
        <code class="ctx-val">#{{ buildNumber }}</code>
        <app-status-chip *ngIf="buildStatus" [status]="buildStatus"></app-status-chip>
      </span>

      <!-- §20/§21 — forme courte lisible, valeur complète dans title et
           derrière le bouton copier. -->
      <span class="ctx-item" *ngIf="commitFull">
        <span class="ctx-key">Commit</span>
        <code class="ctx-val" [attr.title]="commitFull">{{ commitShort() }}</code>
        <button type="button" class="ctx-copy" (click)="copy.emit(commitFull)"
                [attr.aria-label]="'Copier le commit ' + commitFull">
          <span aria-hidden="true">{{ copiedValue === commitFull ? '✓' : '⧉' }}</span>
        </button>
      </span>

      <!-- §19 — fraîcheur relative, horodatage exact en title. Jamais
           fabriquée : absente, la mention disparaît. -->
      <span class="ctx-item" *ngIf="freshness">
        <span class="ctx-key">Dernière analyse</span>
        <span class="ctx-plain" [attr.title]="timestamp">{{ freshness }}</span>
      </span>

      <span class="ctx-actions" *ngIf="repositoryEvidence || buildEvidence">
        <app-source-evidence-link *ngIf="repositoryEvidence" [item]="repositoryEvidence"
          variant="inline" [showProvider]="false" [showReason]="false" [state]="state">
        </app-source-evidence-link>
        <app-source-evidence-link *ngIf="buildEvidence" [item]="buildEvidence"
          variant="inline" [showProvider]="false" [showReason]="false" [state]="state">
        </app-source-evidence-link>
      </span>
    </div>
  `,
  styles: [`
    .ctx {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px;
      padding: 8px 14px; margin: 0 0 12px;
      border: 1px solid var(--border-color); border-radius: 6px;
      background: var(--bg-secondary); font-size: 12px;
    }
    .ctx-item { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
    .ctx-key {
      font-size: 9px; letter-spacing: .05em; text-transform: uppercase;
      color: var(--text-muted); font-family: var(--font-mono);
    }
    .ctx-val {
      font-family: var(--font-mono); font-size: 11px;
      color: var(--text-primary); overflow-wrap: anywhere;
    }
    .ctx-plain { color: var(--text-secondary); }
    .ctx-copy {
      border: 1px solid var(--border-color); background: transparent; color: var(--text-muted);
      border-radius: 3px; padding: 0 4px; font-size: 10px; cursor: pointer; font-family: inherit;
    }
    .ctx-copy:hover, .ctx-copy:focus-visible { color: var(--accent-blue); border-color: var(--accent-blue); }
    .ctx-actions { display: inline-flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-left: auto; }
    @media (max-width: 768px) {
      .ctx { gap: 6px 12px; }
      .ctx-actions { margin-left: 0; width: 100%; }
    }
  `],
})
export class ProjectContextStripComponent {
  @Input() branch: string | null = null;
  @Input() buildNumber: number | null = null;
  @Input() buildStatus: string | null = null;
  @Input() commitFull: string | null = null;
  @Input() freshness: string | null = null;
  @Input() timestamp: string | null = null;
  @Input() repositoryEvidence: SourceEvidence | null = null;
  @Input() buildEvidence: SourceEvidence | null = null;
  @Input() state: EvidenceLoadState = 'ready';
  @Input() copiedValue: string | null = null;
  @Output() copy = new EventEmitter<string>();

  /** 12 caractères : assez pour identifier, assez court pour ne pas casser la ligne. */
  commitShort(): string | null {
    return this.commitFull ? this.commitFull.slice(0, 12) : null;
  }

  /** Un bandeau sans aucun fait constaté ne s'affiche pas du tout. */
  hasAnything(): boolean {
    return !!(this.branch || this.buildNumber !== null || this.commitFull || this.freshness
      || this.repositoryEvidence || this.buildEvidence);
  }
}
