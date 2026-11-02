// Présente les risques et les autorisations de déploiement Azure.
import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { userHttpError } from '../../core/http-error-message';
import { SourceEvidenceListComponent } from '../../shared/source-evidence/source-evidence-list.component';
import { CopyableIdComponent } from '../../shared/copyable-id/copyable-id.component';
import { InfoHintComponent } from '../../shared/info-hint/info-hint.component';
import { EvidenceSection, SourceEvidence } from '../../shared/source-evidence/source-evidence.types';

// ───────────────────────────────────────────────────────────────────── Phase 2B.3 — Interface de gouvernance du déploiement.

export type GovernanceClass = 'READY' | 'CONDITIONAL' | 'CRITICAL_RISK' | 'TECHNICALLY_IMPOSSIBLE';
export type SecurityValidationApplicability = 'APPLICABLE' | 'NOT_APPLICABLE' | 'MISSING' | 'FAILED' | 'AMBIGUOUS';
export type AuthorizationMode = 'NORMAL' | 'CONDITIONAL_EXCEPTION' | 'CRITICAL_OVERRIDE';

export interface GovernancePreview {
  projectId: string;
  incidentId: string | null;
  mainBuildNumber: number | null;
  decision: GovernanceClass;
  buildIdentity: { resolved: boolean; commitSha: string | null };
  artifact: { provenanceVerified: boolean; artifactIdentityProven?: boolean; publicationSource?: 'PIPELINE_VERIFIED' | 'MANUAL_ATTESTED' | 'UNKNOWN'; digest: string | null; registry: string | null; repository: string | null; tag: string | null };
  // `name` and `resourceGroup` are declared optional on purpose: the current
  // backend GovernancePreview does not return them (see
  // deployment-authorization.service.ts getGovernancePreview), so the UI
  // renders "Non disponible" for them rather than inventing a value (§3).
  // If the backend ever adds them, they display with no further change here.
  environment: { resolved: boolean; identityHash: string | null; targetName: string | null; region: string | null; name?: string | null; resourceGroup?: string | null };
  securityValidation: { applicability: SecurityValidationApplicability; status: string };
  failedControls: string[];
  warnings: string[];
  authorizationPolicy: {
    requiredMode: AuthorizationMode | null;
    rolesAllowed: string[];
    adminRequired: boolean;
    reasonRequired: boolean;
    acknowledgementRequirements: string[];
    confirmationPhraseRequired: boolean;
  };
}

interface HeldAuthorization {
  authorizationId: string;
  governanceClass: GovernanceClass;
  expiresAt: string;
  mode: AuthorizationMode;
}

// §11 — UI phases mirrored from the backend's own lifecycle: authorization
// creation (POST /authorize), then dispatch (POST /deploy), whose terminal
// values are exactly the backend's `dispatchStatus` /
// `azureDeploymentState.status` (DISPATCHING -> DEPLOYED | FAILED, see
// azure-deploy.module.ts). Never a frontend-invented state.
export type DeployPhase = 'IDLE' | 'AUTHORISING' | 'AUTHORIZED' | 'DISPATCHING' | 'DEPLOYED' | 'FAILED';

// §4 — icon AND text for every semantic class, never colour alone. Labels
// are the exact required wording.
export const DECISION_PRESENTATION: Record<GovernanceClass, { label: string; icon: string; tone: string }> = {
  READY: { label: 'Prêt au déploiement', icon: '✅', tone: 'ready' },
  CONDITIONAL: { label: 'Déploiement conditionnel', icon: '⚠️', tone: 'conditional' },
  CRITICAL_RISK: { label: 'Risque critique', icon: '⛔', tone: 'critical' },
  TECHNICALLY_IMPOSSIBLE: { label: 'Déploiement techniquement impossible', icon: '🚫', tone: 'impossible' },
};

const ARTIFACT_STATE_PRESENTATION: Record<string, { label: string; detail: string }> = {
  DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE: {
    label: 'Image non publiée',
    detail: 'Aucun artefact vérifié n’existe pour ce build. L’image n’a pas encore été publiée dans le registre du projet, ou sa provenance n’a pas été enregistrée.',
  },
  DEPLOY_ARTIFACT_DIGEST_MISSING: {
    label: 'Digest non résolu',
    detail: 'Le registre n’a pas fourni d’empreinte sha256 pour cette image. Sans identité immuable, le déploiement reste bloqué.',
  },
  DEPLOY_ARTIFACT_DIGEST_MISMATCH: {
    label: 'Digest divergent',
    detail: 'Le tag enregistré ne pointe plus vers l’image autorisée : il a été réécrit depuis. Rien n’est redéployé sur cette base.',
  },
  DEPLOY_ARTIFACT_COMMIT_MISMATCH: {
    label: 'Commit divergent',
    detail: 'L’artefact trouvé appartient à un autre commit que celui gouverné pour ce build.',
  },
  // QA-DEF-11 — l'identite du code source peut etre prouvee alors que rien
  // ne prouve QUI a publie l'image. Le libelle ne doit donc jamais parler du
  // commit : ce n'est pas lui qui est en cause.
  DEPLOY_ARTIFACT_PUBLICATION_UNVERIFIED: {
    label: 'Publication non prouvée',
    detail: 'Le code source de cette image est bien identifié, mais aucune preuve n’établit qui l’a publiée dans le registre : ni reçu de poussée du pipeline, ni attestation manuelle nominative. Le déploiement reste bloqué tant que la publication n’est pas prouvée.',
  },
  DEPLOY_BUILD_MISMATCH: {
    label: 'Artefact d’un autre build',
    detail: 'L’artefact disponible provient d’un build précédent. Un artefact passé n’autorise jamais le build courant.',
  },
  DEPLOY_ARTIFACT_REGISTRY_MISMATCH: {
    label: 'Registre divergent',
    detail: 'L’artefact est dans un autre registre que celui configuré pour ce projet.',
  },
  DEPLOY_ARTIFACT_REPOSITORY_MISMATCH: {
    label: 'Dépôt d’image divergent',
    detail: 'L’artefact est dans un autre dépôt d’image que celui configuré pour ce projet.',
  },
  DEPLOY_ARTIFACT_REVISION_MISSING: {
    label: 'Révision OCI absente',
    detail: 'L’image ne porte pas d’étiquette org.opencontainers.image.revision : son commit d’origine n’est pas prouvable.',
  },
  DEPLOY_ARTIFACT_REVISION_MISMATCH: {
    label: 'Révision OCI divergente',
    detail: 'L’étiquette de révision de l’image contredit le commit gouverné pour ce build.',
  },
  DEPLOY_COMMIT_MISSING: {
    label: 'Identité de build non résolue',
    detail: 'La plateforme n’a pas encore d’identité de build (commit) pour ce projet : aucun artefact ne peut y être rattaché.',
  },
  DEPLOY_ENVIRONMENT_UNRESOLVED: {
    label: 'Cible Azure non résolue',
    detail: 'La configuration de déploiement du projet est incomplète ou invalide.',
  },
};

