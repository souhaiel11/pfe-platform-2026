// Teste le composant « podman-storage-config » et ses cas d’erreur.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const dockerfilePath = path.join(__dirname, '../Dockerfile');
const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

// The two RUN steps under test, isolated by anchor strings so a change
// elsewhere in the Dockerfile can't accidentally satisfy these assertions.
const systemStorageStep = dockerfile.slice(
  dockerfile.indexOf('> /etc/containers/storage.conf') - 400,
  dockerfile.indexOf('> /etc/containers/storage.conf') + 40,
);
const userConfigStepStart = dockerfile.indexOf('RUN mkdir -p /home/node/.config/containers');
assert.ok(userConfigStepStart !== -1, 'the per-user containers config RUN step must exist');
const userConfigStep = dockerfile.slice(userConfigStepStart, dockerfile.indexOf('USER node', userConfigStepStart));

// --- the per-user storage.conf is actually written, to the exact path Podman's rootless engine reads ---
assert.ok(
  userConfigStep.includes('/home/node/.config/containers/storage.conf'),
  'the per-user RUN step must write a storage.conf at the rootless per-user config path',
);

// --- its content matches the proven-required graphroot, not a placeholder or a different path ---
assert.ok(
  /graphroot\s*=\s*"\/var\/pfe-podman-storage"/.test(userConfigStep),
  'the per-user storage.conf content must pin graphroot to the dedicated persistent volume path',
);
assert.ok(
  /\[storage\]/.test(userConfigStep) && /driver\s*=\s*"vfs"/.test(userConfigStep),
  'the per-user storage.conf must keep the same [storage] section shape and vfs driver as the system-level one',
);

// --- the pre-existing, already-proven-effective per-user override is untouched by this change ---
assert.ok(
  /image_parallel_copies\s*=\s*1/.test(userConfigStep),
  'the pre-existing image_parallel_copies=1 network-resilience setting must survive this change untouched',
);

// --- ownership: the whole per-user config directory (both files) is still chowned to node ---
assert.ok(
  /chown\s+-R\s+node:node\s+\/home\/node\/\.config/.test(userConfigStep),
  'the per-user config directory (containers.conf AND the new storage.conf) must still be chowned to node',
);

// --- the system-level file is left in place (documentation of intent / rootful fallback), not removed ---
assert.ok(
  /graphroot\s*=\s*"\/var\/pfe-podman-storage"/.test(systemStorageStep),
  'the system-level /etc/containers/storage.conf must remain present and unchanged in content',
);

// --- no rootless->rootful regression: USER node is still the final USER directive, no root re-escalation after it ---
const userDirectives = [...dockerfile.matchAll(/^USER\s+(\S+)/gm)].map(m => m[1]);
assert.deepEqual(userDirectives, ['node'], 'exactly one USER directive, still `node` -- no rootful regression introduced by this change');
assert.ok(!dockerfile.includes('--privileged'), 'no --privileged flag introduced anywhere in the image');
assert.ok(!/-v\s+\S*docker\.sock|--volume[= ]\S*docker\.sock|VOLUME\s+\S*docker\.sock/.test(dockerfile), 'no docker.sock mount introduced anywhere in the image (comments merely documenting its absence do not count)');

// --- the new RUN step runs strictly before USER node switches away from root (root privileges are needed to chown) ---
const userDirectiveMatch = /^USER\s+node\s*$/m.exec(dockerfile);
assert.ok(userDirectiveMatch, 'the real USER node directive line must exist');
assert.ok(userConfigStepStart < userDirectiveMatch!.index, 'the per-user config RUN step must execute while still root, before the USER node directive');

console.log('Podman rootless storage config packaging: PASS (per-user storage.conf present, correct graphroot/driver, pre-existing settings and USER/privilege boundary unchanged)');
