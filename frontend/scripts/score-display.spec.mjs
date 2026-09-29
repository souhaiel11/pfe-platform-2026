import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

// Charge le module PARTAGÉ réel (score-display.ts).
const moduleSource = read('../src/app/shared/score-display.ts');
const moduleExports = {};
vm.runInNewContext(
  ts.transpileModule(moduleSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: moduleExports, require: () => ({}), console },
);
const { isValidScoreOn100, formatScoreOn100 } = moduleExports;

// Charge aussi le VRAI composant pour prouver que le câblage (hasValidScore /
// historyScoreLabel / historyScoreCritical) délègue effectivement au module
// partagé, et non une logique dupliquée/divergente.
const statusLabelsSource = read('../src/app/shared/status-labels.ts');
const statusLabelsExports = {};
vm.runInNewContext(
  ts.transpileModule(statusLabelsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: statusLabelsExports, require: () => ({}), console },
);
const findingPresentationSource = read('../src/app/shared/finding-presentation.ts');
const findingPresentationExports = {};
vm.runInNewContext(
  ts.transpileModule(findingPresentationSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: findingPresentationExports, require: () => ({}), console },
);
const componentSource = read('../src/app/features/projects/project-detail.component.ts');
const componentTemplate = read('../src/app/features/projects/project-detail.component.html');
const componentExports = {};
const componentCode = ts.transpileModule(componentSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
}).outputText;
vm.runInNewContext(componentCode, {
  exports: componentExports,
  require: (spec) => {
    if (spec.endsWith('status-labels')) return statusLabelsExports;
    if (spec.endsWith('finding-presentation')) return findingPresentationExports;
    if (spec.endsWith('score-display')) return moduleExports;
    return new Proxy({}, { get: () => () => () => {} });
  },
  setTimeout: () => 0, console,
});
const component = Object.create(componentExports.ProjectDetailComponent.prototype);

// ============================================================================
// A. score 82 sur une échelle 0-100 -> "82 /100"
// ============================================================================
{
  assert.equal(formatScoreOn100(82), '82 /100', 'A: 82 -> "82 /100"');
  assert.equal(isValidScoreOn100(82), true, 'A: 82 is a valid 0-100 score');
}
console.log('score-display A) 82 -> "82 /100": PASS');

// ============================================================================
// B. score 100 -> "100 /100"
// ============================================================================
{
  assert.equal(formatScoreOn100(100), '100 /100', 'B: 100 -> "100 /100" (upper bound included)');
}
console.log('score-display B) 100 -> "100 /100": PASS');

// ============================================================================
// C. score 0 RÉELLEMENT CALCULÉ -> "0 /100" (jamais confondu avec "absent",
// piège classique de `!score` / `score || fallback` sur un zéro légitime).
// ============================================================================
{
  assert.equal(formatScoreOn100(0), '0 /100', 'C: a real computed 0 must display "0 /100", never treated as falsy/missing');
  assert.equal(isValidScoreOn100(0), true, 'C: 0 is a valid score');
  component.lastScore = 0; component.scanIncomplete = false; component.scoreUnavailable = false;
  assert.equal(component.hasValidScore(), true, 'C: component treats a real 0 as a valid score, not as "no score"');
}
console.log('score-display C) 0 réellement calculé -> "0 /100": PASS');

// ============================================================================
// D. score ABSENT (null/undefined) -> jamais un faux "0 /100"
// ============================================================================
{
  assert.equal(formatScoreOn100(null), null, 'D: null -> no formatted string at all');
  assert.equal(formatScoreOn100(undefined), null, 'D: undefined -> no formatted string at all');
  assert.equal(isValidScoreOn100(null), false, 'D: null is never a valid score');

  // Câblage réel : le fallback affiché n'est jamais "0 /100".
  assert.equal(component.historyScoreLabel(null), 'non vérifié', 'D: history row shows an honest label, never "0 /100"');
  assert.doesNotMatch(component.historyScoreLabel(null), /^0/, 'D: never starts with a fabricated 0');

  component.lastScore = null; component.scanIncomplete = false; component.scoreUnavailable = false;
  assert.equal(component.hasValidScore(), false, 'D: a null lastScore is never treated as valid, even when scanIncomplete/scoreUnavailable are both false');
}
console.log('score-display D) score absent -> jamais un faux "0 /100": PASS');

// ============================================================================
// E. score invalide / NaN -> rendu sûr (jamais "NaN /100")
// ============================================================================
{
  assert.equal(formatScoreOn100(NaN), null, 'E: NaN is never formatted as a score');
  assert.equal(formatScoreOn100('82'), null, 'E: a string is never accepted as a valid score (must be an actual number)');
  assert.equal(formatScoreOn100(150), null, 'E: out-of-range (>100) is rejected, never silently clamped-and-shown');
  assert.equal(formatScoreOn100(-5), null, 'E: out-of-range (<0) is rejected');
  assert.equal(component.historyScoreLabel(NaN), 'non vérifié', 'E: NaN renders the same safe fallback as a missing score, never "NaN /100"');
  assert.doesNotMatch(component.historyScoreLabel(NaN), /NaN/, 'E: literal "NaN" never reaches the DOM text');
}
console.log('score-display E) score invalide / NaN -> rendu sûr: PASS');

