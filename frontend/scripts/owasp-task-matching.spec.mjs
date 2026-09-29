// taskFor() OWASP source-aware matching fix — loads the REAL
// cve-table.component.ts (never a re-implementation), same discipline as
// cve-selection-eligibility.spec.mjs / owasp-remediation-presentation.spec.mjs.
//
// Root cause fixed: cve.pkg (raw Dependency-Check identity, e.g. a jar
// filename) was compared against findingSnapshot.component (a Maven
// coordinate computed by normalizeOwaspFinding() for a DIFFERENT purpose --
// WF6/correlation). The two never share a format, so every live OWASP row
// failed to match its task (see the live-data validation report). The fix
// compares cve.pkg against findingSnapshot.legacyPackage instead, for
// OWASP only; Trivy's own matching (component-based) is untouched.
//
// Run: node frontend/scripts/owasp-task-matching.spec.mjs
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
function owaspTask(overrides = {}, snapshotOverrides = {}) {
  return {
    id: 'task-1', source: 'OWASP',
    findingSnapshot: { ruleOrCve: 'CVE-2022-25857', component: 'org.yaml:snakeyaml', legacyPackage: 'snakeyaml-1.29.jar', installedVersion: '1.29', fixedVersion: '1.31', fixedVersionSource: 'TRIVY_CORRELATED', ...snapshotOverrides },
    ...overrides,
  };
}
const owaspCve = { id: 'CVE-2022-25857', pkg: 'snakeyaml-1.29.jar', severity: 'HIGH', fixedVersion: undefined, source: 'OWASP' };

// 1. OWASP exact legacyPackage match
{
  const task = owaspTask();
  const table = makeTable('OWASP', [owaspCve], [task]);
  const row = table.normalized()[0];
  assert.equal(table.taskFor(row)?.id, 'task-1');
}
console.log('1. OWASP exact legacyPackage match: PASS');

// 2. wrong legacyPackage -> no match
{
  const task = owaspTask({}, { legacyPackage: 'other-lib-9.9.9.jar' });
  const table = makeTable('OWASP', [owaspCve], [task]);
  const row = table.normalized()[0];
  assert.equal(table.taskFor(row), undefined);
}
console.log('2. wrong legacyPackage -> no match: PASS');

// 3. same CVE, different jar -> correct task only
{
  const taskA = owaspTask({ id: 'task-A' }, { legacyPackage: 'snakeyaml-1.29.jar' });
  const taskB = owaspTask({ id: 'task-B' }, { legacyPackage: 'snakeyaml-1.30.jar' });
  const table = makeTable('OWASP', [owaspCve], [taskA, taskB]);
  const row = table.normalized()[0];
  assert.equal(table.taskFor(row)?.id, 'task-A');
}
console.log('3. same CVE, different jar (multiple candidate versions) -> correct task only: PASS');

// 4. same CVE OWASP + Trivy -> no cross-match
{
  const owaspT = owaspTask({ id: 'owasp-task' });
  const trivyT = { id: 'trivy-task', source: 'TRIVY', findingSnapshot: { ruleOrCve: 'CVE-2022-25857', component: 'org.yaml:snakeyaml' } };
  const trivyCve = { id: 'CVE-2022-25857', pkg: 'org.yaml:snakeyaml', severity: 'HIGH', fixedVersion: '1.31', source: 'TRIVY' };
  const owaspRow = makeTable('OWASP', [owaspCve], [owaspT, trivyT]);
  assert.equal(owaspRow.taskFor(owaspRow.normalized()[0])?.id, 'owasp-task');
  const trivyRow = makeTable('TRIVY', [trivyCve], [owaspT, trivyT]);
  assert.equal(trivyRow.taskFor(trivyRow.normalized()[0])?.id, 'trivy-task');
}
console.log('4. same CVE in OWASP + Trivy -> each row matches only its own-source task, zero cross-match: PASS');

