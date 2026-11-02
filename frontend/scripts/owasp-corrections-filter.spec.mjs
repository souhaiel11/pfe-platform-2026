// Teste le composant « owasp-corrections-filter » et ses cas d’erreur.
import { sharedDependency } from './security-lifecycle-test-loader.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
/** Lit les données depuis leur source. */
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const angular = {
  /** Simule le décorateur de composant Angular. */
  Component: () => value => value,
  /** Simule le décorateur de service Angular. */
  Injectable: () => value => value,
  /** Simule une entrée de composant Angular. */
  Input: () => () => {},
  /** Simule une sortie de composant Angular. */
  Output: () => () => {},
  /** Simule une référence à un élément de vue Angular. */
  ViewChild: () => () => {},
  EventEmitter: class {
  /** Diffuse ou construit le résultat prévu. */
  emit(value) { this.value = value; } },
  /** Prépare une valeur réactive pour le scénario. */
  signal: value => {
  /** Renvoie les contrôles du formulaire. */
  const f = () => value;
  /** Affecte la valeur prévue au champ. */
  f.set = v => value = v; return f; },
  /** Prépare le calcul réactif du scénario. */
  computed: f => f,
};
/** Charge les données nécessaires au composant. */
function load(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
  } }).outputText, { exports,
  /** Charge la dépendance prévue pour le scénario. */
  require: name => dependencies[name] || sharedDependency(name) || (name === '@angular/core' ? angular : {}), console });
  return exports;
}

const eligibility = load('../src/app/shared/cve-selection-eligibility.ts');
const owaspPres = load('../src/app/shared/security-remediation-presentation.ts', { './cve-selection-eligibility': eligibility, './v1-8-compatibility-presentation': load('../src/app/shared/v1-8-compatibility-presentation.ts', { './status-labels': load('../src/app/shared/status-labels.ts') }) });
const { CveTableComponent } = load('../src/app/features/projects/cve-table.component.ts', {
  '../../shared/cve-selection-eligibility': eligibility,
  '../../shared/security-remediation-presentation': owaspPres,
});

/** Prépare les données nécessaires à ce scénario. */
function makeTable(source, cves, tasks) {
  const t = new CveTableComponent();
  t.source = source;
  t.cves = cves;
  t.tasks = tasks;
  /** Décrit la règle de sélection appliquée à la tâche. */
  t.selectionRule = (task, c) => eligibility.canSelectCveTask(task, true, c);
  return t;
}

// Real report #149 live data (146 real OWASP rows, read-only from Postgres).
const liveCves = JSON.parse(read('../src/app/shared/fixtures/owasp-149-live-cves.json')).cves;
const liveTasks = JSON.parse(read('../src/app/shared/fixtures/owasp-149-live-tasks.json')).tasks;
const table = makeTable('OWASP', liveCves, liveTasks);
const rows = table.normalized();
assert.equal(rows.length, 155);
assert.equal(rows.filter(r => r.historical).length, 9);

// 1. AUTO_FIX_AVAILABLE + fixedVersion=1.31 -> displays 1.31
{
  const snakeVariant = rows.find(c => c.id === 'CVE-2022-38749'); // real 1.29->1.31 auto-fix case
  const op = table.owaspPresentation(snakeVariant);
  assert.equal(op.state, 'AUTO_FIX_AVAILABLE');
  assert.equal(op.targetVersion, '1.31');
  assert.equal(op.installedVersion, '1.29');
}
console.log('1. AUTO_FIX_AVAILABLE with fixedVersion=1.31 -> displays 1.31: PASS');

