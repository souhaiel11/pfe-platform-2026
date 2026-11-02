// Regroupe les traitements de pytest rapport.
import * as fs from 'fs';
import { aggregateJunitXml } from './junit-aggregation';
import type { SurefireAggregate } from './surefire-aggregation';

/** Prépare le résultat lié à aggregate Pytest rapport. */
export function aggregatePytestReport(reportFilePath: string): SurefireAggregate {
  try {
    return aggregateJunitXml(fs.readFileSync(reportFilePath, 'utf8'));
  } catch {
    return { total: 0, failures: 0, errors: 0, skipped: 0, matchCount: 0 };
  }
}
