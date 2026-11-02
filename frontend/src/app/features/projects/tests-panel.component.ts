// Affiche les résultats et la couverture des tests.
import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { availableNumber, testStageCoverage, testStageCoverageState } from '../../shared/data-truth';
import { presentationLabel } from '../../shared/status-labels';

// ─────────────────────────────────────────────────────────────────────
//  <app-tests-panel> — destination propre de l'etape « Tests ».
//
//  Pourquoi ce composant existe : l'etape Tests du rail de controle
//  envoyait l'utilisateur sur l'onglet Jenkins, c'est-a-dire sur la liste
//  des BUILDS. Jenkins est la preuve d'execution, pas l'information sur
//  les tests : on y voit « build #156 SUCCESS », jamais combien de tests
//  ont tourne, lesquels, ni quelle couverture ils ont mesuree. Meme
//  raisonnement que R49 pour l'etape 'docker' (routee vers la vue Docker
//  plutot que vers Jenkins) : Jenkins reste accessible ici en preuve
//  secondaire, par un lien explicite.
//
//  Ce que cette vue affirme, et d'ou ca vient exactement :
//    • les totaux (total/echecs/ignores) sont ceux que le build publie
//      lui-meme — BuildRunner.processSurefireResults() somme les attributs
//      @tests/@failures/@errors/@skipped de chaque
//      target/surefire-reports/TEST-*.xml ;
//    • la couverture vient du rapport JaCoCo du meme build
//      (target/site/jacoco/jacoco.xml, dernier compteur LINE) ;
//    • le detail par cas de test vient de semanticEvidence.payload.testcases,
//      produit par le meme passage de lecture des rapports Surefire.
//
//  La plateforme n'execute aucun test et n'en recalcule aucun total : elle
//  lit des faits. Discipline habituelle de cette base : une donnee absente
//  s'affiche comme absente, avec son motif, et jamais comme un zero vert.
//  En particulier `coverage: 0` ecrit par une etape non executee n'est
//  JAMAIS presente comme « 0 % » — c'est a ca que servent
//  testStageCoverage/testStageCoverageState.
// ─────────────────────────────────────────────────────────────────────

type RunState = 'pass' | 'fail' | 'warn' | 'skip';

interface TestRunView {
  key: 'main' | 'validation';
  title: string;
  /** Ce que cette execution prouve, en une phrase. Jamais decoratif. */
  purpose: string;
  /** Contexte exact (build, PR, commit) — null quand non enregistre. */
  context: string | null;
  statusLabel: string;
  state: RunState;
  total: number | null;
  failures: number | null;
  skipped: number | null;
  passed: number | null;
  coverage: number | null;
  /** Motif d'absence de couverture, chaine vide quand une valeur existe. */
  coverageState: string;
  buildUrl: string | null;
}

interface TestCaseRow { name: string; status: string; }
interface TestCaseGroup { classname: string; simpleName: string; cases: TestCaseRow[]; failures: number; }

// Vocabulaire de l'etage tel que WF1 l'ecrit (stages.tests.status) ET
// vocabulaire brut de Jenkins tel que la bibliotheque partagee le rapporte
// (tests.status). Les deux sont acceptes : aucune valeur inconnue n'est
// repliee sur « reussi ».
const PASS_STATUSES = ['PASSED', 'SUCCESS'];
const FAIL_STATUSES = ['FAILED', 'FAILURE'];
const NOT_RUN_STATUSES = ['NOT_RUN', 'NOT_REACHED', 'SKIPPED', 'NOT_CONFIGURED'];