// 2. AUTO_FIX_AVAILABLE never displays "Indisponible" -- neither installed
// nor target version is ever null/unavailable for these rows, and the
// component's own rendered column values (not just the presentation object)
// are checked too.
{
  const autoFixRows = rows.filter(c => table.owaspPresentation(c)?.state === 'AUTO_FIX_AVAILABLE');
  // Le rapport reel #149 comptait 12 lignes auto-corrigeables AVANT
  // l'introduction de la regle de non-franchissement de majeure. Depuis, 4 de
  // ces 12 sont reclassees MAJOR_UPGRADE_REQUIRES_REVIEW -- ce qui est la
  // BONNE regle metier, alignee sur le refus CROSS_MAJOR_ONLY du backend
  // (une montee de majeure exige une revue humaine).
  // On fige donc les deux comptes ET leur somme : ainsi, ni une
  // reclassification silencieuse ni une disparition de lignes ne peut passer
  // inapercue a l'avenir.
  const majorReviewRows = rows.filter(c => table.owaspPresentation(c)?.state === 'MAJOR_UPGRADE_REQUIRES_REVIEW');
  assert.equal(autoFixRows.length, 8, 'sanity: 8 real AUTO_FIX_AVAILABLE rows in report #149');
  assert.equal(majorReviewRows.length, 4, 'sanity: 4 lignes a franchissement de majeure, exclues de la correction automatique');
  assert.equal(autoFixRows.length + majorReviewRows.length, 12,
    'les 12 lignes historiquement eligibles doivent toutes etre retrouvees, soit auto-corrigeables soit en revue de majeure');
  for (const c of majorReviewRows) {
    const op = table.owaspPresentation(c);
    assert.equal(op.selectable, false, `une montee de majeure (${c.id}) ne doit jamais etre selectionnable`);
    assert.ok(op.targetVersion, `la version cible refusee doit rester affichee pour ${c.id}`);
  }
  for (const c of autoFixRows) {
    const op = table.owaspPresentation(c);
    assert.ok(op.targetVersion, `AUTO_FIX_AVAILABLE row ${c.id} must have a non-null targetVersion`);
    assert.ok(op.installedVersion, `AUTO_FIX_AVAILABLE row ${c.id} must have a non-null installedVersion`);
    // The actual template expression for the "Version" column:
    const displayedInstalled = table.owaspPresentation(c)?.installedVersion || c.installedVersion || 'Version non disponible';
    assert.notEqual(displayedInstalled, 'Version non disponible', `row ${c.id} must not render "Version non disponible"`);
  }
}
console.log('2. AUTO_FIX_AVAILABLE rows never display "Indisponible" (installed or target): PASS');

// 3. TRIVY_CORRELATED -> source displays "Trivy"
{
  const c = rows.find(c => c.id === 'CVE-2022-38749');
  const op = table.owaspPresentation(c);
  const task = table.taskFor(c);
  assert.equal(task.findingSnapshot.fixedVersionSource, 'TRIVY_CORRELATED');
  assert.equal(op.targetSource, 'Trivy');
}
console.log('3. fixedVersionSource=TRIVY_CORRELATED -> targetSource="Trivy": PASS');

// 4/5. "Corrections disponibles" filter -> only AUTO_FIX_AVAILABLE, 8 rows
// (12 avant la regle de non-franchissement de majeure ; 4 sont desormais
//  classees MAJOR_UPGRADE_REQUIRES_REVIEW et donc exclues de ce filtre)
{
  table.owaspRemediationFilter.set('AVAILABLE');
  const filteredRows = table.filtered();
  assert.equal(filteredRows.length, 8, 'live report #149 -> filter returns 8 rows');
  for (const c of filteredRows) {
    assert.equal(table.owaspPresentation(c)?.state, 'AUTO_FIX_AVAILABLE', `row ${c.id} in the filter must be AUTO_FIX_AVAILABLE`);
  }
}
console.log('4/5. "Corrections disponibles" filter -> exactly 8 rows, all AUTO_FIX_AVAILABLE: PASS');

// 6. all 8 filtered rows -> selectable=true
{
  table.owaspRemediationFilter.set('AVAILABLE');
  const filteredRows = table.filtered();
  for (const c of filteredRows) {
    assert.equal(table.selectionEligibility(c).selectable, true, `row ${c.id} under "Corrections disponibles" must be selectable`);
  }
}
console.log('6. all 8 filtered rows are selectable: PASS');

// 7. CLOSED SnakeYAML -> target 1.31 still displayed, but excluded from the filter
{
  table.owaspRemediationFilter.set('ALL');
  const snakeClosed = rows.find(c => c.id === 'CVE-2022-25857');
  const op = table.owaspPresentation(snakeClosed);
  assert.equal(op.state, 'VERIFICATION_REQUIRED');
  assert.equal(op.label, 'Correction à vérifier');
  table.owaspRemediationFilter.set('PROPOSED');
  assert.ok(!table.filtered().some(c => c.id === snakeClosed.id && c.pkg === snakeClosed.pkg), 'historical CLOSED must not be proposed');
  table.owaspRemediationFilter.set('MANUAL');
  assert.ok(table.filtered().some(c => c.id === snakeClosed.id && c.pkg === snakeClosed.pkg), 'historical CLOSED belongs to manual verification');
  assert.equal(op.targetVersion, '1.31');
  assert.equal(op.installedVersion, '1.29');
  assert.equal(op.targetSource, 'Trivy');
  assert.equal(op.selectable, false);

  table.owaspRemediationFilter.set('AVAILABLE');
  const filteredIds = table.filtered().map(c => c.id);
  assert.ok(!filteredIds.includes('CVE-2022-25857'), 'CLOSED snakeyaml must NOT appear in "Corrections disponibles"');
}
console.log('7. CLOSED CVE-2022-25857: target 1.31 still shown, excluded from "Corrections disponibles": PASS');

