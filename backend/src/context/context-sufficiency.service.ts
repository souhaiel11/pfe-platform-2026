// R22-A Phase 4 — Context Sufficiency Gate.
//
// The only decision layer allowed to say "the planner may proceed to
// generation." Deliberately has no knowledge of how to fix anything -- it
// only asks whether the RemediationContext has what it needs, and whether
// the shape of the proposed solution requires a human. No uncontrolled
// agent-to-agent conversation happens here or anywhere else in this phase:
// every input is a structured RemediationContext/ProposedSolutionShape, not
// free text.
import { Injectable } from '@nestjs/common';
import { ContextSufficiencyResult, ProposedSolutionShape, RemediationContext } from './context.types';

@Injectable()
export class ContextSufficiencyService {
  evaluate(context: RemediationContext, proposedSolution?: ProposedSolutionShape): ContextSufficiencyResult {
    // A HUMAN_DECISION_REQUIRED-worthy shape overrides everything else: even
    // a fully-resolved context must not silently generate a schema/API/
    // behavior change. This mirrors the CRITICAL RESEARCH RULE: NOT_FOUND
    // does not mean create, and a solution that would require creating
    // something structural is a human decision, not a planning detail.
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
        // A missing fact the planner declared it needs is not automatically
        // a human decision -- it only becomes one once a proposed solution
        // shape says satisfying it requires something structural (checked
        // above). Absent that, it is simply still-missing context.
        return 'CONTEXT_REQUIRED';
      }
    }

    return 'SUFFICIENT';
  }
}
