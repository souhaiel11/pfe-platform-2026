// R-SEC-V1.2 §2/§4 — narrow request/candidate contract for the deterministic
// Maven security patch writer. Pure types; no I/O.
//
// SecurityPatchRequest is sourced ONLY from trusted deterministic evidence
// already produced upstream (DependencyProvenance from the grounded
// resolver, targetVersion from selectEligibleTargetVersion) — an LLM is
// never the source of `package`/`installedVersion`/`targetVersion`/
// `controllingFile`/`controllingElement`/`controllingProperty` here. The one
// deliberate addition beyond the task's suggested shape is `sourceContent`:
// the writer cannot edit a file it was never given the real text of: this is
// still grounded evidence (the exact pom.xml text read from the exact
// `evaluatedSha` worktree), never LLM-authored.
import { CandidateFile } from '../candidate-verification/candidate-verification.types';
import { DependencyProvenanceKind } from './dependency-provenance.types';

export interface SecurityPatchRequest {
  findingIdentity: string;
  evaluatedSha: string;
  ecosystem: 'MAVEN';
  /** Only 'DIRECT_EXPLICIT' | 'PROPERTY_MANAGED' can ever produce a patch — see maven-security-patch-writer.ts. */
  provenanceKind: DependencyProvenanceKind;
  /** groupId:artifactId */
  package: string;
  installedVersion: string;
  targetVersion: string;
  controllingFile: string;
  controllingElement: string | null;
  controllingProperty: string | null;
  /** The exact, real pom.xml text at `evaluatedSha` (e.g. read by GroundedMavenProvenanceService from the exact-SHA worktree). Never LLM-authored. */
  sourceContent: string;
}

/**
 * `file` reuses the EXISTING CandidateFile shape byte-for-byte (path/
 * operation/content/contentSha256/sourceContent/originalBlobSha) so it can
 * flow into a CandidateManifest and through the EXISTING write-guard/
 * candidate-verification pipeline unchanged — no second, incompatible
 * candidate format. `originalBlobSha` is never accepted as an input claim
 * (see maven-security-patch-writer.ts): it is always computed here, by this
 * writer, from the same `sourceContent` it just edited, via the same
 * computeGitBlobSha1 the R81.3 write-guard itself already uses — guaranteed
 * internally consistent by construction, never trusted blindly.
 */
export interface SecurityPatchCandidate {
  file: CandidateFile;
  findingIdentity: string;
  evaluatedSha: string;
  provenanceKind: DependencyProvenanceKind;
  oldVersion: string;
  targetVersion: string;
}
