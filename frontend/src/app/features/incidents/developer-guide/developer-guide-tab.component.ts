import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeveloperGuide, DevGuideIssue, DevGuideFallbackFixOrderItem } from './developer-guide.model';
import { PresentationLabelPipe } from '../../../shared/presentation-label.pipe';

// ─────────────────────────────────────────────────────────────────────
// Onglet "Guide de correction" — page détail incident
// Usage : <app-developer-guide-tab [guide]="developerGuide" />
// où developerGuide = report.rawData?.developerGuide
// Composant autonome : aucune dépendance Material/PrimeNG requise.
// ─────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-developer-guide-tab',
  standalone: true,
  imports: [CommonModule, PresentationLabelPipe],
  template: `
    <ng-container *ngIf="guide && hasDetailedIssues(); else fallbackOrEmpty">

      <!-- ── Bandeau plan d'action ─────────────────────────────── -->
      <section class="dg-plan">
        <div class="dg-plan-head">
          <h3>Plan de correction</h3>
          <div class="dg-plan-metrics">
            <span class="dg-chip dg-chip-count">{{ guide.issues.length }} {{ guide.issues.length === 1 ? 'problème' : 'problèmes' }}</span>
            <span class="dg-chip dg-chip-time">~{{ guide.totalEstimatedMinutes }} min au total</span>
            <span class="dg-chip dg-chip-conf">confiance IA {{ (guide.confidence * 100) | number:'1.0-0' }}%</span>
          </div>
        </div>
        <p class="dg-summary">{{ summaryLabel(guide.summaryForDeveloper) }}</p>

        <div class="dg-quickwins" *ngIf="stringQuickWins().length">
          <span class="dg-qw-label">⚡ Actions rapides (&lt; 15 min) :</span>
          <button class="dg-qw-btn" *ngFor="let id of stringQuickWins()" (click)="scrollTo(id)">{{ id }}</button>
        </div>

        <ol class="dg-fixorder" *ngIf="stringFixOrder().length">
          <li *ngFor="let id of stringFixOrder()">
            <a (click)="scrollTo(id)">{{ id }}</a>
            <span class="dg-fixorder-title">{{ titleOf(id) }}</span>
          </li>
        </ol>
      </section>

      <!-- ── Fiches par problème ───────────────────────────────── -->
      <article class="dg-issue" *ngFor="let issue of sortedIssues()"
               [id]="'dg-' + issue.id"
               [class.dg-open]="isOpen(issue.id)">

        <header class="dg-issue-head" (click)="toggle(issue.id)">
          <span class="dg-priority">{{ issue.priority }}</span>
          <span class="dg-sev" [attr.data-sev]="issue.severity">{{ issue.severity | presentationLabel }}</span>
          <span class="dg-source">{{ issue.source }}</span>
          <div class="dg-issue-title">
            <strong>{{ issue.title }}</strong>
            <code *ngIf="issue.file && issue.file !== 'N/A'">
              {{ issue.file }}<ng-container *ngIf="issue.line">:{{ issue.line }}</ng-container>
            </code>
          </div>
          <span class="dg-effort">~{{ issue.estimatedEffortMinutes }} min</span>
          <span class="dg-caret">{{ isOpen(issue.id) ? '▾' : '▸' }}</span>
        </header>

        <div class="dg-issue-body" *ngIf="isOpen(issue.id)">
          <p class="dg-rule" *ngIf="issue.rule">Règle / réf : <code>{{ issue.rule }}</code></p>

          <div class="dg-block">
            <h4>Le problème</h4>
            <p>{{ issue.problem }}</p>
          </div>

          <div class="dg-block dg-block-risk">
            <h4>Pourquoi c'est important</h4>
            <p>{{ issue.whyItMatters }}</p>
          </div>

          <div class="dg-block">
            <h4>Comment corriger</h4>
            <ol class="dg-steps">
              <li *ngFor="let step of issue.howToFix">{{ step }}</li>
            </ol>
          </div>

          <div class="dg-block dg-code" *ngIf="hasCode(issue)">
            <h4>Exemple de code</h4>
            <div class="dg-code-cols">
              <div>
                <span class="dg-code-label dg-code-bad">Avant</span>
                <pre>{{ codeOf(issue)?.before }}</pre>
              </div>
              <div>
                <span class="dg-code-label dg-code-good">Après</span>
                <pre>{{ codeOf(issue)?.after }}</pre>
              </div>
            </div>
          </div>

          <div class="dg-block dg-verify">
            <h4>Vérifier le correctif</h4>
            <code class="dg-verify-cmd">{{ issue.verification }}</code>
            <button class="dg-copy" (click)="copy(issue.verification)">Copier</button>
          </div>
        </div>
      </article>
    </ng-container>

    <!-- ── Guide de secours (fallback déterministe) ─────────────
         Utilisé quand l'agent Developer Guidance (LLM) n'a pas pu produire
         de fiche détaillée par issue (issues[] vide), mais que WF1 a quand
         même généré un plan d'action déterministe (fixOrder/quickWins/
         summaryForDeveloper). Le guide existe : ne jamais afficher "aucun
         guide disponible" dans ce cas. -->
    <ng-template #fallbackOrEmpty>
      <ng-container *ngIf="hasFallbackPlan(); else empty">
        <section class="dg-plan dg-plan-fallback">
          <div class="dg-plan-head">
            <h3>Guide de correction</h3>
            <span class="dg-chip dg-chip-fallback" title="Guide généré automatiquement : l'agent IA n'a pas pu produire de fiche détaillée par problème pour ce build.">
              Plan déterministe
            </span>
          </div>
          <p class="dg-summary" *ngIf="guide?.summaryForDeveloper">{{ summaryLabel(guide?.summaryForDeveloper) }}</p>

          <div class="dg-block" *ngIf="fallbackFixOrder().length">
            <h4>Ordre de correction recommandé</h4>
            <ol class="dg-fallback-order">
              <li *ngFor="let item of fallbackFixOrder()">
                <strong>{{ fallbackText(item.title) }}</strong>
                <span class="dg-fallback-detail" *ngIf="item.detail">{{ fallbackText(item.detail) }}</span>
                <span class="dg-fallback-meta" *ngIf="item.owner || item.route">
                  <span *ngIf="item.owner">Responsable : {{ item.owner | presentationLabel }}</span>
                  <span *ngIf="item.route && item.route !== 'NONE'"> · Route : {{ item.route }}</span>
                </span>
              </li>
            </ol>
          </div>

          <div class="dg-quickwins" *ngIf="stringQuickWins().length">
            <span class="dg-qw-label">⚡ Actions rapides :</span>
            <span class="dg-qw-item" *ngFor="let w of stringQuickWins()">{{ w }}</span>
          </div>
        </section>
      </ng-container>
    </ng-template>

    <ng-template #empty>
      <div class="dg-empty">
        <p>Aucun guide de correction disponible pour cet incident.</p>
        <p class="dg-empty-hint">Le guide est généré par l’agent de conseil aux développeurs lors de l’analyse du pipeline. Il sera disponible après une nouvelle analyse.</p>
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; font-size: 14px; color: #1f2933; }

    /* ── Plan d'action ── */
    .dg-plan { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 18px; margin-bottom: 18px; }
    .dg-plan-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
    .dg-plan-head h3 { margin: 0; font-size: 16px; }
    .dg-plan-metrics { display: flex; gap: 8px; flex-wrap: wrap; }
    .dg-chip { border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 600; }
    .dg-chip-count { background: #e0e7ff; color: #3730a3; }
    .dg-chip-time  { background: #dcfce7; color: #166534; }
    .dg-chip-conf  { background: #f1f5f9; color: #475569; }
    .dg-summary { margin: 10px 0 8px; line-height: 1.5; }
    .dg-quickwins { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .dg-qw-label { font-weight: 600; font-size: 13px; }
    .dg-qw-btn { border: 1px solid #fbbf24; background: #fef3c7; color: #92400e; border-radius: 6px;
                 padding: 2px 8px; font-size: 12px; cursor: pointer; }
    .dg-fixorder { margin: 6px 0 0; padding-left: 22px; }
    .dg-fixorder li { margin: 2px 0; }
    .dg-fixorder a { color: #2563eb; cursor: pointer; font-weight: 600; margin-right: 6px; }
    .dg-fixorder-title { color: #64748b; }

    /* ── Fiche problème ── */
    .dg-issue { border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 10px; overflow: hidden; background: #fff; }
    .dg-issue.dg-open { border-color: #94a3b8; }
    .dg-issue-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; }
    .dg-issue-head:hover { background: #f8fafc; }
    .dg-priority { min-width: 26px; height: 26px; border-radius: 50%; background: #1e293b; color: #fff;
                   display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; }
    .dg-sev { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
    .dg-sev[data-sev='BLOCKER'], .dg-sev[data-sev='CRITICAL'] { background: #fee2e2; color: #b91c1c; }
    .dg-sev[data-sev='HIGH'], .dg-sev[data-sev='MAJOR']       { background: #ffedd5; color: #c2410c; }
    .dg-sev[data-sev='MEDIUM']                                { background: #fef9c3; color: #a16207; }
    .dg-source { font-size: 11px; color: #64748b; font-weight: 600; }
    .dg-issue-title { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .dg-issue-title code { font-size: 12px; color: #475569; word-break: break-all; }
    .dg-effort { font-size: 12px; color: #166534; white-space: nowrap; }
    .dg-caret { color: #94a3b8; }

    .dg-issue-body { padding: 4px 16px 14px; border-top: 1px solid #f1f5f9; }
    .dg-rule { font-size: 12px; color: #64748b; margin: 8px 0; }
    .dg-block { margin: 12px 0; }
    .dg-block h4 { margin: 0 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #475569; }
    .dg-block p { margin: 0; line-height: 1.55; }
    .dg-block-risk p { color: #9f1239; }
    .dg-steps { margin: 0; padding-left: 20px; }
    .dg-steps li { margin: 4px 0; line-height: 1.5; }

    .dg-code-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    @media (max-width: 720px) { .dg-code-cols { grid-template-columns: 1fr; } }
    .dg-code-label { font-size: 11px; font-weight: 700; }
    .dg-code-bad { color: #b91c1c; }
    .dg-code-good { color: #15803d; }
    .dg-code pre { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 10px 12px;
                   font-size: 12px; overflow-x: auto; margin: 4px 0 0; white-space: pre-wrap; }

    .dg-verify { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .dg-verify h4 { width: 100%; }
    .dg-verify-cmd { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 5px 10px; font-size: 13px; }
    .dg-copy { border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; padding: 4px 10px;
               font-size: 12px; cursor: pointer; }
    .dg-copy:hover { background: #f8fafc; }

    .dg-empty { text-align: center; color: #64748b; padding: 40px 20px; }
    .dg-empty-hint { font-size: 12px; }

    /* ── Guide de secours (fallback déterministe) ── */
    .dg-chip-fallback { background: #e2e8f0; color: #334155; cursor: help; }
    .dg-fallback-order { margin: 6px 0 0; padding-left: 22px; }
    .dg-fallback-order li { margin: 8px 0; line-height: 1.5; }
    .dg-fallback-detail { display: block; color: #64748b; font-size: 13px; }
    .dg-fallback-meta { display: block; color: #94a3b8; font-size: 12px; margin-top: 2px; }
    .dg-qw-item { border: 1px solid #e2e8f0; background: #f8fafc; color: #475569; border-radius: 6px;
                  padding: 2px 8px; font-size: 12px; }
  `]
})
export class DeveloperGuideTabComponent {
  @Input() guide: DeveloperGuide | null | undefined;

