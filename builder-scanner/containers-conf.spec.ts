/** V1.7 network-resilience predeploy phase — deterministic proof that the
 * committed builder-scanner image bakes in `image_parallel_copies = 1`,
 * promoted from a validation-only runtime override to the committed
 * Dockerfile this phase.
 *
 * This is a source-text check, not a real network pull -- deliberately,
 * matching this codebase's own established split (fast/offline/
 * deterministic tests vs. real, network-dependent, one-off validation
 * runs -- see e.g. trivy-readiness.spec.ts's synthetic-text unit tests
 * next to the real bootstrap proofs recorded in the audit doc, or
 * candidate-verifier/test-fixtures/run-security-v17-proof.ts). The REAL
 * runtime proof for THIS exact setting was performed manually against a
 * real build of this image during this predeploy phase: `docker run`
 * (default env, no per-container setup needed -- proving the setting is
 * genuinely baked in, not dependent on any external `docker exec`
 * bootstrapping step) followed by a real `podman --log-level=debug pull`
 * of the real Logback fixture's own base image showed
 * `Merged system config "/home/node/.config/containers/containers.conf"`
 * and blob GETs one second apart (sequential), not the ~8 near-
 * simultaneous GETs observed before this phase -- recorded in
 * n8n-workflows/WF6-V1_7-RUNTIME-INTEGRATION-AUDIT.json under this
 * phase's own block.
 *
 * Test the EFFECTIVE runtime where practical without paying for a real
 * network pull in every regression run: this parses the Dockerfile's own
 * RUN step with a regex broad enough to survive comment/whitespace
 * reflow but strict enough to catch the setting being silently dropped,
 * moved after USER node (which would target root's own, irrelevant,
 * config directory instead), or losing its ownership fix.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const dockerfile = fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8');

// 1. The setting exists, under the correct [engine] section, with the
// correct value -- proven this phase to be the exact key Podman 4.3.1 /
// containers-common 0.50.1 reads for blob-copy concurrency.
assert.match(dockerfile, /\[engine\]'\s*'image_parallel_copies = 1/,
  'containers.conf RUN step must declare [engine] / image_parallel_copies = 1');

// 2. Written to the ROOTLESS USER's own config path (proven this phase,
// via Podman's own debug log, to be the exact file it merges) -- NOT
// /etc/containers/containers.conf (a host-global/system change the audit
// explicitly forbade) and NOT written after `USER node` switches away
// from root (which would need a different, more roundabout mkdir/chown
// dance, not what this Dockerfile does).
assert.match(dockerfile, /\/home\/node\/\.config\/containers\/containers\.conf/,
  'must target the rootless user config path, not a system-wide one');
assert.doesNotMatch(dockerfile, /\/etc\/containers\/containers\.conf/,
  'must never write a host-global/system containers.conf');

// 3. Ownership fixed to node:node (the same real bug class already found
// and fixed for the Trivy/Maven/Podman-storage caches this whole
// predeploy effort: a root-authored file/dir a rootless process must
// read is useless if that process can't actually read it).
assert.match(dockerfile, /chown -R node:node \/home\/node\/\.config/,
  'the config directory must be chowned to node:node, the user Podman actually runs as');

// 4. Ordering: this RUN step must appear BEFORE `USER node` switches the
// build's remaining steps to the unprivileged user (root can still
// create files at this point; verifies this wasn't accidentally moved
// after the USER directive, which would need its own re-verification).
const containersConfIndex = dockerfile.indexOf('image_parallel_copies = 1');
const userNodeIndex = dockerfile.indexOf('\nUSER node');
assert.ok(containersConfIndex > -1 && userNodeIndex > -1 && containersConfIndex < userNodeIndex,
  'the containers.conf RUN step must run before USER node switches away from root');

// 5. Security invariants untouched by this change -- storage.conf (driver/
// graphroot) and registries.conf still present and unmodified in kind.
// (privileged/docker.sock/seccomp are docker-compose/`docker run` runtime
// concerns, not something a Dockerfile can even declare -- those are
// already verified against the real parsed docker-compose.yml in
// candidate-verifier/compose-config.spec.ts, not duplicated here.)
assert.match(dockerfile, /driver = "vfs"/);
assert.match(dockerfile, /graphroot = "\/var\/pfe-podman-storage"/);
assert.match(dockerfile, /unqualified-search-registries = \["docker\.io"\]/);

console.log('containers-conf: PASS (image_parallel_copies=1 baked into the committed image, rootless user path, correctly owned, ordered before USER node, security invariants untouched -- real runtime proof recorded separately in the audit doc)');