// 5. Trivy behavior unchanged (component-based, case-insensitive, untouched by the OWASP fix)
{
  const trivyT = { id: 'trivy-task', source: 'TRIVY', findingSnapshot: { ruleOrCve: 'CVE-2023-6378', component: 'ch.qos.logback:logback-classic' } };
  const trivyCve = { id: 'CVE-2023-6378', pkg: 'CH.QOS.LOGBACK:LOGBACK-CLASSIC', severity: 'HIGH', fixedVersion: '1.2.13', source: 'TRIVY' };
  const table = makeTable('TRIVY', [trivyCve], [trivyT]);
  assert.equal(table.taskFor(table.normalized()[0])?.id, 'trivy-task', 'Trivy matching stays case-insensitive on component, untouched');
}
console.log('5. Trivy behavior unchanged: PASS');

// 6. missing legacyPackage -> fail closed (never falls back to component)
{
  const task = owaspTask({}, { legacyPackage: undefined });
  delete task.findingSnapshot.legacyPackage;
  const table = makeTable('OWASP', [owaspCve], [task]);
  const row = table.normalized()[0];
  assert.equal(table.taskFor(row), undefined, 'must never fall back to findingSnapshot.component for OWASP');
  assert.equal(table.owaspPresentation(row).state, 'NO_TASK');
}
console.log('6. missing legacyPackage -> fail closed, no fallback to component, "Non suivi": PASS');

// 7. report #149 (real live data, read-only from Postgres) -> 146/146 unique matches, 0 ambiguous
{
  const fixCves = JSON.parse(read('../src/app/shared/fixtures/owasp-149-live-cves.json')).cves;
  const fixTasks = JSON.parse(read('../src/app/shared/fixtures/owasp-149-live-tasks.json')).tasks;
  const table = makeTable('OWASP', fixCves, fixTasks);
  const rows = table.normalized();
  assert.equal(rows.length, 146, 'OWASP_TOTAL');
  const matchedTaskIds = new Set();
  let unmatched = 0, ambiguous = 0;
  for (const c of rows) {
    const pkg = String(c.pkg ?? '').trim();
    const candidates = fixTasks.filter(t => t.source === 'OWASP'
      && String(t.findingSnapshot?.ruleOrCve).toLowerCase() === c.id.toLowerCase()
      && String(t.findingSnapshot?.legacyPackage ?? '').trim() === pkg);
    if (candidates.length > 1) ambiguous++;
    const task = table.taskFor(c);
    if (!task) { unmatched++; continue; }
    assert.equal(matchedTaskIds.has(task.id), false, `task ${task.id} matched by more than one OWASP row`);
    matchedTaskIds.add(task.id);
  }
  assert.equal(unmatched, 0, 'OWASP_UNMATCHED must be 0');
  assert.equal(ambiguous, 0, 'OWASP_AMBIGUOUS must be 0');
  assert.equal(matchedTaskIds.size, 146, 'OWASP_MATCHED must be 146');
}
console.log('7. report #149 live data (146 real OWASP rows) -> 146/146 unique matches, 0 unmatched, 0 ambiguous: PASS');

// 8. CVE-2022-25857 (real known case) -> CLOSED / Trivy / PR #40
{
  const fixCves = JSON.parse(read('../src/app/shared/fixtures/owasp-149-live-cves.json')).cves;
  const fixTasks = JSON.parse(read('../src/app/shared/fixtures/owasp-149-live-tasks.json')).tasks;
  const table = makeTable('OWASP', fixCves, fixTasks);
  const row = table.normalized().find(c => c.id === 'CVE-2022-25857');
  const task = table.taskFor(row);
  assert.equal(task?.id, '306e8b84-90fe-4344-8fd6-5c38fcabcf40');
  const p = table.owaspPresentation(row);
  assert.equal(p.state, 'CLOSED');
  assert.equal(p.label, 'Vulnérabilité corrigée');
  assert.equal(p.targetVersion, '1.31');
  assert.equal(p.targetSource, 'Trivy');
  assert.equal(p.prNumber, 40);
  assert.equal(p.selectable, false);
}
console.log('8. CVE-2022-25857 real known case -> CLOSED, 1.29->1.31, source Trivy, PR #40, not selectable: PASS');

console.log('owasp-task-matching.spec.mjs: ALL CHECKS PASS');
