// Teste le composant « wf2-cancellation » et ses cas d’erreur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
/** Lit les données depuis leur source. */
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const source = read('../src/app/features/incidents/incident-detail.component.ts');
const template = read('../src/app/features/incidents/incident-detail.component.html');
const labelsExports = {};
vm.runInNewContext(ts.transpileModule(read('../src/app/shared/status-labels.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: labelsExports });
const exports = {};
let confirms = 0;
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText, {
  exports,
  /** Charge la dépendance prévue pour le scénario. */
  require: name => name.includes('status-labels') ? labelsExports
    : new Proxy({}, {
    /** Récupère les données demandées. */
    get: () => () => target => target }),
  /** Simule la modification demandée par le composant. */
  setInterval: () => 1,
  /** Prépare les données nécessaires à ce scénario. */
  clearInterval: () => {},
  /** Simule la modification demandée par le composant. */
  setTimeout: () => 0,
  globalThis: {
  /** Vérifie les résultats attendus dans ce scénario. */
  confirm: text => { confirms++; assert.equal(text,
    "Voulez-vous annuler cette correction ?\nLa correction sera arrêtée si elle n'a pas encore commencé à écrire sur GitHub."); return true; } },
});
/** Prépare les données nécessaires à ce scénario. */
function fresh(status, extra = {}) {
  const c = Object.create(exports.IncidentDetailComponent.prototype);
  Object.defineProperty(c, 'id', { value: 'incident-1', writable: true });
  c.incident = { metadata: { fixRequest: { workflow: 'WF2', requestId: 'r', batchId: 'b', status,
    findingIds: ['A'], retryEligible: true, ...extra } } };
  c.cancelBusy = false;
  c.cancelError = null;
  c.approvalBusy = false;
  c.loads = 0;
  /** Charge les données nécessaires au composant. */
  c.load = () => c.loads++;
  c.calls = [];
  /** Prépare les données nécessaires à ce scénario. */
  c.startPrPolling = () => {};
  c.toast = {
  /** Prépare les données nécessaires à ce scénario. */
  success() {},
  /** Traite l’erreur reçue et termine le suivi de la demande. */
  error() {} };
  /** Prépare les données nécessaires à ce scénario. */
  const observable = (kind, args) => ({
  /** Prépare les données nécessaires à ce scénario. */
  subscribe: observer => c.calls.push({ kind, args, observer }) });
  c.api = {
  /** Prépare les données nécessaires à ce scénario. */
  cancelFixRequest: (...args) => observable('cancel', args),
  /** Prépare les données nécessaires à ce scénario. */
  retryFixBatch: (...args) => observable('retry', args),
    /** Prépare les données nécessaires à ce scénario. */
    approveFixBatch: (...args) => observable('approve', args) };
  return c;
}
assert.equal(fresh('FIX_STARTING').canCancelFix(), true); console.log('F1 PASS');
assert.equal(fresh('DISPATCHED').canCancelFix(), true); console.log('F2 PASS');
assert.equal(fresh('DISPATCHED', { sideEffectsStarted: true }).canCancelFix(), false); console.log('F3 PASS');
const pending = fresh('CANCEL_REQUESTED');
assert.equal(pending.canCancelFix(), true);
pending.cancelFix(); assert.equal(pending.calls.length, 0);
assert.match(template, /\[disabled\]="cancelBusy \|\| fixRequestStatus\(\) === 'CANCEL_REQUESTED'"/);
assert.match(template, /Annulation en cours\.\.\./); console.log('F4 PASS');
assert.equal(fresh('CANCELLED').fixRequestStatusLabel(), 'Correction annulée');
assert.equal(fresh('CANCEL_REQUESTED').fixRequestStatusLabel(), 'Annulation en cours'); console.log('F5 PASS');
const retry = fresh('CANCELLED');
assert.equal(retry.newCorrectionBlocked(), false);
assert.equal(fresh('CANCEL_REQUESTED').newCorrectionBlocked(), true);
retry.approveFix(['A']); assert.equal(retry.calls[0].kind, 'retry');
const headerRetry = fresh('CANCELLED'); headerRetry.approveFix(); assert.equal(headerRetry.calls[0].kind, 'retry');
const newSelection = fresh('CANCELLED'); newSelection.approveFix(['B']); assert.equal(newSelection.calls[0].kind, 'approve');
assert.equal(fresh('CANCELLED', {}).canCancelFix(), false); console.log('F6 PASS');
const correctivePending = fresh('CANCEL_REQUESTED'); correctivePending.incident.prUrl = 'https://github.example/pull/1';
let pollingStarted = 0;
/** Prépare les données nécessaires à ce scénario. */
correctivePending.startPrPolling = () => pollingStarted++;
correctivePending.prGenerationState = 'idle'; correctivePending.restoreInProgressStateFromServer();
assert.equal(pollingStarted, 1, 'pending cancellation must poll even on an existing corrective PR');
const late = fresh('DISPATCHED');
let stoppedPolling = 0;
/** Prépare les données nécessaires à ce scénario. */
late.stopPrPolling = () => stoppedPolling++;
late.cancelFix(); late.calls[0].observer.error({ status: 409, error: { code: 'CANCELLATION_TOO_LATE' } });
assert.equal(late.cancelError, 'La correction a déjà commencé à écrire sur GitHub et ne peut plus être annulée automatiquement.');
assert.equal(stoppedPolling, 0); assert.equal(late.loads, 1); console.log('F7 PASS');
const c = fresh('DISPATCHED');
c.cancelFix(); assert.equal(c.cancelBusy, true);
assert.equal(c.fixRequestStatus(), 'DISPATCHED');
c.cancelFix(); assert.equal(c.calls.length, 1);
assert.deepEqual(Array.from(c.calls[0].args), ['incident-1', 'r']);
c.calls[0].observer.next({ status: 'CANCELLED' });
assert.equal(c.fixRequestStatus(), 'DISPATCHED', 'only incident refresh may display confirmed cancellation');
assert.equal(c.loads, 1); assert.equal(c.cancelBusy, false); console.log('F8-F9 PASS');
assert.equal(fresh('FIX_FAILED').isFixFailedStage(), true);
assert.equal(fresh('CANCELLED').isFixFailedStage(), false);
assert.match(template, /isFixFailedStage\(\)/);
assert.ok(confirms >= 2); console.log('F10 PASS: Phase 1 failure presentation preserved (full Phase 1 suite also run separately)');
console.log('Frontend cancellation F1-F10: ALL PASS');
