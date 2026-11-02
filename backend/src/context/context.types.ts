// Modèle de données du contexte de remédiation.

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
  symbolOrFile: string;
  reason: string;
}

export interface ResearchResponse {
  requestId: string;
  revisionSha: string;
  state: ResearchState;
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
  requiredFacts: string[];
  resolvedFacts: Record<string, ResearchResponse>;
}

export type ContextSufficiencyResult =
  | 'SUFFICIENT'
  | 'CONTEXT_REQUIRED'
  | 'HUMAN_DECISION_REQUIRED'
  | 'CONTRADICTORY';

export interface ProposedSolutionShape {
  requiresSchemaChange: boolean;
  requiresPublicApiChange: boolean;
  requiresBusinessBehaviorChange: boolean;
}
