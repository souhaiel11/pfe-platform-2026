// Présente les étapes, les tests et les journaux d’un build.
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, interval } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { userHttpError } from '../../core/http-error-message';
import { StatusChipComponent } from '../../shared/status-chip/status-chip.component';
import { CopyableIdComponent } from '../../shared/copyable-id/copyable-id.component';
import { statusTone } from '../../shared/status-chip/status-tone';
import { frenchDate, frenchDuration, frenchRelative } from '../../shared/french-format';
import { presentationLabel } from '../../shared/status-labels';
import {
  BUILD_COMMIT_REASONS, BUILD_DETAIL_REASONS, BUILD_STAGES_REASONS,
  BuildConsole, BuildDetail, BuildStage,
} from '../../shared/build-detail.types';

// ───────────────────────────────────────────────────────────────────── <app-build-panel> — destination propre de l'étape « Build ».

/** Rafraîchissement d'un build EN COURS — jamais de sondage sur un build fini. */
const RUNNING_POLL_MS = 5000;

@Component({
  selector: 'app-build-panel',
  standalone: true,
  imports: [CommonModule, StatusChipComponent, CopyableIdComponent],
  template: `
    <section class="bp">
      <!-- ══ EN-TÊTE ══ -->
      <header class="bp-head">
        <div class="bp-head-main">
          <span class="bp-eyebrow">Exécution de build</span>
          <h3 class="bp-title">{{ headline() }}</h3>
          <p class="bp-note">
            Ce que Jenkins a réellement exécuté pour ce projet : étapes du pipeline et
            durée de chacune, étape en échec et son message exact, commit construit,
            déclencheur, paramètres, résultats de tests publiés et journal de console.
            La plateforme n'exécute rien et ne recalcule rien — elle lit le build
            <span *ngIf="detail()?.jobName">du job <code>{{ detail()!.jobName }}</code></span>.
          </p>
        </div>

        <!-- Navigation entre builds : uniquement des numéros que Jenkins
             rapporte (voisins + précédent/suivant), jamais une plage devinée. -->
        <div class="bp-nav">
          <label class="bp-nav-select" *ngIf="neighbourOptions().length">
            <span>Build</span>
            <select [value]="selectedValue()" (change)="onSelect($any($event.target).value)">
              <option value="last">Dernier build</option>
              <option *ngFor="let b of neighbourOptions()" [value]="b.number">
                #{{ b.number }} — {{ label(b.building ? 'RUNNING' : b.result) }}
              </option>
            </select>
          </label>
          <div class="bp-nav-btns">
            <button type="button" class="bp-btn ghost" *ngIf="detail()?.previousBuildNumber as previous"
                    (click)="select(previous)" [disabled]="loading()">← #{{ previous }}</button>
            <button type="button" class="bp-btn ghost" *ngIf="detail()?.nextBuildNumber as next"
                    (click)="select(next)" [disabled]="loading()">#{{ next }} →</button>
            <button type="button" class="bp-btn ghost" (click)="reload()" [disabled]="loading()">
              {{ loading() ? 'Chargement…' : 'Actualiser' }}
            </button>
            <button type="button" class="bp-btn green" *ngIf="canOperate" (click)="trigger.emit()" [disabled]="triggering">
              {{ triggering ? 'Déclenchement…' : 'Déclencher un build' }}
            </button>
          </div>
        </div>
      </header>

      <!-- ══ ÉTAT DÉGRADÉ ══ -->
      <!-- Neutre, jamais rouge : une absence d'information n'est pas un échec
           de build. Le motif exact est affiché, pas un « non disponible ». -->
      <div class="bp-degraded" *ngIf="error() || (detail() && !detail()!.available)">
        <p class="bp-degraded-title">{{ error() ? 'Lecture impossible' : 'Build non lisible' }}</p>
        <p class="bp-degraded-msg">{{ error() || unavailableText() }}</p>
        <p class="bp-degraded-code" *ngIf="!error() && detail()?.reason">Motif technique : <code>{{ detail()!.reason }}</code></p>
        <button type="button" class="bp-btn ghost" (click)="reload()" [disabled]="loading()">Réessayer</button>
      </div>

      <p class="bp-loading" role="status" *ngIf="loading() && !detail()">Lecture du build dans Jenkins…</p>

      <ng-container *ngIf="detail() as d">
        <ng-container *ngIf="d.available">
          <!-- ══ FAITS PRINCIPAUX ══ -->
          <div class="bp-kpis">
            <article class="bp-kpi" [attr.data-tone]="tone(d.status)">
              <h4>Résultat</h4>
              <app-status-chip [status]="d.status"></app-status-chip>
              <p class="bp-kpi-sub" *ngIf="d.building">Exécution en cours — actualisée automatiquement.</p>
              <p class="bp-kpi-sub" *ngIf="!d.building && d.result">Build {{ d.displayName || ('#' + d.number) }}</p>
            </article>

            <article class="bp-kpi">
              <h4>Durée</h4>
              <p class="bp-kpi-value" *ngIf="d.durationMs !== null">{{ duration(d.durationMs) }}</p>
              <p class="bp-kpi-absent" *ngIf="d.durationMs === null">{{ d.building ? 'En cours' : 'Non disponible' }}</p>
              <p class="bp-kpi-sub" *ngIf="d.estimatedDurationMs !== null">Durée estimée par Jenkins : {{ duration(d.estimatedDurationMs) }}</p>
            </article>

            <article class="bp-kpi">
              <h4>Démarré</h4>
              <p class="bp-kpi-value small" *ngIf="d.startedAt !== null">{{ date(d.startedAt) }}</p>
              <p class="bp-kpi-absent" *ngIf="d.startedAt === null">Non disponible</p>
              <p class="bp-kpi-sub" *ngIf="relative(d.startedAt) as ago">{{ ago }}</p>
              <p class="bp-kpi-sub" *ngIf="d.queueDurationMs !== null">Attente en file : {{ duration(d.queueDurationMs) }}</p>
            </article>

            <article class="bp-kpi" [attr.data-tone]="testsTone()">
              <h4>Tests publiés</h4>
              <ng-container *ngIf="d.tests as t">
                <p class="bp-kpi-value">{{ t.total === null ? 'Non disponible' : t.total }}</p>
                <p class="bp-kpi-sub">
                  <span [class.bp-bad]="(t.failed ?? 0) > 0">{{ t.failed === null ? 'échecs non disponibles' : t.failed + ' en échec' }}</span>
                  <ng-container *ngIf="t.skipped !== null"> · {{ t.skipped }} ignorés</ng-container>
                </p>
                <button type="button" class="bp-link" (click)="goToTab.emit('tests')">Détail des tests →</button>
              </ng-container>
              <p class="bp-kpi-absent" *ngIf="!d.tests">Ce build n'a publié aucun rapport de tests.</p>
            </article>

            <article class="bp-kpi">
              <h4>Déclenché par</h4>
              <p class="bp-kpi-value small" *ngIf="d.trigger?.description">{{ d.trigger!.description }}</p>
              <p class="bp-kpi-absent" *ngIf="!d.trigger?.description">Déclencheur non enregistré</p>
              <p class="bp-kpi-sub" *ngIf="d.queueId !== null">File d'attente Jenkins n° {{ d.queueId }}</p>
            </article>

            <article class="bp-kpi">
              <h4>Code construit</h4>
              <ng-container *ngIf="d.commit as c">
                <p class="bp-kpi-value small">{{ c.branch || 'Branche non enregistrée' }}</p>
                <app-copyable-id [value]="c.sha" label="le commit construit"></app-copyable-id>
                <p class="bp-kpi-sub" *ngIf="c.repo">{{ c.repo }}</p>
              </ng-container>
              <p class="bp-kpi-absent" *ngIf="!d.commit">{{ commitAbsenceText() }}</p>
            </article>
          </div>

          <!-- ══ ÉTAPES DU PIPELINE ══ -->
          <section class="bp-block">
            <header class="bp-block-head">
              <h4>Étapes du pipeline</h4>
              <p class="bp-note">
                Découpage, statut et durée tels que Jenkins les enregistre (Stage View).
                Les barres comparent les étapes entre elles sur ce build —
                l'étape la plus longue vaut 100 %.
              </p>
            </header>

            <p class="bp-failing" *ngIf="failingStages().length" [attr.data-tone]="tone(d.status)">
              <ng-container *ngIf="failingStages().length === 1">
                Première étape en échec : <strong>{{ failingStages()[0].name }}</strong>
                <ng-container *ngIf="failingStages()[0].error"> — {{ failingStages()[0].error }}</ng-container>
              </ng-container>
              <ng-container *ngIf="failingStages().length > 1">
                {{ failingStages().length }} étapes en échec, la première étant
                <strong>{{ failingStages()[0].name }}</strong>.
              </ng-container>
            </p>

            <ol class="bp-stages" *ngIf="d.stages.length">
              <li *ngFor="let s of d.stages; let i = index" [attr.data-tone]="tone(s.status)">
                <span class="bp-stage-index">{{ i + 1 }}</span>
                <div class="bp-stage-main">
                  <div class="bp-stage-line">
                    <span class="bp-stage-name">{{ s.name }}</span>
                    <app-status-chip [status]="s.status"></app-status-chip>
                    <span class="bp-stage-dur">{{ s.durationMs === null ? 'Durée non disponible' : duration(s.durationMs) }}</span>
                  </div>
                  <div class="bp-bar" *ngIf="s.durationMs !== null" [attr.aria-hidden]="true">
                    <span [style.width.%]="barWidth(s)"></span>
                  </div>
                  <p class="bp-stage-error" *ngIf="s.error">{{ s.error }}</p>
                </div>
              </li>
            </ol>

            <p class="bp-empty" *ngIf="!d.stages.length">{{ stagesAbsenceText() }}</p>
          </section>

          <!-- ══ VERDICT DE GOUVERNANCE ══ -->
          <!-- Autre question que « qu'a fait Jenkins » : c'est la lecture que
               WF1 a faite de cette étape, celle que la gouvernance de
               déploiement consulte. Jamais fusionnée avec le statut Jenkins. -->
          <section class="bp-block" *ngIf="governance">
            <header class="bp-block-head">
              <h4>Verdict de la plateforme sur l'étape build</h4>
              <p class="bp-note">
                Lecture enregistrée par l'analyse (WF1) à partir de ce build — c'est elle
                que lit la décision de déploiement, pas le statut brut de Jenkins.
              </p>
            </header>
            <p class="bp-mismatch" *ngIf="governanceMismatch()">
              Attention : ce verdict porte sur le build
              <strong>#{{ reportBuildNumber }}</strong>, pas sur le build affiché ci-dessus.
            </p>
            <dl class="bp-dl">
              <div><dt>Statut retenu</dt><dd><app-status-chip [status]="governance.status"></app-status-chip></dd></div>
              <div *ngIf="governance.message"><dt>Message</dt><dd>{{ governance.message }}</dd></div>
              <div *ngIf="governance.owner"><dt>Responsable désigné</dt><dd>{{ label(governance.owner) }}</dd></div>
              <div *ngIf="governance.problemClass"><dt>Classe de problème</dt><dd>{{ label(governance.problemClass) }}</dd></div>
              <div *ngIf="governance.technicalCode"><dt>Code technique</dt><dd><code>{{ governance.technicalCode }}</code></dd></div>
              <div><dt>Bloquant</dt><dd>{{ governance.blocking === true ? 'Oui' : governance.blocking === false ? 'Non' : 'Non disponible' }}</dd></div>
            </dl>
            <ul class="bp-evidence" *ngIf="governanceEvidence().length">
              <li *ngFor="let line of governanceEvidence()">{{ line }}</li>
            </ul>
          </section>

          <!-- ══ CHANGEMENTS ══ -->
          <section class="bp-block" *ngIf="d.changes.length || d.checkouts.length">
            <header class="bp-block-head">
              <h4>Code et changements</h4>
              <p class="bp-note">
                Révisions récupérées par le build, et les commits que Jenkins a enregistrés
                comme nouveaux depuis l'exécution précédente.
              </p>
            </header>

            <ul class="bp-checkouts" *ngIf="d.checkouts.length">
              <li *ngFor="let c of d.checkouts" [class.bp-primary]="c.primary">
                <span class="bp-checkout-repo">{{ c.repo || 'Dépôt non enregistré' }}</span>
                <span class="bp-tag" *ngIf="c.primary">dépôt du projet</span>
                <span class="bp-tag neutral" *ngIf="!c.primary">dépendance de pipeline</span>
                <span class="bp-checkout-branch">{{ c.branch || 'branche non enregistrée' }}</span>
                <app-copyable-id [value]="c.sha" label="la révision"></app-copyable-id>
              </li>
            </ul>

            <ul class="bp-changes" *ngIf="d.changes.length">
              <li *ngFor="let c of d.changes">
                <div class="bp-change-line">
                  <app-copyable-id [value]="c.sha" [length]="8" label="le commit"></app-copyable-id>
                  <span class="bp-change-msg">{{ c.message || 'Message de commit non enregistré' }}</span>
                </div>
                <p class="bp-change-meta">
                  {{ c.author || 'Auteur non enregistré' }}
                  <ng-container *ngIf="c.date"> · {{ c.date }}</ng-container>
                  <ng-container *ngIf="c.affectedPaths.length"> · {{ c.affectedPaths.length }} fichier(s)</ng-container>
                </p>
                <p class="bp-change-paths" *ngIf="c.affectedPaths.length">{{ c.affectedPaths.join(', ') }}</p>
              </li>
            </ul>
            <p class="bp-empty" *ngIf="!d.changes.length">
              Jenkins n'a enregistré aucun nouveau commit pour ce build : il a reconstruit
              la même révision que l'exécution précédente, ou l'historique n'était pas disponible.
            </p>
          </section>

          <!-- ══ PARAMÈTRES & ARTEFACTS ══ -->
          <div class="bp-split">
            <section class="bp-block" *ngIf="d.parameters.length">
              <header class="bp-block-head">
                <h4>Paramètres d'exécution</h4>
                <p class="bp-note">Valeurs avec lesquelles ce build a tourné. Un paramètre sensible n'est jamais affiché.</p>
              </header>
              <dl class="bp-dl mono">
                <div *ngFor="let p of d.parameters">
                  <dt>{{ p.name }}</dt>
                  <dd>
                    <span *ngIf="!p.masked">{{ p.value === '' ? '(vide)' : p.value }}</span>
                    <span class="bp-masked" *ngIf="p.masked">valeur masquée</span>
                  </dd>
                </div>
              </dl>
            </section>

            <section class="bp-block">
              <header class="bp-block-head">
                <h4>Artefacts Jenkins</h4>
                <p class="bp-note">Fichiers archivés par le build lui-même.</p>
              </header>
              <ul class="bp-artifacts" *ngIf="d.artifacts.length">
                <li *ngFor="let a of d.artifacts"><code>{{ a.relativePath || a.fileName }}</code></li>
              </ul>
              <p class="bp-empty" *ngIf="!d.artifacts.length">
                Ce build n'archive aucun artefact dans Jenkins. L'image produite, elle, est
                tracée côté registre —
                <button type="button" class="bp-link" (click)="goToTab.emit('docker')">voir la vue Docker</button>.
              </p>
            </section>
          </div>

          <!-- ══ JOURNAL DE CONSOLE ══ -->
          <section class="bp-block">
            <header class="bp-block-head">
              <h4>Journal de console</h4>
              <p class="bp-note">
                La fin du journal, telle que Jenkins la détient — chargée à la demande :
                un journal réel compte ici plusieurs milliers de lignes.
              </p>
            </header>

            <div class="bp-nav-btns">
              <button type="button" class="bp-btn ghost" (click)="loadConsole(200)" [disabled]="consoleLoading()">
                {{ consoleLoading() ? 'Chargement…' : '200 dernières lignes' }}
              </button>
              <button type="button" class="bp-btn ghost" (click)="loadConsole(1000)" [disabled]="consoleLoading()">
                1000 dernières lignes
              </button>
              <a class="bp-link" *ngIf="jenkinsLink() as link" [href]="link" target="_blank" rel="noopener noreferrer">
                Ouvrir ce build dans Jenkins →
              </a>
            </div>

            <p class="bp-degraded-msg" *ngIf="consoleError()">{{ consoleError() }}</p>

            <ng-container *ngIf="console() as log">
              <p class="bp-note" *ngIf="log.available">
                {{ log.lines.length }} ligne(s) affichée(s)
                <ng-container *ngIf="log.totalLines !== null"> sur {{ log.totalLines }}</ng-container>
                <ng-container *ngIf="log.truncated"> — le début du journal n'est pas affiché.</ng-container>
              </p>
              <pre class="bp-console" *ngIf="log.available && log.lines.length"><code>{{ log.lines.join('\n') }}</code></pre>
              <p class="bp-empty" *ngIf="log.available && !log.lines.length">Le journal de ce build est vide.</p>
              <p class="bp-degraded-msg" *ngIf="!log.available">{{ log.message || 'Journal non disponible.' }}</p>
            </ng-container>
          </section>
        </ng-container>
      </ng-container>
    </section>
  `,
  styles: [`
    :host { display:block; font-size:13px; color:var(--text-primary); }

    .bp-head { display:flex; flex-wrap:wrap; gap:16px; justify-content:space-between; align-items:flex-start; margin-bottom:18px; }
    .bp-head-main { flex:1; min-width:280px; }
    .bp-eyebrow { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted); margin-bottom:4px; }
    .bp-title { margin:0 0 8px; font-size:17px; font-weight:700; }
    .bp-note { margin:0; line-height:1.6; color:var(--text-secondary); max-width:80ch; }
    .bp-note code, .bp-dl.mono dd, .bp-dl code { font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11.5px; }
    .bp-note code { background:var(--bg-tertiary); padding:1px 5px; border-radius:4px; }

    .bp-nav { display:flex; flex-direction:column; gap:8px; align-items:flex-end; }
    .bp-nav-select { display:flex; align-items:center; gap:7px; font-size:11px; text-transform:uppercase;
                     letter-spacing:.04em; color:var(--text-muted); }
    .bp-nav-select select { font-size:12px; padding:5px 8px; border-radius:6px; background:var(--bg-secondary);
                            color:var(--text-primary); border:1px solid var(--border-color); }
    .bp-nav-btns { display:flex; flex-wrap:wrap; gap:7px; align-items:center; }
    .bp-btn { font-size:12px; font-weight:600; padding:6px 11px; border-radius:6px; cursor:pointer;
              border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-primary); }
    .bp-btn:hover:not(:disabled) { border-color:var(--accent-blue); color:var(--accent-blue); }
    .bp-btn:disabled { opacity:.55; cursor:default; }
    .bp-btn.green { border-color:var(--accent-green); color:var(--accent-green); }
    .bp-link { background:none; border:none; padding:0; font-size:12px; font-weight:600; color:var(--accent-blue);
               cursor:pointer; text-decoration:none; }
    .bp-link:hover { text-decoration:underline; }

    .bp-loading { margin:0 0 14px; color:var(--text-secondary); }
    .bp-degraded { background:var(--bg-secondary); border:1px solid var(--border-color); border-left:3px solid var(--text-muted);
                   border-radius:10px; padding:14px 16px; margin-bottom:16px; }
    .bp-degraded-title { margin:0 0 5px; font-weight:700; }
    .bp-degraded-msg { margin:0 0 7px; color:var(--text-secondary); line-height:1.6; }
    .bp-degraded-code { margin:0 0 9px; font-size:11.5px; color:var(--text-muted); }

    .bp-kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:12px; margin-bottom:20px; }
    .bp-kpi { background:var(--bg-secondary); border:1px solid var(--border-color); border-left:3px solid var(--border-color);
              border-radius:10px; padding:13px 15px; min-width:0; }
    .bp-kpi[data-tone='success'] { border-left-color:var(--accent-green); }
    .bp-kpi[data-tone='error']   { border-left-color:var(--accent-red); }
    .bp-kpi[data-tone='warning'] { border-left-color:var(--color-warning); }
    .bp-kpi[data-tone='pending'] { border-left-color:var(--accent-blue); }
    .bp-kpi h4 { margin:0 0 7px; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); }
    .bp-kpi-value { margin:0; font-size:19px; font-weight:700; line-height:1.25; }
    .bp-kpi-value.small { font-size:13.5px; font-weight:600; word-break:break-word; }
    .bp-kpi-absent { margin:0; font-size:12px; font-weight:600; color:var(--text-muted); line-height:1.5; }
    .bp-kpi-sub { margin:5px 0 0; font-size:11.5px; color:var(--text-secondary); line-height:1.5; }
    .bp-bad { color:var(--accent-red); font-weight:700; }

    .bp-block { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:10px;
                padding:15px 17px; margin-bottom:14px; }
    .bp-block-head { margin-bottom:12px; }
    .bp-block-head h4 { margin:0 0 5px; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-secondary); }
    .bp-split { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:14px; }
    .bp-split .bp-block { margin-bottom:14px; }

    .bp-failing { margin:0 0 12px; padding:9px 12px; border-radius:8px; line-height:1.6;
                  background:var(--bg-tertiary); border-left:3px solid var(--text-muted); }
    .bp-failing[data-tone='error']   { border-left-color:var(--accent-red); }
    .bp-failing[data-tone='warning'] { border-left-color:var(--color-warning); }
    .bp-mismatch { margin:0 0 11px; padding:9px 12px; border-radius:8px; line-height:1.6;
                   background:var(--color-warning-bg); color:var(--color-warning); }

    .bp-stages { list-style:none; margin:0; padding:0; }
    .bp-stages li { display:flex; gap:11px; padding:10px 0; border-bottom:1px solid var(--bg-tertiary); }
    .bp-stages li:last-child { border-bottom:none; }
    .bp-stage-index { flex:none; width:22px; height:22px; border-radius:50%; background:var(--bg-tertiary);
                      color:var(--text-muted); font-size:11px; font-weight:700; display:flex;
                      align-items:center; justify-content:center; }
    li[data-tone='success'] .bp-stage-index { background:var(--accent-green-bg, var(--bg-tertiary)); color:var(--accent-green); }
    li[data-tone='error'] .bp-stage-index   { background:var(--accent-red-bg); color:var(--accent-red); }
    li[data-tone='warning'] .bp-stage-index { background:var(--color-warning-bg); color:var(--color-warning); }
    li[data-tone='pending'] .bp-stage-index { background:var(--accent-blue-bg); color:var(--accent-blue); }
    .bp-stage-main { flex:1; min-width:0; }
    .bp-stage-line { display:flex; flex-wrap:wrap; align-items:center; gap:9px; }
    .bp-stage-name { font-weight:600; }
    .bp-stage-dur { font-size:11.5px; color:var(--text-muted); margin-left:auto; white-space:nowrap; }
    .bp-bar { margin-top:7px; height:4px; border-radius:2px; background:var(--bg-tertiary); overflow:hidden; }
    .bp-bar span { display:block; height:100%; background:var(--text-muted); }
    li[data-tone='success'] .bp-bar span { background:var(--accent-green); }
    li[data-tone='error'] .bp-bar span   { background:var(--accent-red); }
    li[data-tone='warning'] .bp-bar span { background:var(--color-warning); }
    li[data-tone='pending'] .bp-bar span { background:var(--accent-blue); }
    .bp-stage-error { margin:8px 0 0; padding:8px 10px; border-radius:6px; background:var(--accent-red-bg);
                      color:var(--accent-red); font-family:'JetBrains Mono', ui-monospace, monospace;
                      font-size:11.5px; line-height:1.55; word-break:break-word; }

    .bp-dl { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:11px 16px; margin:0; }
    .bp-dl dt { font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-muted); margin-bottom:3px; }
    .bp-dl dd { margin:0; font-size:12.5px; line-height:1.5; word-break:break-word; }
    .bp-masked { font-size:11.5px; color:var(--text-muted); font-style:italic; }

    .bp-evidence { list-style:none; margin:12px 0 0; padding:0; }
    .bp-evidence li { padding:7px 10px; margin-bottom:6px; border-radius:6px; background:var(--bg-tertiary);
                      font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11.5px; line-height:1.55;
                      word-break:break-word; }

    .bp-checkouts { list-style:none; margin:0 0 14px; padding:0; }
    .bp-checkouts li { display:flex; flex-wrap:wrap; align-items:center; gap:9px; padding:8px 0;
                       border-bottom:1px solid var(--bg-tertiary); }
    .bp-checkouts li:last-child { border-bottom:none; }
    .bp-checkout-repo { font-size:12px; word-break:break-all; }
    .bp-checkout-branch { font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11px; color:var(--text-secondary); }
    .bp-tag { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:2px 7px;
              border-radius:4px; background:var(--accent-blue-bg); color:var(--accent-blue); white-space:nowrap; }
    .bp-tag.neutral { background:var(--bg-tertiary); color:var(--text-muted); }

    .bp-changes { list-style:none; margin:0; padding:0; }
    .bp-changes li { padding:10px 0; border-bottom:1px solid var(--bg-tertiary); }
    .bp-changes li:last-child { border-bottom:none; }
    .bp-change-line { display:flex; flex-wrap:wrap; align-items:baseline; gap:9px; }
    .bp-change-msg { font-weight:600; min-width:0; word-break:break-word; }
    .bp-change-meta { margin:4px 0 0; font-size:11.5px; color:var(--text-secondary); }
    .bp-change-paths { margin:4px 0 0; font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11px;
                       color:var(--text-muted); word-break:break-all; }

    .bp-artifacts { list-style:none; margin:0; padding:0; }
    .bp-artifacts li { padding:6px 0; border-bottom:1px solid var(--bg-tertiary); }
    .bp-artifacts li:last-child { border-bottom:none; }
    .bp-artifacts code { font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11.5px; word-break:break-all; }

    .bp-console { margin:12px 0 0; padding:12px 14px; max-height:420px; overflow:auto; border-radius:8px;
                  background:var(--bg-tertiary); border:1px solid var(--border-color); }
    .bp-console code { font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11px; line-height:1.55;
                       white-space:pre; color:var(--text-primary); }

    .bp-empty { margin:0; color:var(--text-muted); line-height:1.6; }
  `]
})
export class BuildPanelComponent implements OnInit, OnDestroy {
  @Input() projectId: string | null = null;
  /**
   * Résolveur d'URL Jenkins navigable, fourni par le parent
   * (project-detail.buildUrl) : ce composant ne fabrique aucune URL — une
   * adresse de service interne n'est pas joignable depuis un navigateur.
   */
  @Input() browserUrl: ((url: string | null | undefined) => string | null) | null = null;
  /** `enrichedData.stages.build` du rapport affiché — verdict de WF1. */
  @Input() governance: any = null;
  /** Numéro de build du rapport affiché, pour signaler un verdict décalé. */
  @Input() reportBuildNumber: number | null = null;
  @Input() canOperate = false;
  @Input() triggering = false;

