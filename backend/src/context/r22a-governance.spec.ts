// R22-A Phase 9 tests #11/#12: prove the R22-A source itself never
// introduces direct n8n DB access or any credential-extraction mechanism --
// this whole migration phase exists partly BECAUSE those were the exact
// workarounds used in R21-AZ (direct SQLite read) that this session was
// explicitly told not to repeat again in R21-BA. Static source scan, same
// technique already used in the Shared Library's offline test suite
// (R2-TEST K: "no governance-classification field emitted anywhere in the
// Shared Library source").
import * as assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

const contextDir = path.join(__dirname);
const validationDir = path.join(__dirname, '..', 'validation');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map(f => path.join(dir, f));
}

const files = [...sourceFiles(contextDir), ...sourceFiles(validationDir)];
assert.ok(files.length > 0, 'sanity: found R22-A source files to scan');

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
