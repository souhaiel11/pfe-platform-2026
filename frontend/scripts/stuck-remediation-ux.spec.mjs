// Teste le composant « stuck-remediation-ux » et ses cas d’erreur.
import {Observable, Subject, takeUntil} from 'rxjs';
// Vérifie le correctif "stuck remediation UX" (Phase 1, audit 2026-10-04).
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

const incidentSource = read('../src/app/features/incidents/incident-detail.component.ts');
const incidentTemplate = read('../src/app/features/incidents/incident-detail.component.html');

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
function loadComponent(timers) {
  const exports = {};
  const code = ts.transpileModule(incidentSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    /** Charge la dépendance prévue pour le scénario. */
    require: name => name === 'rxjs' ? {Observable, Subject, takeUntil} : angularStub(name),
    /** Simule la modification demandée par le composant. */
    setTimeout: () => 0,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    console,
    globalThis: {
    /** Prépare les données nécessaires à ce scénario. */
    confirm: () => true },
  });
  return Object.create(exports['IncidentDetailComponent'].prototype);
}

/** Object.create() ne passe jamais par le constructeur. */
function fakeHttp() {
  const calls = [];
  /** Prépare les données nécessaires à ce scénario. */
  const makeObservable = (url, body) => {
    const rec = { url, body, observer: null };
    calls.push(rec);
    return new Observable(observer => { rec.observer = observer; });
  };
  return {
    /** Récupère les données demandées. */
    get: url => makeObservable(url, undefined),
    /** Prépare les données nécessaires à ce scénario. */
    post: (url, body) => makeObservable(url, body),
    calls,
  };
}

/** Prépare les données nécessaires à ce scénario. */
function freshIncident(timers, { isAdmin = false } = {}) {
  const c = loadComponent(timers);
  // @Input() id est compilé avec un descripteur non réassignable sous ce
  // bac à sable (même limite que canOperate dans cve-selection-eligibility.
  // spec.mjs) -- Object.defineProperty() contourne proprement le problème.
  Object.defineProperty(c, 'id', { value: 'incident-1', writable: true, configurable: true });
  c.POLL_INTERVAL_MS = 4000;
  c.POLL_MAX_ATTEMPTS = 22;
  c.TERMINAL_FIX_STATUSES = ['PR_CREATED', 'FIX_FAILED', 'REJECTED', 'VALIDATING', 'VALIDATED', 'COMPLETED'];
  c.STALE_DISPATCH_THRESHOLD_MS = 30 * 60 * 1000;
  c.incidentScopeReset$ = new Subject();
  c.prGenerationState = 'idle';
  c.reconcileBusy = false;
  c.reconcileError = null;
  c.requestedTab = null;
  const http = fakeHttp();
  c.api = {
    /** Simule la lecture des données demandées par le composant. */
    getIncident: id => http.get(`/api/incidents/${id}`),
    /** Prépare les données nécessaires à ce scénario. */
    reconcileStaleDispatch: (id, requestId, body) => http.post(`/api/incidents/${id}/remediation/${requestId}/reconcile-stale-dispatch`, body),
  };
  c.toast = {
  /** Prépare les données nécessaires à ce scénario. */
  success() {},
  /** Traite l’erreur reçue et termine le suivi de la demande. */
  error() {} };
  c.auth = { isAdmin };
  c.http = http;
  c.timers = timers;
  return c;
}

/** Prépare les données nécessaires à ce scénario. */
const dispatched = (overrides = {}) => ({
  id: 'incident-1', prUrl: null,
  metadata: { fixRequest: {
    status: 'DISPATCHED', requestId: 'req-1', batchId: 'batch-1', attemptCount: 1,
    attempts: [{ attempt: 1, dispatchedAt: new Date().toISOString() }],
    ...overrides,
  } },
});

console.log('--- T1: DISPATCHED -> polling continues ---');
{
  const timers = fakeTimers();
  const c = freshIncident(timers);
  c.startPrPolling();
  assert.equal(c.prGenerationState, 'polling');
  assert.ok(!timers.info.cleared);
  timers.tick();
  c.http.calls[0].observer.next(dispatched());
  assert.equal(c.prGenerationState, 'polling', 'DISPATCHED must keep polling');
  assert.ok(!timers.info.cleared, 'interval must still be active');
  console.log('T1 PASS');
}