const NOT_CONFIGURED_PRESENTATION = { label: 'Azure non configuré', icon: '⚙️', tone: 'neutral' } as const;
// §9 — the exact sentence required for a non-overridable block.
export const NON_OVERRIDABLE_NOTICE = 'Ce blocage ne peut pas être contourné par une acceptation de risque.';

export type ControlStatus = 'PASS' | 'FAIL' | 'WARNING' | 'NOT_RUN' | 'UNKNOWN';

export interface ControlRow {
  name: string;
  status: ControlStatus;
  explanation: string;
  /** null when the backend does not express blocking semantics for this control. */
  blocking: boolean | null;
}

// §5 — a backend pipeline stage exactly as GET /azure-deploy/ready/:id
// returns it (requiredStages[]). Passed down from project-detail, which has
// already loaded it — never re-fetched nor reinterpreted here.
export interface BackendStage {
  stage: string;
  status: string;
  blocking?: boolean | null;
  required?: boolean | null;
  source?: string | null;
  findingCount?: number | null;
}

/** Renvoie étape contrôle statut pour le traitement ou l’affichage. */
export function stageControlStatus(raw: string | null | undefined): ControlStatus {
  const value = String(raw || '').toUpperCase();
  if (['PASS', 'PASSED', 'SUCCESS', 'OK', 'STABLE'].includes(value)) return 'PASS';
  if (['FAIL', 'FAILED', 'FAILURE', 'ERROR', 'BROKEN'].includes(value)) return 'FAIL';
  if (['WARNING', 'WARN', 'UNSTABLE'].includes(value)) return 'WARNING';
  if (['NOT_RUN', 'NOT_EXECUTED', 'SKIPPED', 'NOT_REACHED', 'NOT_ATTEMPTED', 'MISSING', 'ABSENT', 'PENDING'].includes(value)) return 'NOT_RUN';
  return 'UNKNOWN';
}

/** Renvoie sécurité validation contrôle statut pour le traitement ou l’affichage. */
export function securityValidationControlStatus(a: SecurityValidationApplicability | null | undefined): ControlStatus {
  switch (a) {
    case 'APPLICABLE': return 'PASS';
    case 'FAILED': return 'FAIL';
    case 'MISSING':
    case 'NOT_APPLICABLE': return 'NOT_RUN';
    case 'AMBIGUOUS': return 'UNKNOWN';
    default: return 'UNKNOWN';
  }
}

export const CONTROL_STATUS_LABELS: Record<ControlStatus, string> = {
  PASS: 'Réussi', FAIL: 'Échoué', WARNING: 'Avertissement', NOT_RUN: 'Non exécuté', UNKNOWN: 'Indéterminé',
};

// Number of control rows shown before the "Voir tous les contrôles"
// disclosure is required (§5).
export const CONTROLS_COLLAPSED_LIMIT = 4;

// Non-secret deployment target metadata, exactly as GET /azure-deploy/ready
// returns it in `deploymentTarget` (Project.azureConfig). Credentials never
// reach the frontend — this is addressing/identity only.
export interface DeploymentTargetConfig {
  provider?: string | null;
  resourceGroup?: string | null;
  targetName?: string | null;
  registry?: string | null;
  imageRepository?: string | null;
  region?: string | null;
  healthCheck?: { path?: string | null; port?: string | null } | null;
}

// Deployment capability, distinct from the governance decision. A project may
// legitimately have no deployment environment yet; that is a CONFIGURATION
// state, not a risk verdict, and it must never be rendered as a governance
// failure. Every value below is derived from backend-supplied fields only.
export type DeploymentCapability =
  | 'DEPLOYMENT_CONFIGURED'
  | 'DEPLOYMENT_NOT_CONFIGURED'
  | 'DEPLOYMENT_CONFIGURATION_INVALID'
  | 'DEPLOYMENT_GOVERNANCE_UNAVAILABLE'
  | 'DEPLOYMENT_TECHNICALLY_IMPOSSIBLE';

