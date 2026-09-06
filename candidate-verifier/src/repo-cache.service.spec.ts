import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { RepoCacheService } from './repo-cache.service';

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-repo-cache-spec-'));
const cache = new RepoCacheService(scratchRoot);

// --- clone on first use, real public repo ---
const cachedPath = cache.ensureRepo('souhaiel11/pfe-app-test');
assert.ok(fs.existsSync(path.join(cachedPath, '.git')), 'first ensureRepo() call clones the real public repo');
assert.ok(fs.existsSync(path.join(cachedPath, 'pom.xml')), 'the cloned checkout has real project files');

// --- second call fetches instead of re-cloning, same path, idempotent ---
const cachedPathAgain = cache.ensureRepo('souhaiel11/pfe-app-test');
assert.equal(cachedPathAgain, cachedPath, 'a second call for the same repository reuses the same cache path');
const knownSha = execFileSync('git', ['-C', cachedPath, 'cat-file', '-t', '8a315b0dd508eb9843bb3037fe2827f02f6faa78'], { encoding: 'utf8' }).trim();
assert.equal(knownSha, 'commit', 'a real commit from this session\'s PR #25 work is reachable from the cached clone');

// --- rejects an invalid repository identifier before touching the filesystem/network ---
assert.throws(() => cache.ensureRepo('../escape'), /Invalid repository identifier/, 'malformed repository identifier rejected');
assert.throws(() => cache.ensureRepo('not-owner-slash-name'), /Invalid repository identifier/, 'a value without owner/name shape is rejected');

fs.rmSync(scratchRoot, { recursive: true, force: true });
console.log('RepoCacheService: PASS');
