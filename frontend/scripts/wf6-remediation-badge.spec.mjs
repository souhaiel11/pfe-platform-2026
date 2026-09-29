// wf6-remediation-badge.ts — corrige l'écart de vocabulaire prouvé par
// TEST 1 (PR #38) et TEST 2 (PR #39) : le badge testait
// status === 'CANDIDATE_READY' (vocabulaire du chemin mono-CVE historique,
// /result) alors que le chemin batch (/batch-result) persiste le statut de
// fermeture PAR CVE ('CLOSED'/'STILL_OPEN'/'NOT_OBSERVED'/...).
//
// Charge le module PARTAGÉ réel (pas une réimplémentation), même discipline
// que finding-presentation.spec.mjs / score-display.spec.mjs. Fixtures
// status/prUrl/prNumber/batchId tirées des lignes RÉELLES observées en base
// (manual_remediation_tasks) pour PR #37 (chemin mono-CVE historique),
// PR #38 (TEST 1, batch N=1) et PR #39 (TEST 2, batch N=2) ; le cas
// STILL_OPEN n'a encore jamais été produit par un run réel (aucun lot n'a
// encore échoué en tout-ou-rien) donc c'est la SEULE fixture construite ici,
// dérivée du contrat documenté de deriveCveClosureStatus().
//
// Run: node frontend/scripts/wf6-remediation-badge.spec.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

const sharedSource = read('../src/app/shared/wf6-remediation-badge.ts');
const sharedExports = {};
vm.runInNewContext(
  ts.transpileModule(sharedSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: sharedExports, require: () => ({}), console },
);
const { wf6ProposedPr, wf6StillOpenInBatch } = sharedExports;

// Prouve que le composant délègue réellement au module partagé (pas une
// logique dupliquée/divergente) -- même discipline que
// finding-presentation.spec.mjs pour ProjectDetailComponent.
const componentSource = read('../src/app/features/projects/cve-table.component.ts');
assert.match(componentSource, /import\s*\{\s*wf6ProposedPr as wf6ProposedPrShared,\s*wf6StillOpenInBatch as wf6StillOpenInBatchShared\s*\}\s*from\s*'\.\.\/\.\.\/shared\/wf6-remediation-badge'/,
  'cve-table.component.ts must import the shared module, not reimplement the badge logic');
assert.match(componentSource, /wf6ProposedPr\(task: any\)[\s\S]{0,80}?return wf6ProposedPrShared\(task\?\.securityFindingRemediation\);/,
  'wf6ProposedPr(task) must delegate to the shared module');
assert.match(componentSource, /wf6StillOpenInBatch\(task: any\)[\s\S]{0,80}?return wf6StillOpenInBatchShared\(task\?\.securityFindingRemediation\);/,
  'wf6StillOpenInBatch(task) must delegate to the shared module');
console.log('cve-table.component.ts genuinely delegates to wf6-remediation-badge.ts: PASS');

// ── Cas réels observés (manual_remediation_tasks, 2026-09-29) ──────────

// PR #37 -- chemin mono-CVE historique (/result), avant la promotion batch.
const PR37_LEGACY_SINGULAR = {
  status: 'CANDIDATE_READY', prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/37', prNumber: 37,
};
// PR #38 -- TEST 1, lot batch N=1 (même chemin que N>1, "N=1 est le cas
// particulier du multi" -- pas de branche legacy séparée).
const PR38_BATCH_N1 = {
  status: 'CLOSED', prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/38', prNumber: 38, reason: 'TARGET_CVE_CLOSED',
};
// PR #39 -- TEST 2, lot batch N=2, les 2 tâches (mêmes prUrl/prNumber, statut
// par CVE identique car les 2 CVE ont fermé).
const PR39_BATCH_N2_CVE_A = {
  status: 'CLOSED', prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/39', prNumber: 39, reason: 'TARGET_CVE_CLOSED',
};
const PR39_BATCH_N2_CVE_B = {
  status: 'CLOSED', prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/39', prNumber: 39, reason: 'TARGET_CVE_CLOSED',
};

