import { sharedDependency } from './security-lifecycle-test-loader.mjs';
// Vérifie le rafraîchissement automatique pendant un lot de correction
// Trivy/OWASP en cours (statut DISPATCHING) sur project-detail.component.ts :
// démarrage après un lancement, arrêt dès que le lot est terminé, plafond de
// sécurité, nettoyage à la destruction, reprise après rechargement de page.
//
// Même technique que merge-ready-success.spec.mjs : la vraie source .ts est
// transpilée et exécutée dans un bac à sable, puis instanciée via
// Object.create() (sans passer par le constructeur Angular). setInterval/
// clearInterval sont remplacés par un faux minuteur contrôlable à la main
// ("tick()") pour tester le plafond (~150 ticks) sans attendre 20 minutes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const angularStub = () => new Proxy({}, { get: () => (..._args) => target => target });

const projectSource = read('../src/app/features/projects/project-detail.component.ts');
const projectTemplate = read('../src/app/features/projects/project-detail.component.html');

function fakeTimers() {
  const t = { fn: null, ms: null, cleared: true, id: 0 };
  return {
    setInterval: (fn, ms) => { t.fn = fn; t.ms = ms; t.cleared = false; return ++t.id; },
    clearInterval: () => { t.cleared = true; t.fn = null; },
    tick: () => { assert.ok(t.fn && !t.cleared, 'expected an active interval to tick'); t.fn(); },
    info: t,
  };
}

function loadProjectDetail(timers) {
  const exports = {};
  const code = ts.transpileModule(projectSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports, require: name => sharedDependency(name) || angularStub(),
    setTimeout: () => 0,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    console,
  });
  return Object.create(exports['ProjectDetailComponent'].prototype);
}

// Object.create() ne passe jamais par le constructeur : les initialiseurs de
// champs (dont les deux constantes readonly de polling) ne s'exécutent donc
// pas -- on les fixe ici, exactement comme merge-ready-success.spec.mjs fixe
// project.auth/project.latestReport à la main avant d'appeler une méthode.
function freshProject(timers) {
  const project = loadProjectDetail(timers);
  project.BATCH_POLL_INTERVAL_MS = 8000;
  project.BATCH_POLL_MAX_MS = 20 * 60 * 1000;
  project.manualTasks = [];
  project.projectScopeReset$ = {next() {}, complete() {}};
  return project;
}

const dispatchingTask = id => ({ id, source:'TRIVY', findingSnapshot:{ruleOrCve:id,component:'a:b'}, securityFindingRemediation: { status: 'DISPATCHING' } });
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