@Component({
  selector: 'app-tests-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="tp">
      <header class="tp-head">
        <span class="tp-eyebrow">Tests applicatifs</span>
        <h3 class="tp-title">{{ headline() }}</h3>
        <p class="tp-note">
          Tests unitaires JUnit de l'application, exécutés par Maven Surefire pendant
          <code>mvn clean package</code> — le seul étage du pipeline où des tests tournent.
          La plateforme ne les exécute pas : elle lit les totaux publiés par le build
          (<code>target/surefire-reports/TEST-*.xml</code>) et la couverture de lignes
          mesurée par JaCoCo.
        </p>
      </header>

      <!-- ══ EXECUTIONS ══ -->
      <div class="tp-runs">
        <article class="tp-run" *ngFor="let r of runs()" [attr.data-state]="r.state">
          <header class="tp-run-head">
            <h4>{{ r.title }}</h4>
            <span class="tp-badge" [attr.data-state]="r.state">{{ r.statusLabel }}</span>
          </header>
          <p class="tp-purpose">{{ r.purpose }}</p>
          <p class="tp-context" *ngIf="r.context">{{ r.context }}</p>

          <dl class="tp-metrics">
            <div>
              <dt>Tests exécutés</dt>
              <dd>{{ r.total === null ? 'Non disponible' : r.total }}</dd>
            </div>
            <div>
              <dt>Réussis</dt>
              <dd>{{ r.passed === null ? 'Non disponible' : r.passed }}</dd>
            </div>
            <div [class.tp-bad]="(r.failures ?? 0) > 0">
              <dt>En échec</dt>
              <dd>{{ r.failures === null ? 'Non disponible' : r.failures }}</dd>
            </div>
            <div>
              <dt>Ignorés</dt>
              <dd>{{ r.skipped === null ? 'Non disponible' : r.skipped }}</dd>
            </div>
            <div>
              <dt>Couverture de lignes</dt>
              <dd>
                <ng-container *ngIf="r.coverage !== null">{{ r.coverage }} %</ng-container>
                <span class="tp-absent" *ngIf="r.coverage === null">{{ r.coverageState || 'Non disponible' }}</span>
              </dd>
            </div>
          </dl>

          <!-- Jenkins reste la preuve d'execution, en lien secondaire explicite. -->
          <a class="tp-evidence" *ngIf="r.buildUrl" [href]="r.buildUrl" target="_blank" rel="noopener">
            Preuve d'exécution dans Jenkins →
          </a>
        </article>
      </div>

      <!-- ══ DETAIL PAR CAS DE TEST ══ -->
      <section class="tp-cases" *ngIf="caseGroups().length">
        <header class="tp-cases-head">
          <h4>Détail par cas de test</h4>
          <p class="tp-note">
            {{ caseCount() }} cas, répartis sur {{ caseGroups().length }}
            {{ caseGroups().length === 1 ? 'classe' : 'classes' }}.
            {{ casesProvenance() }}
          </p>
        </header>

        <div class="tp-group" *ngFor="let g of caseGroups()">
          <header class="tp-group-head">
            <span class="tp-class" [title]="g.classname">{{ g.simpleName }}</span>
            <span class="tp-class-pkg">{{ g.classname }}</span>
            <span class="tp-count" [class.tp-bad]="g.failures > 0">
              {{ g.cases.length }} {{ g.cases.length === 1 ? 'cas' : 'cas' }}
              <ng-container *ngIf="g.failures > 0"> · {{ g.failures }} en échec</ng-container>
            </span>
          </header>
          <ul class="tp-case-list">
            <li *ngFor="let c of g.cases" [attr.data-status]="c.status">
              <span class="tp-dot" aria-hidden="true"></span>
              <span class="tp-case-name">{{ c.name }}</span>
              <span class="tp-case-status">{{ caseStatusLabel(c.status) }}</span>
            </li>
          </ul>
        </div>
      </section>

      <p class="tp-empty" *ngIf="!caseGroups().length">
        {{ casesAbsenceReason() }}
      </p>
    </section>
  `,
  styles: [`
    :host { display:block; font-size:13px; color:var(--text-primary); }

    .tp-head { margin-bottom:18px; }
    .tp-eyebrow { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted); margin-bottom:4px; }
    .tp-title { margin:0 0 8px; font-size:17px; font-weight:700; }
    .tp-note { margin:0; line-height:1.6; color:var(--text-secondary); max-width:76ch; }
    .tp-note code { font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11.5px;
                    background:var(--bg-tertiary); padding:1px 5px; border-radius:4px; }

    .tp-runs { display:grid; grid-template-columns:repeat(auto-fit, minmax(290px, 1fr)); gap:14px; margin-bottom:22px; }
    .tp-run { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:10px; padding:15px 17px;
              border-left:3px solid var(--border-color); }
    .tp-run[data-state='pass'] { border-left-color:var(--accent-green); }
    .tp-run[data-state='fail'] { border-left-color:var(--accent-red); }
    .tp-run[data-state='warn'] { border-left-color:var(--color-warning); }
    .tp-run[data-state='skip'] { border-left-color:var(--text-muted); }

    .tp-run-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:7px; }
    .tp-run-head h4 { margin:0; font-size:13.5px; font-weight:700; }
    .tp-badge { font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px; white-space:nowrap; }
    .tp-badge[data-state='pass'] { background:var(--accent-green-bg, var(--accent-blue-bg)); color:var(--accent-green); }
    .tp-badge[data-state='fail'] { background:var(--accent-red-bg); color:var(--accent-red); }
    .tp-badge[data-state='warn'] { background:var(--color-warning-bg); color:var(--color-warning); }
    .tp-badge[data-state='skip'] { background:var(--bg-tertiary); color:var(--text-muted); }

    .tp-purpose { margin:0 0 6px; line-height:1.5; color:var(--text-secondary); font-size:12.5px; }
    .tp-context { margin:0 0 12px; font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11px;
                  color:var(--text-muted); word-break:break-all; }

    .tp-metrics { display:grid; grid-template-columns:repeat(auto-fit, minmax(96px, 1fr)); gap:11px 14px; margin:0 0 12px; }
    .tp-metrics dt { font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-muted); margin-bottom:2px; }
    .tp-metrics dd { margin:0; font-size:17px; font-weight:700; line-height:1.2; }
    .tp-metrics .tp-bad dd { color:var(--accent-red); }
    .tp-absent { font-size:12px; font-weight:600; color:var(--text-muted); }

    .tp-evidence { display:inline-block; font-size:12px; font-weight:600; color:var(--accent-blue); text-decoration:none; }
    .tp-evidence:hover { text-decoration:underline; }

    .tp-cases-head { margin-bottom:12px; }
    .tp-cases-head h4 { margin:0 0 5px; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-secondary); }

    .tp-group { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:10px;
                margin-bottom:10px; overflow:hidden; }
    .tp-group-head { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; padding:10px 14px;
                     background:var(--bg-tertiary); border-bottom:1px solid var(--border-color); }
    .tp-class { font-weight:700; font-size:13px; }
    .tp-class-pkg { font-family:'JetBrains Mono', ui-monospace, monospace; font-size:10.5px; color:var(--text-muted);
                    word-break:break-all; flex:1; min-width:120px; }
    .tp-count { font-size:11px; font-weight:600; color:var(--text-muted); white-space:nowrap; }
    .tp-count.tp-bad { color:var(--accent-red); }

    .tp-case-list { list-style:none; margin:0; padding:0; }
    .tp-case-list li { display:flex; align-items:center; gap:9px; padding:7px 14px; border-bottom:1px solid var(--bg-tertiary); }
    .tp-case-list li:last-child { border-bottom:none; }
    .tp-dot { width:7px; height:7px; border-radius:50%; background:var(--text-muted); flex:none; }
    li[data-status='PASS'] .tp-dot { background:var(--accent-green); }
    li[data-status='FAILURE'] .tp-dot,
    li[data-status='ERROR'] .tp-dot { background:var(--accent-red); }
    li[data-status='SKIPPED'] .tp-dot { background:var(--color-warning); }
    .tp-case-name { font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11.5px; word-break:break-all; flex:1; }
    .tp-case-status { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--text-muted); white-space:nowrap; }
    li[data-status='FAILURE'] .tp-case-status,
    li[data-status='ERROR'] .tp-case-status { color:var(--accent-red); }

    .tp-empty { margin:0; padding:20px; text-align:center; color:var(--text-muted); line-height:1.6;
                background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:10px; }
  `]
})
export class TestsPanelComponent {
  /** enrichedData du rapport affiche (bloc `tests` + `stages.tests` + `build`). */
  @Input() set enrichedData(value: any) { this._ed.set(value || {}); }
  /** metadata.validation du meme incident — execution de validation de PR (WF3). */
  @Input() set validation(value: any) { this._validation.set(value || null); }
  /**
   * Resolveur d'URL Jenkins navigable, fourni par le parent
   * (project-detail.buildUrl) : ce composant ne fabrique aucune URL
   * lui-meme — une URL interne Docker n'est pas joignable du navigateur.
   */
  @Input() browserUrl: ((url: string | null | undefined) => string | null) | null = null;

  private _ed = signal<any>({});
  private _validation = signal<any>(null);

  /** Résout URL. */
  private resolveUrl(raw: string | null | undefined): string | null {
    if (!raw) return null;
    return this.browserUrl ? this.browserUrl(raw) : null;
  }

  /** Retrouve l’état normalisé du résultat. */
  private stateOf(status: string): RunState {
    const s = String(status || '').trim().toUpperCase();
    if (FAIL_STATUSES.includes(s)) return 'fail';
    if (PASS_STATUSES.includes(s)) return 'pass';
    if (NOT_RUN_STATUSES.includes(s)) return 'skip';
    return 'warn';
  }

  /** Reussis = total - echecs - ignores, et seulement quand les TROIS sont reellement disponibles. */
  private passedCount(total: number | null, failures: number | null, skipped: number | null): number | null {
    if (total === null || failures === null || skipped === null) return null;
    const value = total - failures - skipped;
    return value >= 0 ? value : null;
  }

  /** Construit Run. */
  private buildRun(key: 'main' | 'validation', tests: any, opts: { title: string; purpose: string; context: string | null; status: string; buildUrl: string | null }): TestRunView {
    const total = availableNumber(tests?.total);
    const failures = availableNumber(tests?.failures);
    const skipped = availableNumber(tests?.skipped);
    return {
      key,
      title: opts.title,
      purpose: opts.purpose,
      context: opts.context,
      statusLabel: presentationLabel(opts.status) || 'Indéterminé',
      state: this.stateOf(opts.status),
      total, failures, skipped,
      passed: this.passedCount(total, failures, skipped),
      coverage: testStageCoverage(tests),
      coverageState: testStageCoverageState(tests),
      buildUrl: opts.buildUrl,
    };
  }

  runs = computed<TestRunView[]>(() => {
    const ed = this._ed();
    const out: TestRunView[] = [];

    const tests = ed?.tests;
    const stage = ed?.stages?.tests;
    if (tests || stage) {
      // Le statut d'ETAGE (stages.tests.status) est la valeur canonique :
      // c'est elle que lit la gouvernance de deploiement. Le statut brut de
      // Jenkins (tests.status) ne sert de repli que si l'etage est absent.
      const status = String(stage?.status || tests?.status || '').toUpperCase();
      const number = ed?.build?.number;
      out.push(this.buildRun('main', tests, {
        title: number ? `Build principal #${number}` : 'Build principal',
        purpose: "Exécution de référence : c'est ce résultat que la chaîne de contrôle et la décision de déploiement lisent.",
        context: ed?.build?.job ? `${ed.build.job}${number ? ` · build ${number}` : ''}` : null,
        status,
        buildUrl: this.resolveUrl(ed?.build?.url),
      }));
    }

    const v = this._validation();
    if (v?.tests) {
      const pr = availableNumber(v?.prNumber);
      const vBuild = availableNumber(v?.buildNumber);
      out.push(this.buildRun('validation', v.tests, {
        title: pr !== null ? `Validation de la PR #${pr}` : 'Validation de correctif',
        purpose: 'Les mêmes tests rejoués sur la branche de correctif — c\'est cette exécution qui atteste qu\'un correctif n\'a rien cassé.',
        context: [
          vBuild !== null ? `build de validation ${vBuild}` : null,
          typeof v?.checkoutSha === 'string' && /^[0-9a-f]{7,40}$/i.test(v.checkoutSha) ? `commit ${v.checkoutSha.slice(0, 12)}` : null,
        ].filter(Boolean).join(' · ') || null,
        status: String(v.tests?.status || '').toUpperCase(),
        buildUrl: this.resolveUrl(v?.jenkinsBuildUrl || v?.buildUrl),
      }));
    }

    return out;
  });

  headline = computed<string>(() => {
    const runs = this.runs();
    if (!runs.length) return 'Aucun résultat de tests enregistré pour cette analyse';
    const main = runs.find(r => r.key === 'main') || runs[0];
    if (main.state === 'fail') {
      return main.failures !== null
        ? `${main.failures} ${main.failures === 1 ? 'test en échec' : 'tests en échec'}`
        : 'Tests en échec';
    }
    if (main.state === 'skip') return 'Tests non exécutés pour ce build';
    if (main.state === 'warn') return 'Résultat des tests indéterminé';
    return main.total !== null ? `${main.total} tests exécutés sans échec` : 'Tests exécutés sans échec';
  });

  private rawCases = computed<TestCaseRow[]>(() => {
    const payload = this._validation()?.semanticEvidence?.payload;
    const cases = Array.isArray(payload?.testcases) ? payload.testcases : [];
    return cases
      .filter((c: any) => c && typeof c.name === 'string' && c.name.trim())
      .map((c: any) => ({
        name: String(c.name).trim(),
        status: String(c.status || '').trim().toUpperCase() || 'UNKNOWN',
        classname: typeof c.classname === 'string' ? c.classname.trim() : '',
      })) as any[];
  });

  caseCount = computed<number>(() => this.rawCases().length);

  caseGroups = computed<TestCaseGroup[]>(() => {
    const groups = new Map<string, TestCaseGroup>();
    for (const c of this.rawCases() as any[]) {
      const classname = c.classname || 'Classe non renseignée';
      let group = groups.get(classname);
      if (!group) {
        const parts = classname.split('.');
        group = { classname, simpleName: parts[parts.length - 1] || classname, cases: [], failures: 0 };
        groups.set(classname, group);
      }
      group.cases.push({ name: c.name, status: c.status });
      if (['FAILURE', 'ERROR'].includes(c.status)) group.failures++;
    }
    // Les classes en echec d'abord : ce qui demande une action se lit en premier.
    return [...groups.values()].sort((a, b) => (b.failures - a.failures) || a.simpleName.localeCompare(b.simpleName));
  });

  /** Décrit l’origine des cas de test affichés. */
  casesProvenance(): string {
    const v = this._validation();
    const pr = availableNumber(v?.prNumber);
    return pr !== null
      ? `Relevé sur l'exécution de validation de la PR #${pr} — le build principal ne transmet pas encore ce détail.`
      : "Relevé sur l'exécution de validation de correctif — le build principal ne transmet pas encore ce détail.";
  }

  /** Explique pourquoi les cas de test sont absents. */
  casesAbsenceReason(): string {
    if (!this.runs().length) {
      return "Aucun bloc de tests n'est enregistré sur cette analyse : le build n'a transmis ni totaux ni rapport exploitable.";
    }
    return "Le détail par cas de test n'est pas disponible pour cette analyse. "
      + "Il n'est transmis aujourd'hui que par une exécution de validation de correctif (WF3) ; "
      + "les totaux ci-dessus restent, eux, ceux rapportés par le build.";
  }

  /** Traduit le statut d’un cas de test. */
  caseStatusLabel(status: string): string {
    const labels: Record<string, string> = { PASS: 'Réussi', FAILURE: 'Échec', ERROR: 'Erreur', SKIPPED: 'Ignoré' };
    return labels[status] || 'Indéterminé';
  }
}
