// Regroupe les traitements de JUnit aggregation.
import * as fs from 'fs';
import * as path from 'path';
import { SurefireAggregate } from './surefire-aggregation';

// Opening tag of a JUnit <testsuite>. `\b` after "testsuite" means the plural
// wrapper `<testsuites ...>` (which Gradle does not emit per-class, but
// aggregate reporters do) is NOT matched here and therefore never double-
// counts the suites nested inside it.
const TESTSUITE_TAG = /<testsuite\b[^>]*>/g;

/** Lit un attribut XML comme un entier. */
function intAttr(tag: string, name: string): number {
  const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*["\\\']([0-9]+)["\\\']'));
  return m ? Number(m[1]) : 0;
}

/** Agrège les cas de test des rapports JUnit XML. */
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

/** Prépare le résultat lié à aggregate JUnit rapports. */
export function aggregateJunitReports(workspacePath: string): SurefireAggregate {
  const reportsDir = path.join(workspacePath, 'build', 'test-results', 'test');
  if (!fs.existsSync(reportsDir)) return { total: 0, failures: 0, errors: 0, skipped: 0, matchCount: 0 };
  const files = fs.readdirSync(reportsDir).filter(name => name.endsWith('.xml'));
  const combined = files.map(name => {
    try { return fs.readFileSync(path.join(reportsDir, name), 'utf8'); } catch { return ''; }
  }).join('\n');
  return aggregateJunitXml(combined);
}
