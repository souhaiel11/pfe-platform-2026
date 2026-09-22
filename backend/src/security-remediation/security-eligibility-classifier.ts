// R-SEC-V1 §6 — deterministic security auto-fix eligibility classifier.
// Pure function: no I/O, no LLM, no WF2/WF6 routing decision (that stays
// entirely out of scope this turn — see incidents.service.ts's
// remediationWorkflowFor(), deliberately NOT touched here).
//
// Reuses the EXISTING remediation-type vocabulary (never invents a new
// lifecycle state, per this turn's explicit instruction): only
// 'AUTO_FIX_ELIGIBLE' | 'DEVELOPER_ACTION_REQUIRED' | 'ADMIN_ACTION_REQUIRED'
// are ever returned.
import { DependencyProvenance } from './dependency-provenance.types';
import { selectEligibleTargetVersion } from './version-selection-policy';

export type SecurityRemediationType = 'AUTO_FIX_ELIGIBLE' | 'DEVELOPER_ACTION_REQUIRED' | 'ADMIN_ACTION_REQUIRED';

export interface SecurityFindingInput {
  source: string | null | undefined;
  /** Caller-resolved ecosystem identity (e.g. from controllingFile's extension) — V1 only ever accepts 'MAVEN'. */
  ecosystem: string | null | undefined;
  pkg: string | null | undefined;
  installedVersion: string | null | undefined;
  fixedVersions: string[] | null | undefined;
}

export interface SecurityEligibilityResult {
  remediationType: SecurityRemediationType;
  targetVersion: string | null;
  reason: string;
}

// Exported so callers that can skip expensive work (e.g. a real grounded
// checkout) on an unsupported source don't have to duplicate this set —
// see candidate-verifier/src/security-finding-decision.service.ts.
export const SUPPORTED_SECURITY_SOURCES = new Set(['TRIVY', 'OWASP']);
const SUPPORTED_SOURCES = SUPPORTED_SECURITY_SOURCES;
const SUPPORTED_ECOSYSTEMS = new Set(['MAVEN']);

/**
 * `provenance` is `null` when the resolver was never run or found nothing —
 * always treated identically to an UNRESOLVED provenance (fail closed,
 * never inferred as "probably fine").
 */
export function classifySecurityAutoFixEligibility(
  finding: SecurityFindingInput,
  provenance: DependencyProvenance | null,
): SecurityEligibilityResult {
  const source = String(finding.source ?? '').toUpperCase();
  if (!SUPPORTED_SOURCES.has(source)) {
    return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: `SOURCE_NOT_SUPPORTED_V1:${source || 'UNKNOWN'}` };
  }

  const ecosystem = String(finding.ecosystem ?? '').toUpperCase();
  if (!SUPPORTED_ECOSYSTEMS.has(ecosystem)) {
    return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: `ECOSYSTEM_NOT_SUPPORTED_V1:${ecosystem || 'UNKNOWN'}` };
  }

  if (!finding.pkg || !String(finding.pkg).trim()) {
    return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: 'PACKAGE_IDENTITY_MISSING' };
  }

  if (!finding.installedVersion || !String(finding.installedVersion).trim()) {
    return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: 'INSTALLED_VERSION_MISSING' };
  }

  const fixedVersions = finding.fixedVersions ?? [];
  if (!fixedVersions.length) {
    return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: 'FIXED_VERSION_MISSING' };
  }

  if (!provenance) {
    return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: 'PROVENANCE_NOT_RESOLVED' };
  }

  switch (provenance.kind) {
    case 'DIRECT_EXPLICIT':
    case 'PROPERTY_MANAGED':
      break; // only these two may proceed to version selection below
    case 'TRANSITIVE':
      return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: 'TRANSITIVE_NOT_AUTOFIXABLE_V1' };
    case 'PLUGIN':
      return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: 'PLUGIN_NOT_AUTOFIXABLE_V1' };
    case 'BOM_MANAGED':
      // V1 has no ownership-evidence resolution (local BOM vs. external
      // parent/BOM) -- default to the HIGHER bar (ADMIN) rather than
      // guess it's safely developer-actionable. See architecture audit §3/§6.
      return { remediationType: 'ADMIN_ACTION_REQUIRED', targetVersion: null, reason: 'BOM_MANAGED_NOT_AUTOFIXABLE_V1' };
    case 'UNRESOLVED':
    default:
      return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: 'PROVENANCE_UNRESOLVED' };
  }

  const selection = selectEligibleTargetVersion(finding.installedVersion, fixedVersions);
  if (selection.reason === 'SELECTED' && selection.eligibleTargetVersion) {
    return { remediationType: 'AUTO_FIX_ELIGIBLE', targetVersion: selection.eligibleTargetVersion, reason: `${provenance.kind}:SELECTED` };
  }
  return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: selection.reason };
}
