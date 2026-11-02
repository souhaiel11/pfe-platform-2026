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

// V1.7 predeploy phases added two plain-config/credential keys on top of
// the original three: BUILDER_SCANNER_URL (an address, like
// CANDIDATE_VERIFIER_URL on the backend below) and BUILDER_INTERNAL_SECRET
// (V1.7 final predeploy phase, Phase A -- the one credential
// candidate-verifier now owns, used only to authenticate its own outbound
// call to builder-scanner). Still an exact allowlist, not a loose superset
// check: nothing beyond these five key NAMES is permitted, and values are
// never printed here.
const workerEnvKeys = Object.keys(worker.environment || {});
assert.deepEqual(new Set(workerEnvKeys), new Set(['PORT', 'WORKSPACE_ROOT', 'REPO_CACHE_ROOT', 'BUILDER_SCANNER_URL', 'BUILDER_INTERNAL_SECRET']), 'candidate-verifier environment has exactly the five expected plain-config/credential keys, nothing else');
const forbiddenKeys = ['JWT_SECRET', 'DB_PASS', 'POSTGRES_PASSWORD', 'N8N_INTERNAL_SECRET', 'N8N_CALLBACK_SECRET', 'AZURE_DEPLOY_AGENT_SECRET'];
for (const key of forbiddenKeys) {
  assert.equal(workerEnvKeys.includes(key), false, `candidate-verifier must not receive ${key}`);
}
console.log('PASS - candidate-verifier environment contains none of the prohibited secret keys (checked by key name only, no value printed)');

// V1.7 predeploy phase — candidate-verifier now ALSO joins builder-scanner-net
// (in addition to candidate-verification-net) to reach the dedicated
// builder; set comparison, not array-order-sensitive, since compose's own
// JSON key order is not a meaningful invariant.
const workerNetworks = Object.keys(worker.networks || {});
assert.deepEqual(new Set(workerNetworks), new Set(['candidate-verification-net', 'builder-scanner-net']), 'candidate-verifier joins ONLY candidate-verification-net and builder-scanner-net (no path to pfe-network/Postgres/n8n/Jenkins/Sonar)');
console.log('PASS - worker network membership is exactly {candidate-verification-net, builder-scanner-net}');

// V1.7 final predeploy phase, Phase B/C/M — the production CAP_SYS_ADMIN
// placement decision, structurally verified rather than trusted from a
// one-off manual check: it belongs on builder-scanner and ONLY
// builder-scanner, never on candidate-verifier.
assert.equal(worker.cap_add, undefined, 'candidate-verifier must NEVER be granted any added Linux capability, CAP_SYS_ADMIN included');
console.log('PASS - candidate-verifier has no cap_add of any kind');

const builder = config.services?.['builder-scanner'];
assert.ok(builder, 'builder-scanner service exists in the compose config');
assert.deepEqual(builder.cap_add, ['SYS_ADMIN'], 'builder-scanner has exactly one added capability, SYS_ADMIN -- no other capability may be added');
assert.equal(builder.init, true, 'builder-scanner must run with init:true so a SIGKILLed build\'s orphaned children get reaped instead of accumulating as permanent zombies (real finding, V1.7 final predeploy phase)');
assert.equal(builder.privileged, undefined, 'builder-scanner must not be privileged');
assert.equal(builder.security_opt, undefined, "builder-scanner must not override Docker's default seccomp profile");
assert.equal(builder.pid, undefined, 'builder-scanner must not share the host PID namespace');
assert.equal(builder.network_mode, undefined, 'builder-scanner must not use host networking');
assert.equal(builder.ports, undefined, 'builder-scanner has NO published host port');
const builderNetworks = Object.keys(builder.networks || {});
assert.deepEqual(new Set(builderNetworks), new Set(['builder-scanner-net']), 'builder-scanner joins ONLY builder-scanner-net');
const builderEnvKeys = Object.keys(builder.environment || {});
assert.deepEqual(new Set(builderEnvKeys), new Set(['PORT', 'WORKSPACE_ROOT', 'REPO_CACHE_ROOT', 'SECURITY_TRIVY_CACHE_DIR', 'BUILDER_INTERNAL_SECRET', 'MAVEN_CACHE_DIR', 'PODMAN_GRAPH_ROOT_DIR']), 'builder-scanner environment has exactly these seven keys, nothing else');
for (const key of forbiddenKeys) {
  assert.equal(builderEnvKeys.includes(key), false, `builder-scanner must not receive ${key}`);
}
console.log('PASS - builder-scanner: cap_add=[SYS_ADMIN] only, not privileged, default seccomp, no host pid/network, no published port, network membership exactly {builder-scanner-net}, no prohibited secret keys');

// builder-scanner-net's ONLY members are candidate-verifier and
// builder-scanner -- if a future change attaches any other service to it,
// this must fail loudly, per this phase's own network-boundary requirement.
const builderNetMembers = Object.entries(config.services || {})
  .filter(([, svc]: [string, any]) => Object.prototype.hasOwnProperty.call(svc.networks || {}, 'builder-scanner-net'))
  .map(([name]) => name);
assert.deepEqual(new Set(builderNetMembers), new Set(['candidate-verifier', 'builder-scanner']), 'builder-scanner-net must have EXACTLY {candidate-verifier, builder-scanner} as members, nothing else');
console.log('PASS - builder-scanner-net membership is exactly {candidate-verifier, builder-scanner}');

// V1.7 runtime stabilization phase, Phase K — the two new persistent
// caches (Maven local-repo, Podman graph root) must not enlarge the trust
// boundary: mounted ONLY into builder-scanner, nowhere else, same
// discipline as trivy_scanner_cache before them.
for (const volumeName of ['builder_maven_cache', 'builder_podman_storage']) {
  const mountedInto = Object.entries(config.services || {})
    .filter(([, svc]: [string, any]) => (svc.volumes || []).some((v: any) => v.source === volumeName))
    .map(([name]) => name);
  assert.deepEqual(mountedInto, ['builder-scanner'], `${volumeName} must be mounted ONLY into builder-scanner`);
}
console.log('PASS - builder_maven_cache and builder_podman_storage are mounted only into builder-scanner');

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