  private openIds = signal<Set<string>>(new Set());

  sortedIssues = computed<DevGuideIssue[]>(() =>
    [...(this.guide?.issues ?? [])].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
  );

  // TEST-FE-02/03 (voir docs/frontend-qa/regression): fiche détaillée par
  // issue prioritaire quand disponible ; guide de secours déterministe sinon.
  hasDetailedIssues(): boolean {
    return !!(this.guide && this.guide.issues && this.guide.issues.length);
  }

  private isFallbackItem(x: string | DevGuideFallbackFixOrderItem): x is DevGuideFallbackFixOrderItem {
    return !!x && typeof x === 'object';
  }

  fallbackFixOrder = computed<DevGuideFallbackFixOrderItem[]>(() =>
    (this.guide?.fixOrder ?? []).filter((x): x is DevGuideFallbackFixOrderItem => this.isFallbackItem(x))
  );

  stringFixOrder = computed<string[]>(() =>
    (this.guide?.fixOrder ?? []).filter((x): x is string => typeof x === 'string')
  );

  stringQuickWins = computed<string[]>(() =>
    (this.guide?.quickWins ?? []).filter((x): x is string => typeof x === 'string')
  );

  hasFallbackPlan(): boolean {
    return !!(this.guide && (
      this.fallbackFixOrder().length > 0 ||
      this.stringQuickWins().length > 0 ||
      (this.guide.summaryForDeveloper && this.guide.summaryForDeveloper.trim().length > 0)
    ));
  }

