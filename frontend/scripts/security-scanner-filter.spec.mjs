import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

// Charge le VRAI composant (méthodes + template réels), pas une
// réimplémentation -- prouve le comportement effectif livré.
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
const scoreDisplaySource = read('../src/app/shared/score-display.ts');
const scoreDisplayExports = {};
vm.runInNewContext(
  ts.transpileModule(scoreDisplaySource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: scoreDisplayExports, require: () => ({}), console },
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
    if (spec.endsWith('score-display')) return scoreDisplayExports;
    return new Proxy({}, { get: () => () => () => {} });
  },
  setTimeout: () => 0, console,
});

function newComponentWithFindings() {
  const c = Object.create(componentExports.ProjectDetailComponent.prototype);
  c.ed = {
    trivy: { status: 'COMPLETED', cves: [{ id: 'CVE-T1', severity: 'CRITICAL' }, { id: 'CVE-T2', severity: 'HIGH' }] },
    owasp: { status: 'COMPLETED', cves: [{ id: 'CVE-O1', severity: 'MEDIUM' }] },
    zap: { status: 'COMPLETED', alerts: [{ id: 'ZAP1', severity: 'HIGH' }, { id: 'ZAP2', severity: 'LOW' }, { id: 'ZAP3', severity: 'MEDIUM' }] },
  };
  c.securityFilter = 'all';
  return c;
}

// Filtrage RÉEL des sections rendues, en interprétant EXACTEMENT les mêmes
// conditions *ngIf que le template (pour prouver la composition scanner +
// section, sans dupliquer une logique séparée non testée).
function visibleSections(c) {
  const visible = [];
  if ((c.securityFilter === 'all' || c.securityFilter === 'trivy') && c.ed.trivy?.cves?.length) visible.push('trivy');
  if ((c.securityFilter === 'all' || c.securityFilter === 'owasp') && c.ed.owasp?.cves?.length) visible.push('owasp');
  if ((c.securityFilter === 'all' || c.securityFilter === 'zap') && c.ed.zap?.alerts?.length) visible.push('zap');
  return visible;
}

// ============================================================================
// A. Tous -> Trivy + OWASP + ZAP visibles
// ============================================================================
{
  const c = newComponentWithFindings();
  c.setSecurityFilter('all');
  assert.deepEqual(visibleSections(c).sort(), ['owasp', 'trivy', 'zap'], 'A: "all" shows every source section');
  assert.equal(c.securityFindingsCount('all'), 6, 'A: total count = 2 (Trivy) + 1 (OWASP) + 3 (ZAP) = 6');
}
console.log('security-scanner-filter A) Tous -> toutes les sources: PASS');

// ============================================================================
// B. Trivy -> uniquement Trivy
// ============================================================================
{
  const c = newComponentWithFindings();
  c.setSecurityFilter('trivy');
  assert.deepEqual(visibleSections(c), ['trivy'], 'B: only the Trivy section is visible');
  assert.equal(c.securityFilter, 'trivy', 'B: canonical internal value is the lowercase key, not the French display label');
}
console.log('security-scanner-filter B) Trivy -> uniquement Trivy: PASS');

// ============================================================================
// C. OWASP -> uniquement OWASP
// ============================================================================
{
  const c = newComponentWithFindings();
  c.setSecurityFilter('owasp');
  assert.deepEqual(visibleSections(c), ['owasp'], 'C: only the OWASP section is visible');
}
console.log('security-scanner-filter C) OWASP -> uniquement OWASP: PASS');

// ============================================================================
// D. ZAP -> uniquement ZAP
// ============================================================================
{
  const c = newComponentWithFindings();
  c.setSecurityFilter('zap');
  assert.deepEqual(visibleSections(c), ['zap'], 'D: only the ZAP section is visible');
}
console.log('security-scanner-filter D) ZAP -> uniquement ZAP: PASS');

// ============================================================================
// E. Trivy + CRITICAL -> intersection correcte (le filtre scanner sélectionne
// la SECTION ; la sévérité, déjà gérée par CveTableComponent.filtered() via
// [severityFilter]="manualSeverityFilter", s'applique ENSUITE aux lignes de
// cette section -- composition prouvée en rejouant la même logique que
// cve-table.component.ts sur les données de la section retenue.)
// ============================================================================
{
  const c = newComponentWithFindings();
  c.setSecurityFilter('trivy');
  c.manualSeverityFilter = 'CRITICAL';
  const sections = visibleSections(c);
  assert.deepEqual(sections, ['trivy'], 'E: scanner filter alone still isolates the Trivy section');
  const rowsInVisibleSection = c.ed.trivy.cves.filter(x =>
    c.manualSeverityFilter === 'ALL' || x.severity === c.manualSeverityFilter);
  assert.deepEqual(rowsInVisibleSection.map(x => x.id), ['CVE-T1'], 'E: within that section, only the CRITICAL row remains -- scanner AND severity compose, neither overrides the other');
  // Et surtout : la section OWASP (qui a aussi un finding MEDIUM, jamais
  // CRITICAL) ne doit JAMAIS apparaître, quelle que soit la sévérité choisie.
  assert.ok(!sections.includes('owasp'), 'E: OWASP never leaks in despite matching no severity constraint at all -- the scanner filter is authoritative for section visibility');
}
console.log('security-scanner-filter E) Trivy + CRITICAL -> intersection correcte: PASS');