for (const [label, fixture, expectedPrNumber] of [
  ['PR #37 (mono-CVE historique, CANDIDATE_READY)', PR37_LEGACY_SINGULAR, 37],
  ['PR #38 (TEST 1, batch N=1, CLOSED)', PR38_BATCH_N1, 38],
  ['PR #39 CVE A (TEST 2, batch N=2, CLOSED)', PR39_BATCH_N2_CVE_A, 39],
  ['PR #39 CVE B (TEST 2, batch N=2, CLOSED)', PR39_BATCH_N2_CVE_B, 39],
]) {
  const badge = wf6ProposedPr(fixture);
  assert.ok(badge, `${label}: badge must be shown`);
  assert.equal(badge.prNumber, expectedPrNumber, `${label}: prNumber`);
  assert.equal(badge.prUrl, fixture.prUrl, `${label}: prUrl`);
  assert.equal(wf6StillOpenInBatch(fixture), false, `${label}: must not be flagged STILL_OPEN`);
}
console.log('wf6ProposedPr) real observed PR #37/#38/#39 rows -- badge shown, both vocabularies: PASS');

// ── Cas limites ─────────────────────────────────────────────────────
assert.equal(wf6ProposedPr(null), null, 'absent securityFindingRemediation -> no badge, no crash');
assert.equal(wf6ProposedPr(undefined), null, 'undefined securityFindingRemediation -> no badge, no crash');
assert.equal(wf6ProposedPr({ status: 'CLOSED' }), null, 'CLOSED without prUrl -> no badge (never a bare status claim)');
assert.equal(wf6ProposedPr({ status: 'CANDIDATE_READY' }), null, 'CANDIDATE_READY without prUrl -> no badge');
assert.equal(wf6ProposedPr({ status: 'DISPATCHING', prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/1' }), null, 'in-flight status must never show a positive badge even with a stale prUrl');
console.log('wf6ProposedPr) edge cases (absent, prUrl-less, in-flight) -- no crash, no false positive: PASS');

// ── STILL_OPEN (lot échoué pour CETTE CVE) -- jamais de badge positif,
// distinct visuellement, même si un prUrl D'UNE TENTATIVE ANTÉRIEURE
// différente est encore présent (non-érasure côté backend -- cas réel
// possible, pas hypothétique). ────────────────────────────────────────
const STILL_OPEN_NO_PR = { status: 'STILL_OPEN', reason: 'TARGET_CVE_STILL_PRESENT', batchId: 'sec-batch-fail-example' };
assert.equal(wf6ProposedPr(STILL_OPEN_NO_PR), null, 'STILL_OPEN -> never a positive badge');
assert.equal(wf6StillOpenInBatch(STILL_OPEN_NO_PR), true, 'STILL_OPEN -> flagged for the distinct visual indicator');

const STILL_OPEN_WITH_STALE_PR = { status: 'STILL_OPEN', prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/12', prNumber: 12, batchId: 'sec-batch-fail-example' };
assert.equal(wf6ProposedPr(STILL_OPEN_WITH_STALE_PR), null, 'STILL_OPEN -> never a positive badge, even with a stale prUrl carried over from an earlier different attempt');
assert.equal(wf6StillOpenInBatch(STILL_OPEN_WITH_STALE_PR), true, 'STILL_OPEN with stale prUrl -> still flagged for the distinct visual indicator');
console.log('wf6ProposedPr/wf6StillOpenInBatch) STILL_OPEN never positive, always distinguishable (stale prUrl included): PASS');

// ── Autres statuts d'échec amont du chemin batch -- jamais de badge
// positif, et PAS le badge STILL_OPEN non plus (statut différent, pas de
// scope inventé au-delà de ce qui est demandé). ─────────────────────────
for (const status of ['NOT_OBSERVED', 'PATCH_CONFLICT', 'NOT_ELIGIBLE', 'GROUNDING_FAILED', 'PENDING', 'DISPATCH_FAILED']) {
  const fixture = { status, prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/12', prNumber: 12 };
  assert.equal(wf6ProposedPr(fixture), null, `${status}: never a positive badge`);
  assert.equal(wf6StillOpenInBatch(fixture), false, `${status}: not the STILL_OPEN indicator either (distinct status)`);
}
console.log('wf6ProposedPr/wf6StillOpenInBatch) other upstream failure statuses -- neither badge shown: PASS');

console.log('wf6-remediation-badge.spec.mjs: ALL CHECKS PASS');
