import * as assert from 'node:assert/strict';
import { ContextSufficiencyService } from './context-sufficiency.service';
import { RemediationContext, ResearchResponse } from './context.types';

const service = new ContextSufficiencyService();

function baseContext(overrides: Partial<RemediationContext> = {}): RemediationContext {
  return {
    repository: 'souhaiel11/pfe-app-test', revisionSha: 'sha1',
    finding: { findingId: 'f1', rule: 'java:S4684', file: 'TaskDTO.java' },
    relatedFiles: [], typeContracts: [], callContracts: [], usageGraph: [], tests: [],
    buildContext: {}, constraints: [], provenance: [],
    requiredFacts: [], resolvedFacts: {},
    ...overrides,
  };
}

function resolved(state: ResearchResponse['state']): ResearchResponse {
  return { requestId: 'r1', revisionSha: 'sha1', state, facts: [], evidence: [] };
}

// --- Test: no required facts declared -> SUFFICIENT ---
assert.equal(service.evaluate(baseContext()), 'SUFFICIENT', 'no required facts declared is trivially SUFFICIENT');

// --- Test 5 (Phase 9): missing required fact -> CONTEXT_REQUIRED ---
{
  const ctx = baseContext({ requiredFacts: ['Task.status.type'], resolvedFacts: {} });
  assert.equal(service.evaluate(ctx), 'CONTEXT_REQUIRED', 'Test 5 - a declared-but-unresolved required fact produces CONTEXT_REQUIRED');
}

// --- Test: all required facts resolved -> SUFFICIENT ---
{
  const ctx = baseContext({
    requiredFacts: ['Task.status.type'],
    resolvedFacts: { 'Task.status.type': resolved('RESOLVED') },
  });
  assert.equal(service.evaluate(ctx), 'SUFFICIENT', 'all required facts RESOLVED is SUFFICIENT');
}

// --- Test 4 (Phase 9): conflicting evidence -> CONTRADICTORY ---
{
  const ctx = baseContext({
    requiredFacts: ['Task.status.type'],
    resolvedFacts: { 'Task.status.type': resolved('CONTRADICTORY') },
  });
  assert.equal(service.evaluate(ctx), 'CONTRADICTORY', 'Test 4 - a CONTRADICTORY resolved fact propagates as CONTRADICTORY');
}

// --- Test 2/3 companion: a NOT_FOUND fact alone (no structural solution flagged) stays CONTEXT_REQUIRED, never silently proceeds ---
{
  const ctx = baseContext({
    requiredFacts: ['Task.dueDate.exists'],
    resolvedFacts: { 'Task.dueDate.exists': resolved('NOT_FOUND') },
  });
  assert.equal(service.evaluate(ctx), 'CONTEXT_REQUIRED', 'a NOT_FOUND required fact alone does not silently become SUFFICIENT');
}

// --- Test 6 (Phase 9): schema-changing solution -> HUMAN_DECISION_REQUIRED, even with fully sufficient context ---
{
  const ctx = baseContext({
    requiredFacts: ['Task.dueDate.exists'],
    resolvedFacts: { 'Task.dueDate.exists': resolved('NOT_FOUND') },
  });
  const result = service.evaluate(ctx, { requiresSchemaChange: true, requiresPublicApiChange: false, requiresBusinessBehaviorChange: false });
  assert.equal(result, 'HUMAN_DECISION_REQUIRED', 'Test 6 - a solution requiring a schema change is HUMAN_DECISION_REQUIRED, never auto-generated');
}

// --- HUMAN_DECISION_REQUIRED overrides even a SUFFICIENT context ---
{
  const ctx = baseContext({
    requiredFacts: ['Task.status.type'],
    resolvedFacts: { 'Task.status.type': resolved('RESOLVED') },
  });
  const result = service.evaluate(ctx, { requiresSchemaChange: false, requiresPublicApiChange: true, requiresBusinessBehaviorChange: false });
  assert.equal(result, 'HUMAN_DECISION_REQUIRED', 'a public API change requirement overrides an otherwise-SUFFICIENT context');
}

console.log('ContextSufficiencyService: PASS');
