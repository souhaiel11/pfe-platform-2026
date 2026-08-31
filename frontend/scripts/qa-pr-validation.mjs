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
console.log('qa-pr-validation: PASS');
