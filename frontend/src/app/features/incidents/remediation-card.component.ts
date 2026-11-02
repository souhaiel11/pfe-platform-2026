// Gère l’affichage et les actions de correction card.
import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PresentationLabelPipe } from '../../shared/presentation-label.pipe';
import { SourceEvidenceLinkComponent } from '../../shared/source-evidence/source-evidence-link.component';
import { SourceEvidence } from '../../shared/source-evidence/source-evidence.types';

/**
 * Composant de remédiation unifié : affiche les issues d'une phase et gère
 * uniquement la sélection locale (cases à cocher) selon son mode
 * ('auto-fix-selective', 'auto-fix-bulk' ou 'signal-only', décidé par
 * l'appelant) ; délègue toute action réseau au parent via (correct).
 */
export type RemediationMode = 'auto-fix-selective' | 'auto-fix-bulk' | 'signal-only';

export interface RemediationIssue {
  id: string;
  title: string;
  detail?: string | null;
  severity?: string | null;
  stage?: string | null;
  source?: string | null;
  blocking?: boolean;
  rootCause?: string | null;
  impact?: string | null;
  file?: string | null;
  line?: number | null;
  recommendation?: string | null;
  remediationType?: 'AUTO_FIX_ELIGIBLE' | 'DEVELOPER_ACTION_REQUIRED' | string;
}

