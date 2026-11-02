// Porte de décision qui dit si le planificateur de remédiation a assez de
// contexte pour passer à la génération d'un correctif, ou s'il faut encore
// des faits, ou une décision humaine.
import { Injectable } from '@nestjs/common';
import { ContextSufficiencyResult, ProposedSolutionShape, RemediationContext } from './context.types';

@Injectable()
export class ContextSufficiencyService {
  /** Décide si le planificateur peut passer à la génération. */
  evaluate(context: RemediationContext, proposedSolution?: ProposedSolutionShape): ContextSufficiencyResult {
    if (proposedSolution && (
      proposedSolution.requiresSchemaChange
      || proposedSolution.requiresPublicApiChange
      || proposedSolution.requiresBusinessBehaviorChange
    )) {
      return 'HUMAN_DECISION_REQUIRED';
    }

    for (const factName of context.requiredFacts) {
      const resolved = context.resolvedFacts[factName];
      if (!resolved) return 'CONTEXT_REQUIRED';
      if (resolved.state === 'CONTRADICTORY') return 'CONTRADICTORY';
      if (resolved.state === 'NOT_FOUND') {
        return 'CONTEXT_REQUIRED';
      }
    }

    return 'SUFFICIENT';
  }
}