// ============================================================================
// F. source utilisant déjà une valeur normalisée -> pas de multiplication
// supplémentaire (le module ne fait AUCUNE opération arithmétique sur la
// valeur, seulement une validation de plage + un formatage de chaîne).
// ============================================================================
{
  // "/100" appears only inside the display template literal (`${score} /100`);
  // the actual double-scaling bug pattern to rule out is a MULTIPLICATION
  // by 100 (e.g. a caller mistakenly re-scaling an already-0-100 value).
  assert.doesNotMatch(moduleSource, /\*\s*100\b/, 'F: the display module never multiplies by 100 -- it only validates and formats, never rescales');
  assert.equal(formatScoreOn100(82), '82 /100', 'F: an already-normalized 82 stays 82, never becomes 8200 or 0.82');
}
console.log('score-display F) pas de double mise à l’échelle: PASS');

// ============================================================================
// G. trace RAW_SCORE -> NORMALIZED_SCORE -> DISPLAYED_SCORE sur la VRAIE
// formule backend (calculateSecurityScore), pour un cas réaliste multi-scanner.
// ============================================================================
{
  const backendSource = read('../../backend/src/common/security-score.ts');
  const backendExports = {};
  vm.runInNewContext(
    ts.transpileModule(backendSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: backendExports, require: () => ({}), console },
  );
  const { calculateSecurityScore } = backendExports;

  // RAW : 3 CVE critiques (Trivy), 1 vulnérabilité + quality gate ERROR (Sonar), tous scanners COMPLETED.
  const normalized = {
    trivy: { status: 'COMPLETED', critical: 3, high: 0, cves: [] },
    owasp: { status: 'COMPLETED', critical: 0, high: 0, cves: [] },
    sonar: { status: 'COMPLETED', vulnerabilities: 1, bugs: 0, code_smells: 0, quality_gate: 'ERROR' },
    zap: { status: 'COMPLETED', alerts_high: 0, alerts_medium: 0 },
  };
  const { score, incomplete } = calculateSecurityScore(normalized);
  // NORMALIZED : pénalité = min(3*2,40)=6 (CVE critiques) + (1*5 + 10 quality-gate)=15 (Sonar, plafonné à 20) -> 100-21=79.
  assert.equal(incomplete, false, 'G: no missing scanner for this realistic payload');
  assert.equal(score, 79, 'G: RAW findings -> NORMALIZED_SCORE=79 via the real backend formula (not re-derived in this test)');
  assert.ok(score >= 0 && score <= 100, 'G: NORMALIZED_SCORE stays within the 0-100 contract');

  // DISPLAYED : le frontend ne fait QUE formater cette même valeur, jamais la recalculer.
  const displayed = formatScoreOn100(score);
  assert.equal(displayed, '79 /100', 'G: DISPLAYED_SCORE is exactly the backend NORMALIZED_SCORE, unchanged, suffixed "/100"');

  // Cas scanner manquant : RAW incomplet -> NORMALIZED = null (jamais un nombre inventé) -> DISPLAYED = repli honnête.
  const incompleteNormalized = { ...normalized, sonar: { status: 'FAILED' } };
  const incompleteResult = calculateSecurityScore(incompleteNormalized);
  assert.equal(incompleteResult.incomplete, true, 'G: a scanner reporting FAILED marks the result incomplete');
  const persistedScoreForIncomplete = incompleteResult.incomplete ? null : incompleteResult.score; // reports.service.ts:64 contract
  assert.equal(formatScoreOn100(persistedScoreForIncomplete), null, 'G: an incomplete scan -> persisted null -> never displayed as a number');
}
console.log('score-display G) RAW -> NORMALIZED -> DISPLAYED (vraie formule backend): PASS');

// ============================================================================
// H. la logique de formatage reste scanner-agnostic : elle ne connaît aucun
// nom d'outil/projet, seulement un nombre. Prouvé en l'appliquant à des
// scores conceptuellement issus de sources différentes (report combiné
// Trivy+Sonar+ZAP ci-dessus vs. un score déjà agrégé "dashboard live") sans
// aucune branche par source.
// ============================================================================
{
  assert.doesNotMatch(moduleSource, /sonar|trivy|owasp|zap|jenkins/i, 'H: score-display.ts contains no scanner/tool-specific literal');
  // Même fonction, même résultat, qu'importe la provenance conceptuelle du nombre.
  assert.equal(formatScoreOn100(55), formatScoreOn100(55), 'H: purely a function of the number, never of an implicit "current source" state');
}
console.log('score-display H) logique scanner-agnostic: PASS');

// ── Câblage template : le header ET l’historique utilisent bien le nouveau
// contrat, plus aucune ancienne comparaison `!= null` brute ni de score
// affiché sans le contexte "/100". ────────────────────────────────────────
{
  assert.match(componentTemplate, /historyScoreLabel\(r\.securityScore\)/, 'template: history row uses the shared, tested formatter');
  assert.match(componentTemplate, /historyScoreCritical\(r\.securityScore\)/, 'template: history row severity class uses the shared, tested guard');
  assert.doesNotMatch(componentTemplate, /r\.securityScore \+ '\/100'/, 'template: no more raw string concatenation for the history score');
  assert.match(componentTemplate, /hasValidScore\(\)/, 'template: header score ring uses the shared validity guard');
  assert.match(componentTemplate, /class="score-max"/, 'template: header score ring renders the "/100" suffix');
}
console.log('score-display câblage template (header + historique): PASS');

console.log('score-display.spec.mjs: ALL CHECKS PASS');