@Component({
  selector: 'app-remediation-card',
  standalone: true,
  imports: [CommonModule, PresentationLabelPipe, SourceEvidenceLinkComponent],
  template: `
    <div class="card rc-card">
      <div class="card-header" style="margin-bottom:12px;">
        <span class="card-title">{{ phaseLabel }}</span>
      </div>

      <div *ngFor="let i of issues" class="rc-issue" [class.rc-validated]="isValidated(i.id)">
        <div style="display:flex;align-items:flex-start;gap:8px;">
          <input *ngIf="mode === 'auto-fix-selective'" type="checkbox"
                 class="rc-check" [class.rc-check-validated]="isValidated(i.id)"
                 [checked]="isValidated(i.id) || isSelected(i.id)"
                 [disabled]="isValidated(i.id) || locked || i.remediationType !== 'AUTO_FIX_ELIGIBLE'"
                 (change)="toggle(i.id)" [attr.aria-label]="'Retenir ' + i.id" />
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;margin-bottom:4px;">
              <span *ngIf="i.severity" class="sev" [attr.data-sev]="sevKey(i.severity)">{{ i.severity | presentationLabel }}</span>
              <strong>{{ i.title }}</strong>
              <span *ngIf="isValidated(i.id)" class="rc-badge-validated">{{ mergeReady ? '✓ Correction validée' : '✓ Validée' }}</span>
              <span *ngIf="isValidated(i.id) && mergeReady" class="rc-badge-pending">En attente de fusion</span>
              <a *ngIf="isValidated(i.id) && prUrl" class="rc-pr-link" [href]="prUrl" target="_blank" rel="noopener noreferrer">{{ prLabel || 'Voir la Pull Request' }}</a>
            </div>
            <div *ngIf="i.detail" class="rc-detail">{{ i.detail }}</div>
            <div class="rc-meta" *ngIf="i.stage || i.source || i.remediationType">
              <span *ngIf="i.stage">Étape : {{ i.stage | presentationLabel }}</span>
              <span *ngIf="i.source">Source : {{ i.source | presentationLabel }}</span>
              <span>{{ i.blocking ? 'Bloquant' : 'Non bloquant' }}</span>
              <span *ngIf="i.remediationType">{{ i.remediationType | presentationLabel }}</span>
            </div>
            <div *ngIf="i.rootCause"><strong>Cause :</strong> {{ i.rootCause }}</div>
            <div *ngIf="i.impact"><strong>Impact :</strong> {{ i.impact }}</div>
            <div *ngIf="i.file" class="mono">{{ i.file }}<span *ngIf="i.line">:{{ i.line }}</span></div>
            <div *ngIf="i.recommendation"><strong>Recommandation :</strong> {{ i.recommendation }}</div>
          </div>
        </div>
      </div>
      <p *ngIf="!issues.length" class="rc-empty">Aucune erreur détectée pour cette phase.</p>

      <div *ngIf="advice" class="rc-advice">{{ advice }}</div>

      <!-- Récap sélection — mode sélectif uniquement -->
      <div *ngIf="mode === 'auto-fix-selective' && issues.length" class="rc-recap">
        <strong class="mono">{{ selected.size }}</strong> / {{ issues.length }} {{ issues.length === 1 ? 'correction retenue' : 'corrections retenues' }}
      </div>

      <!-- Note honnête — mode bulk : pas de sélection fine pour l'instant -->
      <p *ngIf="mode === 'auto-fix-bulk' && issues.length" class="rc-note">
        La correction porte sur l’ensemble des problèmes ci-dessus.
      </p>

      <!-- Mode signal-only : garde-fou fixe, non paramétrable, jamais de bouton -->
      <div *ngIf="mode === 'signal-only'" class="rc-guard">
        Action développeur — le correctif relève du code ou des dépendances, pas d'une
        correction automatique de pipeline ou de fichier.
      </div>

      <!-- Verrou de cycle de vie — une PR de correction existe déjà pour cet
           incident : aucune nouvelle demande n'est possible (modèle backend
           un incident → une PR). Décidé par le parent, jamais deviné ici.
           La provenance PR (lien cliquable) reste visible dans tous les cas. -->
      <p *ngIf="(locked && lockedNote) || prUrl" class="rc-note">
        <ng-container *ngIf="locked && lockedNote">{{ lockedNote }} </ng-container>
        <a *ngIf="prUrl" class="rc-pr-link" [href]="prUrl" target="_blank" rel="noopener noreferrer">{{ prLabel || 'Voir la Pull Request' }}</a>
      </p>

      <!-- Sources de la phase — d'où viennent ces constats : le rapport de
           scanner qui les a produits et le build qui l'a exécuté. Affichées
           seulement quand elles existent réellement. -->
      <div *ngIf="presentSources().length" class="rc-sources">
        <span class="rc-sources-label">Sources</span>
        <app-source-evidence-link *ngFor="let src of presentSources()"
          [item]="src" variant="inline" [showProvider]="false" [showReason]="false">
        </app-source-evidence-link>
      </div>

      <!-- Bouton d'action — modes auto-fix uniquement, jamais quand verrouillé -->
      <button *ngIf="mode === 'auto-fix-selective' && !locked" class="jo-btn"
              [disabled]="correcting || (issues.length > 0 && selected.size === 0)"
              (click)="emitCorrect()">
        {{ correcting ? 'Lancement…' : actionLabel }}
      </button>
      <button *ngIf="mode === 'auto-fix-bulk' && !locked" class="jo-btn" [disabled]="correcting"
              (click)="emitCorrect()">
        {{ correcting ? 'Lancement…' : actionLabel }}
      </button>
    </div>
  `,
  styles: [`
    .rc-card { margin-bottom: 16px; }
    .rc-issue + .rc-issue { margin-top: 10px; }
    .rc-check { margin-top: 2px; flex-shrink: 0; width: 14px; height: 14px; cursor: pointer; }
    .rc-detail {
      font-family: var(--font-mono); font-size: 11px; color: var(--accent-orange);
      background: var(--bg-primary); padding: 10px 12px; border-radius: var(--radius-sm);
      white-space: pre-wrap; margin-top: 4px;
    }
    .rc-empty { font-size: 12px; color: var(--text-secondary); }
    .rc-advice { font-size: 12px; color: var(--accent-green); line-height: 1.6; margin: 8px 0; }
    .rc-recap { font-size: 12px; margin: 12px 0 8px; }
    .rc-note { font-size: 11px; color: var(--text-secondary); font-style: italic; margin: 10px 0; }
    .rc-sources { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; margin: 10px 0; }
    .rc-sources-label { font-size: 9px; letter-spacing: .05em; text-transform: uppercase; font-family: var(--font-mono); color: var(--text-muted); }
    .rc-guard { font-size: 11px; color: var(--text-secondary); }
    .rc-validated .rc-detail { color: var(--accent-green); }
    .rc-check-validated { accent-color: var(--accent-green); }
    .rc-badge-validated {
      display: inline-block; margin-left: 6px; font-size: 9.5px; font-weight: 800;
      letter-spacing: .04em; padding: 2px 7px; border-radius: 999px;
      background: var(--accent-green-bg); color: var(--accent-green);
    }
    .rc-badge-pending {
      display: inline-block; margin-left: 6px; font-size: 9.5px; font-weight: 700;
      padding: 2px 7px; border-radius: 999px; color: var(--text-secondary);
      border: 1px solid var(--border);
    }
    .rc-pr-link {
      display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 700;
      padding: 2px 7px; border-radius: 999px; text-decoration: none;
      background: var(--accent-blue-bg); color: var(--accent-blue);
    }
    .rc-pr-link:hover { text-decoration: underline; }
    .rc-meta { display:flex;gap:8px;flex-wrap:wrap;font-size:10px;color:var(--text-secondary);margin:5px 0; }
    .mono { font-family: var(--font-mono); }
    .sev {
      display: inline-block; font-size: 9.5px; font-weight: 800; letter-spacing: .06em;
      text-transform: uppercase; padding: 2px 7px; border-radius: 3px; margin-right: 6px;
    }
    .sev[data-sev='critical'] { background: rgba(220,38,38,.13); color: var(--accent-red); }
    .sev[data-sev='high']     { background: rgba(234,88,12,.13); color: var(--accent-orange); }
    .sev[data-sev='medium']   { background: rgba(202,138,4,.15); color: #ca8a04; }
    .sev[data-sev='low']      { background: rgba(127,127,127,.12); opacity: .8; }
  `],
})
export class RemediationCardComponent implements OnChanges {
  @Input() phaseLabel = '';
  @Input() mode: RemediationMode = 'signal-only';
  @Input() issues: RemediationIssue[] = [];
  @Input() advice: string | null = null;
  @Input() actionLabel = 'Corriger';
  @Input() correcting = false;
  @Input() locked = false;
  @Input() lockedNote: string | null = null;
  @Input() validatedIds: readonly string[] | Set<string> = [];
  @Input() prUrl: string | null = null;
  @Input() prLabel = '';
  @Input() mergeReady = false;

