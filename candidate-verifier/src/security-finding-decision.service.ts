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
import { writeParentVersionPatch } from '../../backend/src/security-remediation/maven-parent-patch-writer';

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

    // V1.8 Phase 7B — an owner/parent-targeted plan is evaluated on an
    // ENTIRELY SEPARATE branch, taken BEFORE the fixedVersion fast-fail and
    // BEFORE classifySecurityAutoFixEligibility() are ever reached: neither
    // is meaningful here (the scanner's own fixedVersion list describes
    // `finding.package`, not the <parent> this plan actually edits; the
    // classifier only ever knows DIRECT_EXPLICIT/PROPERTY_MANAGED). No
    // fallback exists FROM this branch back to the normal path below --
    // every failure here returns directly, fail-closed, never falls
    // through to legacy dependency/property selection.
    if (finding.parentRemediationPlan) {
      return this.decideParentVersion(finding, finding.parentRemediationPlan, workspace, fixedVersions);
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
      { source: finding.source, ecosystem: success.provenance.ecosystem, pkg: finding.package, installedVersion: finding.expectedInstalledVersion, fixedVersions, pinnedTargetVersion: finding.pinnedTargetVersion },
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

  /**
   * V1.8 Phase 7B — the ONLY place a ParentVersionRemediationPlan is ever
   * executed. Discovers nothing, chooses nothing: `plan` is already the
   * exact, already-validated V1.8 authoritative plan (forwarded verbatim by
   * SecurityFindingResolverService) -- this method's whole job is to
   * REUSE the same real checkout GroundedMavenProvenanceService already
   * performs (never a second, parallel checkout mechanism) to obtain the
   * real pom.xml text, then hand `plan` to maven-parent-patch-writer.ts,
   * which does its OWN independent fail-closed re-verification against
   * that real text. Any failure here — grounding, or the writer rejecting
   * the plan — returns DEVELOPER_ACTION_REQUIRED with the writer's own
   * named reason; there is no path from here back into the normal
   * DIRECT_EXPLICIT/PROPERTY_MANAGED classification below.
   */
  private decideParentVersion(
    finding: SecurityFindingDecisionInput,
    plan: NonNullable<SecurityFindingDecisionInput['parentRemediationPlan']>,
    workspace: Omit<GroundedMavenProvenanceRequest, 'package' | 'expectedInstalledVersion'>,
    fixedVersions: string[],
  ): SecurityFindingDecision {
    const blocked = (evaluatedSha: string | null, reason: string): SecurityFindingDecision => ({
      findingIdentity: finding.findingIdentity, evaluatedSha, provenance: null, fixedVersions,
      selectedTargetVersion: null, remediationType: 'DEVELOPER_ACTION_REQUIRED', reason,
      editType: 'PARENT_VERSION', parentRemediationPlan: plan, parentPatchCandidate: null,
    });

    if (!plan.actualEditTarget || !plan.fromVersion || !plan.toVersion) {
      return blocked(null, 'PARENT_PLAN_INCOMPLETE');
    }

    // Grounding reuses the EXACT SAME real checkout GroundedMavenProvenanceService
    // already performs for every other finding — `package`/`expectedInstalledVersion`
    // are passed through only so that checkout succeeds identically; this
    // method never consults the resulting `.provenance` classification
    // (that describes finding.package, never the <parent>).
    const grounded = this.provenanceService.resolve({
      ...workspace, package: finding.package, expectedInstalledVersion: finding.expectedInstalledVersion,
    });
    if (grounded.ok !== true) {
      const failure = grounded as GroundingFailure;
      return blocked(failure.evidence.evaluatedSha, `GROUNDING_FAILED:${failure.failureClass}`);
    }
    const success = grounded as GroundingSuccess;
    const pomXmlText = success.evidence.pomXmlText;
    if (!pomXmlText) {
      return blocked(success.evidence.evaluatedSha, 'GROUNDING_FAILED:POM_NOT_AVAILABLE');
    }

    const writeResult: any = writeParentVersionPatch({
      findingIdentity: finding.findingIdentity, evaluatedSha: success.evidence.evaluatedSha!,
      ecosystem: 'MAVEN', editType: 'PARENT_VERSION',
      actualEditTarget: plan.actualEditTarget, fromVersion: plan.fromVersion, toVersion: plan.toVersion,
      controllingFile: 'pom.xml', sourceContent: pomXmlText,
    });
    if (writeResult.ok !== true) {
      return blocked(success.evidence.evaluatedSha, `PARENT_WRITE_FAILED:${writeResult.reason}`);
    }

    return {
      findingIdentity: finding.findingIdentity,
      evaluatedSha: success.evidence.evaluatedSha,
      // Honest, additive provenance kind (Phase 7B) -- never fakes the
      // parent as this finding's own direct/property declaration.
      provenance: {
        ecosystem: 'MAVEN', kind: 'PARENT_MANAGED', package: finding.package, installedVersion: finding.expectedInstalledVersion,
        controllingFile: 'pom.xml', controllingElement: null, controllingProperty: null,
        groundedSha: success.evidence.evaluatedSha!,
        evidence: `PARENT_VERSION plan: ${plan.actualEditTarget} ${plan.fromVersion} -> ${plan.toVersion} (V1.8-authoritative, never discovered here).`,
      },
      fixedVersions,
      selectedTargetVersion: plan.toVersion,
      remediationType: 'AUTO_FIX_ELIGIBLE',
      reason: 'PARENT_MANAGED:V1_8_PINNED',
      editType: 'PARENT_VERSION',
      parentRemediationPlan: plan,
      parentPatchCandidate: writeResult.candidate,
    };
  }
}
