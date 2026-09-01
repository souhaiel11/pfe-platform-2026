import assert from 'node:assert/strict';
import fs from 'node:fs';

const component = fs.readFileSync('src/app/features/incidents/incident-detail.component.ts', 'utf8');
const template = fs.readFileSync('src/app/features/incidents/incident-detail.component.html', 'utf8');
const projectComponent = fs.readFileSync('src/app/features/projects/project-detail.component.ts', 'utf8');
const projectTemplate = fs.readFileSync('src/app/features/projects/project-detail.component.html', 'utf8');
const api = fs.readFileSync('src/app/core/services/api.service.ts', 'utf8');

assert.match(template, /Valider la Pull Request/);
assert.match(template, /\[disabled\]="prValidationBusy"/);
assert.match(component, /if \(this\.prValidationBusy \|\| !this\.canRequestPrValidation\(\)\) return;/);
assert.match(component, /this\.prValidationBusy = true;[\s\S]*requestPrValidation\(this\.id\)/);
assert.match(api, /\/incidents\/\$\{id\}\/pr-validation/);
assert.doesNotMatch(component, /requestPrValidation[\s\S]{0,500}triggerBuild/);
assert.doesNotMatch(component, /localStorage[\s\S]{0,500}prValidation/);
assert.match(projectTemplate, /PR #\{\{activeFixRequest\(\)\?\.prNumber\}\} créée/);
assert.match(projectTemplate, /Valider la Pull Request/);
assert.match(projectComponent, /this\.canOperate && request\?\.status === 'PR_CREATED'/);
assert.match(projectComponent, /if \(this\.prValidationBusy \|\| !this\.canRequestPrValidation\(\) \|\| !this\.latestReport\?\.id\) return;/);
assert.match(projectComponent, /this\.prValidationBusy = true;[\s\S]*requestPrValidation\(this\.latestReport\.id\)/);
assert.doesNotMatch(projectComponent, /requestPrValidation[\s\S]{0,700}triggerBuild/);
assert.doesNotMatch(projectComponent, /localStorage[\s\S]{0,500}prValidation/);

// R65 — governed PR-head refresh: the 409 "PR changed" conflict must surface
// an explicit "Actualiser la cible" action, distinct from the retry button,
// and refreshing must never itself relaunch validation automatically.
assert.match(api, /refreshPrValidationTarget[\s\S]{0,120}\/incidents\/\$\{id\}\/pr-validation\/refresh-target/);

for (const [name, comp, tmpl] of [['incident-detail', component, template], ['project-detail', projectComponent, projectTemplate]]) {
  assert.match(comp, /prValidationTargetStale/, `${name}: missing prValidationTargetStale state`);
  assert.match(comp, /status\s*===\s*409[\s\S]{0,80}includes\('a changé'\)/, `${name}: 409 detection must key off the exact backend conflict message`);
  assert.match(comp, /refreshValidationTarget\(\)[\s\S]{0,20}:\s*void\s*\{/, `${name}: missing refreshValidationTarget() action`);
  assert.match(comp, /refreshPrValidationTarget\(/, `${name}: refreshValidationTarget() must call the api service`);
  // No automatic retry after a successful refresh: the refresh success
  // handler must never itself call requestPrValidation.
  const refreshMethodMatch = comp.match(/refreshValidationTarget\(\)[\s\S]*?\n  \}/);
  assert.ok(refreshMethodMatch, `${name}: could not isolate refreshValidationTarget() body`);
  assert.doesNotMatch(refreshMethodMatch[0], /this\.requestPrValidation\(\)/, `${name}: refresh must never auto-trigger a new validation retry`);
  assert.match(tmpl, /prValidationTargetStale/, `${name} template: missing the stale-target warning`);
  assert.match(tmpl, /Actualiser la cible/, `${name} template: missing the explicit refresh action label`);
  assert.match(tmpl, /refreshValidationTarget\(\)/, `${name} template: refresh button must call refreshValidationTarget()`);
}

console.log('qa-pr-validation: PASS');
