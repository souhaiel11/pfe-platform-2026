// V1.7 predeploy phase — the REAL execution (podman/trivy execFileSync)
// moved to the dedicated builder/scanner (builder-scanner/src/
// security-artifact-validator.ts): candidate-verifier no longer holds
// CAP_SYS_ADMIN or execs podman/trivy itself, per the V1.7 architecture
// audit's recommendation (isolate the untrusted-repo-controlled build/scan
// step from the write-authorizing decision process). This file now keeps
// only: the SecurityArtifactValidator CONTRACT (how the orchestrator calls
// whatever implementation it's given -- see remote-builder-artifact-
// validator.ts, candidate-verifier's own concrete implementation, an HTTP
// client to that builder), and re-exports of the pure, dependency-free
// primitives (backend/src/security-remediation/security-artifact-scan.ts)
// the orchestrator's OWN source-digest-binding checks and CVE-matching
// logic still call directly -- so every existing
// `from './security-artifact-validator'` import in this project keeps
// resolving unchanged.
export { SecurityArtifactScan, ArtifactRuntimeError, trackedSourceDigest, cveTargets, provesSecurityClosure } from '../../backend/src/security-remediation/security-artifact-scan';
import { SecurityArtifactScan } from '../../backend/src/security-remediation/security-artifact-scan';

export interface SecurityArtifactValidator {
  /**
   * `budgetMs`, when given, is the caller's remaining overall-deadline
   * budget (V1.7 Blocker B, candidate-verifier/src/worker-deadline.ts) at
   * the moment this call starts -- a plain number, not the WorkerDeadline
   * type itself, so this interface stays free of a cross-cutting dependency
   * on the orchestrator's own timing concept. Absent means "no deadline",
   * i.e. use each stage's own fixed default (unchanged legacy behavior).
   */
  inspect(workspace: string, budgetMs?: number): SecurityArtifactScan;
}