export const CAPABILITY_PRESENTATION: Record<DeploymentCapability, { label: string; icon: string; tone: string; detail: string }> = {
  DEPLOYMENT_CONFIGURED: {
    label: 'Configuration disponible', icon: '🟢', tone: 'configured',
    detail: 'Un environnement de déploiement est configuré pour ce projet.',
  },
  DEPLOYMENT_NOT_CONFIGURED: {
    label: 'Déploiement non configuré', icon: '⚪', tone: 'unconfigured',
    detail: "Aucun environnement de déploiement n'est encore configuré pour ce projet.",
  },
  DEPLOYMENT_CONFIGURATION_INVALID: {
    label: 'Configuration invalide', icon: '🔴', tone: 'invalid',
    detail: "La configuration de déploiement de ce projet existe mais n'a pas pu être résolue par le backend.",
  },
  DEPLOYMENT_GOVERNANCE_UNAVAILABLE: {
    label: 'Gouvernance indisponible', icon: '🟠', tone: 'unavailable',
    detail: "L'état de gouvernance du déploiement n'a pas pu être obtenu auprès du backend.",
  },
  DEPLOYMENT_TECHNICALLY_IMPOSSIBLE: {
    label: 'Déploiement techniquement impossible', icon: '🚫', tone: 'impossible',
    detail: 'Un prérequis technique non contournable empêche tout déploiement de ce projet.',
  },
};

/** Détermine déploiement capacité. */
export function deriveDeploymentCapability(input: {
  previewFailed: boolean;
  deploymentConfigured: boolean | null;
  environmentResolved: boolean | null;
  decision: GovernanceClass | null;
}): DeploymentCapability {
  if (input.previewFailed || !input.decision) return 'DEPLOYMENT_GOVERNANCE_UNAVAILABLE';
  if (input.environmentResolved !== true) {
    // The backend could not resolve a deployment environment. Which of the two
    // configuration states that is depends on whether any config exists.
    return input.deploymentConfigured === true ? 'DEPLOYMENT_CONFIGURATION_INVALID' : 'DEPLOYMENT_NOT_CONFIGURED';
  }
  if (input.decision === 'TECHNICALLY_IMPOSSIBLE') return 'DEPLOYMENT_TECHNICALLY_IMPOSSIBLE';
  return 'DEPLOYMENT_CONFIGURED';
}

/** Renvoie capacité Allows déploiement action pour le traitement ou l’affichage. */
export function capabilityAllowsDeployAction(c: DeploymentCapability): boolean {
  return c === 'DEPLOYMENT_CONFIGURED';
}

// §14 — the backend persists DeploymentAttempt rows but exposes no read
// endpoint for them (azure-deploy.module.ts injects attemptsRepo and never
// queries it; there is no GET .../attempts route). A history panel is
// therefore deliberately NOT implemented rather than faked client-side.
export const DEPLOYMENT_HISTORY_UI_DEFERRED = false;

// §6 — exact backend phrase (deployment-authorization-policy.ts). Never
// pre-filled into the input's value, never autocompleted — the user must
// type it themselves.
export const CRITICAL_OVERRIDE_PHRASE = 'DEPLOYER MALGRÉ LES RISQUES';
const MIN_MEANINGFUL_REASON_LENGTH = 10;

@Component({
  selector: 'app-deployment-governance',
  standalone: true,
  imports: [CommonModule, FormsModule, SourceEvidenceListComponent, CopyableIdComponent, InfoHintComponent],
  templateUrl: './deployment-governance.component.html',
  styleUrls: ['./deployment-governance.component.scss'],
})
export class DeploymentGovernanceComponent implements OnInit, OnChanges {
  @Input() projectId: string | null = null;
  // §5 — already loaded by project-detail from GET /azure-deploy/ready/:id.
  // Optional: when absent the control list simply shows the preview-derived
  // rows, never fabricated stage results.
  @Input() requiredStages: BackendStage[] | null = null;
  // Whether the project carries ANY deployment configuration, from
  // GET /azure-deploy/ready's `deploymentConfigured` (already loaded by the
  // parent). Used only to tell "never configured" from "invalid".
  @Input() deploymentConfigured: boolean | null = null;
  // Non-secret target metadata from GET /azure-deploy/ready's
  // `deploymentTarget`. Display only; never sent back as authority.
  @Input() deploymentTarget: DeploymentTargetConfig | null = null;
  @Input() projectName: string | null = null;
  // Source/evidence table for this project, derived by the backend
  // (GET /api/source-evidence/*). Kept deliberately separate from the
  // deployment action: links to INSPECT the build, the image and the Azure
  // target — never the deployment UI itself. This component composes no URL
  // of its own; it previously received a pre-built Jenkins URL, which hid
  // the fact that the URL was assembled from an overloaded project field.
  @Input() sourceEvidence: Record<string, SourceEvidence> | null = null;
  readonly azureLinkSections: EvidenceSection[] = [
    { id: 'azure', title: 'Ressources Azure', slots: ['AZURE_TARGET', 'ACR_IMAGE', 'ACR_REGISTRY', 'AZURE_RESOURCE_GROUP'] },
  ];
  @Input() sourceEvidenceSections: EvidenceSection[] | null = null;

  readonly criticalOverridePhrase = CRITICAL_OVERRIDE_PHRASE;
  readonly capabilityPresentation = CAPABILITY_PRESENTATION;
  readonly nonOverridableNotice = NON_OVERRIDABLE_NOTICE;
  readonly controlStatusLabels = CONTROL_STATUS_LABELS;
  readonly historyDeferred = DEPLOYMENT_HISTORY_UI_DEFERRED;

  preview: GovernancePreview | null = null;
  previewLoading = true;
  previewError: string | null = null;

  // §12 — transient only, NEVER persisted to localStorage/sessionStorage.
  authorization: HeldAuthorization | null = null;
  authorizing = false;
  authorizeError: string | null = null;
  staleNotice: string | null = null;

  deployRequestId: string | null = null;
  deploying = false;
  deployAmbiguous = false;
  deployErrorMessage: string | null = null;
  deploySuccessInfo: { state: string; health: string; authorizationId: string; artifactDigest: string | null; appUrl: string | null; portalUrl: string | null } | null = null;