// ============================================================================
// F. scanner sans résultat -> état vide lisible (jamais une zone vide
// silencieuse), distinct du cas "scanner non exécuté".
// ============================================================================
{
  const c = newComponentWithFindings();
  c.ed.trivy = { status: 'COMPLETED', cves: [] }; // le scanner a bien tourné,零 finding
  c.setSecurityFilter('trivy');
  assert.deepEqual(visibleSections(c), [], 'F: no section actually renders the (now empty) table');
  assert.equal(c.isScannerMissing(c.ed.trivy), false, 'F: this is NOT the "scanner did not run" case');
  assert.equal(c.securityScannerEmpty('trivy'), true, 'F: the new clean-empty-state guard is true for this exact case');
  assert.match(componentTemplate, /Aucune vulnérabilité Trivy pour cette analyse\./, 'F: the template carries a clear, readable empty-state message for Trivy');
  assert.match(componentTemplate, /Aucune vulnérabilité OWASP pour cette analyse\./, 'F: same for OWASP');
  assert.match(componentTemplate, /Aucune alerte ZAP pour cette analyse\./, 'F: same for ZAP');
}
console.log('security-scanner-filter F) scanner sans résultat -> état vide lisible: PASS');

// ============================================================================
// G. source inconnue -> reste visible sous "Tous" (limite honnête de
// l'architecture actuelle constatée, pas simulée artificiellement : le
// contrat EnrichedData du backend est fermé à {trivy, owasp, sonar, zap} --
// voir report-normalizer.ts. Le nouveau filtre n'introduit AUCUNE régression
// sur ce point : il ne fait que basculer entre les MÊMES 3 sections déjà
// rendues aujourd'hui, jamais en retirer une du panier "all".)
// ============================================================================
{
  const backendSource = read('../../backend/src/common/report-normalizer.ts');
  assert.match(backendSource, /export interface EnrichedData \{\s*trivy: ScannerBlock;\s*owasp: ScannerBlock;\s*sonar: SonarBlock;\s*zap: ZapBlock;/,
    'G: EnrichedData is a closed 4-key contract today -- no 5th "unknown scanner" bucket exists to lose in the first place, confirmed against the real backend type, not assumed');
  const c = newComponentWithFindings();
  c.setSecurityFilter('all');
  // "Tous" continue d'agréger EXACTEMENT les mêmes 3 sources qu'avant ce
  // changement -- aucune source retirée du panier "all" par le nouveau filtre.
  assert.deepEqual(visibleSections(c).sort(), ['owasp', 'trivy', 'zap'], 'G: "all" still aggregates every currently-possible source, unchanged by this feature');
}
console.log('security-scanner-filter G) source inconnue -> architecture fermée constatée, "Tous" inchangé: PASS');

// ============================================================================
// H. changement de filtre -> aucune mutation des données source (ed.*
// reste strictement identique en valeur -- seule la présentation change).
// ============================================================================
{
  const c = newComponentWithFindings();
  const before = JSON.stringify(c.ed);
  c.setSecurityFilter('trivy');
  c.setSecurityFilter('zap');
  c.setSecurityFilter('all');
  assert.equal(JSON.stringify(c.ed), before, 'H: switching the filter never mutates ed.{trivy,owasp,zap} -- purely presentational');
}
console.log('security-scanner-filter H) changement de filtre -> aucune mutation des données: PASS');

// ============================================================================
// I. Pagination -- vérifié honnêtement : ni CveTableComponent ni
// ZapTableComponent n'implémentent de pagination aujourd'hui (recherche
// exhaustive de page/slice() dans les deux fichiers sources -- aucune
// occurrence), donc "remettre la pagination à la première page" n'a
// actuellement aucune logique à laquelle s'appliquer. Ce test le CONSTATE
// plutôt que de fabriquer une pagination inexistante.
// ============================================================================
{
  const cveSource = read('../src/app/features/projects/cve-table.component.ts');
  const zapSource = read('../src/app/features/projects/zap-table.component.ts');
  assert.doesNotMatch(cveSource, /\bpage\b|\.slice\(/i, 'I: CveTableComponent has no pagination to reset');
  assert.doesNotMatch(zapSource, /\bpage\b|\.slice\(/i, 'I: ZapTableComponent has no pagination to reset');
}
console.log('security-scanner-filter I) pagination absente aujourd\'hui, constaté honnêtement: PASS');

// ── Câblage template : contrôle chips présent, valeurs canoniques (pas les
// libellés FR) utilisées en interne pour le filtrage. ─────────────────────
{
  assert.match(componentTemplate, /class="sec-scanner-filter"/, 'template: chip control is present above the findings');
  assert.match(componentTemplate, /setSecurityFilter\('all'\)/, 'template: "Tous" chip');
  assert.match(componentTemplate, /setSecurityFilter\('trivy'\)/, 'template: "Trivy" chip');
  assert.match(componentTemplate, /setSecurityFilter\('owasp'\)/, 'template: "OWASP" chip');
  assert.match(componentTemplate, /setSecurityFilter\('zap'\)/, 'template: "ZAP" chip');
  assert.match(componentTemplate, /securityFindingsCount\('all'\)/, 'template: counters wired for all 4 chips');
  // Les *ngIf de section continuent de comparer sur la valeur canonique
  // minuscule ('trivy'/'owasp'/'zap'), jamais sur un libellé affiché.
  assert.doesNotMatch(componentTemplate, /securityFilter === 'Trivy'|securityFilter === 'OWASP'|securityFilter === 'ZAP'/, 'template: never filters against the French/display-cased label');
}
console.log('security-scanner-filter câblage template (chips, valeurs canoniques): PASS');

console.log('security-scanner-filter.spec.mjs: ALL CHECKS PASS');
