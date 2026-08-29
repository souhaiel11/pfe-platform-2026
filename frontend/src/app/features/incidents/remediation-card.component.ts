import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PresentationLabelPipe } from '../../shared/presentation-label.pipe';

// ─────────────────────────────────────────────────────────────────────────
//  Composant de remédiation unifié — Couche 2.
//  Ne CORRIGE rien lui-même, n'appelle AUCUN backend : affiche erreurs +
//  proposition/conseil, gère UNIQUEMENT l'état local de sélection (cases à
//  cocher), et délègue toute action réseau au parent via (correct) —
//  chaque phase sait déjà appeler son propre workflow (WF4/WF5/WF2
//  existent, prouvés, ce composant ne fait qu'unifier leur présentation).
//
//  3 modes, jamais devinés ici — décidés par l'appelant à partir du TYPE de
//  la phase (voir PHASE_MODE / remediationModeForPhase, jenkins-known-fixes.ts) :
//
//    - 'auto-fix-selective' (Jenkins/WF4, Docker/WF5) : issues avec case à
//      cocher (retain/discard, patron repris tel quel de
//      jenkinsfile-optimizer.component.ts), récap "X / Y retenues", bouton
//      qui émet (correct) avec le Set des ids retenus.
//    - 'auto-fix-bulk' (SonarQube/WF2) : issues en LECTURE seule (WF2 ne
//      sait pas encore cibler une correction par issue précise — décision
//      assumée, note affichée honnêtement), bouton unique qui émet
//      (correct) sans sélection (correction sur l'ensemble).
//    - 'signal-only' (OWASP/Trivy/ZAP) : JAMAIS de bouton. Garde-fou en dur
//      dans le template, non paramétrable — une vulnérabilité ne doit
//      jamais pouvoir déclencher une correction automatique.
// ─────────────────────────────────────────────────────────────────────────

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
  imports: [CommonModule, PresentationLabelPipe],
  template: `
    <div class="card rc-card">
      <div class="card-header" style="margin-bottom:12px;">
        <span class="card-title">{{ phaseLabel }}</span>
      </div>

      <div *ngFor="let i of issues" class="rc-issue">
        <div style="display:flex;align-items:flex-start;gap:8px;">
          <input *ngIf="mode === 'auto-fix-selective'" type="checkbox"
                 class="rc-check" [checked]="isSelected(i.id)"
                 [disabled]="i.remediationType !== 'AUTO_FIX_ELIGIBLE'"
                 (change)="toggle(i.id)" [attr.aria-label]="'Retenir ' + i.id" />
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;margin-bottom:4px;">
              <span *ngIf="i.severity" class="sev" [attr.data-sev]="sevKey(i.severity)">{{ i.severity | presentationLabel }}</span>
              <strong>{{ i.title }}</strong>
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

      <!-- Bouton d'action — modes auto-fix uniquement -->
      <button *ngIf="mode === 'auto-fix-selective'" class="jo-btn"
              [disabled]="correcting || (issues.length > 0 && selected.size === 0)"
              (click)="emitCorrect()">
        {{ correcting ? 'Lancement…' : actionLabel }}
      </button>
      <button *ngIf="mode === 'auto-fix-bulk'" class="jo-btn" [disabled]="correcting"
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
    .rc-guard { font-size: 11px; color: var(--text-secondary); }
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
  @Output() correct = new EventEmitter<Set<string>>();

  selected = new Set<string>();

  // Nouvelle liste d'issues (ex: résultat frais d'optimize()) -> tout
  // retenu par défaut, comme le patron jenkinsfile-optimizer.component.ts
  // (voir applyResult -> defaultSelected).
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['issues']) {
      this.selected = new Set();
    }
  }

  isSelected(id: string): boolean { return this.selected.has(id); }
  toggle(id: string): void {
    const issue = this.issues.find(i => i.id === id);
    if (issue?.remediationType !== 'AUTO_FIX_ELIGIBLE') return;
    const next = new Set(this.selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selected = next;
  }
  emitCorrect(): void { this.correct.emit(this.selected); }

  sevKey(s: string): string {
    const u = String(s || '').toUpperCase();
    if (u === 'CRITICAL' || u === 'CRITIQUE' || u === 'BLOCKER') return 'critical';
    if (u === 'HIGH' || u === 'ELEVE' || u === 'ÉLEVÉ' || u === 'MAJOR') return 'high';
    if (u === 'MEDIUM' || u === 'MOYEN' || u === 'MINOR') return 'medium';
    return 'low';
  }
}