  /** Lien vers l'application déployée, seulement s'il s'agit d'une URL http(s) (valeur renvoyée par l'agent). */
  private safeAppUrl(value: unknown): string | null {
    try { const u = new URL(String(value || '')); return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password ? u.toString() : null; }
    catch { return null; }
  }

  /** Lien vers la ressource dans le portail Azure, seulement sur le domaine officiel du portail. */
  private safePortalUrl(value: unknown): string | null {
    const url = String(value || '');
    return url.startsWith('https://portal.azure.com/') ? url : null;
  }

  // §11 — current lifecycle phase, derived only from what the backend has
  // actually confirmed.
  deployPhase: DeployPhase = 'IDLE';
  // §13 — failure evidence surfaced from the backend's own error envelope
  // ({ error, message, attemptId, authorizationId, requestId }). Never a
  // stack trace, never a secret.
  deployErrorCode: string | null = null;
  deployAttemptId: string | null = null;
  // §13 — a governed dispatch consumes the authorization whatever the
  // outcome (see deployWithAuthorization: "Dispatch consumed the
  // authorization, regardless of the result").
  authorizationConsumed = false;

  // §5 — disclosure state for long blocker/control lists.
  controlsExpanded = false;

  // Guards against a slow response for project A landing after the user has
  // already navigated to project B. Every load captures the project it was
  // issued for plus a monotonic generation; a response is applied only if both
  // still match the component's current state. Without this, rapid A -> B
  // navigation can paint A's governance under B's URL.
  private loadGeneration = 0;
  private loadedForProjectId: string | null = null;

  showConditionalForm = false;
  conditionalReason = '';
  conditionalAck = false;

