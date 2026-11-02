// R22-E2C2 Phase 8/14 (#5,#6,#7,#8,#21) — structural proof that the worker
// source itself never references a secret env var and never performs a
// GitHub write. Same static-source-scan technique already used in R22-A's
// r22a-governance.spec.ts.
import * as assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

const srcDir = path.join(__dirname, 'src');
const sourceFiles = readdirSync(srcDir)
  .filter(f => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
  .map(f => path.join(srcDir, f));
assert.ok(sourceFiles.length > 0, 'sanity: found worker source files to scan');

// --- Tests 5/6/7 (spec): worker source never references backend secrets ---
const forbiddenEnvPatterns: Array<[RegExp, string]> = [
  [/process\.env\.DB_PASS\b/, 'DB_PASS'],
  [/process\.env\.DB_HOST\b/, 'DB_HOST (no DB configuration of any kind)'],
  [/process\.env\.JWT_SECRET\b/, 'JWT_SECRET'],
  [/process\.env\.N8N_INTERNAL_SECRET\b/, 'N8N_INTERNAL_SECRET'],
  [/process\.env\.POSTGRES_PASSWORD\b/, 'POSTGRES_PASSWORD'],
];
for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf8');
  for (const [pattern, label] of forbiddenEnvPatterns) {
    assert.equal(pattern.test(content), false, `Test 5/6/7 - ${path.basename(file)} must not reference ${label}`);
  }
}
console.log('Test 5/6/7 PASS - no worker source file references DB/JWT/N8N-internal secrets');

// --- Test 8 (spec): worker source has no GitHub write operation ---
const githubWritePatterns: Array<[RegExp, string]> = [
  [/method:\s*['"]PUT['"]/, "an HTTP PUT (GitHub Contents API write)"],
  [/git\/refs['"`]?\s*,?\s*{\s*method:\s*['"]POST['"]/, 'a POST to git/refs (branch creation)'],
  [/octokit|@octokit/i, 'a GitHub write SDK'],
  [/pulls\/\d|\/pulls['"`]/, 'a pull-request endpoint reference'],
];
// Deliberately excludes the read-only 'GET /repos/.../contents' pattern
// already used by RepoCacheService (clone via `git clone https://github.com/...`,
// never the Contents API at all).
for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf8');
  for (const [pattern, label] of githubWritePatterns) {
    assert.equal(pattern.test(content), false, `Test 8 - ${path.basename(file)} must not contain ${label}`);
  }
}
console.log('Test 8 PASS - no worker source file contains a GitHub write operation');

// --- server.ts: only reads PORT/WORKSPACE_ROOT/REPO_CACHE_ROOT from env, nothing else ---
{
  const serverSrc = readFileSync(path.join(srcDir, 'server.ts'), 'utf8');
  const envReads = [...serverSrc.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map(m => m[1]);
  const allowed = new Set(['PORT', 'WORKSPACE_ROOT', 'REPO_CACHE_ROOT']);
  const unexpected = envReads.filter(key => !allowed.has(key));
  assert.deepEqual(unexpected, [], 'server.ts reads only PORT/WORKSPACE_ROOT/REPO_CACHE_ROOT from the environment, nothing else');
  console.log('Test PASS - server.ts env surface is exactly {PORT, WORKSPACE_ROOT, REPO_CACHE_ROOT}');
}

console.log('candidate-verifier isolation: PASS');
