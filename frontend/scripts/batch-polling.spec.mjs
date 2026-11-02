// Teste le composant « batch-polling » et ses cas d’erreur.
import { sharedDependency } from './security-lifecycle-test-loader.mjs';
// Vérifie le rafraîchissement automatique pendant un lot de correction Trivy/OWASP en cours (statut DISPATCHING) sur project-detail.component.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
/** Lit les données depuis leur source. */
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
/** Simule les dépendances nécessaires au scénario. */
const angularStub = () => new Proxy({}, {
/** Récupère les données demandées. */
get: () => (..._args) => target => target });

const projectSource = read('../src/app/features/projects/project-detail.component.ts');
const projectTemplate = read('../src/app/features/projects/project-detail.component.html');

/** Vérifie les résultats attendus dans ce scénario. */
function fakeTimers() {
  const t = { fn: null, ms: null, cleared: true, id: 0 };
  return {
    /** Simule la modification demandée par le composant. */
    setInterval: (fn, ms) => { t.fn = fn; t.ms = ms; t.cleared = false; return ++t.id; },
    /** Prépare les données nécessaires à ce scénario. */
    clearInterval: () => { t.cleared = true; t.fn = null; },
    /** Vérifie les résultats attendus dans ce scénario. */
    tick: () => { assert.ok(t.fn && !t.cleared, 'expected an active interval to tick'); t.fn(); },
    info: t,
  };
}

/** Simule la lecture des données demandées par le composant. */
function loadProjectDetail(timers) {
  const exports = {};
  const code = ts.transpileModule(projectSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    /** Charge la dépendance prévue pour le scénario. */
    require: name => sharedDependency(name) || angularStub(),
    /** Simule la modification demandée par le composant. */
    setTimeout: () => 0,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    console,
  });
  return Object.create(exports['ProjectDetailComponent'].prototype);
}

/** Object.create() ne passe jamais par le constructeur. */
function freshProject(timers) {
  const project = loadProjectDetail(timers);
  project.BATCH_POLL_INTERVAL_MS = 8000;
  project.BATCH_POLL_MAX_MS = 20 * 60 * 1000;
  project.manualTasks = [];
  project.projectScopeReset$ = {
  /** Traite le résultat reçu et actualise les données locales. */
  next() {},
  /** Marque la tâche comme terminée. */
  complete() {}};
  return project;
}

/** Prépare les données nécessaires à ce scénario. */
const dispatchingTask = id => ({ id, source:'TRIVY', findingSnapshot:{ruleOrCve:id,component:'a:b'}, securityFindingRemediation: { status: 'DISPATCHING' } });
/** Prépare les données nécessaires à ce scénario. */
const closedTask = id => ({ id, source:'TRIVY', findingSnapshot:{ruleOrCve:id,component:'a:b'}, securityFindingRemediation: { status: 'CLOSED' } });

// ── CASE 1 : lancement réussi -> le polling démarre ───────────────────
{
  const timers = fakeTimers();
  const project = freshProject(timers);

  project.syncBatchPolling(); // aucune tâche en cours : no-op
  assert.equal(project.batchPolling, false);
  assert.ok(timers.info.cleared);

  project.manualTasks = [dispatchingTask('t1'), closedTask('t2')];
  project.syncBatchPolling(); // ce que loadManualRemediation() déclenche juste après launchCveBatch()
  assert.equal(project.batchPolling, true);
  assert.equal(project.dispatchingCount(), 1);
  assert.equal(timers.info.cleared, false);
  assert.equal(timers.info.ms, 8000);
}

// ── CASE 2 : plus aucune tâche en DISPATCHING -> arrêt du polling ─────
{
  const timers = fakeTimers();
  const project = freshProject(timers);
  project.manualTasks = [dispatchingTask('t1')];
  project.syncBatchPolling();
  assert.equal(project.batchPolling, true);

  // Un tick recharge les tâches ; le lot est maintenant terminé.
  project.loadManualRemediation = () => {
    project.manualTasks = [closedTask('t1')];
    project.syncBatchPolling();
  };
  timers.tick();
  assert.equal(project.batchPolling, false);
  assert.ok(timers.info.cleared, 'le minuteur doit être nettoyé une fois le lot terminé');
}

// ── CASE 3 : plafond de sécurité atteint -> arrêt + message, sans appel réseau supplémentaire
{
  const timers = fakeTimers();
  const project = freshProject(timers);
  project.manualTasks = [dispatchingTask('t1')];
  project.syncBatchPolling();
  let loadCalls = 0;
  /** Prépare les données nécessaires à ce scénario. */
  project.loadManualRemediation = () => { loadCalls++; }; // tâche toujours DISPATCHING à chaque tick

  const totalTicksToCap = project.BATCH_POLL_MAX_MS / project.BATCH_POLL_INTERVAL_MS; // 150
  for (let i = 0; i < totalTicksToCap - 1; i++) timers.tick();
  assert.equal(project.batchPollTimedOut, false);
  assert.equal(loadCalls, totalTicksToCap - 1);

  timers.tick(); // dernier tick : plafond atteint exactement
  assert.equal(project.batchPolling, false);
  assert.equal(project.batchPollTimedOut, true);
  assert.ok(timers.info.cleared);
  assert.equal(loadCalls, totalTicksToCap - 1, 'aucun rechargement supplémentaire une fois le plafond atteint');
}

// ── CASE 4 : destruction du composant -> minuteur nettoyé (pas de fuite) ─
{
  const timers = fakeTimers();
  const project = freshProject(timers);
  project.manualTasks = [dispatchingTask('t1')];
  project.syncBatchPolling();
  assert.equal(timers.info.cleared, false);

  project.ngOnDestroy();
  assert.equal(project.batchPolling, false);
  assert.ok(timers.info.cleared, 'ngOnDestroy doit nettoyer le minuteur');
}

// ── CASE 5 : rechargement de page pendant qu'un lot tourne -> reprise ──
{
  const timers = fakeTimers();
  const project = freshProject(timers);
  // Ce que loadProject() -> loadManualRemediation() produit dès le tout
  // premier chargement si des tâches sont déjà DISPATCHING côté serveur.
  project.manualTasks = [dispatchingTask('t1'), dispatchingTask('t2')];
  project.syncBatchPolling();
  assert.equal(project.batchPolling, true);
  assert.equal(project.dispatchingCount(), 2);
}

// ── CASE 6 : aucun lot en cours -> pas de polling, rien ne change ──────
{
  const timers = fakeTimers();
  const project = freshProject(timers);
  project.manualTasks = [closedTask('t1')];
  project.syncBatchPolling();
  assert.equal(project.batchPolling, false);
  assert.equal(timers.info.fn, null);
}

// ── Indication visuelle câblée dans le template ────────────────────────
assert.match(projectTemplate, /\*ngIf="batchPolling"/);
assert.match(projectTemplate, /dispatchingCount\(\)/);
assert.match(projectTemplate, /\*ngIf="batchPollTimedOut"/);

console.log('batch-polling: PASS');
