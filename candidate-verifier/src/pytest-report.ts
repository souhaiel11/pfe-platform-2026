import * as fs from 'fs';
import { aggregateJunitXml } from './junit-aggregation';
import type { SurefireAggregate } from './surefire-aggregation';

/** Read the exact pytest --junitxml artifact, independent of Gradle paths. */
export function aggregatePytestReport(reportFilePath: string): SurefireAggregate {
  try {
    return aggregateJunitXml(fs.readFileSync(reportFilePath, 'utf8'));
  } catch {
    return { total: 0, failures: 0, errors: 0, skipped: 0, matchCount: 0 };
  }
}
