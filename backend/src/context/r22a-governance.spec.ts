// Teste le composant « r22a-governance » et ses cas d’erreur.
import * as assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

const contextDir = path.join(__dirname);
const validationDir = path.join(__dirname, '..', 'validation');
// R22-C reuses this same scan (same governance concern: no n8n DB access,
// no secret extraction) rather than duplicating a second copy of it.
const candidateVerificationDir = path.join(__dirname, '..', 'candidate-verification');

/** Prépare les données nécessaires à ce scénario. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map(f => path.join(dir, f));
}

const files = [...sourceFiles(contextDir), ...sourceFiles(validationDir), ...sourceFiles(candidateVerificationDir)];
assert.ok(files.length > 0, 'sanity: found R22-A/R22-C source files to scan');

const forbiddenPatterns: Array<[RegExp, string]> = [
  [/execution_entity|execution_data/i, 'n8n execution table name'],
  [/\.n8n\/database\.sqlite/i, 'n8n SQLite database path'],
  [/require\(['"]sqlite3?['"]\)/i, 'sqlite driver import'],
  [/SONAR_TOKEN|jenkinsToken|sonarqubeToken/, 'credential field name (extraction risk)'],
  [/Authorization.*Basic.*Buffer\.from/i, 'ad hoc Basic-auth header construction'],
];

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  for (const [pattern, label] of forbiddenPatterns) {
    assert.equal(pattern.test(content), false, `Test 11/12 - ${path.basename(file)} must not contain a ${label} (found pattern ${pattern})`);
  }
}

console.log('R22-A governance scan (no DB access, no secret extraction): PASS');
