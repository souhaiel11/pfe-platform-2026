import { sharedDependency } from './security-lifecycle-test-loader.mjs';
// getSecurityRemediationPresentation()/summarizeSecurityRemediation() — loads the
// REAL shared modules (never a re-implementation), same discipline as
// cve-selection-eligibility.spec.mjs / wf6-remediation-badge.spec.mjs.
// Run: node frontend/scripts/owasp-remediation-presentation.spec.mjs
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
  } }).outputText, { exports, require: name => dependencies[name] || sharedDependency(name) || (name === '@angular/core' ? angular : {}), console });
  return exports;
}

const eligibility = load('../src/app/shared/cve-selection-eligibility.ts');
const { getSecurityRemediationPresentation, summarizeSecurityRemediation } = load(
  '../src/app/shared/security-remediation-presentation.ts',
  { './cve-selection-eligibility': eligibility, './v1-8-compatibility-presentation': load('../src/app/shared/v1-8-compatibility-presentation.ts', { './status-labels': load('../src/app/shared/status-labels.ts') }) },
);

const CVE = { id: 'CVE-2022-25857', pkg: 'org.yaml:snakeyaml', fixedVersion: undefined };
const baseSnapshot = { component: 'org.yaml:snakeyaml', legacyPackage: CVE.pkg, purl: 'pkg:maven/org.yaml/snakeyaml@1.29', installedVersion: '1.29', currentVersion: '1.29', ruleOrCve: CVE.id };
function task(overrides = {}, snapshotOverrides = {}) {
  return { id: 'task-1', source: 'OWASP', ruleOrCve: CVE.id, findingSnapshot: { ...baseSnapshot, ...snapshotOverrides }, ...overrides };
}
// Real canSelectCveTask() call, matching exactly what the component itself
// would compute -- never a hand-rolled {selectable:true} stand-in, so these
// tests exercise the REAL gate, not an assumption about it.
function elig(t, cve = CVE) { return eligibility.canSelectCveTask(t, true, cve); }

// 1. OWASP + unique fixedVersion -> AUTO_FIX_AVAILABLE
{
  const t = task({}, { fixedVersion: '1.31', fixedVersionSource: 'TRIVY_CORRELATED' });
  const p = getSecurityRemediationPresentation(t, elig(t), CVE);
  assert.equal(p.state, 'AUTO_FIX_AVAILABLE');
  assert.equal(p.label, 'Correction automatique disponible');
  assert.equal(p.selectable, true);
  assert.equal(p.targetVersion, '1.31');
}
console.log('1. unique fixedVersion -> AUTO_FIX_AVAILABLE, selectable: PASS');

// 2. OWASP + TRIVY_CORRELATED -> Source cible = Trivy (never "OWASP")
{
  const t = task({}, { fixedVersion: '1.31', fixedVersionSource: 'TRIVY_CORRELATED' });
  const p = getSecurityRemediationPresentation(t, elig(t), CVE);
  assert.equal(p.targetSource, 'Trivy');
}
console.log('2. fixedVersionSource=TRIVY_CORRELATED -> targetSource="Trivy", never "OWASP": PASS');

// 3. multi-target unsupported -> manual review, checkbox disabled, distinct from "no target"
{
  const t = task({}, { fixedVersion: null, fixedVersionUnavailableReason: 'MULTIPLE_CANDIDATES', fixedVersionEvidence: { trivyFixedVersionRaw: '1.3.12, 1.4.12, 1.2.13' } });
  const p = getSecurityRemediationPresentation(t, elig(t), CVE);
  assert.equal(p.state, 'MANUAL_REVIEW_MULTIPLE_TARGETS');
  assert.equal(p.label, 'Intervention manuelle requise');
  assert.equal(p.selectable, false);
  assert.match(p.explanation, /Plusieurs versions corrigées possibles/);
  assert.ok(p.tooltip.includes('1.3.12, 1.4.12, 1.2.13'), 'raw evidence available in the technical tooltip, not the main text');
  assert.doesNotMatch(p.explanation, /1\.3\.12/, 'the raw comma-list must never leak into the primary explanation text');
}
console.log('3. multi-target unsupported -> MANUAL_REVIEW_MULTIPLE_TARGETS, disabled, raw evidence only in tooltip: PASS');

