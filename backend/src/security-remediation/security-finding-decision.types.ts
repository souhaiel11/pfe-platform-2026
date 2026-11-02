/** Contrats de la décision de remédiation d'un finding de sécurité : entrée (identité, package, versions, plan éventuel) et sortie (décision, provenance, candidat patch). */
import { DependencyProvenance } from './dependency-provenance.types';
import { SecurityRemediationType } from './security-eligibility-classifier';

import { MavenRemediationScope } from './maven-remediation-scope';
import { ParentVersionPatchCandidate } from './maven-parent-patch-writer';

/** Plan de remédiation ciblant le `<parent>` Maven plutôt que la dépendance de la CVE elle-même. */
export interface ParentVersionRemediationPlan {
  /** groupId:artifactId du `<parent>` ciblé par ce plan — jamais le package propre du finding. */
  actualEditTarget: string;
  fromVersion: string;
  toVersion: string;
  /** Version à laquelle le propre package vulnérable du finding est attendu de se résoudre après la bascule du parent. */
  expectedResolvedDependency?: string;
}

export interface SecurityFindingDecisionInput {
  /** Identité d'avis persistée côté backend, jamais fournie par l'appelant du webhook. */
  cveId?: string;
  /** Identité stable inter-builds — réutilise findingFingerprint(), jamais recalculée ici. */
  findingIdentity: string;
  source: string;
  /** groupId:artifactId */
  package: string;
  expectedInstalledVersion: string;
  /** Chaîne brute fixedVersion du scanner (non découpée) — analysée via parseFixedVersions(). */
  fixedVersion: string | null;
  /** V1.8 — version cible déjà validée côté serveur, prioritaire sur la politique numérique pure. */
  pinnedTargetVersion?: string;
  /** V1.8 Phase 7B — présent uniquement quand le plan persisté cible le `<parent>` ; mutuellement exclusif avec pinnedTargetVersion. */
  parentRemediationPlan?: ParentVersionRemediationPlan;
}

export interface SecurityFindingDecision {
  remediationScope?: MavenRemediationScope;
  findingIdentity: string;
  /** null quand le groundage lui-même a échoué (checkout/arbre) — jamais une supposition. */
  evaluatedSha: string | null;
  provenance: DependencyProvenance | null;
  fixedVersions: string[];
  selectedTargetVersion: string | null;
  remediationType: SecurityRemediationType;
  reason: string;
  /** Présent uniquement pour une décision produite par le chemin PARENT_VERSION. */
  editType?: 'PARENT_VERSION';
  parentRemediationPlan?: ParentVersionRemediationPlan;
  /** Candidat déjà construit pour une décision PARENT_VERSION — jamais re-dérivé ad hoc par l'appelant. */
  parentPatchCandidate?: ParentVersionPatchCandidate | null;
}
