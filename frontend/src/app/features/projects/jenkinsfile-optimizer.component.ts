import { Component, Input, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription, interval, switchMap } from 'rxjs';

// ─────────────────────────────────────────────────────────────────────
//  Optimiseur de Jenkinsfile — agent IA
//  Usage : <app-jenkinsfile-optimizer [projectId]="project?.id" [projectName]="project?.name">
//  Backend requis : POST /api/jenkins/optimize (module JenkinsOptimizerModule)
//
//  Asynchrone par construction : POST /optimize renvoie un id immédiatement,
//  le résultat arrive via polling de GET /optimize/:id/status. Aucun timeout
//  fixe côté frontend — "en cours" reste affiché tant que status=pending,
//  même après plusieurs minutes (données réelles : une analyse a mis 11min
//  et a quand même abouti). Seul un vrai signal d'erreur explicite du
//  workflow (status=error, avec une raison lisible) fait passer à "bloqué".
//
//  Persistance : la dernière analyse est rechargée depuis
//  GET /api/jenkins/analyses?projectId= au ngOnInit (voir loadLatestAnalysis)
//  — état conservé en base côté backend (JenkinsAnalysis), pas seulement en
//  mémoire ici. Une analyse encore 'pending' au moment du chargement reprend
//  automatiquement son polling sur le même jobId.
// ─────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-jenkinsfile-optimizer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- ── Saisie : import Git ou collage ── -->
    <section class="jo-input" *ngIf="!result()">
      <span class="eyebrow">Agent IA — optimisation de pipeline</span>
      <h3 class="jo-title">Analyser votre Jenkinsfile</h3>

      <!-- État neutre : aucune analyse trouvée en base pour ce projet (voir
           loadLatestAnalysis) — première fois, ou historique vide. Évite un
           formulaire qui semble "vide"/cassé. -->
      <p class="jo-neutral" *ngIf="!loading() && !error() && !checkingHistory()">Aucune analyse récente — lancez-en une.</p>
      <p class="jo-neutral" *ngIf="checkingHistory()">Recherche d'une analyse existante…</p>

      <!-- Bascule de mode -->
      <div class="jo-modes">
        <button class="jo-mode" [class.on]="mode() === 'git'" (click)="mode.set('git')">Importer depuis Git</button>
        <button class="jo-mode" [class.on]="mode() === 'paste'" (click)="mode.set('paste')">Coller manuellement</button>
      </div>

      <!-- Mode Git -->
      <div *ngIf="mode() === 'git'">
        <p class="jo-sub">La plateforme récupère le Jenkinsfile directement depuis le dépôt GitHub.</p>
        <div class="jo-git-fields">
          <input class="jo-repo-in" placeholder="owner (ex: souhaiel11)"
                 [value]="ownerInput()" (input)="ownerInput.set($any($event.target).value)" />
          <input class="jo-repo-in" placeholder="repo (ex: devsecops-testbed)"
                 [value]="repoInput()" (input)="repoInput.set($any($event.target).value)" />
          <input class="jo-repo-in small" placeholder="branche (main)"
                 [value]="refInput()" (input)="refInput.set($any($event.target).value)" />
          <input class="jo-repo-in small" placeholder="chemin (Jenkinsfile)"
                 [value]="pathInput()" (input)="pathInput.set($any($event.target).value)" />
        </div>
        <div class="jo-actions">
          <span class="jo-hint" *ngIf="fetched()">✓ Jenkinsfile récupéré ({{ source().length }} caractères)</span>
          <span class="jo-hint" *ngIf="!fetched()"></span>
          <button class="jo-btn ghost" [disabled]="fetching() || !canFetch()" (click)="fetchFromGit()">
            {{ fetching() ? 'Récupération…' : 'Récupérer depuis Git' }}
          </button>
        </div>
        <p class="jo-error" *ngIf="fetchError()">{{ fetchError() }} <button class="jo-inline-link" (click)="mode.set('paste')">Coller manuellement</button></p>
        <pre class="jo-code jo-preview" *ngIf="fetched()"><code>{{ source() }}</code></pre>
      </div>

      <!-- Mode Collage -->
      <div *ngIf="mode() === 'paste'">
        <p class="jo-sub">Collez le contenu du Jenkinsfile ci-dessous.</p>
        <textarea class="jo-textarea" rows="14" spellcheck="false"
                  placeholder="pipeline &#123;&#10;  agent any&#10;  stages &#123; … &#125;&#10;&#125;"
                  [value]="source()" (input)="source.set($any($event.target).value)"></textarea>
        <div class="jo-actions">
          <span class="jo-hint mono">{{ source().length }} caractères</span>
        </div>
      </div>

      <!-- Bouton d'analyse commun -->
      <div class="jo-analyze-row">
        <button class="jo-btn" [disabled]="loading() || source().trim().length < 30" (click)="analyze()">
          {{ loading() ? 'Analyse en cours…' : 'Analyser et optimiser' }}
        </button>
      </div>
      <p class="jo-error" *ngIf="error()">{{ error() }}</p>
      <div class="jo-loading" *ngIf="loading()">
        <span class="jo-spinner"></span>
        L'agent examine sécurité, fiabilité, performance et bonnes pratiques DevSecOps — analyse en cours…
      </div>
      <p class="jo-unstable" *ngIf="loading() && pollUnstable()">Connexion instable — nouvelle tentative…</p>
    </section>

    <!-- ── Résultat ── -->
    <ng-container *ngIf="result() as r">

      <section class="jo-verdict">
        <div class="jo-score" [attr.data-tone]="scoreTone(r.score)">
          <span class="jo-score-num mono">{{ r.score }}</span>
          <span class="jo-score-lab">score du fichier<br>original / 100</span>
        </div>
        <div class="jo-verdict-body">
          <span class="eyebrow">Diagnostic</span>
          <p class="jo-summary">{{ r.summary }}</p>
          <div class="jo-gains">
            <span class="jo-gain" *ngIf="r.estimatedTimeSavingPercent > 0">
              ≈ <strong class="mono">−{{ r.estimatedTimeSavingPercent }}%</strong> de durée de pipeline estimée
            </span>
            <span class="jo-gain">
              <strong class="mono">{{ r.issues.length }}</strong> point(s) d'amélioration
            </span>
          </div>
        </div>
        <button class="jo-btn ghost" (click)="reset()">Nouvelle analyse</button>
      </section>

      <!-- Issues -->
      <section class="block" *ngIf="r.issues.length">
        <span class="eyebrow">Points identifiés</span>
        <div class="jo-issues">
          <details class="jo-issue" *ngFor="let i of r.issues">
            <summary class="jo-issue-head">
              <span class="sev" [attr.data-sev]="sevKey(i.severity)">{{ i.severity }}</span>
              <span class="jo-cat mono">{{ i.category }}</span>
              <strong class="jo-issue-title">{{ i.title }}</strong>
              <span class="jo-chevron">▸</span>
            </summary>
            <div class="jo-issue-body">
              <p><span class="jo-lbl">Problème :</span> {{ i.problem }}</p>
              <p><span class="jo-lbl">Recommandation :</span> {{ i.recommendation }}</p>
              <code class="jo-linehint" *ngIf="i.lineHint">{{ i.lineHint }}</code>
            </div>
          </details>
        </div>
      </section>

      <!-- Fichier optimisé -->
      <section class="block">
        <div class="jo-file-head">
          <div>
            <span class="eyebrow">Jenkinsfile optimisé</span>
            <p class="jo-sub" style="margin:0">Complet et prêt à remplacer l'original — chaque modification est tracée ci-dessous.</p>
          </div>
          <div class="jo-file-actions">
            <button class="jo-btn ghost" (click)="copy(r.optimizedJenkinsfile)">{{ copied() ? 'Copié ✓' : 'Copier' }}</button>
            <button class="jo-btn ghost" (click)="download(r.optimizedJenkinsfile)">Télécharger</button>
          </div>
        </div>
        <pre class="jo-code"><code>{{ r.optimizedJenkinsfile }}</code></pre>
      </section>

      <!-- Décision : valider (PR) ou rejeter -->
      <section class="block" *ngIf="!applied()">
        <div class="jo-decision">
          <div class="jo-decision-txt">
            <span class="eyebrow">Appliquer ces changements</span>
            <p class="jo-sub" style="margin:0">
              « Valider » crée une branche et ouvre une Pull Request sur le dépôt — rien n'est poussé sur
              <code class="mono">{{ baseBranch }}</code> directement. Vous relisez et fusionnez depuis GitHub.
            </p>
            <div class="jo-repo-fields" *ngIf="!owner || !repo">
              <input class="jo-repo-in" placeholder="owner (ex: souhaiel11)"
                     [value]="ownerInput()" (input)="ownerInput.set($any($event.target).value)" />
              <input class="jo-repo-in" placeholder="repo (ex: devsecops-testbed)"
                     [value]="repoInput()" (input)="repoInput.set($any($event.target).value)" />
            </div>
          </div>
          <div class="jo-decision-btns">
            <button class="jo-btn ghost danger" [disabled]="applying()" (click)="reject()">Rejeter</button>
            <button class="jo-btn" [disabled]="applying() || !canApply()" (click)="apply(r)">
              {{ applying() ? 'Création de la PR…' : 'Valider → créer la PR' }}
            </button>
          </div>
        </div>
        <p class="jo-error" *ngIf="applyError()">{{ applyError() }}</p>
      </section>

      <!-- PR créée -->
      <section class="block" *ngIf="applied() as pr">
        <div class="jo-pr-ok">
          <span class="jo-pr-icon">✓</span>
          <div>
            <strong>Pull Request créée</strong>
            <p class="jo-sub" style="margin:2px 0 0">Branche <code class="mono">{{ pr.branch }}</code> — relisez et fusionnez depuis GitHub.</p>
          </div>
          <a class="jo-btn" [href]="pr.prUrl" target="_blank" rel="noopener" *ngIf="pr.prUrl">Ouvrir la PR ↗</a>
        </div>
      </section>

      <!-- Changements -->
      <section class="block" *ngIf="r.changes.length">
        <span class="eyebrow">Modifications appliquées</span>
        <ul class="jo-changes">
          <li *ngFor="let c of r.changes">
            <span class="jo-ref mono">{{ c.ref }}</span>
            <span>{{ c.description }}</span>
          </li>
        </ul>
      </section>
    </ng-container>
  `,
  styles: [`
    :host {
      display: block; font-size: 13px;
      --c-fail: var(--accent-red,    #dc2626);
      --c-warn: var(--accent-orange, #ea580c);
      --c-med:  #ca8a04;
      --c-pass: var(--accent-green,  #16a34a);
      --c-auto: var(--accent-blue,   #2563eb);
      --c-line: var(--border, rgba(127,127,127,.18));
      font-variant-numeric: tabular-nums;
    }
    .mono { font-family: var(--font-mono, ui-monospace, monospace); }
    .eyebrow {
      display: block; font-family: var(--font-mono, monospace);
      font-size: 10px; font-weight: 700; letter-spacing: .14em;
      text-transform: uppercase; opacity: .45; margin-bottom: 8px;
    }
    .block { margin-top: 22px; }

    /* Saisie */
    .jo-input { border: 1px solid var(--c-line); border-radius: 12px; padding: 20px 22px; }
    .jo-title { margin: 0 0 12px; font-size: 19px; font-weight: 700; }

    .jo-modes { display: inline-flex; gap: 4px; padding: 3px; border-radius: 9px; background: rgba(127,127,127,.08); margin-bottom: 14px; }
    .jo-mode {
      font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
      background: transparent; color: inherit; border: 0; border-radius: 7px; padding: 6px 14px; opacity: .6;
    }
    .jo-mode.on { background: var(--card-bg, #fff); opacity: 1; box-shadow: 0 1px 3px rgba(0,0,0,.08); }

    .jo-git-fields { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
    .jo-repo-in {
      font: inherit; font-size: 12.5px; padding: 7px 11px; min-width: 190px; flex: 1;
      border: 1px solid var(--c-line); border-radius: 8px; background: transparent; color: inherit;
    }
    .jo-repo-in.small { min-width: 130px; flex: 0 1 150px; }
    .jo-repo-in:focus { outline: 2px solid var(--c-auto); outline-offset: -1px; }
    .jo-preview { max-height: 240px; margin-top: 12px; }
    .jo-inline-link { background: none; border: 0; color: var(--c-auto); font: inherit; font-weight: 600; cursor: pointer; text-decoration: underline; padding: 0; }
    .jo-analyze-row { margin-top: 14px; }
    .jo-sub { margin: 0 0 14px; font-size: 13px; opacity: .65; line-height: 1.55; max-width: 66ch; }
    .jo-textarea {
      width: 100%; box-sizing: border-box; resize: vertical;
      font-family: var(--font-mono, monospace); font-size: 12px; line-height: 1.55;
      background: rgba(127,127,127,.05); color: inherit;
      border: 1px solid var(--c-line); border-radius: 10px; padding: 12px 14px;
    }
    .jo-textarea:focus { outline: 2px solid var(--c-auto); outline-offset: -1px; }
    .jo-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
    .jo-hint { font-size: 11px; opacity: .45; }
    .jo-btn {
      font: inherit; font-size: 13px; font-weight: 650; cursor: pointer;
      background: var(--c-auto); color: #fff; border: 1px solid var(--c-auto);
      border-radius: 8px; padding: 8px 18px;
    }
    .jo-btn:disabled { opacity: .45; cursor: not-allowed; }
    .jo-btn.ghost { background: transparent; color: inherit; border-color: var(--c-line); }
    .jo-btn.ghost:hover { border-color: rgba(127,127,127,.5); }
    .jo-error { color: var(--c-fail); font-size: 12.5px; margin: 10px 0 0; }
    .jo-neutral { font-size: 12.5px; opacity: .55; margin: 0 0 16px; padding: 8px 12px; border: 1px dashed var(--c-line); border-radius: 8px; }
    .jo-loading { display: flex; align-items: center; gap: 10px; margin-top: 14px; font-size: 12.5px; opacity: .7; }
    .jo-unstable { margin: 6px 0 0; font-size: 11px; opacity: .55; }
    .jo-spinner {
      width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
      border: 2px solid var(--c-line); border-top-color: var(--c-auto);
      animation: jo-spin .8s linear infinite;
    }
    @keyframes jo-spin { to { transform: rotate(360deg); } }

    /* Verdict */
    .jo-verdict {
      display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
      border: 1px solid var(--c-line); border-radius: 12px; padding: 18px 22px;
      background: rgba(127,127,127,.04);
    }
    .jo-score { display: flex; flex-direction: column; align-items: center; min-width: 88px; }
    .jo-score-num { font-size: 36px; font-weight: 800; line-height: 1; }
    .jo-score[data-tone='fail'] .jo-score-num { color: var(--c-fail); }
    .jo-score[data-tone='warn'] .jo-score-num { color: var(--c-warn); }
    .jo-score[data-tone='pass'] .jo-score-num { color: var(--c-pass); }
    .jo-score-lab { font-size: 10px; opacity: .55; text-align: center; margin-top: 4px; line-height: 1.3; }
    .jo-verdict-body { flex: 1; min-width: 240px; }
    .jo-summary { margin: 0; font-size: 13px; line-height: 1.6; }
    .jo-gains { display: flex; gap: 18px; margin-top: 8px; flex-wrap: wrap; }
    .jo-gain { font-size: 12px; opacity: .75; }

    /* Issues */
    .jo-issues { border: 1px solid var(--c-line); border-radius: 12px; overflow: hidden; }
    .jo-issue + .jo-issue { border-top: 1px solid var(--c-line); }
    .jo-issue-head {
      display: flex; align-items: center; gap: 10px; padding: 11px 16px;
      cursor: pointer; user-select: none; list-style: none;
    }
    .jo-issue-head::-webkit-details-marker { display: none; }
    .jo-issue-head:hover { background: rgba(127,127,127,.05); }
    .jo-issue[open] .jo-chevron { transform: rotate(90deg); }
    .jo-chevron { margin-left: auto; opacity: .4; transition: transform .15s; }
    .jo-cat { font-size: 10px; opacity: .5; letter-spacing: .06em; }
    .jo-issue-title { font-size: 13px; font-weight: 600; }
    .jo-issue-body { padding: 2px 16px 14px 16px; font-size: 12.5px; line-height: 1.6; }
    .jo-issue-body p { margin: 6px 0; }
    .jo-lbl { font-weight: 700; opacity: .7; }
    .jo-linehint {
      display: block; margin-top: 8px; font-family: var(--font-mono, monospace);
      font-size: 11px; background: rgba(127,127,127,.08);
      border-radius: 6px; padding: 6px 10px; word-break: break-all;
    }

    /* Fichier */
    .jo-file-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
    .jo-file-actions { display: flex; gap: 8px; }
    .jo-code {
      margin: 0; max-height: 480px; overflow: auto;
      background: #0f172a; color: #e2e8f0; border-radius: 12px;
      padding: 16px 18px; font-size: 12px; line-height: 1.55;
    }
    .jo-code code { font-family: var(--font-mono, monospace); }

    /* Changements */
    .jo-changes { list-style: none; margin: 0; padding: 0; border: 1px solid var(--c-line); border-radius: 12px; overflow: hidden; }
    .jo-changes li { display: flex; gap: 12px; padding: 10px 16px; font-size: 12.5px; line-height: 1.5; }
    .jo-changes li + li { border-top: 1px solid var(--c-line); }
    .jo-ref { flex-shrink: 0; font-weight: 700; color: var(--c-auto); font-size: 11px; padding-top: 1px; }

    /* Échelle sévérité unifiée */
    .sev {
      display: inline-block; font-size: 9.5px; font-weight: 800;
      letter-spacing: .06em; text-transform: uppercase;
      padding: 2px 7px; border-radius: 3px; flex-shrink: 0;
    }
    .sev[data-sev='critical'] { background: rgba(220,38,38,.13); color: var(--c-fail); }
    .sev[data-sev='high']     { background: rgba(234,88,12,.13); color: var(--c-warn); }
    .sev[data-sev='medium']   { background: rgba(202,138,4,.15);  color: var(--c-med); }
    .sev[data-sev='low']      { background: rgba(127,127,127,.12); opacity: .8; }

    /* Décision */
    .jo-decision {
      display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; flex-wrap: wrap;
      border: 1px solid var(--c-line); border-radius: 12px; padding: 16px 20px; background: rgba(127,127,127,.04);
    }
    .jo-decision-txt { flex: 1; min-width: 260px; }
    .jo-decision-txt code { font-family: var(--font-mono, monospace); background: rgba(127,127,127,.1); padding: 1px 6px; border-radius: 4px; }
    .jo-repo-fields { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .jo-repo-in {
      font: inherit; font-size: 12.5px; padding: 6px 10px; min-width: 180px;
      border: 1px solid var(--c-line); border-radius: 7px; background: transparent; color: inherit;
    }
    .jo-repo-in:focus { outline: 2px solid var(--c-auto); outline-offset: -1px; }
    .jo-decision-btns { display: flex; gap: 8px; }
    .jo-btn.ghost.danger { color: var(--c-fail); border-color: rgba(220,38,38,.35); }
    .jo-btn.ghost.danger:hover { border-color: var(--c-fail); }

    /* PR OK */
    .jo-pr-ok {
      display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
      border: 1px solid rgba(22,163,74,.35); border-radius: 12px; padding: 14px 18px; background: rgba(22,163,74,.06);
    }
    .jo-pr-icon {
      width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%;
      background: var(--c-pass); color: #fff; display: inline-flex; align-items: center; justify-content: center;
      font-weight: 800;
    }
    .jo-pr-ok a { margin-left: auto; text-decoration: none; }

    @media (prefers-reduced-motion: reduce) { .jo-spinner { animation: none; } * { transition: none !important; } }
  `]
})
export class JenkinsfileOptimizerComponent implements OnInit, OnDestroy {
  @Input() projectName: string | null | undefined;
  @Input() projectId: string | null | undefined;
  // Renseignez owner/repo depuis le parent si connus (sinon champs de saisie affichés)
  @Input() owner: string | null | undefined;
  @Input() repo: string | null | undefined;
  @Input() baseBranch = 'main';

  source = signal<string>('');
  loading = signal<boolean>(false);
  error = signal<string>('');
  result = signal<any>(null);
  copied = signal<boolean>(false);

  mode = signal<'git' | 'paste'>('git');
  ownerInput = signal<string>('');
  repoInput = signal<string>('');
  refInput = signal<string>('');
  pathInput = signal<string>('');
  fetching = signal<boolean>(false);
  fetched = signal<boolean>(false);
  fetchError = signal<string>('');

  applying = signal<boolean>(false);
  applyError = signal<string>('');
  applied = signal<any>(null);

  // Signal discret, n'arrête jamais le polling — juste une indication que
  // le réseau a un souci passager (pas un vrai statut du job).
  pollUnstable = signal<boolean>(false);
  // Vrai le temps du chargement de GET /jenkins/analyses au démarrage —
  // distinct de "loading" (qui, lui, veut dire "une analyse tourne").
  checkingHistory = signal<boolean>(false);
  private pollSub?: Subscription;

  constructor(private http: HttpClient) {}

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  ngOnInit(): void {
    let o = (this.owner || '').trim();
    let r = (this.repo || '').trim();
    // Gère 'owner/repo' combiné OU une URL github complète
    if (!o && r) {
      let s = r.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
      if (s.includes('/')) {
        const parts = s.split('/').filter(Boolean);
        o = parts[0] || '';
        r = parts[1] || '';
      }
    }
    if (o) this.ownerInput.set(o);
    if (r) this.repoInput.set(r);
    this.refInput.set('main');
    this.pathInput.set('Jenkinsfile');

    this.loadLatestAnalysis();
  }

  // Recharge la dernière analyse connue en base pour ce projet — appelé une
  // fois au démarrage. Si elle est encore 'pending', reprend le polling sur
  // le même jobId plutôt que de laisser l'onglet paraître vide alors qu'un
  // callback n8n peut encore arriver.
  private loadLatestAnalysis(): void {
    const pid = (this.projectId || '').trim();
    if (!pid) return;
    this.checkingHistory.set(true);
    this.http.get<any[]>(`/api/jenkins/analyses?projectId=${encodeURIComponent(pid)}`).subscribe({
      next: (rows) => {
        this.checkingHistory.set(false);
        const latest = rows?.[0];
        if (!latest) return;
        if (latest.status === 'done') {
          this.result.set(latest.result);
        } else if (latest.status === 'pending') {
          this.loading.set(true);
          this.startPolling(latest.jobId);
        } else if (latest.status === 'error') {
          this.error.set(`Bloqué : ${latest.reason || 'raison inconnue'}${latest.detail ? ' — ' + latest.detail : ''}`);
        }
      },
      // Échec silencieux : on retombe sur l'état neutre habituel, comme si
      // aucun historique n'existait — ne bloque jamais l'usage normal.
      error: () => this.checkingHistory.set(false),
    });
  }

  canFetch(): boolean { return !!this.ownerInput().trim() && !!this.repoInput().trim(); }

  fetchFromGit(): void {
    this.fetching.set(true);
    this.fetchError.set('');
    this.fetched.set(false);
    this.http.post<any>('/api/jenkins/fetch', {
      owner: this.ownerInput().trim(),
      repo: this.repoInput().trim(),
      ref: this.refInput().trim() || 'main',
      filePath: this.pathInput().trim() || 'Jenkinsfile',
    }).subscribe({
      next: (r) => {
        this.source.set(r.jenkinsfile || '');
        this.fetched.set(true);
        this.fetching.set(false);
      },
      error: (e) => {
        this.fetchError.set(e?.error?.message || 'Jenkinsfile introuvable sur le dépôt.');
        this.fetching.set(false);
      },
    });
  }

  private effOwner(): string { return (this.owner || this.ownerInput()).trim(); }
  private effRepo(): string { return (this.repo || this.repoInput()).trim(); }
  canApply(): boolean { return !!this.effOwner() && !!this.effRepo(); }

  apply(r: any): void {
    this.applying.set(true);
    this.applyError.set('');
    this.http.post<any>('/api/jenkins/apply', {
      owner: this.effOwner(),
      repo: this.effRepo(),
      baseBranch: this.baseBranch,
      filePath: 'Jenkinsfile',
      optimizedJenkinsfile: r.optimizedJenkinsfile,
    }).subscribe({
      next: (res) => { this.applied.set(res); this.applying.set(false); },
      error: (e) => {
        this.applyError.set(e?.error?.message || e?.message || 'Échec de création de la PR.');
        this.applying.set(false);
      },
    });
  }

  reject(): void { this.reset(); }

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

  analyze(): void {
    if (!this.projectId) {
      this.error.set('Projet inconnu — impossible de lancer une analyse hors contexte projet.');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.pollUnstable.set(false);
    this.pollSub?.unsubscribe();
    this.http.post<any>('/api/jenkins/optimize', {
      jenkinsfile: this.source(),
      projectId: this.projectId,
      projectName: this.projectName || 'projet',
    }).subscribe({
      next: (r) => {
        if (!r?.id) {
          // Ne devrait jamais arriver si le backend répond 200, mais on ne
          // laisse jamais le bouton "muet" — un id manquant est une erreur.
          this.error.set("Réponse inattendue du serveur : identifiant d'analyse manquant.");
          this.loading.set(false);
          return;
        }
        this.startPolling(r.id);
      },
      error: (e) => {
        this.error.set(e?.error?.message || e?.message || "Impossible de démarrer l'analyse — vérifiez que le backend est joignable.");
        this.loading.set(false);
      },
    });
  }

  // Poll GET /optimize/:id/status. "en cours" reste affiché indéfiniment
  // tant que status=pending — pas de timeout ni de seuil de temps. Seul un
  // vrai status=error (raison explicite fournie par le workflow) ou un 404
  // (job perdu/expiré) arrêtent le polling.
  private startPolling(id: string): void {
    let unstableStreak = 0;
    this.pollSub = interval(3000).pipe(
      switchMap(() => this.http.get<any>(`/api/jenkins/optimize/${id}/status`)),
    ).subscribe({
      next: (s) => {
        unstableStreak = 0;
        this.pollUnstable.set(false);
        if (s.status === 'pending') return; // on continue de poller, rien à afficher de plus
        this.pollSub?.unsubscribe();
        this.loading.set(false);
        if (s.status === 'done') {
          this.result.set(s.result);
        } else {
          this.error.set(`Bloqué : ${s.reason || 'raison inconnue'}${s.detail ? ' — ' + s.detail : ''}`);
        }
      },
      error: (e) => {
        if (e.status === 404) {
          this.pollSub?.unsubscribe();
          this.loading.set(false);
          this.error.set('Analyse introuvable ou perdue — réessayez.');
          return;
        }
        // Erreur réseau transitoire du polling lui-même (pas du job) : on ne
        // coupe pas le suivi, on signale juste une instabilité discrète.
        unstableStreak++;
        if (unstableStreak >= 3) this.pollUnstable.set(true);
      },
    });
  }

  reset(): void {
    this.pollSub?.unsubscribe();
    this.pollUnstable.set(false);
    this.result.set(null); this.copied.set(false);
    this.applied.set(null); this.applyError.set(''); this.applying.set(false);
    this.fetched.set(false); this.fetchError.set('');
  }

  copy(text: string): void {
    navigator.clipboard?.writeText(text);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  download(text: string): void {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Jenkinsfile';
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
