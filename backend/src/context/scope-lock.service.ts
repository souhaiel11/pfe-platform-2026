// R22-A Phase 5 — Scope Lock.
//
// Every file a remediation candidate touches must be attributable to either
// an approved finding's own location, or a proven regression the candidate
// itself introduced. Anything else is OUT_OF_SCOPE: no silent refactoring,
// no unrelated cleanup, no new feature, no schema change without explicit
// human authorization (schema changes are never in-scope here regardless of
// attribution -- they require the separate HUMAN_DECISION_REQUIRED path in
// ContextSufficiencyService).
import { Injectable } from '@nestjs/common';

export type ScopeClassification = 'IN_SCOPE_APPROVED_FINDING' | 'IN_SCOPE_REGRESSION' | 'OUT_OF_SCOPE';

export interface ScopeLockInput {
  approvedFindingFiles: string[];
  /** Files proven (by a failing build/test attributable to the candidate) to need a regression fix. */
  provenRegressionFiles: string[];
  proposedFiles: string[];
  /** Schema changes are never in-scope, even if the file also appears in the other two lists. */
  schemaFiles?: string[];
}

export interface ScopeLockResult {
  classification: Record<string, ScopeClassification | 'OUT_OF_SCOPE'>;
  allInScope: boolean;
  outOfScopeFiles: string[];
}

@Injectable()
export class ScopeLockService {
  evaluate(input: ScopeLockInput): ScopeLockResult {
    const approved = new Set(input.approvedFindingFiles);
    const regression = new Set(input.provenRegressionFiles);
    const schema = new Set(input.schemaFiles ?? []);
    const classification: Record<string, ScopeClassification | 'OUT_OF_SCOPE'> = {};
    const outOfScopeFiles: string[] = [];

    for (const file of input.proposedFiles) {
      if (schema.has(file)) {
        classification[file] = 'OUT_OF_SCOPE';
        outOfScopeFiles.push(file);
        continue;
      }
      if (approved.has(file)) {
        classification[file] = 'IN_SCOPE_APPROVED_FINDING';
      } else if (regression.has(file)) {
        classification[file] = 'IN_SCOPE_REGRESSION';
      } else {
        classification[file] = 'OUT_OF_SCOPE';
        outOfScopeFiles.push(file);
      }
    }

    return { classification, allInScope: outOfScopeFiles.length === 0, outOfScopeFiles };
  }
}
