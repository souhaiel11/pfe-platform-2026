// Vérifie que chaque fichier proposé correspond à un finding approuvé ou à une régression prouvée.
import { Injectable } from '@nestjs/common';

export type ScopeClassification = 'IN_SCOPE_APPROVED_FINDING' | 'IN_SCOPE_REGRESSION' | 'OUT_OF_SCOPE';

export interface ScopeLockInput {
  approvedFindingFiles: string[];
  provenRegressionFiles: string[];
  proposedFiles: string[];
  schemaFiles?: string[];
}

export interface ScopeLockResult {
  classification: Record<string, ScopeClassification | 'OUT_OF_SCOPE'>;
  allInScope: boolean;
  outOfScopeFiles: string[];
}

@Injectable()
export class ScopeLockService {
  /** Classe chaque fichier proposé par le candidat. */
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
