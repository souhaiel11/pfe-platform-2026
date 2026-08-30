import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const component = readFileSync(new URL('../src/app/features/projects/project-detail.component.ts', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/app/features/projects/project-detail.component.html', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/app/core/services/api.service.ts', import.meta.url), 'utf8');

const method = component.slice(component.indexOf('confirmSonarCorrection(): void'), component.indexOf('\n  // Source unique', component.indexOf('confirmSonarCorrection(): void')));
assert.ok(method.indexOf('if (this.approving) return;') < method.indexOf('this.api.approveFixBatch'), 'submitting guard must precede approval call');
assert.equal((method.match(/approveFixBatch/g) || []).length, 1, 'one approval call site expected');
assert.ok(template.includes('[disabled]="approving" (click)="confirmSonarCorrection()"'), 'confirmation button must disable while pending');
assert.ok(!api.match(/approveFixBatch[\s\S]{0,200}\bretry\s*\(/), 'approval request must not configure automatic retry');
assert.ok(component.includes('Supprimer le champ privé « ${field} » inutilisé.'), 'S1068 French summary missing');
assert.ok(component.includes('Supprimer ce bloc de code commenté devenu inutile.'), 'S125 French summary missing');
assert.ok(template.includes('<summary>Preuve technique Sonar</summary>') && template.includes('{{finding.message}}'), 'raw Sonar evidence must remain available');

console.log('wf2 frontend hotfix contract: PASS');
