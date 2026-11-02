// Regroupe les traitements de Surefire aggregation.
import * as fs from 'fs';
import * as path from 'path';

export interface SurefireAggregate {
  total: number;
  failures: number;
  errors: number;
  skipped: number;
  matchCount: number;
}

const TESTS_RUN_PATTERN = /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/g;

/** Agrège les compteurs des rapports Maven Surefire. */
export function aggregateSurefireText(combinedText: string): SurefireAggregate {
  let total = 0, failures = 0, errors = 0, skipped = 0, matchCount = 0;
  for (const match of combinedText.matchAll(TESTS_RUN_PATTERN)) {
    matchCount++;
    total += Number(match[1]);
    failures += Number(match[2]);
    errors += Number(match[3]);
    skipped += Number(match[4]);
  }
  return { total, failures, errors, skipped, matchCount };
}

/** Prépare le résultat lié à aggregate Surefire rapports. */
export function aggregateSurefireReports(workspacePath: string): SurefireAggregate {
  const reportsDir = path.join(workspacePath, 'target', 'surefire-reports');
  if (!fs.existsSync(reportsDir)) return { total: 0, failures: 0, errors: 0, skipped: 0, matchCount: 0 };
  const files = fs.readdirSync(reportsDir).filter(name => name.endsWith('.txt'));
  const combined = files.map(name => {
    try { return fs.readFileSync(path.join(reportsDir, name), 'utf8'); } catch { return ''; }
  }).join('\n');
  return aggregateSurefireText(combined);
}