console.log('--- T2: PR_CREATED -> polling stops, success ---');
{
  const timers = fakeTimers();
  const c = freshIncident(timers);
  /** Charge les données nécessaires au composant. */
  c.load = () => { c.incident = c.incident; }; // resynchronisation stub, non testée ici
  c.startPrPolling();
  timers.tick();
  c.http.calls[0].observer.next(dispatched({ status: 'PR_CREATED' }));
  assert.equal(c.prGenerationState, 'idle');
  assert.ok(timers.info.cleared, 'polling must stop on PR_CREATED');
  assert.equal(c.incident.metadata.fixRequest.status, 'PR_CREATED');
  console.log('T2 PASS');
}

console.log('--- T3: FIX_FAILED -> polling stops IMMEDIATELY (not after 22 ticks) ---');
{
  const timers = fakeTimers();
  const c = freshIncident(timers);
  /** Charge les données nécessaires au composant. */
  c.load = () => {};
  c.startPrPolling();
  timers.tick(); // tick #1 only
  c.http.calls[0].observer.next(dispatched({ status: 'FIX_FAILED', lastError: 'Dispatch WF2 obsolète réconcilié par un administrateur.', lastErrorCode: 'WF2_STALE_DISPATCH_RECONCILED' }));
  assert.equal(c.prGenerationState, 'idle');
  assert.ok(timers.info.cleared, 'FIX_FAILED must stop polling on the very first tick, never waiting for POLL_MAX_ATTEMPTS');
  console.log('T3 PASS');
}

console.log('--- T4: reload while DISPATCHED -> in-progress state restored ---');
{
  const timers = fakeTimers();
  const c = freshIncident(timers);
  // Simule un rechargement de page : prGenerationState repart de 'idle'
  // (comme avant le correctif), SEUL metadata.fixRequest.status fait foi.
  c.prGenerationState = 'idle';
  c.incident = dispatched();
  c.restoreInProgressStateFromServer();
  assert.equal(c.isFixInProgress(), true);
  assert.equal(c.prGenerationState, 'polling', 'reload must resume visible polling, not stay idle/silent');
  assert.ok(!timers.info.cleared);
  console.log('T4 PASS');
}

console.log('--- T5: reload while FIX_FAILED -> failure shown immediately ---');
{
  const timers = fakeTimers();
  const c = freshIncident(timers);
  c.prGenerationState = 'polling'; // un vieux polling local pourrait encore tourner
  c.incident = dispatched({ status: 'FIX_FAILED', lastError: 'Erreur d’exécution WF2', lastErrorCode: 'WF2_EXECUTION_ERROR' });
  c.restoreInProgressStateFromServer();
  assert.equal(c.isFixFailedStage(), true);
  assert.equal(c.prGenerationState, 'idle', 'no polling must remain active once FIX_FAILED is known');
  // (objet créé dans le bac à sable vm : comparer champ par champ, pas
  // deepEqual sur l'objet entier -- prototypes de royaumes différents.)
  const t5details = c.fixFailureDetails();
  assert.equal(t5details.message, 'Erreur d’exécution WF2');
  assert.equal(t5details.code, 'WF2_EXECUTION_ERROR');
  console.log('T5 PASS');
}

console.log('--- T6: stale DISPATCHED + admin -> reconcile action visible ---');
{
  const timers = fakeTimers();
  const c = freshIncident(timers, { isAdmin: true });
  const old = new Date(Date.now() - 31 * 60 * 1000).toISOString(); // 31 min > seuil 30 min
  c.incident = dispatched({ attempts: [{ attempt: 1, dispatchedAt: old }] });
  assert.equal(c.looksStuck(), true);
  assert.equal(c.canReconcileStaleDispatch(), true);
  assert.match(incidentTemplate, /auth\.isAdmin/, 'the reconcile button must be gated on auth.isAdmin in the template');
  assert.match(incidentTemplate, /Marquer la correction bloquée comme échouée/);
  console.log('T6 PASS');
}