  @Output() goToTab = new EventEmitter<string>();
  @Output() trigger = new EventEmitter<void>();

  readonly detail = signal<BuildDetail | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly console = signal<BuildConsole | null>(null);
  readonly consoleLoading = signal(false);
  readonly consoleError = signal<string | null>(null);

  /** Build demandé : un numéro, ou « last » tant que l'utilisateur n'a pas choisi. */
  private readonly selected = signal<number | 'last'>('last');
  private pollSub: Subscription | null = null;

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly api: ApiService) {}

  /** Charge les données nécessaires à l’ouverture du composant. */
  ngOnInit() { this.load(); }
  /** Arrête les abonnements et les suivis du composant. */
  ngOnDestroy() { this.stopPolling(); }

  // ── Présentation ────────────────────────────────────────────────
  tone = (status: unknown) => statusTone(status);
  /** Renvoie le libellé présenté à l’utilisateur. */
  label = (raw: string | null | undefined) => presentationLabel(raw);
  /** Formate la date pour l’affichage. */
  date = (ms: number | null) => frenchDate(ms);
  /** Exprime l’ancienneté de la date pour l’affichage. */
  relative = (ms: number | null) => frenchRelative(ms);
  /** Les durées arrivent en millisecondes ; frenchDuration parle en secondes. */
  duration(ms: number | null): string {
    if (ms === null) return 'Non disponible';
    // Sous la seconde, arrondir à 0 s effacerait une étape réellement courte.
    return ms < 1000 ? `${ms} ms` : frenchDuration(Math.round(ms / 1000));
  }

  selectedValue = computed<string>(() => String(this.selected()));

  neighbourOptions = computed(() => this.detail()?.neighbours ?? []);

  headline = computed<string>(() => {
    const d = this.detail();
    if (!d) return this.loading() ? 'Lecture du build…' : 'Aucun build lu';
    if (!d.available) return 'Build non lisible';
    const name = d.displayName || (d.number !== null ? `#${d.number}` : 'Build');
    if (d.building) return `Build ${name} en cours`;
    const failing = this.failingStages()[0];
    if (failing) return `Build ${name} — échec à l'étape « ${failing.name} »`;
    const status = String(d.status || '').toUpperCase();
    if (status === 'SUCCESS') {
      return d.durationMs !== null
        ? `Build ${name} réussi en ${this.duration(d.durationMs)}`
        : `Build ${name} réussi`;
    }
    if (status === 'UNSTABLE') return `Build ${name} instable`;
    if (status === 'ABORTED') return `Build ${name} interrompu`;
    if (status === 'FAILURE') return `Build ${name} en échec`;
    return `Build ${name} — résultat ${this.label(d.status).toLowerCase()}`;
  });

  /**
   * Étapes réellement en défaut, dans l'ordre du pipeline. L'étape qui a
   * ARRÊTÉ le build est la première : c'est elle qu'il faut lire en premier.
   */
  failingStages = computed<BuildStage[]>(() =>
    (this.detail()?.stages ?? []).filter(s => ['FAILED', 'FAILURE', 'UNSTABLE', 'ABORTED'].includes(String(s.status || '').toUpperCase())));

  private longestStageMs = computed<number>(() =>
    (this.detail()?.stages ?? []).reduce((max, s) => Math.max(max, s.durationMs ?? 0), 0));

  /** Largeur COMPARATIVE : l'étape la plus longue de ce build vaut 100 %. */
  barWidth(stage: BuildStage): number {
    const longest = this.longestStageMs();
    if (!longest || stage.durationMs === null) return 0;
    return Math.max(Math.round((stage.durationMs / longest) * 100), 1);
  }

  /** Choisit la tonalité des résultats de tests. */
  testsTone(): string {
    const tests = this.detail()?.tests;
    if (!tests || tests.failed === null) return 'neutral';
    return tests.failed > 0 ? 'error' : 'success';
  }

  /** Construit le lien du build dans Jenkins. */
  jenkinsLink(): string | null {
    const url = this.detail()?.url;
    if (!url) return null;
    return this.browserUrl ? this.browserUrl(url) : null;
  }

  /** Explique pourquoi la donnée est indisponible. */
  unavailableText(): string {
    const d = this.detail();
    if (!d) return '';
    return (d.reason && BUILD_DETAIL_REASONS[d.reason]) || d.message || 'Jenkins n’a pas pu fournir ce build.';
  }

  /** Explique pourquoi le commit du build est absent. */
  commitAbsenceText(): string {
    const reason = this.detail()?.commitReason;
    return (reason && BUILD_COMMIT_REASONS[reason]) || 'Commit construit non enregistré par ce build.';
  }

  /** Explique pourquoi les étapes du build sont absentes. */
  stagesAbsenceText(): string {
    const reason = this.detail()?.stagesReason;
    return (reason && BUILD_STAGES_REASONS[reason])
      || 'Aucun découpage en étapes n’est disponible pour ce build.';
  }

  /** Le verdict de gouvernance chargé par le parent porte sur le build du RAPPORT affiché. */
  governanceMismatch(): boolean {
    const shown = this.detail()?.number;
    return this.reportBuildNumber !== null && shown !== null && shown !== undefined
      && this.reportBuildNumber !== shown;
  }

  /** Sélectionne les preuves utiles à la décision de déploiement. */
  governanceEvidence(): string[] {
    const evidence = this.governance?.evidence;
    if (!Array.isArray(evidence)) return [];
    return evidence.map((line: unknown) => String(line ?? '').trim()).filter((line: string) => line.length > 0);
  }

  /** Traite Select. */
  onSelect(value: string) {
    const parsed = Number(value);
    this.select(Number.isInteger(parsed) && parsed > 0 ? parsed : 'last');
  }

  /** Sélectionne l’élément à consulter. */
  select(build: number | 'last') {
    this.selected.set(build);
    // Le journal appartient au build précédent : ne jamais le laisser
    // affiché sous un autre numéro.
    this.console.set(null);
    this.consoleError.set(null);
    this.load();
  }

  /** Recharge les données affichées. */
  reload() { this.load(); }

  /** Charge les données nécessaires au composant. */
  private load() {
    if (!this.projectId) return;
    this.stopPolling();
    this.loading.set(true);
    this.error.set(null);
    this.api.getBuildDetail(this.projectId, this.selected()).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: detail => {
        this.loading.set(false);
        this.detail.set(detail);
        // Un build en cours change sous nos yeux : le suivre tant qu'il
        // tourne, et s'arrêter dès qu'il est terminé.
        if (detail?.available && detail.building) this.startPolling();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: err => {
        this.loading.set(false);
        this.detail.set(null);
        this.error.set(userHttpError(err, 'Impossible de lire ce build. Réessayez dans un instant.'));
      },
    });
  }

  /** Démarre la consultation périodique du statut. */
  private startPolling() {
    if (this.pollSub) return;
    this.pollSub = interval(RUNNING_POLL_MS).subscribe(() => {
      if (!this.projectId) return;
      this.api.getBuildDetail(this.projectId, this.selected()).subscribe({
        /** Traite le résultat reçu et actualise les données locales. */
        next: detail => {
          this.detail.set(detail);
          if (!detail?.available || !detail.building) this.stopPolling();
        },
        // Une erreur transitoire n'efface pas le build déjà affiché : elle
        // arrête seulement le suivi automatique.
        error: () => this.stopPolling(),
      });
    });
  }

  /** Arrête la consultation périodique du statut. */
  private stopPolling() {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }

  /** Charge console. */
  loadConsole(tail: number) {
    if (!this.projectId) return;
    const build = this.detail()?.number ?? this.selected();
    this.consoleLoading.set(true);
    this.consoleError.set(null);
    this.api.getBuildConsole(this.projectId, build, tail).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: log => { this.consoleLoading.set(false); this.console.set(log); },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: err => {
        this.consoleLoading.set(false);
        this.console.set(null);
        this.consoleError.set(userHttpError(err, 'Impossible de lire le journal de ce build.'));
      },
    });
  }
}