  showCriticalForm = false;
  criticalReason = '';
  criticalAcks = { criticalRiskAccepted: false, securityControlsMayHaveFailed: false, deploymentMayExposeKnownRisk: false };
  criticalPhrase = '';

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private api: ApiService, private toast: ToastService, public auth: AuthService) {}

  /** Charge les données nécessaires à l’ouverture du composant. */
  ngOnInit(): void { this.loadPreview(); }

  // Un changement de projet affiché (navigation sans recréation du
  // composant) ne doit jamais laisser un ancien état de gouvernance/
  // autorisation visible pour un AUTRE projet.
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['projectId'] && !changes['projectId'].firstChange) {
      // Drop the previous project's governance immediately — it must not stay
      // on screen for even one frame under the new project's identity — then
      // reload. resetTransientState() also discards any held authorization,
      // which may never cross a project boundary.
      this.preview = null;
      this.previewError = null;
      this.loadedForProjectId = null;
      this.previewLoading = true;
      this.resetTransientState();
      this.loadPreview();
    }
  }

  /** Renvoie aperçu état pour courant projet pour le traitement ou l’affichage. */
  get previewIsForCurrentProject(): boolean {
    return !!this.preview && !!this.projectId && this.loadedForProjectId === this.projectId;
  }

  /** Réinitialise les formulaires et messages temporaires. */
  private resetTransientState(): void {
    this.authorization = null;
    this.deployRequestId = null;
    this.deploySuccessInfo = null;
    this.deployErrorMessage = null;
    this.deployAmbiguous = false;
    this.staleNotice = null;
    this.showConditionalForm = false;
    this.showCriticalForm = false;
    this.deployPhase = 'IDLE';
    this.deployErrorCode = null;
    this.deployAttemptId = null;
    this.authorizationConsumed = false;
    this.controlsExpanded = false;
  }

  /** Derniers déploiements (serveur) : survit à l'actualisation de la page, contrairement au bloc de résultat. */
  deploymentHistory: any[] = [];
  /** Dernier déploiement réussi ayant un lien vers l'application. */
  get lastDeployedApp(): any | null { return this.deploymentHistory.find(h => h.status === 'DEPLOYED' && h.appUrl) || null; }
  /** Charge l'historique des déploiements du projet. */
  loadHistory(): void {
    if (!this.projectId) return;
    const requested = this.projectId;
    this.api.getDeploymentHistory(requested).subscribe({
      next: (rows) => { if (this.projectId === requested) this.deploymentHistory = (rows || []).map(r => ({ ...r, appUrl: this.safeAppUrl(r.appUrl), portalUrl: this.safePortalUrl(r.portalUrl) })); },
      error: () => { if (this.projectId === requested) this.deploymentHistory = []; },
    });
  }

  /** Charge aperçu. */
  loadPreview(): void {
    if (!this.projectId) return;
    this.loadHistory();
    const requestedProjectId = this.projectId;
    const generation = ++this.loadGeneration;
    /** Renvoie courant pour le traitement ou l’affichage. */
    const current = () => generation === this.loadGeneration && this.projectId === requestedProjectId;
    this.previewLoading = true;
    this.previewError = null;
    this.api.getGovernancePreview(requestedProjectId).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (preview: GovernancePreview) => {
        if (!current()) return;
        this.preview = preview;
        this.loadedForProjectId = requestedProjectId;
        this.previewLoading = false;
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => {
        if (!current()) return;
        this.preview = null;
        this.loadedForProjectId = requestedProjectId;
        this.previewError = "Impossible de charger l'état de gouvernance du déploiement (backend injoignable).";
        this.previewLoading = false;
      },
    });
  }

  /** Recharge la décision avec les preuves courantes. */
  reevaluate(): void { this.loadPreview(); }

  /** Renvoie décision pour le traitement ou l’affichage. */
  get decision(): GovernanceClass | null {
    return this.previewIsForCurrentProject ? (this.preview?.decision ?? null) : null;
  }

  /** Renvoie capacité pour le traitement ou l’affichage. */
  get capability(): DeploymentCapability {
    return deriveDeploymentCapability({
      previewFailed: !!this.previewError,
      deploymentConfigured: this.deploymentConfigured,
      environmentResolved: this.preview?.environment?.resolved ?? null,
      decision: this.decision,
    });
  }

  /** Décrit la capacité de déploiement disponible. */
  get capabilityInfo(): { label: string; icon: string; tone: string; detail: string } {
    return CAPABILITY_PRESENTATION[this.capability];
  }

  /** Renvoie shows déploiement action pour le traitement ou l’affichage. */
  get showsDeployAction(): boolean { return capabilityAllowsDeployAction(this.capability); }

  /** Vérifie l’état suivant : Configured. */
  get isConfigured(): boolean { return this.capability === 'DEPLOYMENT_CONFIGURED'; }
  /** Renvoie le rôle de l’utilisateur courant. */
  get role(): string { return String(this.auth.currentUser?.role || 'viewer'); }
  /** Indique si l’utilisateur possède le rôle administrateur. */
  get isAdmin(): boolean { return this.role === 'admin'; }
  /** Renvoie rôles Allowed pour courant décision pour le traitement ou l’affichage. */
  get rolesAllowedForCurrentDecision(): string[] { return this.preview?.authorizationPolicy?.rolesAllowed || []; }
  /** Vérifie si le rôle peut autoriser ce déploiement. */
  get canAuthorizeCurrentDecision(): boolean { return this.rolesAllowedForCurrentDecision.includes(this.role); }

  /** Renvoie sécurité validation libellé pour le traitement ou l’affichage. */
  securityValidationLabel(applicability: SecurityValidationApplicability | undefined | null): string {
    switch (applicability) {
      case 'MISSING': return 'Aucune validation sécurité applicable à cet artefact';
      case 'NOT_APPLICABLE': return 'Une validation existe, mais elle concerne un autre artefact/commit';
      case 'FAILED': return 'Validation sécurité échouée';
      // APPLICABLE only occurs when the WF3 validation targets this EXACT
      // artifact AND passed (see security-validation-applicability.ts) —
      // "successful" is not a separate state to check for here.
      case 'APPLICABLE': return 'Validation sécurité applicable';
      case 'AMBIGUOUS': return "Applicabilité de la validation sécurité indéterminée";
      default: return 'Validation sécurité indéterminée';
    }
  }

  /** Renvoie artefact état Presentation pour le traitement ou l’affichage. */
  get artifactStatePresentation(): { label: string; detail: string } | null {
    const art: any = this.preview?.artifact;
    if (!art || art.provenanceVerified === true) return null;
    const code = String(art.failureCode ?? '').trim();
    if (!code) return null;
    return ARTIFACT_STATE_PRESENTATION[code] ?? null;
  }
  /** Artefact pret : dit par le backend, jamais deduit d'un digest non nul. */
  get artifactReady(): boolean { return this.preview?.artifact?.provenanceVerified === true; }

  /** Prépare le libellé et la tonalité de la décision. */
  get decisionPresentation(): { label: string; icon: string; tone: string } | null {
    const d = this.decision;
    if (!d) return null;
    // Voir NOT_CONFIGURED_PRESENTATION : seul le libelle change, et seulement
    // quand l'absence de configuration est un fait connu, pas une inconnue.
    if (d === 'TECHNICALLY_IMPOSSIBLE' && this.deploymentConfigured === false) {
      return NOT_CONFIGURED_PRESENTATION;
    }
    return DECISION_PRESENTATION[d];
  }

  /** Renvoie décision tonalité classe pour le traitement ou l’affichage. */
  get decisionToneClass(): string {
    const p = this.decisionPresentation;
    return p ? `dg-tone-${p.tone}` : '';
  }

  /** Renvoie santé cible libellé pour le traitement ou l’affichage. */
  get healthTargetLabel(): string {
    const hc = this.deploymentTarget?.healthCheck;
    if (!hc || (!hc.path && !hc.port)) return 'Non disponible';
    const port = hc.port ? `:${hc.port}` : '';
    return `${port}${hc.path || ''}` || 'Non disponible';
  }

  /** Prépare le résultat lié à ou absent disponible. */
  orNotAvailable(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return 'Non disponible';
    const text = String(value).trim();
    return text.length ? text : 'Non disponible';
  }

  /** Renvoie contrôle lignes pour le traitement ou l’affichage. */
  get controlRows(): ControlRow[] {
    const p = this.preview;
    if (!p) return [];
    const rows: ControlRow[] = [
      {
        name: 'Identité du build (commit)',
        status: p.buildIdentity.resolved ? 'PASS' : 'FAIL',
        explanation: p.buildIdentity.resolved
          ? `Commit résolu : ${this.shortSha(p.buildIdentity.commitSha)}`
          : "Le commit du build principal n'a pas pu être résolu.",
        blocking: p.buildIdentity.resolved ? null : true,
      },
      ...(p.artifact.artifactIdentityProven === undefined && p.artifact.publicationSource === undefined
        ? ([{
            name: "Provenance de l'artefact",
            status: p.artifact.provenanceVerified ? 'PASS' : 'FAIL',
            explanation: p.artifact.provenanceVerified
              ? "La provenance de l'image a été prouvée pour ce commit exact. Ce backend ne distingue pas encore l'identité du code source de la provenance de la publication (QA-DEF-11)."
              : "La provenance de l'image n'est pas prouvée pour ce commit.",
            blocking: p.artifact.provenanceVerified ? null : true,
          }] as ControlRow[])
        : ([{
            name: "Identité du code source de l'artefact",
            status: p.artifact.artifactIdentityProven === undefined ? 'NOT_RUN' : p.artifact.artifactIdentityProven ? 'PASS' : 'FAIL',
            explanation: p.artifact.artifactIdentityProven === undefined
              ? "Non évalué : ce backend ne rapporte pas cette affirmation séparément."
              : p.artifact.artifactIdentityProven
                ? "Les octets de l'image ont été prouvés issus de ce commit exact."
                : "Il n'est pas prouvé que les octets de l'image proviennent de ce commit.",
            blocking: p.artifact.artifactIdentityProven === false ? true : null,
          },
          {
            name: "Provenance de la publication",
            status: p.artifact.publicationSource === undefined ? 'NOT_RUN'
              : (p.artifact.publicationSource === 'PIPELINE_VERIFIED' || p.artifact.publicationSource === 'MANUAL_ATTESTED') ? 'PASS' : 'FAIL',
            explanation: p.artifact.publicationSource === undefined
              ? "Non évalué : ce backend ne rapporte pas la provenance de publication séparément."
              : p.artifact.publicationSource === 'PIPELINE_VERIFIED'
                ? "Publication prouvée par le pipeline : reçu de poussée recoupé avec le digest confirmé par le registre."
                : p.artifact.publicationSource === 'MANUAL_ATTESTED'
                  ? "Publication attestée manuellement par un administrateur nommé — connue, mais non prouvée par un pipeline."
                  : "Publication inconnue : aucune preuve n'établit qui a publié cette image dans le registre. Distinct de l'identité du code source, qui peut être prouvée par ailleurs.",
            blocking: p.artifact.publicationSource !== undefined
              && p.artifact.publicationSource !== 'PIPELINE_VERIFIED'
              && p.artifact.publicationSource !== 'MANUAL_ATTESTED' ? true : null,
          }] as ControlRow[])),
      {
        name: 'Registre / digest immuable',
        status: p.artifact.digest ? 'PASS' : 'NOT_RUN',
        explanation: p.artifact.digest
          ? `${this.orNotAvailable(p.artifact.registry)} / ${this.orNotAvailable(p.artifact.repository)} @ ${this.shortDigest(p.artifact.digest)}`
          : "Aucun digest immuable n'a été résolu pour ce tag.",
        blocking: null,
      },
      {
        name: 'Configuration de la cible',
        status: p.environment.resolved ? 'PASS' : 'FAIL',
        explanation: p.environment.resolved
          ? `Cible : ${this.orNotAvailable(p.environment.targetName)} (${this.orNotAvailable(p.environment.region)})`
          : "La cible de déploiement Azure n'est pas résolue.",
        blocking: p.environment.resolved ? null : true,
      },
      {
        name: 'Validation sécurité (WF3)',
        status: securityValidationControlStatus(p.securityValidation.applicability),
        explanation: this.securityValidationLabel(p.securityValidation.applicability),
        blocking: null,
      },
    ];
    for (const stage of this.requiredStages || []) {
      const status = stageControlStatus(stage?.status);
      rows.push({
        name: String(stage?.stage || 'Étape'),
        status,
        explanation: `${CONTROL_STATUS_LABELS[status]}`
          + (stage?.findingCount !== null && stage?.findingCount !== undefined ? ` — ${stage.findingCount} problème(s)` : '')
          + (stage?.source ? ` — source : ${stage.source}` : ''),
        blocking: stage?.blocking === true ? true : stage?.blocking === false ? false : null,
      });
    }
    return rows;
  }

  /** Sélectionne les contrôles actuellement visibles. */
  get visibleControlRows(): ControlRow[] {
    const rows = this.controlRows;
    return this.controlsExpanded ? rows : rows.slice(0, CONTROLS_COLLAPSED_LIMIT);
  }

  /** Indique si des contrôles restent masqués. */
  get hasHiddenControls(): boolean { return this.controlRows.length > CONTROLS_COLLAPSED_LIMIT; }

  /** Bascule contrôles. */
  toggleControls(): void { this.controlsExpanded = !this.controlsExpanded; }

  /** Vérifie si l’action est autorisée : relance déploiement. */
  get canRetryDeploy(): boolean { return this.deployAmbiguous && !this.deploying && !!this.authorization; }

  /** Renvoie conditionnel désactivé motif pour le traitement ou l’affichage. */
  get conditionalDisabledReason(): string | null {
    if (this.conditionalFormValid) return null;
    if (this.conditionalReason.trim().length < MIN_MEANINGFUL_REASON_LENGTH) {
      return `Saisissez un motif d'au moins ${MIN_MEANINGFUL_REASON_LENGTH} caractères.`;
    }
    return 'Cochez la case d’acceptation des risques identifiés.';
  }

  /** Explique pourquoi la dérogation critique est désactivée. */
  get criticalDisabledReason(): string | null {
    if (this.criticalFormValid) return null;
    if (this.criticalReason.trim().length < MIN_MEANINGFUL_REASON_LENGTH) {
      return `Saisissez un motif d'au moins ${MIN_MEANINGFUL_REASON_LENGTH} caractères.`;
    }
    const acks = this.criticalAcks;
    if (!acks.criticalRiskAccepted || !acks.securityControlsMayHaveFailed || !acks.deploymentMayExposeKnownRisk) {
      return 'Cochez les trois reconnaissances de risque obligatoires.';
    }
    return 'Saisissez exactement la phrase de confirmation demandée.';
  }

  /** Abrège le SHA pour l’affichage. */
  shortSha(sha: string | null | undefined): string { return sha ? sha.slice(0, 12) : 'Non disponible'; }
  /** Abrège le digest pour l’affichage. */
  shortDigest(digest: string | null | undefined): string { return digest ? digest.replace(/^sha256:/, 'sha256:').slice(0, 19) + '…' : 'Non disponible'; }

  /** Prépare le résultat lié à submit Normal autorisation. */
  submitNormalAuthorization(): void {
    // Capability guard first: a project with no resolved deployment
    // environment can never reach an authorization, whatever the decision.
    if (!this.showsDeployAction) return;
    if (this.decision !== 'READY' || !this.canAuthorizeCurrentDecision || this.authorizing) return;
    this.runAuthorization({ mode: 'NORMAL' });
  }

  /** Ouvre conditionnel formulaire. */
  openConditionalForm(): void {
    if (!this.showsDeployAction) return;
    if (this.decision !== 'CONDITIONAL' || !this.canAuthorizeCurrentDecision) return;
    this.conditionalReason = '';
    this.conditionalAck = false;
    this.authorizeError = null;
    this.showConditionalForm = true;
    this.loadPreview();
  }
  /** Annule conditionnel formulaire. */
  cancelConditionalForm(): void { if (this.authorizing) return; this.showConditionalForm = false; }
  /** Vérifie les champs exigés pour l’autorisation conditionnelle. */
  get conditionalFormValid(): boolean {
    return this.conditionalReason.trim().length >= MIN_MEANINGFUL_REASON_LENGTH && this.conditionalAck === true;
  }
  /** Envoie l’autorisation conditionnelle avec son motif. */
  submitConditionalAuthorization(): void {
    if (!this.conditionalFormValid || this.authorizing) return;
    this.runAuthorization({
      mode: 'CONDITIONAL_EXCEPTION',
      reason: this.conditionalReason,
      acknowledgements: { conditionalRiskAccepted: true },
    });
  }

  /** Ouvre critique formulaire. */
  openCriticalForm(): void {
    if (!this.showsDeployAction) return;
    if (this.decision !== 'CRITICAL_RISK' || !this.isAdmin) return;
    this.criticalReason = '';
    this.criticalAcks = { criticalRiskAccepted: false, securityControlsMayHaveFailed: false, deploymentMayExposeKnownRisk: false };
    this.criticalPhrase = '';
    this.authorizeError = null;
    this.showCriticalForm = true;
    this.loadPreview();
  }
  /** Annule critique formulaire. */
  cancelCriticalForm(): void { if (this.authorizing) return; this.showCriticalForm = false; }
  /** Vérifie le motif et les confirmations de la dérogation critique. */
  get criticalFormValid(): boolean {
    return this.criticalReason.trim().length >= MIN_MEANINGFUL_REASON_LENGTH
      && this.criticalAcks.criticalRiskAccepted === true
      && this.criticalAcks.securityControlsMayHaveFailed === true
      && this.criticalAcks.deploymentMayExposeKnownRisk === true
      && this.criticalPhrase === CRITICAL_OVERRIDE_PHRASE;
  }
  /** Envoie la dérogation critique avec les confirmations exigées. */
  submitCriticalAuthorization(): void {
    if (!this.criticalFormValid || this.authorizing) return;
    this.runAuthorization({
      mode: 'CRITICAL_OVERRIDE',
      reason: this.criticalReason,
      acknowledgements: { ...this.criticalAcks },
      confirmationPhrase: this.criticalPhrase,
    });
  }

  /** Exécute autorisation. */
  private runAuthorization(input: { mode: AuthorizationMode; reason?: string; acknowledgements?: Record<string, boolean>; confirmationPhrase?: string }): void {
    if (this.authorizing || this.deploying || !this.projectId || !this.showsDeployAction) return;
    this.authorizing = true;
    this.authorizeError = null;
    this.deployErrorMessage = null;
    this.deployErrorCode = null;
    this.deployAttemptId = null;
    this.authorizationConsumed = false;
    this.deployPhase = 'AUTHORISING';
    this.api.authorizeDeployment(this.projectId, input).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (r: any) => {
        this.authorizing = false;
        this.showConditionalForm = false;
        this.showCriticalForm = false;
        this.authorization = { authorizationId: r.authorizationId, governanceClass: r.governanceClass, expiresAt: r.expiresAt, mode: input.mode };
        this.deployPhase = 'AUTHORIZED';
        this.deployRequestId = null;
        this.startDeploy();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (err: any) => {
        this.authorizing = false;
        this.showConditionalForm = false;
        this.showCriticalForm = false;
        this.deployPhase = 'FAILED';
        this.deployErrorCode = typeof err?.error?.error === 'string' ? err.error.error : null;
        this.authorizeError = userHttpError(err, "L'autorisation a été refusée.");
        // §11 — never resubmit automatically with the stale acknowledgements;
        // always refresh so the human re-reads the CURRENT risk first.
        this.staleNotice = 'Les conditions de déploiement ont changé. Veuillez revoir les risques.';
        this.loadPreview();
      },
    });
  }

  /** Démarre déploiement. */
  private startDeploy(): void {
    if (!this.authorization || !this.projectId || this.deploying || !this.showsDeployAction) return;
    if (!this.deployRequestId) {
      this.deployRequestId = globalThis.crypto?.randomUUID?.() || `deploy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
    this.deploying = true;
    this.deployAmbiguous = false;
    this.deployErrorMessage = null;
    this.deployErrorCode = null;
    this.deploySuccessInfo = null;
    this.deployPhase = 'DISPATCHING';
    this.api.deployGoverned(this.projectId, this.deployRequestId, this.authorization.authorizationId).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (r: any) => {
        this.deploying = false;
        // §12/§15 — an idempotent replay returns { duplicate: true, ...the
        // persisted azureDeploymentState }, which carries `status`
        // (DISPATCHING | DEPLOYED | FAILED) and NO `success` field. Reading
        // `success` here would report an actually-succeeded deployment as a
        // failure, so the duplicate envelope is handled on its own terms.
        if (r?.duplicate === true) {
          this.applyDuplicateDispatchState(r);
          return;
        }
        // §12 — HTTP 200 alone is never success. The backend only reaches
        // this branch once classifyAgentDeploymentResult() has proven
        // success === true AND healthOk === true (any other outcome is
        // raised as an error envelope). This re-check is a second, local
        // barrier so a contract change can never silently render DEPLOYED.
        if (r?.success === true && r?.healthOk === true) {
          this.deployPhase = 'DEPLOYED';
          this.deploySuccessInfo = { state: r.state, health: 'Disponible', authorizationId: r.authorizationId, artifactDigest: r.artifactDigest ?? null,
            appUrl: this.safeAppUrl(r.appUrl), portalUrl: this.safePortalUrl(r.portalUrl) };
          this.authorizationConsumed = true;
          this.toast.success('Déploiement réussi', `Conteneur ${r.state} — application disponible`);
          this.loadHistory();
          return;
        }
        this.deployPhase = 'FAILED';
        this.authorizationConsumed = true;
        this.deployErrorCode = r?.healthOk === false ? 'AGENT_HEALTH_FAILED' : 'AGENT_RESULT_INVALID';
        this.deployAttemptId = r?.attemptId ?? null;
        this.deployErrorMessage = r?.healthOk === false
          ? "Le conteneur a démarré mais le contrôle de santé de l'application a échoué — le déploiement n'est pas considéré comme réussi."
          : `Déploiement non confirmé par l'agent (état : ${this.orNotAvailable(r?.state)}).`;
        this.toast.error('Déploiement échoué', this.deployErrorMessage);
        this.loadHistory();
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: (err: any) => {
        this.deploying = false;
        const code = err?.error?.error;
        if (['DEPLOY_AUTHORIZATION_EXPIRED', 'DEPLOY_AUTHORIZATION_CONSUMED', 'DEPLOY_AUTHORIZATION_REVOKED', 'DEPLOY_AUTHORIZATION_IDENTITY_CHANGED', 'DEPLOY_AUTHORIZATION_RISK_CHANGED'].includes(code)) {
          // §14 — dead authorization: never retried automatically. A
          // brand new authorization (fresh reason/acks/phrase) is required.
          this.authorization = null;
          this.deployRequestId = null;
          this.deployPhase = 'FAILED';
          this.deployErrorCode = code;
          this.deployAttemptId = err?.error?.attemptId ?? null;
          // DEPLOY_AUTHORIZATION_CONSUMED is the one code that proves the
          // authorization was already spent; the others mean it was rejected
          // before any dispatch reservation.
          this.authorizationConsumed = code === 'DEPLOY_AUTHORIZATION_CONSUMED';
          this.deployErrorMessage = 'Autorisation expirée ou invalidée — une nouvelle autorisation est requise.';
          this.staleNotice = 'Les conditions de déploiement ont changé. Veuillez revoir les risques.';
          this.loadPreview();
        } else if (err?.status === 0 || code === undefined) {
          // §15 — ambiguous/network failure: the SAME authorizationId +
          // requestId pair is safe to resubmit (backend's own idempotent
          // duplicate:true passthrough reconciles it) — never a NEW
          // authorization just because the response was unclear.
          this.deployAmbiguous = true;
          this.deployPhase = 'FAILED';
          this.deployErrorCode = 'TRANSPORT_AMBIGUOUS';
          this.deployErrorMessage = "Réponse réseau ambiguë — l'état réel du déploiement n'a pas pu être confirmé.";
        } else {
          // §13 — a semantic dispatch failure. The backend envelope carries
          // its own failure code plus the attempt identifier, and the
          // authorization has been consumed by the dispatch either way.
          this.deployPhase = 'FAILED';
          this.deployErrorCode = typeof code === 'string' ? code : null;
          this.deployAttemptId = err?.error?.attemptId ?? null;
          this.authorizationConsumed = err?.error?.deploymentSuccess === false || !!err?.error?.attemptId;
          this.deployErrorMessage = userHttpError(err, 'Le déploiement a échoué.');
          this.toast.error('Erreur', this.deployErrorMessage);
        }
      },
    });
  }

  /** Applique Duplicate envoi état. */
  private applyDuplicateDispatchState(r: any): void {
    const status = String(r?.status || '').toUpperCase();
    this.deployAttemptId = r?.attemptId ?? null;
    this.authorizationConsumed = true;
    if (status === 'DEPLOYED') {
      this.deployPhase = 'DEPLOYED';
      this.deployAmbiguous = false;
      this.deploySuccessInfo = {
        state: this.orNotAvailable(r?.result?.state ?? status),
        health: 'Disponible',
        authorizationId: r?.authorizationId ?? this.authorization?.authorizationId ?? '',
        artifactDigest: r?.result?.artifactDigest ?? null,
        appUrl: this.safeAppUrl(r?.result?.appUrl), portalUrl: this.safePortalUrl(r?.result?.portalUrl),
      };
      this.toast.success('Déploiement déjà confirmé', 'Cette requête avait déjà abouti — état réconcilié.');
      return;
    }
    if (status === 'DISPATCHING') {
      // Still in flight on the backend: neither success nor failure yet.
      this.deployPhase = 'DISPATCHING';
      this.deployAmbiguous = true;
      this.deployErrorMessage = "Un déploiement est déjà en cours pour cette requête — état non encore terminal.";
      return;
    }
    this.deployPhase = 'FAILED';
    this.deployAmbiguous = false;
    this.deployErrorCode = typeof r?.failureCode === 'string' ? r.failureCode : null;
    this.deployErrorMessage = r?.failureReason
      ? String(r.failureReason)
      : `Le déploiement précédent pour cette requête a échoué (état : ${this.orNotAvailable(r?.status)}).`;
    this.toast.error('Déploiement échoué', this.deployErrorMessage);
  }

  /** Relance Ambiguous déploiement. */
  retryAmbiguousDeploy(): void {
    if (!this.canRetryDeploy) return;
    this.startDeploy();
  }
}
