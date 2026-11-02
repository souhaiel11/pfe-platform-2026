// Teste le composant « podman-storage-runtime » et ses cas d’erreur.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

/** Prépare les données nécessaires à ce scénario. */
function hasPodman(): boolean {
  try {
    execFileSync('podman', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Simule l’échec attendu par ce scénario. */
function extractPackagedGraphRoot(): string {
  const dockerfile = fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8');
  const userConfigStepStart = dockerfile.indexOf('RUN mkdir -p /home/node/.config/containers');
  const userConfigStep = dockerfile.slice(userConfigStepStart, dockerfile.indexOf('USER node', userConfigStepStart));
  const match = /graphroot\s*=\s*"([^"]+)"/.exec(userConfigStep);
  if (!match) throw new Error('Could not find the per-user graphroot value in builder-scanner/Dockerfile -- podman-storage-config.spec.ts should already have failed first if this changed.');
  return match[1];
}

if (!hasPodman()) {
  console.log('Podman rootless storage runtime proof: SKIPPED (no local `podman` binary on this host — expected outside the builder-scanner image itself)');
} else {
  const packagedGraphRoot = extractPackagedGraphRoot();
  const scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'podman-storage-runtime-'));
  const configDir = path.join(scratchHome, '.config', 'containers');
  fs.mkdirSync(configDir, { recursive: true });
  // Same [storage] shape as the Dockerfile's own per-user override (driver
  // + graphroot), now carrying the REAL packaged graphroot VALUE -- this
  // host never needs write access to that real path itself; only podman's
  // config-parsing/reporting is exercised, not an actual storage init at it.
  fs.writeFileSync(path.join(configDir, 'storage.conf'), ['[storage]', 'driver = "vfs"', `graphroot = "${packagedGraphRoot}"`].join('\n') + '\n');

  try {
    const reportedGraphRoot = execFileSync('podman', ['info', '--format', '{{.Store.GraphRoot}}'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: scratchHome, XDG_CONFIG_HOME: path.join(scratchHome, '.config') },
      timeout: 15_000,
    }).trim();
    assert.equal(
      reportedGraphRoot,
      packagedGraphRoot,
      `a per-user $HOME/.config/containers/storage.conf carrying the REAL packaged graphroot must control podman info's reported GraphRoot (got "${reportedGraphRoot}", expected "${packagedGraphRoot}")`,
    );
    console.log(`Podman rootless storage runtime proof: PASS (per-user storage.conf carrying the real packaged graphroot "${packagedGraphRoot}" is honored by this podman binary -- mechanism proof only, NOT proof of the built image's own effective GraphRoot at real startup)`);
  } finally {
    fs.rmSync(scratchHome, { recursive: true, force: true });
  }
}
