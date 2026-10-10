import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EvidenceLoadState, SourceEvidence, isAbbreviated, providerLabel, shortIdentifier } from './source-evidence.types';

// ─────────────────────────────────────────────────────────────────────
//  <app-source-evidence-link> — rendu d'UN emplacement de preuve.
//
//  Trois états, et seulement trois (voir source-evidence.types.ts) :
//
//    LINK        → lien externe « <libellé> ↗ », nouvelle fenêtre,
//                  rel="noopener noreferrer".
//    PATH_ONLY   → chemin/identifiant EXACT en police mono, NON cliquable,
//                  accompagné du motif d'absence d'URL. C'est le cas qui
//                  justifie ce composant : un chemin de rapport dans le
//                  workspace du build est une source exacte, mais ce n'est
//                  pas une adresse ; en faire un lien serait un faux.
//    UNAVAILABLE → « Source non disponible », jamais un lien vers l'accueil
//                  de l'outil en guise de preuve.
//
//  Le composant ne compose ni ne complète jamais une URL : il affiche
//  `item.url` tel que le backend l'a dérivé et assaini.
//
//  Usage :
//    <app-source-evidence-link [item]="evidence('JENKINS_BUILD')">
//    <app-source-evidence-link [item]="..." variant="inline">
// ─────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-source-evidence-link',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Chargement : aucune affirmation. Un squelette ne dit rien, ce qui est
         exactement ce qu'on sait à cet instant. -->
    <span *ngIf="state === 'loading'" class="sev-skeleton" aria-hidden="true"></span>
    <span *ngIf="state === 'loading'" class="sev-sr" role="status">Chargement de la source…</span>

    <!-- Échec de requête : JAMAIS présenté comme une absence de preuve. La
         source existe peut-être ; c'est l'appel qui n'a pas abouti. -->
    <span *ngIf="state === 'error'" class="sev-error">
      <span aria-hidden="true">⚠</span>
      <span>Source non chargée</span>
      <button *ngIf="retryable" type="button" class="sev-retry" (click)="retry.emit()">Réessayer</button>
    </span>

    <ng-container *ngIf="state === 'ready'">
    <ng-container *ngIf="item; else missing">
      <!-- Lien externe exact -->
      <a *ngIf="item.availability === 'LINK'"
         class="sev-link" [class.sev-inline]="variant === 'inline'"
         [href]="item.url" target="_blank" rel="noopener noreferrer"
         [attr.title]="titleFor(item)">
        <span class="sev-provider" *ngIf="showProvider">{{ providerLabel(item.provider) }}</span>
        <span class="sev-label">{{ item.label }}</span>
        <span class="sev-ext" aria-hidden="true">↗</span>
        <span class="sev-sr">(s’ouvre dans un nouvel onglet)</span>
      </a>

      <!-- Chemin de source connu, sans URL : affiché, jamais cliquable -->
      <span *ngIf="item.availability === 'PATH_ONLY'"
            class="sev-path" [class.sev-inline]="variant === 'inline'">
        <span class="sev-provider" *ngIf="showProvider">{{ providerLabel(item.provider) }}</span>
        <span class="sev-path-label">{{ item.label }}</span>
        <!-- §20 — forme abrégée seulement pour une empreinte opaque ; la
             valeur complète reste dans title et derrière le bouton copier. -->
        <code class="sev-path-value" [attr.title]="isAbbreviated(item.sourcePath) ? item.sourcePath : null">{{ shortIdentifier(item.sourcePath) }}</code>
        <!-- §21 — copier là où c'est réellement utile : un chemin ou une
             empreinte qu'on va coller dans un terminal. -->
        <button type="button" class="sev-copy" (click)="copy(item.sourcePath)"
                [attr.aria-label]="'Copier ' + item.label">
          <span aria-hidden="true">{{ copied === item.sourcePath ? '✓' : '⧉' }}</span>
        </button>
        <span class="sev-reason" *ngIf="showReason && item.reason">{{ item.reason }}</span>
      </span>

      <!-- Aucune information de source -->
      <span *ngIf="item.availability === 'UNAVAILABLE'"
            class="sev-none" [class.sev-inline]="variant === 'inline'"
            [attr.title]="item.reason">
        <span class="sev-provider" *ngIf="showProvider">{{ providerLabel(item.provider) }}</span>
        <span class="sev-path-label">{{ item.label }}</span>
        <span class="sev-none-value">Source non disponible</span>
        <span class="sev-reason" *ngIf="showReason && item.reason">{{ item.reason }}</span>
      </span>
    </ng-container>

    </ng-container>

    <ng-template #missing>
      <span class="sev-none" [class.sev-inline]="variant === 'inline'">
        <span class="sev-none-value">Source non disponible</span>
      </span>
    </ng-template>
  `,
  styles: [`
    :host { display: contents; }
    .sev-link, .sev-path, .sev-none {
      display: inline-flex; align-items: baseline; gap: 6px;
      font-size: 12px; line-height: 1.5; max-width: 100%;
    }
    .sev-link.sev-inline, .sev-path.sev-inline, .sev-none.sev-inline { font-size: 11px; }
    .sev-provider {
      flex: 0 0 auto; font-size: 9px; letter-spacing: .04em; text-transform: uppercase;
      font-family: var(--font-mono); color: var(--text-muted);
      border: 1px solid var(--border-color); border-radius: 3px; padding: 1px 5px;
    }
    .sev-link {
      color: var(--accent-blue); text-decoration: none;
      border-bottom: 1px solid transparent; transition: border-color .12s ease;
    }
    .sev-link:hover, .sev-link:focus-visible { border-bottom-color: currentColor; }
    .sev-link .sev-label { font-weight: 500; }
    .sev-ext { flex: 0 0 auto; font-size: 11px; opacity: .75; }
    .sev-path-label { color: var(--text-secondary); }
    .sev-path-value {
      font-family: var(--font-mono); font-size: 11px; color: var(--text-primary);
      background: var(--bg-tertiary); border: 1px solid var(--border-color);
      border-radius: 3px; padding: 1px 5px;
      overflow-wrap: anywhere; word-break: break-all;
    }
    .sev-none-value { color: var(--text-muted); font-style: italic; }
    .sev-copy {
      flex: 0 0 auto; border: 1px solid var(--border-color); background: transparent;
      color: var(--text-muted); border-radius: 3px; padding: 0 4px; cursor: pointer;
      font-size: 10px; line-height: 1.5; font-family: inherit;
    }
    .sev-copy:hover, .sev-copy:focus-visible { color: var(--accent-blue); border-color: var(--accent-blue); }
    .sev-reason {
      display: block; flex-basis: 100%; margin-top: 2px;
      font-size: 10px; color: var(--text-muted);
    }
    .sev-sr {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip: rect(0 0 0 0); white-space: nowrap;
    }
    /* Squelette : n'affiche ni 0, ni « indisponible », pendant le chargement. */
    .sev-skeleton {
      display: inline-block; width: 11ch; height: 11px; border-radius: 3px;
      background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-hover) 50%, var(--bg-tertiary) 75%);
      background-size: 240% 100%; animation: sev-shimmer 1.3s ease-in-out infinite;
    }
    @keyframes sev-shimmer { 0% { background-position: 150% 0; } 100% { background-position: -50% 0; } }
    @media (prefers-reduced-motion: reduce) { .sev-skeleton { animation: none; } }
    .sev-error {
      display: inline-flex; align-items: baseline; gap: 6px;
      font-size: 11px; color: var(--color-warning);
    }
    .sev-retry {
      border: 1px solid currentColor; background: transparent; color: inherit;
      border-radius: 3px; padding: 0 6px; font-size: 10px; cursor: pointer;
      font-family: inherit;
    }
    .sev-retry:hover { background: var(--bg-hover); }
  `],
})
export class SourceEvidenceLinkComponent {
  @Input() item: SourceEvidence | null = null;
  /**
   * État du CHARGEMENT, distinct de la disponibilité de la preuve. Par défaut
   * `ready` : un appelant qui ne suit pas d'état de chargement garde le
   * comportement d'origine.
   */
  @Input() state: EvidenceLoadState = 'ready';
  @Input() retryable = false;
  @Output() retry = new EventEmitter<void>();
  /** `inline` = densité réduite, pour une cellule de tableau ou une puce. */
  @Input() variant: 'default' | 'inline' = 'default';
  /** Pastille du fournisseur — masquée quand le contexte le dit déjà. */
  @Input() showProvider = true;
  /** Motif d'absence d'URL — masqué dans les contextes très denses. */
  @Input() showReason = true;

  providerLabel = providerLabel;
  shortIdentifier = shortIdentifier;
  isAbbreviated = isAbbreviated;
  /** Dernière valeur copiée — pilote l'accusé de réception visuel. */
  copied: string | null = null;

  /**
   * Copie la valeur COMPLÈTE, jamais la forme abrégée. Un échec reste
   * silencieux côté visuel (pas d'accusé) : on ne prétend pas avoir copié.
   */
  copy(value: string | null) {
    if (!value) return;
    const clipboard = (navigator as any)?.clipboard;
    if (!clipboard?.writeText) return;
    clipboard.writeText(value).then(
      () => { this.copied = value; setTimeout(() => { if (this.copied === value) this.copied = null; }, 1600); },
      () => { this.copied = null; },
    );
  }

  titleFor(item: SourceEvidence): string {
    const parts = [providerLabel(item.provider)];
    if (item.sourcePath) parts.push(item.sourcePath);
    if (item.buildNumber !== null) parts.push(`build #${item.buildNumber}`);
    if (item.commitSha) parts.push(`commit ${item.commitSha}`);
    return parts.join(' — ');
  }
}
