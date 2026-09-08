// R22 (Gradle adapter) — JUnit XML aggregation, the Gradle counterpart of
// surefire-aggregation.ts. Same rule as Surefire/BuildRunner.groovy: sum
// EVERY <testsuite> across EVERY report file, never last-file-only. Kept as a
// pure function (no subprocess dependency) so it is independently unit-
// testable against synthetic fixtures and against real
// `build/test-results/test/*.xml` output.
import * as fs from 'fs';
import * as path from 'path';
import { SurefireAggregate } from './surefire-aggregation';

// Opening tag of a JUnit <testsuite>. `\b` after "testsuite" means the plural
// wrapper `<testsuites ...>` (which Gradle does not emit per-class, but
// aggregate reporters do) is NOT matched here and therefore never double-
// counts the suites nested inside it.
const TESTSUITE_TAG = /<testsuite\b[^>]*>/g;

function intAttr(tag: string, name: string): number {
  const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*["\\\']([0-9]+)["\\\']'));
  return m ? Number(m[1]) : 0;
}

export function aggregateJunitXml(combinedXml: string): SurefireAggregate {
  let total = 0, failures = 0, errors = 0, skipped = 0, matchCount = 0;
  for (const match of combinedXml.matchAll(TESTSUITE_TAG)) {
    const tag = match[0];
    const testsMatch = tag.match(/\btests\s*=\s*["\']([0-9]+)["\']/);
    // A <testsuite> with no parseable tests="N" attribute is not usable
    // data -- skip it so it never inflates matchCount into a fake PASS.
    if (!testsMatch) continue;
    matchCount++;
    total += Number(testsMatch[1]);
    failures += intAttr(tag, 'failures');
    errors += intAttr(tag, 'errors');
    skipped += intAttr(tag, 'skipped');
  }
  return { total, failures, errors, skipped, matchCount };
}

/** Reads every *.xml report under `<workspacePath>/build/test-results/test/` and aggregates them. */
export function aggregateJunitReports(workspacePath: string): SurefireAggregate {
  const reportsDir = path.join(workspacePath, 'build', 'test-results', 'test');
  if (!fs.existsSync(reportsDir)) return { total: 0, failures: 0, errors: 0, skipped: 0, matchCount: 0 };
  const files = fs.readdirSync(reportsDir).filter(name => name.endsWith('.xml'));
  const combined = files.map(name => {
    try { return fs.readFileSync(path.join(reportsDir, name), 'utf8'); } catch { return ''; }
  }).join('\n');
  return aggregateJunitXml(combined);
}
