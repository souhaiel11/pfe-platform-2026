/** Contrat étroit requête/candidat pour le patch writer Maven déterministe : chaque champ vient d'une preuve déjà établie en amont, jamais d'une IA. */
import { CandidateFile } from '../candidate-verification/candidate-verification.types';
import { DependencyProvenanceKind } from './dependency-provenance.types';

import { MavenRemediationScope, MavenScopeEvidence } from './maven-remediation-scope';

export interface SecurityPatchRequest {
  remediationScope?: MavenRemediationScope;
  scopeEvidence?: MavenScopeEvidence;
  findingIdentity: string;
  evaluatedSha: string;
  ecosystem: 'MAVEN';
  /** Seules 'DIRECT_EXPLICIT' | 'PROPERTY_MANAGED' peuvent produire un patch. */
  provenanceKind: DependencyProvenanceKind;
  /** groupId:artifactId */
  package: string;
  installedVersion: string;
  targetVersion: string;
  controllingFile: string;
  controllingElement: string | null;
  controllingProperty: string | null;
  /** Texte réel et exact du pom.xml à `evaluatedSha`. Jamais généré par une IA. */
  sourceContent: string;
}

export interface SecurityPatchCandidate {
  file: CandidateFile;
  findingIdentity: string;
  evaluatedSha: string;
  provenanceKind: DependencyProvenanceKind;
  oldVersion: string;
  targetVersion: string;
}
