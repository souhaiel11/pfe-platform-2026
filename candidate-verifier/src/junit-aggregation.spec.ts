import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { aggregateJunitXml, aggregateJunitReports } from './junit-aggregation';

// Gradle writes one <testsuite> per test class into
// build/test-results/test/TEST-<fqcn>.xml. Same aggregation rule as Surefire.

// --- normal case: one suite, all attributes present ---
{
  const xml = '<testsuite name="com.ex.TaskServiceTest" tests="10" skipped="2" failures="1" errors="0" time="0.4">' +
    '<testcase name="a"/></testsuite>';
  const agg = aggregateJunitXml(xml);
  assert.equal(agg.total, 10);
  assert.equal(agg.failures, 1);
  assert.equal(agg.errors, 0);
  assert.equal(agg.skipped, 2);
  assert.equal(agg.matchCount, 1);
}

// --- multi-file: two separate report files concatenated ---
{
  const fileA = '<testsuite name="A" tests="10" skipped="0" failures="0" errors="0"></testsuite>';
  const fileB = '<testsuite name="B" tests="12" skipped="1" failures="2" errors="3"></testsuite>';
  const agg = aggregateJunitXml(fileA + '\n' + fileB);
  assert.equal(agg.total, 22, 'sums both files, never last-file-only');
  assert.equal(agg.failures, 2);
  assert.equal(agg.errors, 3);
  assert.equal(agg.skipped, 1);
  assert.equal(agg.matchCount, 2);
}

// --- multiple <testsuite> inside a single file ---
{
  const xml = '<testsuites>' +
    '<testsuite name="A" tests="4" failures="0" errors="0" skipped="0"></testsuite>' +
    '<testsuite name="B" tests="5" failures="1" errors="0" skipped="0"></testsuite>' +
    '</testsuites>';
  const agg = aggregateJunitXml(xml);
  assert.equal(agg.matchCount, 2, 'inner <testsuite> tags counted, the <testsuites> wrapper is not');
  assert.equal(agg.total, 9);
  assert.equal(agg.failures, 1);
}

// --- attribute order independence + missing optional attrs default to 0 ---
{
  const xml = '<testsuite errors="0" tests="3" name="C"></testsuite>';
  const agg = aggregateJunitXml(xml);
  assert.equal(agg.total, 3);
  assert.equal(agg.failures, 0);
  assert.equal(agg.skipped, 0);
  assert.equal(agg.matchCount, 1);
}

// --- <testsuites> plural wrapper alone must NOT be counted ---
{
  const agg = aggregateJunitXml('<testsuites tests="100" failures="9"></testsuites>');
  assert.equal(agg.matchCount, 0, 'the plural wrapper is never a data source');
  assert.equal(agg.total, 0);
}

// --- a <testsuite> with no tests= attribute is not usable data ---
{
  const agg = aggregateJunitXml('<testsuite name="broken" time="0.1"></testsuite>');
  assert.equal(agg.matchCount, 0);
}

// --- malformed / non-XML input never throws ---
{
  assert.doesNotThrow(() => aggregateJunitXml('not xml at all {{{ <<<'));
  assert.doesNotThrow(() => aggregateJunitXml('<testsuite tests="5" <<< truncated'));
  const partial = aggregateJunitXml('<testsuite name="ok" tests="7" failures="0" errors="0" skipped="0"></testsuite> GARBAGE ]]> <testsuite tests=');
  assert.equal(partial.matchCount, 1, 'the one well-formed suite still parses; the truncated tail is ignored');
  assert.equal(partial.total, 7);
}

// --- empty input yields matchCount 0, never a fabricated total ---
{
  const agg = aggregateJunitXml('');
  assert.equal(agg.matchCount, 0);
}

// --- FS wrapper: absent directory yields matchCount 0 without throwing ---
{
  const agg = aggregateJunitReports(path.join(os.tmpdir(), 'pfe-junit-does-not-exist-' + Date.now()));
  assert.deepEqual(agg, { total: 0, failures: 0, errors: 0, skipped: 0, matchCount: 0 });
}

// --- FS wrapper: reads every *.xml under build/test-results/test/ ---
{
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe-junit-fs-spec-'));
  const dir = path.join(scratch, 'build', 'test-results', 'test');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'TEST-com.ex.ATest.xml'), '<testsuite name="A" tests="10" failures="0" errors="0" skipped="0"></testsuite>');
  fs.writeFileSync(path.join(dir, 'TEST-com.ex.BTest.xml'), '<testsuite name="B" tests="12" failures="1" errors="0" skipped="0"></testsuite>');
  fs.writeFileSync(path.join(dir, 'not-a-report.txt'), 'ignored');
  const agg = aggregateJunitReports(scratch);
  assert.equal(agg.total, 22);
  assert.equal(agg.failures, 1);
  assert.equal(agg.matchCount, 2);
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log('junit-aggregation: PASS');
