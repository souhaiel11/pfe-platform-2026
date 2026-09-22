// R-SEC-V1.1 §8 — composes GroundedMavenProvenanceService (I/O, real
// checkout + real Maven) with the pure classifySecurityAutoFixEligibility()
// (backend/src/security-remediation) into one decision record.
//
// DECISION/EVIDENCE ONLY. Deliberately does NOT call remediationWorkflowFor()
// and does NOT touch WF2/WF6 routing — see incidents.service.ts, untouched
// this phase. A caller (not built here) would persist/inspect this record;
// nothing here ever writes to GitHub, n8n, or dispatches anything.
import { Injectable, Optional } from '@nestjs/common';
import { GroundedMavenProvenanceService } from './grounded-maven-provenance.service';
import { GroundedMavenProvenanceRequest, GroundedMavenProvenanceResult } from '../../backend/src/security-remediation/grounded-maven-provenance.types';
import { SecurityFindingDecisionInput, SecurityFindingDecision } from '../../backend/src/security-remediation/security-finding-decision.types';
import { parseFixedVersions } from '../../backend/src/security-remediation/fixed-version-normalizer';
import { classifySecurityAutoFixEligibility, SUPPORTED_SECURITY_SOURCES } from '../../backend/src/security-remediation/security-eligibility-classifier';

// This project's tsconfig runs with strictNullChecks:false (a pre-existing,
// intentional project-wide setting — see maven-build-adapter.ts and every
// other file here), under which TS's usual `if (!x.ok)` discriminated-union
// narrowing on a 3+ field literal-boolean union is unreliable. Extract<> +
// an explicit cast sidesteps that entirely rather than depending on
// inference this project's own compiler settings don't guarantee.
type GroundingFailure = Extract<GroundedMavenProvenanceResult, { ok: false }>;
type GroundingSuccess = Extract<GroundedMavenProvenanceResult, { ok: true }>;

@Injectable()
export class SecurityFindingDecisionService {
  constructor(
    @Optional() private readonly provenanceService: GroundedMavenProvenanceService = new GroundedMavenProvenanceService(),
  ) {}

  decide(
    finding: SecurityFindingDecisionInput,
    workspace: Omit<GroundedMavenProvenanceRequest, 'package' | 'expectedInstalledVersion'>,
  ): SecurityFindingDecision {
    const fixedVersions = parseFixedVersions(finding.fixedVersion);

    // Fast pre-checks BEFORE any real checkout/Maven execution: both are
    // pure, cheap, and already independently sufficient to reject (see
    // classifySecurityAutoFixEligibility's own identical checks) — no
    // point spending a real git worktree + real `mvn dependency:tree` on a
    // ZAP finding, or on an OWASP finding whose fixedVersion is, in this
    // platform's real data, ALWAYS null (see §7/fixed-version-normalizer.ts).
    const sourceUpper = String(finding.source ?? '').toUpperCase();
    if (!SUPPORTED_SECURITY_SOURCES.has(sourceUpper)) {
      return { findingIdentity: finding.findingIdentity, evaluatedSha: null, provenance: null, fixedVersions, selectedTargetVersion: null, remediationType: 'DEVELOPER_ACTION_REQUIRED', reason: `SOURCE_NOT_SUPPORTED_V1:${sourceUpper || 'UNKNOWN'}` };
    }
    if (!fixedVersions.length) {
      return { findingIdentity: finding.findingIdentity, evaluatedSha: null, provenance: null, fixedVersions, selectedTargetVersion: null, remediationType: 'DEVELOPER_ACTION_REQUIRED', reason: 'FIXED_VERSION_MISSING' };
    }

    const grounded = this.provenanceService.resolve({
      ...workspace,
      package: finding.package,
      expectedInstalledVersion: finding.expectedInstalledVersion,
    });

    if (grounded.ok !== true) {
      // §10 — checkout failure / Maven timeout / dependency-tree failure /
      // package not resolved / installed-version mismatch (already folded
      // into UNRESOLVED by the pure resolver, or into a grounding failure
      // here): every one of these is a deterministic non-auto outcome,
      // never AUTO_FIX_ELIGIBLE, never a fabricated provenance.
      const failure = grounded as GroundingFailure;
      return {
        findingIdentity: finding.findingIdentity,
        evaluatedSha: failure.evidence.evaluatedSha,
        provenance: null,
        fixedVersions,
        selectedTargetVersion: null,
        remediationType: 'DEVELOPER_ACTION_REQUIRED',
        reason: `GROUNDING_FAILED:${failure.failureClass}`,
      };
    }

    const success = grounded as GroundingSuccess;
    const result = classifySecurityAutoFixEligibility(
      { source: finding.source, ecosystem: success.provenance.ecosystem, pkg: finding.package, installedVersion: finding.expectedInstalledVersion, fixedVersions },
      success.provenance,
    );

    return {
      findingIdentity: finding.findingIdentity,
      evaluatedSha: success.evidence.evaluatedSha,
      provenance: success.provenance,
      fixedVersions,
      selectedTargetVersion: result.targetVersion,
      remediationType: result.remediationType,
      reason: result.reason,
    };
  }
}
