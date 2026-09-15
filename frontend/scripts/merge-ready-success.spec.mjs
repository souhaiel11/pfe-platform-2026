import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const angularStub = () => new Proxy({}, { get: () => (..._args) => target => target });
const loadComponent = (source, exportName) => {
  const exports = {};
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require: angularStub, setTimeout: () => 0, clearInterval() {}, console });
  return Object.create(exports[exportName].prototype);
};

const projectSource = read('../src/app/features/projects/project-detail.component.ts');
const projectTemplate = read('../src/app/features/projects/project-detail.component.html');
const incidentSource = read('../src/app/features/incidents/incident-detail.component.ts');
const incidentTemplate = read('../src/app/features/incidents/incident-detail.component.html');
const remediationSource = read('../src/app/features/incidents/remediation-card.component.ts');

const validatedRequest = { status: 'COMPLETED', result: 'VALIDATED' };
const mergeReady = { authorization: 'MERGE_READY', forSha: 'a'.repeat(40) };
const selected = { id: 'selected', remediationType: 'AUTO_FIX_ELIGIBLE' };
const remaining = { id: 'remaining', remediationType: 'AUTO_FIX_ELIGIBLE' };

const project = loadComponent(projectSource, 'ProjectDetailComponent');
project.latestReport = {
  prUrl: 'https://github.example/pull/32',
  metadata: {
    prValidationRequest: validatedRequest,
    fixRequest: { status: 'VALIDATED', prNumber: 32, prHeadSha: 'a'.repeat(40), findingIds: ['selected'] },
    validation: { mergeAuthorization: mergeReady, derived: { findings: [{ findingId: 'selected', verdict: 'VALID' }] } },
  },
};
project.auth = { currentUser: { role: 'developer' } };

// CASE 1 + PR presentation.
assert.equal(project.isMergeReadySuccess(), true);
assert.match(projectTemplate, /Correction réussie/);
assert.match(projectTemplate, /En attente de fusion/);
assert.match(projectTemplate, /batchPrNumber\(\)/);
assert.match(projectTemplate, /Voir la Pull Request/);

project.latestReport.metadata.fixRequest.prHeadSha = 'b'.repeat(40);
assert.equal(project.isMergeReadySuccess(), false);
project.latestReport.metadata.fixRequest.prHeadSha = 'a'.repeat(40);

// CASE 2 and CASE 3: incomplete/non-authoritative validation never succeeds.
project.latestReport.metadata.prValidationRequest = { status: 'RUNNING', result: null };
assert.equal(project.isMergeReadySuccess(), false);
project.latestReport.metadata.prValidationRequest = { status: 'COMPLETED', result: 'INCONCLUSIVE' };
assert.equal(project.isMergeReadySuccess(), false);

// CASE 4: the existing FIX_FAILED branch remains present and cannot be success.
project.latestReport.metadata.fixRequest.status = 'FIX_FAILED';
project.latestReport.metadata.validation.mergeAuthorization.authorization = 'BLOCKED';
assert.equal(project.isMergeReadySuccess(), false);
assert.match(projectTemplate, /activeFixRequest\(\)\?\.status === 'FIX_FAILED'/);
assert.match(projectTemplate, /Échec de la correction/);

// CASE 5: only a selected, authoritatively VALID finding gets the candidate state.
project.latestReport.metadata.prValidationRequest = validatedRequest;
project.latestReport.metadata.fixRequest.status = 'VALIDATED';
project.latestReport.metadata.validation.mergeAuthorization = { ...mergeReady, authorization: 'MERGE_READY' };
assert.equal(project.isFindingMergeReady(selected), true);
assert.equal(project.canSelectFinding(selected), false);
assert.match(projectTemplate, /Validé dans PR #\{\{batchPrNumber\(\)\}\}/);

// CASE 6: a finding outside the batch keeps its ordinary label and never inherits success.
assert.equal(project.isFindingMergeReady(remaining), false);
assert.equal(project.isFindingValidated(remaining), false);
assert.equal(project.canSelectFinding(remaining), false); // unchanged global PR lock

const incident = loadComponent(incidentSource, 'IncidentDetailComponent');
incident.prValidationRequest = validatedRequest;
incident.incident = {
  prUrl: 'https://github.example/pull/32',
  metadata: {
    fixRequest: { prNumber: 32, prHeadSha: 'a'.repeat(40), findingIds: ['selected'] },
    validation: { derived: { findings: [
      { findingId: 'selected', verdict: 'VALID' },
      { findingId: 'remaining', verdict: 'VALID' },
    ] } },
  },
};
incident.validation = {
  ...incident.incident.metadata.validation,
  mergeAuthorization: { ...mergeReady, authorization: 'MERGE_READY' },
};
assert.equal(incident.isMergeReadySuccess(), true);
assert.deepEqual([...incident.validatedSonarIds()], ['selected']);
assert.match(incidentTemplate, /Correction réussie/);
assert.match(incidentTemplate, /En attente de fusion/);

// CASE 7: stale SHA is downgraded by the real normalization helper.
incident.incident.metadata.fixRequest.prHeadSha = 'b'.repeat(40);
assert.equal(incident.mergeAuthorization().authorization, 'INCONCLUSIVE');
assert.equal(incident.isMergeReadySuccess(), false);

// Compact remediation UX and non-selectability remain driven by validatedIds.
assert.match(remediationSource, /✓ Correction validée/);
assert.match(remediationSource, /En attente de fusion/);
assert.match(remediationSource, /\[disabled\]="isValidated\(i\.id\) \|\| locked/);

console.log('merge-ready-success: PASS');
