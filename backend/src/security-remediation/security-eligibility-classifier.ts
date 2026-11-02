/** Classifie de façon déterministe (sans IA) si un finding de sécurité Maven est éligible à une correction automatique, nécessite une action développeur, ou une action administrateur. */
import { DependencyProvenance } from './dependency-provenance.types';
import { selectEligibleTargetVersion } from './version-selection-policy';

export type SecurityRemediationType = 'AUTO_FIX_ELIGIBLE' | 'DEVELOPER_ACTION_REQUIRED' | 'ADMIN_ACTION_REQUIRED';

export interface SecurityFindingInput {
  source: string | null | undefined;
  /** Identité d'écosystème déjà résolue par l'appelant — seul 'MAVEN' est accepté en V1. */
  ecosystem: string | null | undefined;
  pkg: string | null | undefined;
  installedVersion: string | null | undefined;
  fixedVersions: string[] | null | undefined;
  /** V1.8 — version cible déjà validée et épinglée en amont. */
  pinnedTargetVersion?: string;
}

export interface SecurityEligibilityResult {
  remediationType: SecurityRemediationType;
  targetVersion: string | null;
  reason: string;
}

export const SUPPORTED_SECURITY_SOURCES = new Set(['TRIVY', 'OWASP']);
const SUPPORTED_SOURCES = SUPPORTED_SECURITY_SOURCES;
const SUPPORTED_ECOSYSTEMS = new Set(['MAVEN']);

/** Décide le type de remédiation applicable à un finding, en refusant par défaut (DEVELOPER_ACTION_REQUIRED) à chaque donnée manquante ou provenance non éligible. */
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
      break;
    case 'TRANSITIVE':
      return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: 'TRANSITIVE_NOT_AUTOFIXABLE_V1' };
    case 'PLUGIN':
      return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: 'PLUGIN_NOT_AUTOFIXABLE_V1' };
    case 'BOM_MANAGED':
      return { remediationType: 'ADMIN_ACTION_REQUIRED', targetVersion: null, reason: 'BOM_MANAGED_NOT_AUTOFIXABLE_V1' };
    case 'UNRESOLVED':
    default:
      return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: 'PROVENANCE_UNRESOLVED' };
  }

  const pinned = finding.pinnedTargetVersion != null ? String(finding.pinnedTargetVersion).trim() : '';
  if (pinned) {
    return { remediationType: 'AUTO_FIX_ELIGIBLE', targetVersion: pinned, reason: `${provenance.kind}:V1_8_PINNED` };
  }

  const selection = selectEligibleTargetVersion(finding.installedVersion, fixedVersions);
  if (selection.reason === 'SELECTED' && selection.eligibleTargetVersion) {
    return { remediationType: 'AUTO_FIX_ELIGIBLE', targetVersion: selection.eligibleTargetVersion, reason: `${provenance.kind}:SELECTED` };
  }
  return { remediationType: 'DEVELOPER_ACTION_REQUIRED', targetVersion: null, reason: selection.reason };
}