console.log('--- T7: stale DISPATCHED + non-admin -> reconcile action hidden ---');
{
  const timers = fakeTimers();
  const c = freshIncident(timers, { isAdmin: false });
  const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  c.incident = dispatched({ attempts: [{ attempt: 1, dispatchedAt: old }] });
  assert.equal(c.looksStuck(), true, 'the banner itself is not admin-gated, only the action inside it');
  assert.equal(c.canReconcileStaleDispatch(), false, 'reconciliation itself must stay admin-only');
  console.log('T7 PASS');
}

console.log('--- T8: reconciliation failure -> error shown ---');
{
  const timers = fakeTimers();
  const c = freshIncident(timers, { isAdmin: true });
  const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  c.incident = dispatched({ attempts: [{ attempt: 1, dispatchedAt: old }] });
  /** Prépare les données nécessaires à ce scénario. */
  globalThis.confirm = () => true;
  c.reconcileStaleDispatch();
  assert.equal(c.http.calls.length, 1);
  assert.equal(c.http.calls[0].url, '/api/incidents/incident-1/remediation/req-1/reconcile-stale-dispatch');
  assert.equal(c.http.calls[0].body.batchId, 'batch-1');
  assert.equal(c.http.calls[0].body.attemptCount, 1);
  /** Charge les données nécessaires au composant. */
  c.load = () => {};
  c.http.calls[0].observer.error({ status: 409, error: { message: 'La récupération ne correspond pas au batch WF2 demandé.' } });
  assert.equal(c.reconcileBusy, false);
  assert.ok(c.reconcileError && c.reconcileError.length > 0, 'a visible error must be set on failure');
  console.log('T8 PASS');
}

console.log('--- T9: lastError safe display ---');
{
  const timers = fakeTimers();
  const c = freshIncident(timers);
  c.incident = dispatched({ status: 'FIX_FAILED', lastError: 'CANDIDATE_MANIFEST_INVALID', lastErrorCode: 'WF2_EXECUTION_ERROR' });
  const details = c.fixFailureDetails();
  assert.equal(details.message, 'CANDIDATE_MANIFEST_INVALID');
  assert.equal(details.code, 'WF2_EXECUTION_ERROR');
  // Aucun détail quand lastError est absent -- jamais "undefined" affiché.
  c.incident = dispatched({ status: 'FIX_FAILED' });
  assert.equal(c.fixFailureDetails(), null);
  console.log('T9 PASS');
}

console.log('--- T10: raw internal error payload not exposed ---');
{
  const timers = fakeTimers();
  const c = freshIncident(timers);
  c.incident = dispatched({
    status: 'FIX_FAILED',
    lastError: 'Erreur d’exécution WF2',
    lastErrorCode: 'WF2_EXECUTION_ERROR',
    verificationEvidence: { buildLog: 'secret-looking-stack-trace\nAuthorization: Bearer abc123', candidateDigest: 'deadbeef' },
    attempts: [{ attempt: 1, dispatchedAt: new Date().toISOString(), failureSummary: 'internal raw payload', verificationEvidence: { token: 'should-never-surface' } }],
  });
  const details = c.fixFailureDetails();
  const serialized = JSON.stringify(details);
  assert.ok(!serialized.includes('secret-looking-stack-trace'));
  assert.ok(!serialized.includes('Bearer'));
  assert.ok(!serialized.includes('should-never-surface'));
  assert.ok(!serialized.includes('candidateDigest'));
  // Le getter ne retourne jamais que {message, code} -- jamais verificationEvidence/attempts.
  assert.deepEqual(Object.keys(details).sort(), ['code', 'message']);
  assert.doesNotMatch(incidentTemplate, /verificationEvidence/);
  assert.doesNotMatch(incidentTemplate, /attempts\[/);
  console.log('T10 PASS');
}

console.log('stuck-remediation-ux: all T1-T10 PASS');
