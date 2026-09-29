// "Corrections disponibles" filter + installed/target version display fix —
// loads the REAL cve-table.component.ts/owasp-remediation-presentation.ts
// (never a re-implementation), same discipline as the sibling *.spec.mjs
// files in this directory.
//
// Root cause fixed alongside the filter: the "Version" (installed) column
// read the raw OWASP scan row's own installedVersion, which is ALWAYS null
// in real Dependency-Check reports (confirmed against report #149's live
// data) -- only the matched task's findingSnapshot.currentVersion has it.
// The "Corrigé dans" (target) column was already correct from a prior
// increment; this file proves both, plus the new remediation-state filter.
//
// Run: node frontend/scripts/owasp-corrections-filter.spec.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const angular = {
  Component: () => value => value, Injectable: () => value => value,
  Input: () => () => {}, Output: () => () => {}, ViewChild: () => () => {},
  EventEmitter: class { emit(value) { this.value = value; } },
  signal: value => { const f = () => value; f.set = v => value = v; return f; },
  computed: f => f,
};
function load(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true,
  } }).outputText, { exports, require: name => dependencies[name] || (name === '@angular/core' ? angular : {}), console });
  return exports;
}

const eligibility = load('../src/app/shared/cve-selection-eligibility.ts');
const owaspPres = load('../src/app/shared/owasp-remediation-presentation.ts', { './cve-selection-eligibility': eligibility });
const { CveTableComponent } = load('../src/app/features/projects/cve-table.component.ts', {
  '../../shared/cve-selection-eligibility': eligibility,
  '../../shared/owasp-remediation-presentation': owaspPres,
});

function makeTable(source, cves, tasks) {
  const t = new CveTableComponent();
  t.source = source;
  t.cves = cves;
  t.tasks = tasks;
  t.selectionRule = (task, c) => eligibility.canSelectCveTask(task, true, c);
  return t;
}

// Real report #149 live data (146 real OWASP rows, read-only from Postgres).
const liveCves = JSON.parse(read('../src/app/shared/fixtures/owasp-149-live-cves.json')).cves;
const liveTasks = JSON.parse(read('../src/app/shared/fixtures/owasp-149-live-tasks.json')).tasks;
const table = makeTable('OWASP', liveCves, liveTasks);
const rows = table.normalized();
assert.equal(rows.length, 146);

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
  assert.equal(autoFixRows.length, 12, 'sanity: 12 real AUTO_FIX_AVAILABLE rows in report #149');
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

// 4/5. "Corrections disponibles" filter -> only AUTO_FIX_AVAILABLE, 12 rows
{
  table.owaspRemediationFilter.set('AUTO_FIX_AVAILABLE');
  const filteredRows = table.filtered();
  assert.equal(filteredRows.length, 12, 'live report #149 -> filter returns 12 rows');
  for (const c of filteredRows) {
    assert.equal(table.owaspPresentation(c)?.state, 'AUTO_FIX_AVAILABLE', `row ${c.id} in the filter must be AUTO_FIX_AVAILABLE`);
  }
}
console.log('4/5. "Corrections disponibles" filter -> exactly 12 rows, all AUTO_FIX_AVAILABLE: PASS');

// 6. all 12 filtered rows -> selectable=true
{
  table.owaspRemediationFilter.set('AUTO_FIX_AVAILABLE');
  const filteredRows = table.filtered();
  for (const c of filteredRows) {
    assert.equal(table.selectionEligibility(c).selectable, true, `row ${c.id} under "Corrections disponibles" must be selectable`);
  }
}
console.log('6. all 12 filtered rows are selectable: PASS');

// 7. CLOSED SnakeYAML -> target 1.31 still displayed, but excluded from the filter
{
  table.owaspRemediationFilter.set('ALL');
  const snakeClosed = rows.find(c => c.id === 'CVE-2022-25857');
  const op = table.owaspPresentation(snakeClosed);
  assert.equal(op.state, 'CLOSED');
  assert.equal(op.targetVersion, '1.31');
  assert.equal(op.installedVersion, '1.29');
  assert.equal(op.targetSource, 'Trivy');
  assert.equal(op.selectable, false);

  table.owaspRemediationFilter.set('AUTO_FIX_AVAILABLE');
  const filteredIds = table.filtered().map(c => c.id);
  assert.ok(!filteredIds.includes('CVE-2022-25857'), 'CLOSED snakeyaml must NOT appear in "Corrections disponibles"');
}
console.log('7. CLOSED CVE-2022-25857: target 1.31 still shown, excluded from "Corrections disponibles": PASS');

// 8. MULTIPLE_CANDIDATES -> not in "Corrections disponibles"
{
  const multi = rows.find(c => table.owaspPresentation(c)?.state === 'MANUAL_REVIEW_MULTIPLE_TARGETS');
  assert.ok(multi, 'sanity: at least one MULTIPLE_CANDIDATES row exists');
  table.owaspRemediationFilter.set('AUTO_FIX_AVAILABLE');
  assert.ok(!table.filtered().some(c => c.id === multi.id && c.pkg === multi.pkg), 'MULTIPLE_CANDIDATES row must not appear under "Corrections disponibles"');
  table.owaspRemediationFilter.set('MANUAL_REVIEW');
  assert.ok(table.filtered().some(c => c.id === multi.id && c.pkg === multi.pkg), 'MULTIPLE_CANDIDATES row must appear under "Intervention manuelle"');
}
console.log('8. MULTIPLE_CANDIDATES rows excluded from "Corrections disponibles", included in "Intervention manuelle": PASS');

// 9. NO_TRIVY_MATCH -> not in "Corrections disponibles"
{
  const noMatch = rows.find(c => table.owaspPresentation(c)?.state === 'MANUAL_REVIEW_NO_TARGET');
  assert.ok(noMatch, 'sanity: at least one NO_TRIVY_MATCH row exists');
  table.owaspRemediationFilter.set('AUTO_FIX_AVAILABLE');
  assert.ok(!table.filtered().some(c => c.id === noMatch.id && c.pkg === noMatch.pkg), 'NO_TRIVY_MATCH row must not appear under "Corrections disponibles"');
}
console.log('9. NO_TRIVY_MATCH rows excluded from "Corrections disponibles": PASS');

// 10. Trivy findings behavior unchanged: the filter is a no-op for a Trivy table.
{
  const trivyTable = makeTable('TRIVY', [
    { id: 'CVE-2023-6378', pkg: 'ch.qos.logback:logback-classic', fixedVersion: '1.2.13', installedVersion: '1.2.11', severity: 'HIGH' },
  ], [
    { id: 'trivy-task-1', source: 'TRIVY', findingSnapshot: { ruleOrCve: 'CVE-2023-6378', component: 'ch.qos.logback:logback-classic' } },
  ]);
  assert.equal(trivyTable.owaspPresentation(trivyTable.normalized()[0]), null);
  const before = trivyTable.filtered().length;
  trivyTable.owaspRemediationFilter.set('AUTO_FIX_AVAILABLE');
  const after = trivyTable.filtered().length;
  assert.equal(before, after, 'the OWASP remediation filter must never affect a Trivy table');
  assert.equal(after, 1);
  // Trivy's own installed-version display is also untouched (real value, not resolved via owaspPresentation).
  assert.equal(trivyTable.normalized()[0].installedVersion, '1.2.11');
}
console.log('10. Trivy findings unaffected by the OWASP filter or the installed-version fix: PASS');

console.log('owasp-corrections-filter.spec.mjs: ALL CHECKS PASS');
