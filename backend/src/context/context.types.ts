// R22-A Phase 2 — remediation context data model.
//
// These types exist to make two architecture principles mechanically
// enforceable rather than just documented: "context before generation"
// (a remediation candidate is not proposed until required facts are
// resolved) and "AI proposes, deterministic tools prove" (facts here come
// from RepositoryResearchService reading real files at an exact SHA, never
// from an LLM's belief about what a class "probably" contains).

export type QuestionClass =
  | 'SYMBOL_TYPE'
  | 'FIELD_EXISTS'
  | 'METHOD_SIGNATURE'
  | 'CONSTRUCTOR_SIGNATURE'
  | 'USAGES'
  | 'CALLERS'
  | 'CALLEES'
  | 'API_CONTRACT'
  | 'DTO_CONTRACT'
  | 'ENTITY_CONTRACT'
  | 'TEST_EXPECTATION'
  | 'CONFIG_VALUE'
  | 'RELATED_FILES';

export type ResearchState = 'RESOLVED' | 'NOT_FOUND' | 'CONTRADICTORY';

/** Identifies exactly where a fact came from, sufficient to re-verify it independently. */
export interface EvidenceEntry {
  file: string;
  revisionSha: string;
  subject: string;
  detail?: string;
}

export interface ContextRequest {
  requestId: string;
  revisionSha: string;
  requestType: QuestionClass;
  /** e.g. "Task.dueDate" (FIELD_EXISTS) or "com/pfe/devsecops/model/Task.java" (RELATED_FILES) */
  symbolOrFile: string;
  reason: string;
}

export interface ResearchResponse {
  requestId: string;
  revisionSha: string;
  state: ResearchState;
  /** Structured facts, e.g. [{ exists: false }] or [{ type: 'Task.TaskStatus' }]. Empty when NOT_FOUND. */
  facts: Record<string, unknown>[];
  evidence: EvidenceEntry[];
}

export interface RemediationContext {
  repository: string;
  revisionSha: string;
  finding: { findingId: string; rule: string; file: string; line?: number };
  targetSource?: string;
  relatedFiles: string[];
  typeContracts: Record<string, unknown>[];
  callContracts: Record<string, unknown>[];
  usageGraph: Record<string, unknown>[];
  tests: Record<string, unknown>[];
  buildContext: Record<string, unknown>;
  constraints: string[];
  provenance: EvidenceEntry[];
  /** Facts the planner has decided it needs before it may generate. */
  requiredFacts: string[];
  /** requiredFacts entries already answered, keyed by the same fact name. */
  resolvedFacts: Record<string, ResearchResponse>;
}

export type ContextSufficiencyResult =
  | 'SUFFICIENT'
  | 'CONTEXT_REQUIRED'
  | 'HUMAN_DECISION_REQUIRED'
  | 'CONTRADICTORY';

/** A candidate change's shape, as far as the sufficiency gate needs to know it. */
export interface ProposedSolutionShape {
  requiresSchemaChange: boolean;
  requiresPublicApiChange: boolean;
  requiresBusinessBehaviorChange: boolean;
}