  summaryLabel(raw: string | null | undefined): string {
    const value = String(raw || '').trim();
    if (/^Guide développeur généré automatiquement \(agent IA indisponible/i.test(value)) {
      return 'Guide de correction généré automatiquement. Ordre causal déterministe fondé sur les résultats des étapes.';
    }
    return value;
  }

  fallbackText(raw: string | null | undefined): string {
    return String(raw || '')
      .replace(/(\d+) finding\(s\)/gi, (_m, count) => `${count} ${count === '1' ? 'problème' : 'problèmes'}`)
      .replace(/liste des findings/gi, 'liste des problèmes');
  }

  isOpen(id: string): boolean { return this.openIds().has(id); }

  toggle(id: string): void {
    const next = new Set(this.openIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this.openIds.set(next);
  }

  scrollTo(id: string): void {
    const next = new Set(this.openIds());
    next.add(id);
    this.openIds.set(next);
    setTimeout(() =>
      document.getElementById('dg-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  titleOf(id: string): string {
    return this.guide?.issues?.find(i => i.id === id)?.title ?? '';
  }

  hasCode(issue: DevGuideIssue): boolean {
    const c = this.codeOf(issue);
    return !!(c && (c.before || c.after));
  }

  codeOf(issue: DevGuideIssue): { before: string; after: string } | null {
    const c = issue.codeExample;
    if (!c || typeof c === 'string') return null;
    return c;
  }

  copy(text: string): void {
    navigator.clipboard?.writeText(text);
  }
}
