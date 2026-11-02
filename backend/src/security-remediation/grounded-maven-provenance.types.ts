/** Contrat de requête/résultat du service de résolution de provenance Maven « groundée » (exécuté côté candidate-verifier, sur un checkout réel). */
import { DependencyProvenance } from './dependency-provenance.types';

export interface GroundedMavenProvenanceRequest {
  repository: string; // "owner/name"
  candidateBaseSha: string;
  requestId: string;
  batchId: string;
  candidateAttempt: number;
  /** groupId:artifactId */
  package: string;
  expectedInstalledVersion: string;
  timeoutMs?: number;
}

export type GroundedMavenProvenanceFailureClass =
  | 'WORKSPACE_CREATION_FAILED'
  | 'WORKSPACE_SHA_MISMATCH'
  | 'WORKSPACE_INFRA_FAILURE'
  | 'POM_NOT_FOUND'
  | 'DEPENDENCY_TREE_FAILED'
  | 'DEPENDENCY_TREE_TIMEOUT'
  | 'WARMUP_TIMEOUT'
  | 'WARMUP_NETWORK_FAILURE'
  | 'WARMUP_FAILED'
  | 'DEPENDENCY_NOT_IN_CACHE';

/** Preuve bornée et expurgée de l'exécution d'une commande Maven (succès ou échec), sans jamais dupliquer le texte complet de l'arbre de dépendances. */
export interface MavenStepEvidence {
  status: 'SUCCESS' | 'FAILED';
  timedOut: boolean;
  evidenceTail: string;
  exitCode?: number | null;
  durationMs?: number;
  networkFailure?: { code: 'WARMUP_NETWORK_FAILURE'; matchedSignature: string; detail: string };
  resolutionFailure?: { code: 'ARTIFACT_NOT_FOUND'; artifact: string };
  timeoutEvidence?: { lastArtifact: string | null; retryCount: number; stdoutTail: string; stderrTail: string };
  offlineFailure?: { code: 'DEPENDENCY_NOT_IN_CACHE'; missingArtifacts: string[]; primaryMissingArtifact: string };
}

export interface GroundedMavenProvenanceEvidence {
  mavenResolution?: {
    baselineWarmup: MavenStepEvidence;
    targetWarmups: Array<{ gav: string; result: MavenStepEvidence }>;
    analysis: MavenStepEvidence;
  };
  requestedSha: string;
  checkoutSha: string | null;
  /** Renseigné uniquement une fois prouvé que checkoutSha === requestedSha. */
  evaluatedSha: string | null;
  /** Texte brut réel du pom.xml lu sur le checkout exact-SHA, avant tout patch ; null si jamais lu avec succès. */
  pomXmlText: string | null;
}

export type GroundedMavenProvenanceResult =
  | { ok: true; provenance: DependencyProvenance; evidence: GroundedMavenProvenanceEvidence }
  | { ok: false; failureClass: GroundedMavenProvenanceFailureClass; retryable?: boolean; detail: string; evidence: GroundedMavenProvenanceEvidence };
