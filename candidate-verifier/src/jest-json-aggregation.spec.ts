import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { aggregateJestJson, aggregateJestReport } from './jest-json-aggregation';

const green = { numTotalTests: 3, numFailedTests: 0, numPassedTests: 3,
  numPendingTests: 0, numFailedTestSuites: 0 };
const empty = { total: 0, failures: 0, errors: 0, skipped: 0, matchCount: 0 };
const parse = (overrides = {}) => aggregateJestJson(JSON.stringify({ ...green, ...overrides }));

assert.deepEqual(parse({ numFailedTests: 1, numPassedTests: 2, numFailedTestSuites: 1 }),
  { total: 3, failures: 1, errors: 0, skipped: 0, matchCount: 1 });
assert.deepEqual(parse(), { total: 3, failures: 0, errors: 0, skipped: 0, matchCount: 1 });
assert.deepEqual(parse({ numPassedTests: 2, numPendingTests: 1 }),
  { total: 3, failures: 0, errors: 0, skipped: 1, matchCount: 1 });

// A reported zero is usable data, but is not a SUCCESS verdict from this parser.
assert.deepEqual(parse({ numTotalTests: 0, numPassedTests: 0 }), { ...empty, matchCount: 1 });
assert.deepEqual(parse({ numTotalTests: 0, numPassedTests: 0, numFailedTestSuites: 1 }),
  { ...empty, errors: 1, matchCount: 1 });
assert.deepEqual(parse({ numFailedTests: 1, numPassedTests: 2, numFailedTestSuites: 2 }),
  { total: 3, failures: 1, errors: 1, skipped: 0, matchCount: 1 });

for (const input of ['', ' ', '{broken', '{"numTotalTests":3', 'null', '[]', '42', '{}']) {
  assert.doesNotThrow(() => aggregateJestJson(input));
  assert.deepEqual(aggregateJestJson(input), empty);
}
for (const key of Object.keys(green)) {
  const incomplete = { ...green };
  delete incomplete[key];
  assert.deepEqual(aggregateJestJson(JSON.stringify(incomplete)), empty, `missing ${key}`);
  for (const value of [-1, 1.5, '3', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(parse({ [key]: value }), empty, `invalid ${key}: ${value}`);
  }
}
assert.deepEqual(parse({ numTotalTests: 2 }), empty, 'inconsistent counters');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-jest-json-spec-'));
try {
  const output = path.join(scratch, 'report.json');
  assert.deepEqual(aggregateJestReport(output), empty, 'absent file');
  assert.deepEqual(aggregateJestReport(scratch), empty, 'unreadable as a file');
  fs.writeFileSync(output, JSON.stringify(green));
  assert.deepEqual(aggregateJestReport(output), parse(), 'reads --outputFile');
  fs.writeFileSync(output, '{broken');
  assert.deepEqual(aggregateJestReport(output), empty, 'malformed file');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log('jest-json-aggregation: PASS');
