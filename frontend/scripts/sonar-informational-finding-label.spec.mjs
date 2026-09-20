import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/app/features/projects/project-detail.component.ts', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/app/features/projects/project-detail.component.html', import.meta.url), 'utf8');

// Executes the REAL component method (findingActionLabel / findingCellStatus),
// not a re-implementation -- proves the actual presentational fix, generic on
// (severity, remediationType) only, with no rule/source/file/project literal.
// The status-labels module is loaded for real (not stubbed): findingActionLabel
// delegates to remediationLabel() -> remediationTypeLabel(), and the real
// label text ('Action développeur requise', etc.) must come from the actual
// shared module, not a re-typed copy in this test.
const labelsSource = readFileSync(new URL('../src/app/shared/status-labels.ts', import.meta.url), 'utf8');
const labelsExports = {};
vm.runInNewContext(
  ts.transpileModule(labelsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: labelsExports, require: () => ({}), console },
);
const exports = {};
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
vm.runInNewContext(code, {
  exports,
  require: (spec) => spec.endsWith('status-labels') ? labelsExports : new Proxy({}, { get: () => () => () => {} }),
  setTimeout: () => 0, console,
});
const component = Object.create(exports.ProjectDetailComponent.prototype);
Object.assign(component, { latestReport: { metadata: {} } });

const INFORMATIONAL_LABEL = 'Information — à examiner';

// A. Sonar INFO finding (e.g. java:S1135), no auto-fix dispatched -> scanner-
// agnostic informational label, stays visible.
const sonarInfoFinding = { id: 'i1', source: 'SONARQUBE', rule: 'java:S1135', severity: 'INFO', remediationType: 'DEVELOPER_ACTION_REQUIRED' };
assert.equal(component.findingActionLabel(sonarInfoFinding), INFORMATIONAL_LABEL, 'A: Sonar INFO + DEVELOPER_ACTION_REQUIRED -> generic informational label');
assert.equal(component.findingCellStatus(sonarInfoFinding), INFORMATIONAL_LABEL, 'A: table cell uses the same informational label');

// B. A DIFFERENT scanner source (Trivy) at INFO severity with the same
// no-auto-fix fallback -> the identical label, proving the rule is not
// Sonar-specific despite the finding never happening to come from Sonar.
const trivyInfoFinding = { id: 't1', source: 'TRIVY', severity: 'INFO', remediationType: 'DEVELOPER_ACTION_REQUIRED' };
assert.equal(component.findingActionLabel(trivyInfoFinding), INFORMATIONAL_LABEL, 'B: a non-Sonar (Trivy) INFO finding gets the SAME scanner-agnostic label');
const zapInfoFinding = { id: 'z1', source: 'ZAP', severity: 'INFO', remediationType: 'DEVELOPER_ACTION_REQUIRED' };
assert.equal(component.findingActionLabel(zapInfoFinding), INFORMATIONAL_LABEL, 'B: a ZAP INFO finding also gets the identical label');

// C. Actual actionable (non-informational) finding -> unchanged, real
// action-required wording, regardless of source.
const criticalFinding = { id: 'c1', rule: 'java:S3305', severity: 'CRITICAL', remediationType: 'DEVELOPER_ACTION_REQUIRED' };
assert.equal(component.findingActionLabel(criticalFinding), 'Action développeur requise', 'C: CRITICAL + DEVELOPER_ACTION_REQUIRED keeps the real action-required wording');
const majorFinding = { id: 'm1', rule: 'java:S107', severity: 'MAJOR', remediationType: 'DEVELOPER_ACTION_REQUIRED' };
assert.equal(component.findingActionLabel(majorFinding), 'Action développeur requise', 'C: MAJOR + DEVELOPER_ACTION_REQUIRED also unaffected (only INFO is special-cased)');

// D. AUTO_FIX_ELIGIBLE preserved exactly, for every severity (remediationType
// always wins over severity for anything other than the DEVELOPER_ACTION_
// REQUIRED fallback).
const autoFixInfo = { id: 'a1', severity: 'INFO', remediationType: 'AUTO_FIX_ELIGIBLE' };
assert.equal(component.findingActionLabel(autoFixInfo), 'Correction automatisable', 'D: AUTO_FIX_ELIGIBLE unaffected by severity, even at INFO');

// E. ADMIN_ACTION_REQUIRED preserved exactly, for every severity.
const adminInfo = { id: 'ad1', severity: 'INFO', remediationType: 'ADMIN_ACTION_REQUIRED' };
assert.equal(component.findingActionLabel(adminInfo), 'Action administrateur requise', 'E: ADMIN_ACTION_REQUIRED unaffected by severity, even at INFO');

// F. Missing/unknown severity or remediationType -> safe existing fallback,
// never a crash.
const noSeverity = { id: 'n1', rule: 'java:SXXX', remediationType: 'DEVELOPER_ACTION_REQUIRED' };
assert.equal(component.findingActionLabel(noSeverity), 'Action développeur requise', 'F: missing severity falls back to the existing label, no crash');
const unknownRemediation = { id: 'n2', severity: 'INFO', remediationType: undefined };
assert.doesNotThrow(() => component.findingActionLabel(unknownRemediation), 'F: missing remediationType never throws');

// Template wiring: the drawer footer, drawer "Type" field, and table-row
// tooltip all call the generic function instead of interpolating the raw
// literal text or the bare remediationType-only label.
assert.match(template, /findingActionLabel\(selectedSonarFinding\)/, 'drawer footer/type field use findingActionLabel');
assert.match(template, /findingActionLabel\(issue\)/, 'table row tooltip uses findingActionLabel');
// Never hardcode "Action développeur requise" as unconditional literal text
// tied only to remediationType (the old bug) -- it must always be reached
// through the severity-aware function now.
assert.doesNotMatch(
  template.match(/DEVELOPER_ACTION_REQUIRED'\s*"\s*class="action-required">([^<{]*)</)?.[1] || '',
  /\S/,
  'drawer footer no longer interpolates a raw literal for the DEVELOPER_ACTION_REQUIRED case',
);
// The label itself must never name a specific scanner (Sonar/Trivy/OWASP/ZAP).
assert.doesNotMatch(component.findingActionLabel(sonarInfoFinding), /sonar|trivy|owasp|zap/i, 'the informational label names no specific scanner');

console.log('Sonar informational finding label: PASS (A-F, scanner-agnostic generic label, no rule/source/project-specific hardcoding)');