// 8. MULTIPLE_CANDIDATES -> not in "Corrections disponibles"
{
  const multi = rows.find(c => table.owaspPresentation(c)?.state === 'MANUAL_REVIEW_MULTIPLE_TARGETS');
  assert.ok(multi, 'sanity: at least one MULTIPLE_CANDIDATES row exists');
  table.owaspRemediationFilter.set('AVAILABLE');
  assert.ok(!table.filtered().some(c => c.id === multi.id && c.pkg === multi.pkg), 'MULTIPLE_CANDIDATES row must not appear under "Corrections disponibles"');
  table.owaspRemediationFilter.set('MANUAL');
  assert.ok(table.filtered().some(c => c.id === multi.id && c.pkg === multi.pkg), 'MULTIPLE_CANDIDATES row must appear under "Intervention manuelle"');
}
console.log('8. MULTIPLE_CANDIDATES rows excluded from "Corrections disponibles", included in "Intervention manuelle": PASS');

// 9. NO_TRIVY_MATCH -> not in "Corrections disponibles"
{
  const noMatch = rows.find(c => table.owaspPresentation(c)?.state === 'MANUAL_REVIEW_NO_TARGET');
  assert.ok(noMatch, 'sanity: at least one NO_TRIVY_MATCH row exists');
  table.owaspRemediationFilter.set('AVAILABLE');
  assert.ok(!table.filtered().some(c => c.id === noMatch.id && c.pkg === noMatch.pkg), 'NO_TRIVY_MATCH row must not appear under "Corrections disponibles"');
}
console.log('9. NO_TRIVY_MATCH rows excluded from "Corrections disponibles": PASS');

// Trivy now uses the same state presentation and filters.
// La cible reste dans la MEME majeure (1.0 -> 1.1) : c'est le seul cas qui
// peut etre auto-corrige, la regle de non-franchissement de majeure etant
// commune aux deux scanners.
const trivy = makeTable('TRIVY', [{ id: 'CVE-1', pkg: 'a:b', installedVersion: '1.0', fixedVersion: '1.1' }], [{ id: 't', source: 'TRIVY', findingSnapshot: { component: 'a:b', ruleOrCve: 'CVE-1', currentVersion: '1.0', fixedVersion: '1.1' } }]);
assert.equal(trivy.owaspPresentation(trivy.normalized()[0]).state, 'AUTO_FIX_AVAILABLE');
trivy.owaspRemediationFilter.set('MANUAL');
assert.equal(trivy.filtered().length, 0);
trivy.owaspRemediationFilter.set('AVAILABLE');
assert.equal(trivy.filtered().length, 1, 'la ligne Trivy auto-corrigeable doit apparaitre sous « Corrections disponibles »');

// Controle negatif : la meme ligne Trivy avec un franchissement de majeure
// (1.0 -> 2.0) doit basculer en revue manuelle pour les DEUX scanners, donc
// sortir de « Corrections disponibles » et entrer dans « Intervention manuelle ».
const trivyMajor = makeTable('TRIVY', [{ id: 'CVE-1', pkg: 'a:b', installedVersion: '1.0', fixedVersion: '2.0' }], [{ id: 't', source: 'TRIVY', findingSnapshot: { component: 'a:b', ruleOrCve: 'CVE-1', currentVersion: '1.0', fixedVersion: '2.0' } }]);
const majorPresentation = trivyMajor.owaspPresentation(trivyMajor.normalized()[0]);
assert.equal(majorPresentation.state, 'MAJOR_UPGRADE_REQUIRES_REVIEW');
assert.equal(majorPresentation.selectable, false);
assert.equal(majorPresentation.targetVersion, '2.0', 'la version cible refusee doit rester visible');
trivyMajor.owaspRemediationFilter.set('AVAILABLE');
assert.equal(trivyMajor.filtered().length, 0, 'un franchissement de majeure ne doit jamais figurer dans « Corrections disponibles »');
trivyMajor.owaspRemediationFilter.set('MANUAL');
assert.equal(trivyMajor.filtered().length, 1, 'un franchissement de majeure appartient a « Intervention manuelle »');
console.log('OWASP regression and shared Trivy presentation: PASS');
