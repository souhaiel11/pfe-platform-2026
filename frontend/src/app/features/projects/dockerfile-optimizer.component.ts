import { Component, Input, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription, interval, switchMap } from 'rxjs';

// ─────────────────────────────────────────────────────────────────────
//  Optimiseur de Dockerfile — agent IA (MVP minimal, calqué sur
//  JenkinsfileOptimizerComponent mais volontairement réduit) :
//    - pas de sélection fine par finding : "Corriger" applique TOUS les
//      findings détectés (raffinement possible plus tard) ;
//    - pas de polling sur l'apply : la branche n8n dockerfile-apply
//      exécute agent + gate + PR dans une seule requête synchrone
//      (contrairement à jenkinsfile-apply), donc POST /dockerfile/apply
//      répond directement avec le résultat final (~30-90s observés,
//      nginx a un proxy_read_timeout de 200s, voir docker/nginx.conf).
//
//  Usage : <app-dockerfile-optimizer [projectId]="project?.id" [projectName]="project?.name" [repo]="project?.githubRepo">
// ─────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-dockerfile-optimizer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- ── Saisie ── -->
    <section class="do-input" *ngIf="!result()">
      <span class="eyebrow">Agent IA — optimisation de Dockerfile</span>
      <h3 class="do-title">Analyser votre Dockerfile</h3>
      <p class="do-sub">Récupéré depuis le dépôt GitHub du projet, analysé en 3 volets : cohérence runtime (Dockerfile ↔ pom.xml/config), image de base, sécurité.</p>

      <div class="do-git-fields">
        <input class="do-repo-in" placeholder="owner (ex: souhaiel11)"
               [value]="ownerInput()" (input)="ownerInput.set($any($event.target).value)" />
        <input class="do-repo-in" placeholder="repository"
               [value]="repoInput()" (input)="repoInput.set($any($event.target).value)" />
      </div>

      <div class="do-analyze-row">
        <button class="do-btn" [disabled]="loading() || !canAnalyze()" (click)="analyze()">
          {{ loading() ? 'Analyse en cours…' : 'Analyser le Dockerfile' }}
        </button>
      </div>
      <p class="do-error" *ngIf="error()">{{ error() }}</p>
      <div class="do-loading" *ngIf="loading()">
        <span class="do-spinner"></span>
        L'agent examine l'image de base, la sécurité et la cohérence avec le projet — quelques secondes…
      </div>
    </section>

    <!-- ── Résultat de l'analyse ── -->
    <ng-container *ngIf="result() as r">
      <section class="do-verdict">
        <div class="do-score" [attr.data-tone]="scoreTone(r.score)">
          <span class="do-score-num mono">{{ r.score }}</span>
          <span class="do-score-lab">score<br>/ 100</span>
        </div>
        <div class="do-verdict-body">
          <span class="eyebrow">Diagnostic</span>
          <p class="do-summary">{{ r.summary }}</p>
        </div>
        <button class="do-btn ghost" (click)="reset()">Nouvelle analyse</button>
      </section>

      <!-- Findings groupés par catégorie -->
      <section class="block" *ngFor="let g of groupedIssues()">
        <span class="eyebrow">{{ g.label }} ({{ g.items.length }})</span>
        <div class="do-issues">
          <div class="do-issue" *ngFor="let i of g.items">
            <div class="do-issue-head">
              <span class="sev" [attr.data-sev]="sevKey(i.severity)">{{ i.severity }}</span>
              <span class="do-det" *ngIf="i.deterministic">déterministe</span>
              <strong class="do-issue-cat mono">{{ i.category }}</strong>
            </div>
            <p class="do-issue-desc">{{ i.description }}</p>
            <p class="do-issue-sugg"><span class="do-lbl">Suggestion :</span> {{ i.suggestion }}</p>
          </div>
        </div>
      </section>

      <div class="do-empty" *ngIf="!(r.issues || []).length">Aucun problème détecté.</div>

      <!-- ── Remédiation ── -->
      <section class="block" *ngIf="!applyResult()">
        <div class="do-decision">
          <p class="do-sub" style="margin:0">
            « Corriger » applique <strong>tous</strong> les findings ci-dessus et ouvre une Pull Request sur le dépôt —
            rien n'est poussé directement sur <code class="mono">main</code>. Un gate déterministe vérifie la correction avant toute PR.
          </p>
          <button class="do-btn" [disabled]="applying() || !(r.issues || []).length" (click)="apply(r)">
            {{ applying() ? 'Correction en cours…' : 'Corriger et créer une PR' }}
          </button>
        </div>
        <div class="do-loading" *ngIf="applying()">
          <span class="do-spinner"></span>
          Agent de remédiation + gate déterministe + création de la PR — peut prendre jusqu'à 1-2 minutes…
        </div>
        <p class="do-error" *ngIf="applyError()">{{ applyError() }}</p>
      </section>

      <!-- PR créée -->
      <section class="block" *ngIf="applyResult() as ar" [ngSwitch]="!!ar.prUrl">
        <div class="do-pr-ok" *ngSwitchCase="true">
          <span class="do-pr-icon">✓</span>
          <div style="flex:1">
            <strong>Pull Request créée</strong>
            <p class="do-sub" style="margin:2px 0 8px">Branche <code class="mono">{{ ar.branch }}</code></p>
            <div class="do-classif">
              <p *ngIf="byStatus(ar, 'SÛR').length"><strong>✅ Corrections appliquées (sûr) :</strong> {{ joinReasons(byStatus(ar, 'SÛR')) }}</p>
              <p *ngIf="byStatus(ar, 'INFÉRÉ').length"><strong>👀 À vérifier :</strong> {{ joinReasons(byStatus(ar, 'INFÉRÉ')) }}</p>
              <p *ngIf="byStatus(ar, 'REFUSÉ').length"><strong>⛔ Non appliqué :</strong> {{ joinReasons(byStatus(ar, 'REFUSÉ')) }}</p>
            </div>
          </div>
          <a class="do-btn" [href]="ar.prUrl" target="_blank" rel="noopener">Ouvrir la PR ↗</a>
        </div>
        <div class="do-rejected" *ngSwitchCase="false">
          <strong>⚠ Gate déterministe : correction rejetée, aucune PR créée.</strong>
          <p class="do-sub" style="margin:6px 0 0">{{ ar.message }}</p>
          <ul class="do-violations" *ngIf="(ar.violations || []).length">
            <li *ngFor="let v of ar.violations">[{{ v.family }}] {{ v.message }}</li>
          </ul>
        </div>
      </section>
    </ng-container>
  `,
  styles: [`
    :host {
      display: block; font-size: 13px;
      --c-fail: var(--accent-red,    #dc2626);
      --c-warn: var(--accent-orange, #ea580c);
      --c-pass: var(--accent-green,  #16a34a);
      --c-auto: var(--accent-blue,   #2563eb);
      --c-line: var(--border, rgba(127,127,127,.18));
    }
    .mono { font-family: var(--font-mono, ui-monospace, monospace); }
    .eyebrow { display: block; font-family: var(--font-mono, monospace); font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; opacity: .45; margin-bottom: 8px; }
    .block { margin-top: 20px; }

    .do-input { border: 1px solid var(--c-line); border-radius: 12px; padding: 20px 22px; }
    .do-title { margin: 0 0 8px; font-size: 18px; font-weight: 700; }
    .do-sub { margin: 0 0 14px; font-size: 12.5px; opacity: .65; line-height: 1.5; max-width: 66ch; }
    .do-git-fields { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .do-repo-in { font: inherit; font-size: 12.5px; padding: 7px 11px; min-width: 190px; flex: 1; border: 1px solid var(--c-line); border-radius: 8px; background: transparent; color: inherit; }
    .do-repo-in:focus { outline: 2px solid var(--c-auto); outline-offset: -1px; }
    .do-btn { font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; background: var(--c-auto); color: #fff; border: 1px solid var(--c-auto); border-radius: 8px; padding: 8px 18px; }
    .do-btn:disabled { opacity: .45; cursor: not-allowed; }
    .do-btn.ghost { background: transparent; color: inherit; border-color: var(--c-line); }
    .do-error { color: var(--c-fail); font-size: 12.5px; margin: 10px 0 0; }
    .do-loading { display: flex; align-items: center; gap: 10px; margin-top: 14px; font-size: 12.5px; opacity: .7; }
    .do-spinner { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; border: 2px solid var(--c-line); border-top-color: var(--c-auto); animation: do-spin .8s linear infinite; }
    @keyframes do-spin { to { transform: rotate(360deg); } }

    .do-verdict { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; border: 1px solid var(--c-line); border-radius: 12px; padding: 18px 22px; background: rgba(127,127,127,.04); }
    .do-score { display: flex; flex-direction: column; align-items: center; min-width: 80px; }
    .do-score-num { font-size: 32px; font-weight: 800; line-height: 1; }
    .do-score[data-tone='fail'] .do-score-num { color: var(--c-fail); }
    .do-score[data-tone='warn'] .do-score-num { color: var(--c-warn); }
    .do-score[data-tone='pass'] .do-score-num { color: var(--c-pass); }
    .do-score-lab { font-size: 10px; opacity: .55; text-align: center; margin-top: 4px; }
    .do-verdict-body { flex: 1; min-width: 220px; }
    .do-summary { margin: 0; font-size: 13px; line-height: 1.6; }

    .do-issues { border: 1px solid var(--c-line); border-radius: 12px; overflow: hidden; }
    .do-issue { padding: 11px 16px; }
    .do-issue + .do-issue { border-top: 1px solid var(--c-line); }
    .do-issue-head { display: flex; align-items: center; gap: 8px; }
    .do-issue-cat { font-size: 11px; opacity: .6; }
    .do-det { font-size: 9px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 1px 6px; border-radius: 3px; background: rgba(37,99,235,.12); color: var(--c-auto); }
    .do-issue-desc { margin: 6px 0 4px; font-size: 12.5px; line-height: 1.55; }
    .do-issue-sugg { margin: 0; font-size: 12.5px; line-height: 1.55; opacity: .85; }
    .do-lbl { font-weight: 700; opacity: .7; }
    .do-empty { font-size: 12.5px; opacity: .55; margin-top: 16px; }

    .sev { display: inline-block; font-size: 9.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; flex-shrink: 0; }
    .sev[data-sev='critical'] { background: rgba(220,38,38,.13); color: var(--c-fail); }
    .sev[data-sev='high']     { background: rgba(234,88,12,.13); color: var(--c-warn); }
    .sev[data-sev='medium']   { background: rgba(202,138,4,.15); color: #ca8a04; }
    .sev[data-sev='low']      { background: rgba(127,127,127,.12); opacity: .8; }

    .do-decision { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; flex-wrap: wrap; border: 1px solid var(--c-line); border-radius: 12px; padding: 16px 20px; background: rgba(127,127,127,.04); }
    .do-decision p { flex: 1; min-width: 260px; }
    .do-decision code { font-family: var(--font-mono, monospace); background: rgba(127,127,127,.1); padding: 1px 6px; border-radius: 4px; }

    .do-pr-ok { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; border: 1px solid rgba(22,163,74,.35); border-radius: 12px; padding: 14px 18px; background: rgba(22,163,74,.06); }
    .do-pr-icon { width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; background: var(--c-pass); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; }
    .do-classif p { margin: 4px 0; font-size: 12px; line-height: 1.5; }

    .do-rejected { border: 1px solid rgba(220,38,38,.3); border-radius: 12px; padding: 14px 18px; background: rgba(220,38,38,.06); color: var(--c-fail); }
    .do-violations { margin: 8px 0 0; padding-left: 18px; font-size: 12px; }

    @media (prefers-reduced-motion: reduce) { .do-spinner { animation: none; } }
  `],
})
export class DockerfileOptimizerComponent implements OnInit, OnDestroy {
  @Input() projectId: string | null | undefined;
  @Input() projectName: string | null | undefined;
  @Input() owner: string | null | undefined;
  @Input() repo: string | null | undefined;
  @Input() baseBranch = 'main';

  ownerInput = signal<string>('');
  repoInput = signal<string>('');

  loading = signal<boolean>(false);
  error = signal<string>('');
  result = signal<any>(null);
  dockerfileSource = signal<string>('');

  applying = signal<boolean>(false);
  applyError = signal<string>('');
  applyResult = signal<any>(null);

  private pollSub?: Subscription;

  constructor(private http: HttpClient) {}

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  ngOnInit(): void {
    let o = (this.owner || '').trim();
    let r = (this.repo || '').trim();
    if (!o && r) {
      const s = r.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
      if (s.includes('/')) {
        const parts = s.split('/').filter(Boolean);
        o = parts[0] || '';
        r = parts[1] || '';
      }
    }
    if (o) this.ownerInput.set(o);
    if (r) this.repoInput.set(r);
  }

  canAnalyze(): boolean { return !!this.ownerInput().trim() && !!this.repoInput().trim(); }

  groupedIssues(): { label: string; items: any[] }[] {
    const issues: any[] = this.result()?.issues || [];
    const runtime = issues.filter((i) => ['CAT-JDK', 'CAT-PORT', 'CAT-ARTIFACT'].includes(i.category));
    const image = issues.filter((i) => i.category === 'CAT-IMAGE');
    const security = issues.filter((i) => i.category === 'CAT-SECURITY');
    return [
      { label: 'Cohérence runtime', items: runtime },
      { label: 'Image', items: image },
      { label: 'Sécurité', items: security },
    ].filter((g) => g.items.length > 0);
  }

  byStatus(ar: any, status: string): any[] {
    return (ar?.classification || []).filter((c: any) => c.status === status);
  }
  joinReasons(items: any[]): string {
    return items.map((c) => c.id).join(', ');
  }

  sevKey(s: string): string {
    const u = String(s || '').toUpperCase();
    if (u === 'CRITIQUE') return 'critical';
    if (u === 'ELEVE' || u === 'ÉLEVÉ') return 'high';
    if (u === 'MOYEN') return 'medium';
    return 'low';
  }

  scoreTone(score: number): string {
    if (score < 40) return 'fail';
    if (score < 70) return 'warn';
    return 'pass';
  }

  // Récupère le Dockerfile en amont (nécessaire pour l'apply, l'analyse ne
  // le renvoie pas — voir dockerfile-optimizer.module.ts:optimize()) puis
  // lance l'analyse (async, polling — mêmes principes que Jenkinsfile).
  analyze(): void {
    if (!this.canAnalyze()) return;
    this.loading.set(true);
    this.error.set('');
    this.pollSub?.unsubscribe();

    this.http.post<any>('/api/dockerfile/fetch', {
      owner: this.ownerInput().trim(),
      repo: this.repoInput().trim(),
    }).subscribe({
      next: (fetchRes) => {
        this.dockerfileSource.set(fetchRes?.content || '');
        this.http.post<any>('/api/dockerfile/optimize', {
          owner: this.ownerInput().trim(),
          repo: this.repoInput().trim(),
          projectId: this.projectId || undefined,
          projectName: this.projectName || 'projet',
        }).subscribe({
          next: (r) => {
            if (!r?.id) {
              this.error.set("Réponse inattendue du serveur : identifiant d'analyse manquant.");
              this.loading.set(false);
              return;
            }
            this.startPolling(r.id);
          },
          error: (e) => {
            this.error.set(e?.error?.message || e?.message || "Impossible de démarrer l'analyse.");
            this.loading.set(false);
          },
        });
      },
      error: (e) => {
        this.error.set(e?.error?.message || 'Dockerfile introuvable sur le dépôt.');
        this.loading.set(false);
      },
    });
  }

  private startPolling(id: string): void {
    this.pollSub = interval(3000).pipe(
      switchMap(() => this.http.get<any>(`/api/dockerfile/optimize/${id}/status`)),
    ).subscribe({
      next: (s) => {
        if (s.status === 'pending') return;
        this.pollSub?.unsubscribe();
        this.loading.set(false);
        if (s.status === 'done') {
          this.result.set(s.result);
          this.applyResult.set(null);
          this.applyError.set('');
        } else {
          this.error.set(`Bloqué : ${s.reason || 'raison inconnue'}${s.detail ? ' — ' + s.detail : ''}`);
        }
      },
      error: () => {
        // erreur transitoire de polling — on continue, pas de coupure
      },
    });
  }

  // Synchrone (pas de polling) : la branche n8n dockerfile-apply répond une
  // fois agent + gate + PR terminés. Tous les findings sont envoyés, sans
  // sélection fine (MVP — voir en-tête du fichier).
  apply(r: any): void {
    this.applying.set(true);
    this.applyError.set('');
    this.applyResult.set(null);

    this.http.post<any>('/api/dockerfile/apply', {
      requestId: crypto.randomUUID(),
      projectId: this.projectId,
      dockerfile: this.dockerfileSource(),
      findings: r.issues || [],
      context: {},
      owner: this.ownerInput().trim(),
      repo: this.repoInput().trim(),
      baseBranch: this.baseBranch,
      filePath: 'Dockerfile',
    }).subscribe({
      next: (res) => {
        this.applying.set(false);
        this.applyResult.set(res);
      },
      error: (e) => {
        this.applying.set(false);
        this.applyError.set(e?.error?.message || e?.message || 'Échec de la remédiation.');
      },
    });
  }

  reset(): void {
    this.pollSub?.unsubscribe();
    this.result.set(null);
    this.error.set('');
    this.applyResult.set(null);
    this.applyError.set('');
    this.applying.set(false);
    this.dockerfileSource.set('');
  }
}
