// Bandeau compact de contexte projet (branche, build, commit, fraîcheur de la dernière analyse) affiché en en-tête d'écran.

import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatusChipComponent } from '../status-chip/status-chip.component';
import { SourceEvidenceLinkComponent } from '../source-evidence/source-evidence-link.component';
import { EvidenceLoadState, SourceEvidence } from '../source-evidence/source-evidence.types';

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

      <span class="ctx-item" *ngIf="commitFull">
        <span class="ctx-key">Commit</span>
        <code class="ctx-val" [attr.title]="commitFull">{{ commitShort() }}</code>
        <button type="button" class="ctx-copy" (click)="copy.emit(commitFull)"
                [attr.aria-label]="'Copier le commit ' + commitFull">
          <span aria-hidden="true">{{ copiedValue === commitFull ? '✓' : '⧉' }}</span>
        </button>
      </span>

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

  // Tronque le commit complet à 12 caractères pour l'affichage court.
  commitShort(): string | null {
    return this.commitFull ? this.commitFull.slice(0, 12) : null;
  }

  // Indique si au moins un champ de contexte est renseigné (sinon le bandeau ne s'affiche pas).
  hasAnything(): boolean {
    return !!(this.branch || this.buildNumber !== null || this.commitFull || this.freshness
      || this.repositoryEvidence || this.buildEvidence);
  }
}
