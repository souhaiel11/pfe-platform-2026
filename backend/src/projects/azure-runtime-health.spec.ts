import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ProjectsService } from './projects.service';

const normalize = (input: any) => (ProjectsService.prototype as any).normalizeAzureConfig(input);
const base = { provider: 'azure-container-instances', resourceGroup: 'rg-pfe-devsecops',
  targetName: 'aci-canary', registry: 'acrpfedevsecops', imageRepository: 'pfe-app-test' };
assert.equal(normalize(base).healthCheck, undefined);
const healthCheck = { path: '/api/auth/health', expectedBody: 'OK', client: 'wget', port: '8080' };
assert.deepEqual(normalize({ ...base, healthCheck }).healthCheck, healthCheck);
for (const change of [{ path: '/health;id' }, { client: 'sh' }, { port: '9999' },
  { password: 'must-not-persist' }, { expectedBody: '' }]) {
  assert.throws(() => normalize({ ...base, healthCheck: { ...healthCheck, ...change } }));
}
assert.equal(normalize({ ...base, arbitrarySecret: 'must-not-persist' }).arbitrarySecret, undefined);
console.log('Azure runtime health configuration: PASS');