  @Input() sources: (SourceEvidence | null)[] = [];

  /** Ne garde que les preuves de source réellement disponibles (jamais une preuve "indisponible" affichée comme si elle existait). */
  presentSources(): SourceEvidence[] {
    return (this.sources || []).filter((s): s is SourceEvidence => !!s && s.availability !== 'UNAVAILABLE');
  }
  @Output() correct = new EventEmitter<Set<string>>();

  selected = new Set<string>();

  /** Réinitialise la sélection quand une nouvelle liste d'issues arrive (rien n'est retenu par défaut). */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['issues']) {
      this.selected = new Set();
    }
  }

  /** Vrai si cette issue est actuellement cochée pour correction. */
  isSelected(id: string): boolean { return this.selected.has(id); }
  /** Vrai si cette issue a déjà un verdict WF3 validé (Set ou tableau selon ce que fournit le parent). */
  isValidated(id: string): boolean {
    const v = this.validatedIds;
    return v instanceof Set ? v.has(id) : Array.isArray(v) && v.includes(id);
  }
  /** Coche/décoche une issue pour correction sélective — refuse les issues non éligibles ou déjà validées. */
  toggle(id: string): void {
    const issue = this.issues.find(i => i.id === id);
    if (issue?.remediationType !== 'AUTO_FIX_ELIGIBLE' || this.isValidated(id)) return;
    const next = new Set(this.selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selected = next;
  }
  /** Délègue la demande de correction au parent avec le Set des issues retenues. */
  emitCorrect(): void { this.correct.emit(this.selected); }

  /** Normalise une sévérité (française ou anglaise, variantes Sonar incluses) vers une des 4 classes d'affichage. */
  sevKey(s: string): string {
    const u = String(s || '').toUpperCase();
    if (u === 'CRITICAL' || u === 'CRITIQUE' || u === 'BLOCKER') return 'critical';
    if (u === 'HIGH' || u === 'ELEVE' || u === 'ÉLEVÉ' || u === 'MAJOR') return 'high';
    if (u === 'MEDIUM' || u === 'MOYEN' || u === 'MINOR') return 'medium';
    return 'low';
  }
}
