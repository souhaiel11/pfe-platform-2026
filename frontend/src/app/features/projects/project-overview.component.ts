import { Component, Input, Output, EventEmitter, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

// ─────────────────────────────────────────────────────────────────────────
//  VUE GLOBALE v2 — onglet « Rapport IA »
//  Signature : le rail de contrôle (8 portes, marqueur « arrêt ici »)
//  Usage inchangé :
//    <app-project-overview [ed]="ed" [rp]="rp" (goToTab)="activeTab = tabMap[$event]">
// ─────────────────────────────────────────────────────────────────────────

interface Stage {
  key: string; label: string; detail: string;
  state: 'pass' | 'warn' | 'fail' | 'skip'; tab: string | null;
}

@Component({
  selector: 'app-project-overview',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- ══ RAIL DE CONTRÔLE ══ -->
    <section class="chain">
      <header class="chain-head">
        <span class="eyebrow">Chaîne de contrôle du pipeline</span>
        <h3 class="chain-title">{{ verdictTitle() }}</h3>
        <p class="chain-sub">{{ verdictSub() }}</p>
      </header>

      <div class="rail-wrap">
        <ol class="gates">
          <li *ngFor="let s of stages(); let i = index; let last = last"
              class="gate" [attr.data-state]="s.state"
              [class.blocking]="blockingKey() === s.key"
              [class.clickable]="!!s.tab"
              [attr.tabindex]="s.tab ? 0 : null"
              (click)="s.tab && goToTab.emit(s.tab)"
              (keydown.enter)="s.tab && goToTab.emit(s.tab)">
            <span class="gate-track" [class.gate-track-end]="last"></span>
            <span class="gate-pip"></span>
            <span class="gate-label">{{ s.label }}</span>
            <span class="gate-detail">{{ s.detail }}</span>
            <span class="gate-flag" *ngIf="blockingKey() === s.key">Arrêt ici</span>
          </li>
        </ol>
      </div>
    </section>

    <!-- ══ OÙ SONT LES PROBLÈMES ══ -->
    <section class="block">
      <span class="eyebrow">Où sont les problèmes</span>
      <div class="tools">
        <button class="tool" *ngFor="let t of tools()"
                [attr.data-tone]="t.tone" (click)="goToTab.emit(t.tab)">
          <span class="tool-count">{{ t.count }}</span>
          <span class="tool-name">{{ t.name }}</span>
          <span class="tool-detail">{{ t.detail }}</span>
        </button>
      </div>
    </section>

    <!-- ══ GRAVITÉ + PRISE EN CHARGE ══ -->
    <div class="split">
      <section class="panel">
        <span class="eyebrow">Répartition par gravité</span>
        <div class="bar" *ngIf="totalSeverity() > 0; else noSev">
          <span class="seg" *ngFor="let s of severities()"
                [style.width.%]="s.count / totalSeverity() * 100"
                [attr.data-sev]="s.key"
                [title]="s.count + ' ' + s.label"></span>
        </div>
        <ng-template #noSev><p class="empty">Aucun problème remonté par les scanners.</p></ng-template>
        <ul class="legend">
          <li *ngFor="let s of severities()" [attr.data-sev]="s.key">
            <span class="legend-pip"></span>
            <span class="legend-count">{{ s.count }}</span>
            <span class="legend-label">{{ s.label }}</span>
          </li>
        </ul>
      </section>

      <section class="panel">
        <span class="eyebrow">Prise en charge</span>
        <div class="care">
          <div class="care-side">
            <span class="care-num auto">{{ autoCount() }}</span>
            <span class="care-lab">corrigés par l'agent</span>
          </div>
          <div class="care-div"></div>
          <div class="care-side">
            <span class="care-num manual">{{ manualCount() }}</span>
            <span class="care-lab">à corriger vous-même</span>
          </div>
        </div>
        <div class="care-bar" *ngIf="autoCount() + manualCount() > 0">
          <span class="care-fill" [style.width.%]="autoCount() / (autoCount() + manualCount()) * 100"></span>
        </div>
        <p class="care-note" *ngIf="totalEffort() > 0">
          <span class="mono">{{ totalEffort() }} min</span> de travail manuel estimé
        </p>
        <button class="link" (click)="goToTab.emit('guide')">Ouvrir le guide de correction</button>
      </section>
    </div>

    <!-- ══ À TRAITER EN PREMIER ══ -->
    <section class="block" *ngIf="topActions().length">
      <span class="eyebrow">À traiter en premier</span>
      <ol class="acts">
        <li class="act" *ngFor="let a of topActions()">
          <span class="act-rank mono">{{ a.priority }}</span>
          <div class="act-body">
            <div class="act-line">
              <span class="sev" [attr.data-sev]="sevKey(a.severity)">{{ a.severity }}</span>
              <strong class="act-title">{{ a.title }}</strong>
              <span class="who" [class.agent]="a.resolution === 'AUTO'">
                {{ a.resolution === 'AUTO' ? 'agent' : 'manuel' }}
              </span>
            </div>
            <code class="act-file" *ngIf="a.file && a.file !== 'N/A'">{{ a.file }}<ng-container *ngIf="a.line">:{{ a.line }}</ng-container></code>
          </div>
          <span class="act-effort mono" *ngIf="a.estimatedEffortMinutes">{{ a.estimatedEffortMinutes }} min</span>
        </li>
      </ol>
      <button class="link" (click)="goToTab.emit('guide')">Voir les {{ issueCount() }} problèmes détaillés</button>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      --c-fail: var(--accent-red,    #dc2626);
      --c-warn: var(--accent-orange, #ea580c);
      --c-med:  #ca8a04;
      --c-pass: var(--accent-green,  #16a34a);
      --c-auto: var(--accent-blue,   #2563eb);
      --c-line: var(--border, rgba(127,127,127,.18));
      --c-soft: rgba(127,127,127,.05);
      --c-soft2: rgba(127,127,127,.1);
      font-variant-numeric: tabular-nums;
    }
    .mono { font-family: var(--font-mono, ui-monospace, monospace); }

    .eyebrow {
      display: block; font-family: var(--font-mono, monospace);
      font-size: 10px; font-weight: 700; letter-spacing: .14em;
      text-transform: uppercase; opacity: .45; margin-bottom: 10px;
    }
    .block { margin-top: 24px; }

    /* ── Rail de contrôle ── */
    .chain { border: 1px solid var(--c-line); border-radius: 12px; padding: 20px 22px 8px; background: var(--c-soft); }
    .chain-title { margin: 0 0 4px; font-size: 19px; font-weight: 700; letter-spacing: -.01em; }
    .chain-sub { margin: 0; font-size: 13px; opacity: .68; line-height: 1.55; max-width: 68ch; }

    .rail-wrap { overflow-x: auto; margin: 18px -6px 0; }
    .gates { list-style: none; margin: 0; padding: 0 6px; display: flex; min-width: 640px; }
    .gate {
      flex: 1 1 0; position: relative; padding: 16px 8px 14px;
      display: flex; flex-direction: column; gap: 2px; border-radius: 8px;
    }
    .gate-track {
      position: absolute; top: 19px; left: 50%; width: 100%; height: 2px;
      background: var(--c-line); z-index: 0;
    }
    .gate-track-end { display: none; }
    .gate-pip {
      position: relative; z-index: 1; width: 9px; height: 9px; border-radius: 50%;
      background: var(--c-line); margin-bottom: 8px; box-shadow: 0 0 0 3px var(--c-soft);
    }
    .gate[data-state='pass'] .gate-pip { background: var(--c-pass); }
    .gate[data-state='warn'] .gate-pip { background: var(--c-warn); }
    .gate[data-state='fail'] .gate-pip { background: var(--c-fail); box-shadow: 0 0 0 4px rgba(220,38,38,.15); }
    .gate.clickable { cursor: pointer; }
    .gate.clickable:hover, .gate.clickable:focus-visible { background: var(--c-soft2); outline: none; }
    .gate.blocking { background: rgba(220,38,38,.06); }
    .gate-label { font-size: 12.5px; font-weight: 650; }
    .gate-detail { font-size: 11px; opacity: .55; font-family: var(--font-mono, monospace); }
    .gate-flag {
      margin-top: 5px; align-self: flex-start;
      font-size: 9px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase;
      color: #fff; background: var(--c-fail); border-radius: 3px; padding: 2px 6px;
    }

    /* ── Outils ── */
    .tools { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .tool {
      text-align: left; border: 1px solid var(--c-line); border-radius: 10px;
      padding: 13px 15px; background: transparent; color: inherit; font: inherit;
      cursor: pointer; display: flex; flex-direction: column; gap: 1px;
      transition: border-color .15s, background .15s;
    }
    .tool:hover { border-color: rgba(127,127,127,.45); background: var(--c-soft); }
    .tool:focus-visible { outline: 2px solid var(--c-auto); outline-offset: 2px; }
    .tool-count { font-size: 24px; font-weight: 750; line-height: 1.1; font-family: var(--font-mono, monospace); }
    .tool[data-tone='fail'] .tool-count { color: var(--c-fail); }
    .tool[data-tone='warn'] .tool-count { color: var(--c-warn); }
    .tool[data-tone='pass'] .tool-count { color: var(--c-pass); }
    .tool-name { font-size: 12.5px; font-weight: 650; margin-top: 2px; }
    .tool-detail { font-size: 11px; opacity: .55; }

    /* ── Split ── */
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 24px; }
    @media (max-width: 760px) { .split { grid-template-columns: 1fr; } }
    .panel { border: 1px solid var(--c-line); border-radius: 12px; padding: 16px 18px; }

    .bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--c-soft2); gap: 1px; }
    .seg[data-sev='critical'] { background: var(--c-fail); }
    .seg[data-sev='high']     { background: var(--c-warn); }
    .seg[data-sev='medium']   { background: var(--c-med); }
    .legend { list-style: none; margin: 12px 0 0; padding: 0; display: flex; gap: 16px; flex-wrap: wrap; }
    .legend li { display: flex; align-items: baseline; gap: 6px; font-size: 12px; }
    .legend-pip { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
    .legend li[data-sev='critical'] .legend-pip { background: var(--c-fail); }
    .legend li[data-sev='high']     .legend-pip { background: var(--c-warn); }
    .legend li[data-sev='medium']   .legend-pip { background: var(--c-med); }
    .legend-count { font-weight: 700; font-family: var(--font-mono, monospace); }
    .legend-label { opacity: .6; }
    .empty { font-size: 12.5px; opacity: .6; margin: 4px 0 0; }

    .care { display: flex; align-items: center; gap: 20px; }
    .care-div { width: 1px; align-self: stretch; background: var(--c-line); }
    .care-side { display: flex; flex-direction: column; }
    .care-num { font-size: 28px; font-weight: 750; line-height: 1.05; font-family: var(--font-mono, monospace); }
    .care-num.auto   { color: var(--c-auto); }
    .care-num.manual { color: var(--c-warn); }
    .care-lab { font-size: 11.5px; opacity: .6; margin-top: 2px; }
    .care-bar { height: 5px; border-radius: 3px; background: rgba(234,88,12,.25); margin-top: 14px; overflow: hidden; }
    .care-fill { display: block; height: 100%; background: var(--c-auto); }
    .care-note { font-size: 12px; opacity: .7; margin: 10px 0 0; }

    .link {
      background: none; border: 0; padding: 0; margin-top: 12px;
      color: var(--c-auto); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
    }
    .link:hover { text-decoration: underline; }
    .link::after { content: ' →'; }

    /* ── Actions ── */
    .acts { list-style: none; margin: 0; padding: 0; border: 1px solid var(--c-line); border-radius: 12px; overflow: hidden; }
    .act { display: flex; align-items: center; gap: 12px; padding: 11px 16px; }
    .act + .act { border-top: 1px solid var(--c-line); }
    .act-rank {
      width: 22px; height: 22px; flex-shrink: 0; border-radius: 50%;
      background: var(--c-soft2); display: inline-flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700;
    }
    .act-body { flex: 1; min-width: 0; }
    .act-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .act-title { font-size: 13px; font-weight: 600; }
    .act-file { display: block; font-size: 11px; opacity: .5; margin-top: 2px; word-break: break-all; }
    .act-effort { font-size: 11px; opacity: .5; white-space: nowrap; }

    /* ── Échelle de sévérité unifiée ── */
    .sev {
      font-size: 9.5px; font-weight: 800; letter-spacing: .06em;
      padding: 2px 7px; border-radius: 3px; text-transform: uppercase;
    }
    .sev[data-sev='critical'] { background: rgba(220,38,38,.13); color: var(--c-fail); }
    .sev[data-sev='high']     { background: rgba(234,88,12,.13); color: var(--c-warn); }
    .sev[data-sev='medium']   { background: rgba(202,138,4,.15);  color: var(--c-med); }

    .who {
      font-size: 10px; font-weight: 650; padding: 1px 8px; border-radius: 999px;
      background: rgba(234,88,12,.12); color: var(--c-warn);
    }
    .who.agent { background: rgba(37,99,235,.12); color: var(--c-auto); }

    @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  `]
})
export class ProjectOverviewComponent {
  @Input() set ed(v: any) { this._ed.set(v || {}); }
  @Input() set rp(v: any) { this._rp.set(v || {}); }
  @Output() goToTab = new EventEmitter<string>();

  private _ed = signal<any>({});
  private _rp = signal<any>({});

  private guide = computed<any>(() => this._rp()?.developerGuide || {});
  private issues = computed<any[]>(() => {
    const i = this.guide()?.issues;
    return Array.isArray(i) ? i : [];
  });

  sevKey(s: string): string {
    const u = String(s || '').toUpperCase();
    if (u === 'BLOCKER' || u === 'CRITICAL') return 'critical';
    if (u === 'HIGH' || u === 'MAJOR') return 'high';
    return 'medium';
  }

  private sonarBySeverity = computed(() => {
    const list = this._ed()?.sonar?.issues || [];
    const c = { BLOCKER: 0, CRITICAL: 0, MAJOR: 0, MINOR: 0 } as any;
    for (const i of list) { const s = String(i.severity || '').toUpperCase(); if (s in c) c[s]++; }
    return c;
  });

  stages = computed<Stage[]>(() => {
    const d = this._ed();
    const s = this.sonarBySeverity();
    const buildOk = String(d?.build?.status || '').toUpperCase() === 'SUCCESS';
    const tests = d?.tests || {};
    const sonarState: Stage['state'] =
      s.BLOCKER > 0 ? 'fail' :
      (String(d?.sonar?.quality_gate || '').toUpperCase() === 'ERROR' ? 'fail' :
      (s.CRITICAL > 0 ? 'warn' : (d?.sonar?.status === 'COMPLETED' ? 'pass' : 'skip')));
    const cveState = (crit: number, high: number, status: string): Stage['state'] =>
      status !== 'COMPLETED' ? 'skip' : (crit > 0 ? 'fail' : (high > 0 ? 'warn' : 'pass'));

    return [
      { key: 'build', label: 'Build', tab: 'jenkins',
        detail: d?.build?.number ? '#' + d.build.number : '—',
        state: buildOk ? 'pass' : (d?.build?.status ? 'fail' : 'skip') },
      { key: 'tests', label: 'Tests', tab: 'jenkins',
        detail: (tests.total ?? 0) === 0 ? 'aucun test' : `${tests.failures ?? 0} échec(s)`,
        state: (tests.total ?? 0) === 0 ? 'warn' : ((tests.failures ?? 0) > 0 ? 'fail' : 'pass') },
      { key: 'sonar', label: 'SonarQube', tab: 'sonar',
        detail: `${s.BLOCKER} bloquant(s)`, state: sonarState },
      { key: 'trivy', label: 'Conteneur', tab: 'security:trivy',
        detail: `${d?.trivy?.critical ?? 0} critique(s)`,
        state: cveState(d?.trivy?.critical ?? 0, d?.trivy?.high ?? 0, d?.trivy?.status) },
      { key: 'owasp', label: 'Dépendances', tab: 'security:owasp',
        detail: `${d?.owasp?.critical ?? 0} critique(s)`,
        state: cveState(d?.owasp?.critical ?? 0, d?.owasp?.high ?? 0, d?.owasp?.status) },
      { key: 'zap', label: 'DAST', tab: 'security:zap',
        detail: `${d?.zap?.alerts_count ?? 0} alerte(s)`,
        state: d?.zap?.status !== 'COMPLETED' ? 'skip'
             : ((d?.zap?.alerts_high ?? 0) > 0 ? 'fail'
             : ((d?.zap?.alerts_medium ?? 0) > 0 ? 'warn' : 'pass')) },
      { key: 'image', label: 'Image', tab: 'jenkins',
        detail: d?.docker?.image_tag ? String(d.docker.image_tag).split(':').pop() || '—' : '—',
        state: String(d?.docker?.build_status || '').toUpperCase() === 'SUCCESS' ? 'pass' : 'skip' },
      { key: 'deploy', label: 'Déploiement', tab: 'jenkins',
        detail: String(d?.deploy?.status || 'non lancé').toLowerCase(),
        state: String(d?.deploy?.status || '').toUpperCase() === 'SUCCESS' ? 'pass'
             : (String(d?.deploy?.status || '').toUpperCase() === 'FAILED' ? 'fail' : 'skip') },
    ];
  });

  blockingKey = computed<string | null>(() => {
    const f = this.stages().find(s => s.state === 'fail');
    return f ? f.key : null;
  });

  verdictTitle = computed<string>(() => {
    const k = this.blockingKey();
    if (!k) return 'Le pipeline passe toutes les portes';
    const s = this.stages().find(x => x.key === k);
    return `Bloqué à l'étape « ${s?.label} »`;
  });

  verdictSub = computed<string>(() => {
    const g = this.guide()?.summaryForDeveloper;
    if (g) return String(g);
    const j = this._rp()?.justification || this._rp()?.decisionReason;
    return j ? String(j).substring(0, 260) : 'Analyse en cours ou non disponible pour ce build.';
  });

  tools = computed(() => {
    const d = this._ed();
    const s = this.sonarBySeverity();
    const tone = (fail: number, warn: number) => fail > 0 ? 'fail' : (warn > 0 ? 'warn' : 'pass');
    return [
      { name: 'SonarQube', tab: 'sonar', count: d?.sonar?.issues_count ?? 0,
        detail: `${s.BLOCKER} bloquant · ${s.CRITICAL} critique`, tone: tone(s.BLOCKER, s.CRITICAL) },
      { name: 'CVE conteneur', tab: 'security:trivy', count: d?.trivy?.cves_count ?? 0,
        detail: `${d?.trivy?.critical ?? 0} critique · ${d?.trivy?.high ?? 0} élevée`,
        tone: tone(d?.trivy?.critical ?? 0, d?.trivy?.high ?? 0) },
      { name: 'CVE dépendances', tab: 'security:owasp', count: d?.owasp?.cves_count ?? 0,
        detail: `${d?.owasp?.critical ?? 0} critique · ${d?.owasp?.high ?? 0} élevée`,
        tone: tone(d?.owasp?.critical ?? 0, d?.owasp?.high ?? 0) },
      { name: 'Alertes DAST', tab: 'security:zap', count: d?.zap?.alerts_count ?? 0,
        detail: `${d?.zap?.alerts_high ?? 0} élevée · ${d?.zap?.alerts_medium ?? 0} moyenne`,
        tone: tone(d?.zap?.alerts_high ?? 0, d?.zap?.alerts_medium ?? 0) },
      { name: 'Tests', tab: 'jenkins', count: d?.tests?.total ?? 0,
        detail: `${d?.tests?.failures ?? 0} échec · ${d?.tests?.coverage ?? 0}% couverture`,
        tone: tone(d?.tests?.failures ?? 0, (d?.tests?.total ?? 0) === 0 ? 1 : 0) },
    ];
  });

  severities = computed(() => {
    const d = this._ed();
    const s = this.sonarBySeverity();
    return [
      { key: 'critical', label: 'critiques', count: s.BLOCKER + s.CRITICAL + (d?.trivy?.critical ?? 0) + (d?.owasp?.critical ?? 0) },
      { key: 'high', label: 'élevés', count: s.MAJOR + (d?.trivy?.high ?? 0) + (d?.owasp?.high ?? 0) + (d?.zap?.alerts_high ?? 0) },
      { key: 'medium', label: 'moyens', count: s.MINOR + (d?.zap?.alerts_medium ?? 0) },
    ];
  });

  totalSeverity = computed<number>(() => this.severities().reduce((a, s) => a + s.count, 0));

  autoCount = computed<number>(() =>
    this.guide()?.autoCount ?? this.issues().filter(i => i.resolution === 'AUTO').length);
  manualCount = computed<number>(() =>
    this.guide()?.manualCount ?? this.issues().filter(i => i.resolution !== 'AUTO').length);
  totalEffort = computed<number>(() =>
    this.issues().filter(i => i.resolution !== 'AUTO')
      .reduce((a, i) => a + (Number(i.estimatedEffortMinutes) || 0), 0));
  issueCount = computed<number>(() => this.issues().length);
  topActions = computed<any[]>(() =>
    [...this.issues()].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)).slice(0, 5));
}