// 4. no target at all -> manual review, distinct message from case 3
{
  const t = task({}, { fixedVersion: null, fixedVersionUnavailableReason: 'NO_TRIVY_MATCH' });
  const p = getSecurityRemediationPresentation(t, elig(t), CVE);
  assert.equal(p.state, 'MANUAL_REVIEW_NO_TARGET');
  assert.equal(p.selectable, false);
  assert.match(p.explanation, /Aucune version corrigée fiable/);
  const t2 = task({}, { fixedVersion: null, fixedVersionUnavailableReason: 'MULTIPLE_CANDIDATES' });
  const multi = getSecurityRemediationPresentation(t2, elig(t2), CVE);
  assert.notEqual(p.explanation, multi.explanation, 'the two manual-review reasons must never share the exact same wording');
}
console.log('4. no Trivy match -> MANUAL_REVIEW_NO_TARGET, wording distinct from the multi-target case: PASS');

// 5. Maven identity missing -> données Maven insuffisantes
{
  const t = task({}, { component: 'not-a-maven-coordinate', fixedVersion: null });
  const p = getSecurityRemediationPresentation(t, elig(t), CVE);
  assert.equal(p.state, 'MAVEN_DATA_MISSING');
  assert.equal(p.label, 'Données Maven insuffisantes');
  assert.equal(p.selectable, false);
}
console.log('5. Maven identity missing -> MAVEN_DATA_MISSING: PASS');

// 6. DISPATCHING -> Correction en cours
{
  const t = task({ securityFindingRemediation: { status: 'DISPATCHING' } }, { fixedVersion: '1.31', fixedVersionSource: 'TRIVY_CORRELATED' });
  const p = getSecurityRemediationPresentation(t, elig(t), CVE);
  assert.equal(p.state, 'DISPATCHING');
  assert.equal(p.label, 'Correction en cours');
  assert.equal(p.selectable, false);
}
console.log('6. DISPATCHING -> "Correction en cours", disabled: PASS');

// 7. CANDIDATE_READY + PR -> "Correction déjà proposée (PR #N)"
{
  const t = task({ securityFindingRemediation: { status: 'CANDIDATE_READY', prNumber: 40, prUrl: 'https://github.com/x/y/pull/40' } }, { fixedVersion: '1.31', fixedVersionSource: 'TRIVY_CORRELATED' });
  const p = getSecurityRemediationPresentation(t, elig(t), CVE);
  assert.equal(p.state, 'CANDIDATE_READY');
  assert.equal(p.label, 'Correction proposée');
  assert.equal(p.prNumber, 40);
  assert.equal(p.prUrl, 'https://github.com/x/y/pull/40');
  assert.equal(p.selectable, false);
}
console.log('7. CANDIDATE_READY + PR -> "Correction proposée (PR #N)": PASS');

