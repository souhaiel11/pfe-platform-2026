import * as assert from 'node:assert/strict';
import 'reflect-metadata';
import { buildEffectiveConfig } from './effective-config.service';
import { EffectiveConfigController } from './effective-config.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const sensitiveKeys = ['GITHUB_TOKEN', 'N8N_INTERNAL_SECRET', 'JWT_SECRET', 'ANTHROPIC_API_KEY', 'DB_PASS', 'DB_PASSWORD', 'DB_USER', 'N8N_URL', 'N8N_API_KEY', 'ANTHROPIC_MODEL', 'MAX_TOKENS'];
const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
for (const key of sensitiveKeys) env[key] = 'LEAK_' + key;
env.N8N_WF2_WEBHOOK = 'http://user:LEAK_credentials@n8n:5678/webhook';
const result = buildEffectiveConfig(env);
const json = JSON.stringify(result);
for (const key of sensitiveKeys) {
  assert.ok(!json.includes(key), 'sensitive key excluded: ' + key);
  assert.ok(!json.includes(env[key]!), 'sensitive value excluded: ' + key);
}
assert.ok(!json.includes('LEAK_'));
function checkKeys(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!/token|secret|password|db_pass|anthropic|model|max_tokens|workflowId|url/i.test(key), 'forbidden key: ' + key);
    checkKeys(child);
  }
}
checkKeys(result);
assert.deepEqual(Object.keys(result).sort(), ['generatedAt', 'platform', 'policies', 'scanners']);
assert.deepEqual(Object.keys(result.platform).sort(), ['defaultBranch','environment','projectConfigurationReason','targetRepository','wf2','wf6','workflowConfigurationReason']);
assert.equal(result.platform.environment, 'production');
assert.deepEqual(result.platform.wf2, { configured: true });
assert.deepEqual(result.platform.wf6, { configured: true });
const empty = buildEffectiveConfig({});
assert.equal(empty.platform.environment, null);
assert.equal(empty.platform.targetRepository, null);
assert.equal(empty.platform.defaultBranch, null);
assert.equal(empty.platform.wf2.configured, false);
assert.equal(empty.scanners.trivy.available, null);
assert.equal(empty.scanners.trivy.severityThresholds, null);
for (const database of [empty.scanners.trivy.vulnDb, empty.scanners.trivy.javaDb]) {
  assert.equal(database.ageMs, null); assert.equal(database.maxAgeMs, null);
}
assert.equal(buildEffectiveConfig({NODE_ENV:'LEAK_secret'}).platform.environment, null);
assert.equal(result.policies.invariants.length, 4);
assert.ok(Reflect.getMetadata('__guards__', EffectiveConfigController).includes(JwtAuthGuard));
assert.equal(Reflect.getMetadata('path', EffectiveConfigController), 'config');
assert.equal(Reflect.getMetadata('path', EffectiveConfigController.prototype.getEffective), 'effective');
assert.equal(Reflect.getMetadata('method', EffectiveConfigController.prototype.getEffective), 0);
assert.equal(Object.getOwnPropertyNames(EffectiveConfigController.prototype).length, 2, 'GET only, no mutation endpoint');
console.log('Effective config: explicit keys/values secret exclusions, JWT guard, GET only, dynamic/unavailable values PASS');
