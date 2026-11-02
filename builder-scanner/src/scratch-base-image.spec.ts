// Teste le composant « scratch-base-image » et ses cas d’erreur.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { baseImageKind, parseBaseImages, TrivyImageArtifactValidator } from './security-artifact-validator';

assert.equal(baseImageKind('scratch'), 'BUILTIN_EMPTY_BASE');
assert.deepEqual(parseBaseImages('FROM scratch\n'), []);
assert.deepEqual(parseBaseImages('FROM eclipse-temurin:17 AS builder\nFROM builder AS packaged\nFROM scratch\n'), ['eclipse-temurin:17']);
assert.deepEqual(parseBaseImages('FROM node:20 AS builder\nFROM alpine:3\n'), ['node:20', 'alpine:3']);
for (const ref of ['scratch/foo', 'library/scratch', 'scratch:latest', 'invalid-image', 'nonexistent/repository:tag', 'SCRATCH']) {
  assert.equal(baseImageKind(ref), 'REGISTRY_IMAGE');
  assert.deepEqual(parseBaseImages('FROM ' + ref), [ref]);
}
assert.notEqual(baseImageKind(''), 'BUILTIN_EMPTY_BASE');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-base-test-'));
/** Traite l’erreur reçue et termine le suivi de la demande. */
const error = (status: number, stderr: string) => Object.assign(new Error(stderr), {status, stderr});
try {
  execFileSync('git', ['init', '-q', workspace]);
  fs.writeFileSync(path.join(workspace, 'Dockerfile'), 'FROM scratch\n');
  execFileSync('git', ['-C', workspace, 'add', 'Dockerfile']);
  for (const spec of [
    {from: 'FROM scratch', stage: 'TRIVY_SCAN'},
    {from: 'FROM scratch/foo', stage: 'PODMAN_BASE_IMAGE_PULL'},
    {from: 'FROM library/scratch', stage: 'PODMAN_BASE_IMAGE_PULL'},
    {from: 'FROM invalid-image', stage: 'PODMAN_BASE_IMAGE_PULL'},
    {from: 'FROM nonexistent/repository:tag', stage: 'PODMAN_BASE_IMAGE_PULL'},
    {from: 'FROM private/image:tag', stage: 'PODMAN_BASE_IMAGE_PULL'},
    {from: 'FROM', stage: 'IMAGE_BUILD'},
    {from: 'FROM ', stage: 'IMAGE_BUILD'},
    {from: 'FROM scratch unexpected syntax', stage: 'IMAGE_BUILD'},
  ]) {
    fs.writeFileSync(path.join(workspace, 'Dockerfile'), spec.from + '\n');
    const calls: string[] = [];
    const validator = new TrivyImageArtifactValidator((cmd, args) => {
      calls.push(cmd + ' ' + args.slice(0, 2).join(' '));
      if (args[0] === 'info') return 'true';
      if (args[0] === '--version') return 'Version: 0.72.0';
      if (args[0] === 'pull') throw error(125, args[1].startsWith('private/') ? 'unauthorized: authentication required' : 'manifest unknown');
      if (args[0] === 'build' && spec.stage === 'IMAGE_BUILD') throw error(125, 'invalid FROM instruction');
      if (args[0] === 'build' || args[0] === 'save') return '';
      if (cmd === 'trivy' && args[0] === 'image') throw error(1, 'scanner failed');
      if (args[0] === 'image' && args[1] === 'exists') throw error(1, 'absent');
      throw new Error('Unexpected command');
    });
    assert.throws(() => validator.inspect(workspace), (e: any) => e.code === 'RUNTIME_COMMAND_FAILED' && e.stage === spec.stage);
    if (spec.from === 'FROM scratch') {
      assert.ok(!calls.some(c => c.startsWith('podman pull')));
      assert.ok(calls.some(c => c.startsWith('podman build')));
      assert.ok(calls.includes('trivy image --input'), 'scratch still requires the real scanner command; scan failure rejects artifact');
    }
  }
} finally { fs.rmSync(workspace, {recursive: true, force: true}); }
console.log('scratch semantics and fail-closed artifact/scan wiring: PASS');
