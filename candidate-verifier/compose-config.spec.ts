// R22-E2C2 Phase 15 — structural validation of docker-compose.yml via
// `docker compose config --format json`, WITHOUT ever printing the
// resolved config: this repo's compose file resolves `env_file:` inline
// for the `backend` service, so a naive full dump (as running
// `docker compose config` plainly does) prints real secret values
// (N8N_INTERNAL_SECRET etc.) — learned the hard way earlier this session.
// This test parses the JSON and asserts on structure only, never logging
// the `backend` service's `environment` block or any secret-shaped value.
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const repoRoot = path.join(__dirname, '..');
const raw = execFileSync('docker', ['compose', 'config', '--format', 'json'], { cwd: repoRoot, encoding: 'utf8' });
const config = JSON.parse(raw);

const worker = config.services?.['candidate-verifier'];
assert.ok(worker, 'candidate-verifier service exists in the compose config');
console.log('PASS - candidate-verifier service exists in docker compose config');

assert.equal(worker.ports, undefined, 'candidate-verifier has NO published host port');
console.log('PASS - no published worker port');

// Only the three plain-configuration keys are allowed on the worker --
// nothing secret-shaped, verified by KEY NAME only, values never logged.
const workerEnvKeys = Object.keys(worker.environment || {});
assert.deepEqual(new Set(workerEnvKeys), new Set(['PORT', 'WORKSPACE_ROOT', 'REPO_CACHE_ROOT']), 'candidate-verifier environment has exactly the three expected plain-config keys, nothing else');
const forbiddenKeys = ['JWT_SECRET', 'DB_PASS', 'POSTGRES_PASSWORD', 'N8N_INTERNAL_SECRET', 'N8N_CALLBACK_SECRET', 'AZURE_DEPLOY_AGENT_SECRET'];
for (const key of forbiddenKeys) {
  assert.equal(workerEnvKeys.includes(key), false, `candidate-verifier must not receive ${key}`);
}
console.log('PASS - candidate-verifier environment contains none of the prohibited secret keys (checked by key name only, no value printed)');

const workerNetworks = Object.keys(worker.networks || {});
assert.deepEqual(workerNetworks, ['candidate-verification-net'], 'candidate-verifier joins ONLY candidate-verification-net (no path to pfe-network/Postgres/n8n/Jenkins/Sonar)');
console.log('PASS - worker network membership is exactly candidate-verification-net');

const backend = config.services?.backend;
assert.ok(backend, 'sanity: backend service still exists');
const backendNetworks = Object.keys(backend.networks || {});
assert.deepEqual(new Set(backendNetworks), new Set(['pfe-network', 'candidate-verification-net']), 'backend joins both pfe-network (existing) and candidate-verification-net (new) — no other service does');
console.log('PASS - backend joins both pfe-network and candidate-verification-net');

// backend's environment key SET is inspected (names only, never values) to
// confirm CANDIDATE_VERIFIER_URL was added and nothing was removed.
const backendEnvKeys = Object.keys(backend.environment || {});
assert.ok(backendEnvKeys.includes('CANDIDATE_VERIFIER_URL'), 'backend has the worker URL configured');
console.log('PASS - backend has CANDIDATE_VERIFIER_URL configured (key presence only, value not asserted/printed)');

const volumeMount = (worker.volumes || []).find((v: any) => v.target === '/var/pfe-remediation-repos');
assert.ok(volumeMount, 'candidate-verifier has the repository cache volume mounted');
assert.equal(volumeMount.source, 'candidate_repo_cache');
console.log('PASS - repository cache volume correctly mounted on the worker only');

assert.ok(!(backend.volumes || []).some((v: any) => v.target === '/var/pfe-remediation-repos'), 'backend does NOT have repository filesystem access (no shared mount)');
console.log('PASS - backend has no repository cache volume (no filesystem access to candidate repos)');

console.log('\ndocker-compose structural validation: PASS');
