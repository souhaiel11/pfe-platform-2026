import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { aggregatePytestReport } from './pytest-report';

const empty = { total: 0, failures: 0, errors: 0, skipped: 0, matchCount: 0 };
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pytest-report-spec-'));
const report = path.join(scratch, 'pytest-output.xml');
try {
  assert.deepEqual(aggregatePytestReport(report), empty, 'absent file');
  console.log('PASS: absent file -> matchCount 0');
  assert.deepEqual(aggregatePytestReport(scratch), empty, 'directory is not a readable report');
  console.log('PASS: unreadable report -> matchCount 0');

  const cases = [
    { name: 'one passing test',
      xml: '<testsuites><testsuite tests="1" failures="0" errors="0" skipped="0"><testcase name="test_sum"/></testsuite></testsuites>',
      expected: { total: 1, failures: 0, errors: 0, skipped: 0, matchCount: 1 } },
    { name: 'one failed test',
      xml: '<testsuites><testsuite tests="1" failures="1" errors="0" skipped="0"><testcase name="test_sum"><failure message="assertion failed"/></testcase></testsuite></testsuites>',
      expected: { total: 1, failures: 1, errors: 0, skipped: 0, matchCount: 1 } },
    { name: 'collection error with zero tests remains visible',
      xml: '<testsuites><testsuite tests="0" failures="0" errors="1" skipped="0"><testcase name="test_sum"><error message="collection failure"/></testcase></testsuite></testsuites>',
      expected: { total: 0, failures: 0, errors: 1, skipped: 0, matchCount: 1 } },
    { name: 'malformed XML without usable suite does not crash',
      xml: '<testsuites><testsuite tests="', expected: empty },
    { name: 'empty file', xml: '', expected: empty },
  ];
  for (const scenario of cases) {
    fs.writeFileSync(report, scenario.xml);
    assert.doesNotThrow(() => aggregatePytestReport(report), scenario.name);
    assert.deepEqual(aggregatePytestReport(report), scenario.expected, scenario.name);
    console.log(`PASS: ${scenario.name}`);
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log('pytest-report: PASS (7 synthetic cases; no Python/pytest execution)');