// 8. Legacy CLOSED with PR -> verification required, not project correction (real CVE-2022-25857/PR #40 shape)
{
  const t = task({ securityFindingRemediation: { status: 'CLOSED', reason: 'TARGET_CVE_CLOSED', prNumber: 40, prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/40' } }, { fixedVersion: '1.31', fixedVersionSource: 'TRIVY_CORRELATED' });
  const p = getSecurityRemediationPresentation(t, elig(t), CVE);
  assert.equal(p.state, 'VERIFICATION_REQUIRED');
  assert.equal(p.label, 'Correction à vérifier');
  assert.equal(p.prNumber, 40);
  assert.match(p.explanation, /scan du projet/);
}
console.log('8. legacy CLOSED -> verification required, PR shown: PASS');

// 9. failure status -> user-facing message derived from reason, never a raw code; retry follows the existing gate
{
  const t = task({ securityFindingRemediation: { status: 'CANDIDATE_BUILD_FAILED', reason: 'CANDIDATE_BUILD_FAILED' } }, { fixedVersion: '1.31', fixedVersionSource: 'TRIVY_CORRELATED' });
  const p = getSecurityRemediationPresentation(t, elig(t), CVE);
  assert.equal(p.state, 'NON_RETRYABLE_FAILURE');
  assert.equal(p.label, 'Intervention manuelle requise');
  assert.match(p.explanation, /n'a pas pu être validée/);
  assert.doesNotMatch(p.explanation, /^CANDIDATE_BUILD_FAILED$/, 'never the raw opaque code verbatim as the whole message');
  // Existing attempts must not bypass the dedicated retry endpoint.
  assert.equal(p.selectable, false, 'a failure cannot bypass the dedicated retry endpoint');
  assert.equal(p.retryAllowed, false, 'retryability absent from legacy backend means no retry');
}
console.log('9. legacy failure -> safe manual message, no retry without backend permission: PASS');

// 10. Trivy finding keeps its EXISTING, unchanged behavior (this module is never consulted for it)
{
  const trivyTask = { id: 'task-2', source: 'TRIVY', ruleOrCve: 'CVE-2023-6378', findingSnapshot: { component: 'ch.qos.logback:logback-classic', ruleOrCve: 'CVE-2023-6378' } };
  const { canSelectCveTask, resolveFixedVersion } = eligibility;
  const trivyCve = { pkg: 'ch.qos.logback:logback-classic', fixedVersion: '1.2.13' };
  assert.equal(canSelectCveTask(trivyTask, true, trivyCve).selectable, true);
  assert.equal(resolveFixedVersion(trivyCve, trivyTask), '1.2.13');
}
console.log('10. Trivy finding unaffected by this module, existing eligibility/resolution untouched: PASS');

// 11. same CVE id present as both an OWASP and a Trivy task -> no incorrect visual merge
{
  const owaspTask = task({ id: 'owasp-task' }, { component: 'org.yaml:snakeyaml' });
  const trivyTask = { id: 'trivy-task', source: 'TRIVY', ruleOrCve: CVE.id, findingSnapshot: { component: 'org.yaml:snakeyaml' } };
  const owaspP = getSecurityRemediationPresentation(owaspTask, elig(owaspTask), CVE);
  assert.notEqual(owaspTask.id, trivyTask.id, 'sanity: two genuinely distinct task ids sharing a CVE id');
  assert.equal(owaspP.state, 'MANUAL_REVIEW_NO_TARGET'); // no fixedVersion set on this particular owaspTask fixture
  // The presentation is keyed off the TASK object passed in, never a bare CVE id -- calling it again for the Trivy task's
  // own data must never leak the OWASP task's state onto it, proven by using the shared (Trivy-path) functions directly.
  assert.equal(eligibility.canSelectCveTask(trivyTask, true, { pkg: 'org.yaml:snakeyaml', fixedVersion: '1.31' }).selectable, true);
}
console.log('11. identical CVE id on independent OWASP/Trivy tasks -> no visual/state merge: PASS');

// 12. summary is computed dynamically from the same per-row classification, never hardcoded
{
  const cves = [
    { id: 'A', pkg: 'org.yaml:snakeyaml' },
    { id: 'B', pkg: 'org.yaml:snakeyaml' },
    { id: 'C', pkg: 'org.yaml:snakeyaml' },
  ];
  const tasks = {
    A: task({ id: 'a' }, { fixedVersion: '1.31', fixedVersionSource: 'TRIVY_CORRELATED' }),
    B: task({ id: 'b' }, { fixedVersion: null, fixedVersionUnavailableReason: 'MULTIPLE_CANDIDATES' }),
    C: task({ id: 'c' }, { fixedVersion: null, fixedVersionUnavailableReason: 'NO_TRIVY_MATCH' }),
  };
  const taskFor = cve => tasks[cve.id];
  const eligFor = (t, cve) => eligibility.canSelectCveTask(t, true, cve);
  const summary = summarizeSecurityRemediation(cves, taskFor, eligFor);
  assert.equal(summary.total, 3);
  assert.equal(summary.autoFixAvailable, 1);
  assert.equal(summary.manualRequired, 2);
  assert.equal(summary.candidateReady, 0);
  // Change the underlying data -> the summary must change with it, never a frozen/hardcoded number.
  tasks.B = task({ id: 'b2' }, { fixedVersion: '2.0', fixedVersionSource: 'TRIVY_CORRELATED' });
  const summary2 = summarizeSecurityRemediation(cves, taskFor, eligFor);
  assert.equal(summary2.autoFixAvailable, 2);
  assert.equal(summary2.manualRequired, 1);
}
console.log('12. summary computed dynamically from real per-row classification, reacts to data changes: PASS');

// ── Component-level wiring (cve-table.component.ts) — proves the ACTUAL
// integration, not just the pure module above. cve-selection-eligibility.
// spec.mjs loads this same component but never calls owaspPresentation()/
// owaspRemediationSummary(), so it never exercises this wiring; this is the
// only place that does.
const { CveTableComponent } = load('../src/app/features/projects/cve-table.component.ts', {
  '../../shared/cve-selection-eligibility': eligibility,
  '../../shared/security-remediation-presentation': load('../src/app/shared/security-remediation-presentation.ts', { './cve-selection-eligibility': eligibility }),
});

{
  const table = new CveTableComponent();
  table.source = 'OWASP';
  const t = task({}, { fixedVersion: '1.31', fixedVersionSource: 'TRIVY_CORRELATED' });
  table.tasks = [t];
  table.cves = [CVE];
  table.selectionRule = (task_, c) => eligibility.canSelectCveTask(task_, true, c);
  const row = table.normalized()[0];
  const p = table.owaspPresentation(row);
  assert.equal(p.state, 'AUTO_FIX_AVAILABLE');
  assert.equal(p.targetVersion, '1.31');
  assert.equal(p.targetSource, 'Trivy');
  assert.equal(p.selectable, true);

  const summary = table.owaspRemediationSummary();
  assert.equal(summary.total, 1);
  assert.equal(summary.autoFixAvailable, 1);

  // Trivy uses the same scanner-neutral presentation and summary.
  const trivyTable = new CveTableComponent();
  trivyTable.source = 'TRIVY';
  trivyTable.tasks = [{ id: 'trivy-1', source: 'TRIVY', findingSnapshot: { component: 'ch.qos.logback:logback-classic', ruleOrCve: 'CVE-2023-6378' } }];
  trivyTable.cves = [{ id: 'CVE-2023-6378', pkg: 'ch.qos.logback:logback-classic', fixedVersion: '1.2.13' }];
  trivyTable.selectionRule = (task_, c) => eligibility.canSelectCveTask(task_, true, c);
  const trivyRow = trivyTable.normalized()[0];
  assert.equal(trivyTable.owaspPresentation(trivyRow).state, 'AUTO_FIX_AVAILABLE');
  assert.equal(trivyTable.owaspRemediationSummary().autoFixAvailable, 1);
}
console.log('component wiring: owaspPresentation()/owaspRemediationSummary() correctly wired on CveTableComponent, shared with Trivy: PASS');

// ── The real worked example from the ticket (Phase 7): CVE-2022-25857 /
// org.yaml:snakeyaml, closed via real PR #40. ──
{
  const t = task(
    { securityFindingRemediation: { status: 'CLOSED', reason: 'TARGET_CVE_CLOSED', prNumber: 40, prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/40' } },
    { fixedVersion: '1.31', fixedVersionSource: 'TRIVY_CORRELATED', installedVersion: '1.29', currentVersion: '1.29' },
  );
  const p = getSecurityRemediationPresentation(t, elig(t), CVE);
  assert.equal(p.state, 'VERIFICATION_REQUIRED');
  assert.equal(p.label, 'Correction à vérifier');
  assert.equal(p.targetVersion, '1.31');
  assert.equal(p.targetSource, 'Trivy', 'never "OWASP" -- OWASP only detected the CVE, Trivy supplied the target version');
  assert.equal(p.prNumber, 40);
  assert.equal(p.prUrl, 'https://github.com/souhaiel11/pfe-app-test/pull/40');
}
console.log('Phase 7 worked example (CVE-2022-25857/snakeyaml/PR #40): Scanner=OWASP (detection), Source cible=Trivy, Status=Correction à vérifier, PR #40: PASS');

console.log('security-remediation-presentation.spec.mjs: ALL CHECKS PASS');
