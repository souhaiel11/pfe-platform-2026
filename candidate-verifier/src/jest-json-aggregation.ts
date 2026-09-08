import * as fs from 'fs';
import type { SurefireAggregate } from './surefire-aggregation';

function empty(): SurefireAggregate {
  return { total: 0, failures: 0, errors: 0, skipped: 0, matchCount: 0 };
}

/** Parse Jest's aggregate counters; matchCount, not total, signals usable data. */
export function aggregateJestJson(jsonText: string): SurefireAggregate {
  try {
    const report = JSON.parse(jsonText);
    if (!report || typeof report !== 'object' || Array.isArray(report)) return empty();
    const keys = ['numTotalTests', 'numFailedTests', 'numPassedTests',
      'numPendingTests', 'numFailedTestSuites'];
    if (!keys.every(key => Number.isSafeInteger(report[key]) && report[key] >= 0)) return empty();
    const { numTotalTests: total, numFailedTests: failures, numPassedTests: passed,
      numPendingTests: skipped, numFailedTestSuites: failedSuites } = report;
    // A larger total can include todo tests; never invent their classification.
    if (failures + passed + skipped > total) return empty();
    // Each failed test can explain at most one failed suite. Remaining suites
    // are an error signal even when no assertion ran (e.g. a loading failure).
    // This is a lower bound, not an exact count of runtime errors: these
    // aggregate counters cannot distinguish every mixed suite failure.
    const errors = Math.max(0, failedSuites - failures);
    return { total, failures, errors, skipped, matchCount: 1 };
  } catch {
    return empty();
  }
}

/** Read the exact --outputFile artifact; missing/unreadable files are unknown. */
export function aggregateJestReport(outputFilePath: string): SurefireAggregate {
  try {
    return aggregateJestJson(fs.readFileSync(outputFilePath, 'utf8'));
  } catch {
    return empty();
  }
}
