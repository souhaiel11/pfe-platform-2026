// Phase 2B.3 — governance frontend tests (F1-F12, API trust §20-21).
// Same convention as the rest of this directory: loads the REAL
// deployment-governance.component.ts through the TypeScript compiler API
// inside a VM sandbox (no Angular TestBed), exercises its real methods,
// and checks the real .html template text for the required bindings.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFrontend } from './security-lifecycle-test-loader.mjs';

// VM sandbox objects live in a different realm — their prototype differs
// from this script's own Object.prototype, so assert.deepEqual (strict)
// would fail on structurally-identical objects. Round-tripping through
// JSON normalizes both sides to this realm's plain objects (same fix
// already used elsewhere in this directory, see stuck-remediation-ux.spec.mjs).
const plain = v => JSON.parse(JSON.stringify(v));
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const componentSource = read('../src/app/features/projects/deployment-governance.component.ts');
const template = read('../src/app/features/projects/deployment-governance.component.html');
const apiServiceSource = read('../src/app/core/services/api.service.ts');
const projectDetailSource = read('../src/app/features/projects/project-detail.component.ts');
const projectDetailTemplate = read('../src/app/features/projects/project-detail.component.html');

const mod = loadFrontend('../src/app/features/projects/deployment-governance.component.ts', {
  '../../core/http-error-message': { userHttpError: (err, fallback) => err?.error?.message || fallback },
});
const { DeploymentGovernanceComponent, CRITICAL_OVERRIDE_PHRASE } = mod;
assert.equal(CRITICAL_OVERRIDE_PHRASE, 'DEPLOYER MALGRÉ LES RISQUES');

function observableFactory(calls, kind) {
  return (...args) => ({ subscribe: observer => { calls.push({ kind, args, observer }); return observer; } });
}

function freshComponent(role = 'admin') {
  const c = Object.create(DeploymentGovernanceComponent.prototype);
  c.projectId = 'proj-1';
  c.preview = null; c.previewLoading = false; c.previewError = null;
  c.authorization = null; c.authorizing = false; c.authorizeError = null; c.staleNotice = null;
  c.deployRequestId = null; c.deploying = false; c.deployAmbiguous = false;
  c.deployErrorMessage = null; c.deploySuccessInfo = null;
  // New fields (§5/§11/§13) — Object.create() skips class field initialisers,
  // so the sandbox instance must mirror the declared defaults exactly.
  c.deployPhase = 'IDLE'; c.deployErrorCode = null; c.deployAttemptId = null;
  c.authorizationConsumed = false; c.controlsExpanded = false; c.requiredStages = null;
  // Multi-project fields (§7/§23). Object.create() skips class field
  // initialisers, so the sandbox instance mirrors the declared defaults.
  c.loadGeneration = 0; c.loadedForProjectId = null;
  c.deploymentConfigured = true; c.deploymentTarget = null;
  c.projectName = null; c.sourceEvidence = null; c.sourceEvidenceSections = null;
  c.showConditionalForm = false; c.conditionalReason = ''; c.conditionalAck = false;
  c.showCriticalForm = false; c.criticalReason = ''; c.criticalPhrase = '';
  c.criticalAcks = { criticalRiskAccepted: false, securityControlsMayHaveFailed: false, deploymentMayExposeKnownRisk: false };
  c.toast = { success() {}, error() {} };
  c.auth = { currentUser: { role } };
  c.calls = [];
  c.api = {
    getGovernancePreview: observableFactory(c.calls, 'preview'),
    authorizeDeployment: observableFactory(c.calls, 'authorize'),
    deployGoverned: observableFactory(c.calls, 'deploy'),
  };
  return c;
}

const PREVIEW_READY = {
  projectId: 'proj-1', incidentId: 'inc-1', mainBuildNumber: 5, decision: 'READY',
  buildIdentity: { resolved: true, commitSha: 'a'.repeat(40) },
  artifact: { provenanceVerified: true, digest: 'sha256:' + '1'.repeat(64), registry: 'r', repository: 'repo', tag: '5' },
  environment: { resolved: true, identityHash: 'h', targetName: 't', region: 'reg' },
  securityValidation: { applicability: 'APPLICABLE', status: 'APPLICABLE' },
  failedControls: [], warnings: [],
  authorizationPolicy: { requiredMode: 'NORMAL', rolesAllowed: ['admin', 'developer'], adminRequired: false, reasonRequired: false, acknowledgementRequirements: [], confirmationPhraseRequired: false },
};
const PREVIEW_CONDITIONAL = {
  ...PREVIEW_READY, decision: 'CONDITIONAL', warnings: ['zap: WARNING'],
  authorizationPolicy: { requiredMode: 'CONDITIONAL_EXCEPTION', rolesAllowed: ['admin', 'developer'], adminRequired: false, reasonRequired: true, acknowledgementRequirements: ['conditionalRiskAccepted'], confirmationPhraseRequired: false },
};
// Real build #150 fixture (§19): project pfe-app-test, CRITICAL_RISK,
// securityValidation MISSING.
const PREVIEW_CRITICAL_150 = {
  projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', incidentId: 'a657d5ae-fbe0-47cb-b954-451bd81636aa', mainBuildNumber: 150, decision: 'CRITICAL_RISK',
  buildIdentity: { resolved: true, commitSha: '7ae0f954f99628b69ce9b42f42c1e2acc8568d99' },
  artifact: { provenanceVerified: true, digest: 'sha256:2027f8ed1c023e8d34e30e5848a3ed780831b8e52945543bd00f7c3ed521718d', registry: 'acrpfedevsecops', repository: 'pfe-app-test', tag: '150' },
  environment: { resolved: true, identityHash: 'h150', targetName: 'aci-pfe-app-test', region: 'francecentral' },
  securityValidation: { applicability: 'MISSING', status: 'MISSING' },
  failedControls: ['Validation de sécurité WF3 absente'], warnings: [],
  authorizationPolicy: { requiredMode: 'CRITICAL_OVERRIDE', rolesAllowed: ['admin'], adminRequired: true, reasonRequired: true, acknowledgementRequirements: ['criticalRiskAccepted', 'securityControlsMayHaveFailed', 'deploymentMayExposeKnownRisk'], confirmationPhraseRequired: true },
};
const PREVIEW_IMPOSSIBLE = {
  ...PREVIEW_READY, decision: 'TECHNICALLY_IMPOSSIBLE', failedControls: ['Identité de build non résolue (DEPLOY_COMMIT_MISSING)'],
  authorizationPolicy: { requiredMode: null, rolesAllowed: [], adminRequired: false, reasonRequired: false, acknowledgementRequirements: [], confirmationPhraseRequired: false },
};

// ── F1 — READY → normal authorize + deploy flow ──────────────────────
{
  const c = freshComponent('developer');
  c.ngOnInit();
  assert.equal(c.calls[0].kind, 'preview');
  c.calls[0].observer.next(PREVIEW_READY);
  assert.equal(c.decision, 'READY');
  assert.equal(c.canAuthorizeCurrentDecision, true);
  c.submitNormalAuthorization();
  assert.equal(c.calls[1].kind, 'authorize');
  assert.deepEqual(plain(c.calls[1].args[1]), { mode: 'NORMAL' });
  c.calls[1].observer.next({ authorizationId: 'auth-1', governanceClass: 'READY', expiresAt: '2026-01-01T00:00:00Z' });
  assert.equal(c.authorization.authorizationId, 'auth-1');
  assert.equal(c.calls[2].kind, 'deploy');
  assert.deepEqual(plain(c.calls[2].args), ['proj-1', c.deployRequestId, 'auth-1']);
  assert.ok(c.deployRequestId);
  c.calls[2].observer.next({ success: true, state: 'Running', healthOk: true, authorizationId: 'auth-1', artifactDigest: PREVIEW_READY.artifact.digest });
  assert.ok(c.deploySuccessInfo);
  assert.equal(c.deploySuccessInfo.state, 'Running');
  console.log('F1 PASS');
}

// ── F2 — CONDITIONAL → reason + checkbox required ────────────────────
{
  const c = freshComponent('developer');
  c.ngOnInit(); c.calls[0].observer.next(PREVIEW_CONDITIONAL);
  c.openConditionalForm();
  assert.equal(c.calls[1].kind, 'preview', 'opening the form must re-fetch a fresh preview (§10)');
  c.calls[1].observer.next(PREVIEW_CONDITIONAL);
  assert.equal(c.showConditionalForm, true);
  assert.equal(c.conditionalFormValid, false);
  c.submitConditionalAuthorization();
  assert.equal(c.calls.length, 2, 'invalid form must never call authorize');
  c.conditionalReason = 'short';
  assert.equal(c.conditionalFormValid, false, 'reason under 10 chars is not meaningful');
  c.conditionalReason = 'motif suffisamment détaillé';
  assert.equal(c.conditionalFormValid, false, 'checkbox still unchecked');
  c.conditionalAck = true;
  assert.equal(c.conditionalFormValid, true);
  c.submitConditionalAuthorization();
  assert.equal(c.calls[2].kind, 'authorize');
  assert.deepEqual(plain(c.calls[2].args[1]), { mode: 'CONDITIONAL_EXCEPTION', reason: 'motif suffisamment détaillé', acknowledgements: { conditionalRiskAccepted: true } });
  console.log('F2 PASS');
}

// ── F3 — CRITICAL developer → no override action ─────────────────────
{
  const c = freshComponent('developer');
  c.ngOnInit(); c.calls[0].observer.next(PREVIEW_CRITICAL_150);
  assert.equal(c.isAdmin, false);
  assert.equal(c.canAuthorizeCurrentDecision, false, 'rolesAllowed=[admin] must exclude developer');
  c.openCriticalForm();
  assert.equal(c.showCriticalForm, false);
  assert.equal(c.calls.length, 1, 'developer must never trigger a critical-form preview reload or authorize call');
  console.log('F3 PASS');
}

// ── F4 — CRITICAL admin without reason → blocked ──────────────────────
{
  const c = freshComponent('admin');
  c.ngOnInit(); c.calls[0].observer.next(PREVIEW_CRITICAL_150);
  c.openCriticalForm(); c.calls[1].observer.next(PREVIEW_CRITICAL_150);
  c.criticalAcks = { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true };
  c.criticalPhrase = CRITICAL_OVERRIDE_PHRASE;
  assert.equal(c.criticalFormValid, false, 'empty reason must block, even with acks+phrase correct');
  c.submitCriticalAuthorization();
  assert.equal(c.calls.length, 2, 'blocked submit must never call authorize');
  console.log('F4 PASS');
}

// ── F5 — CRITICAL admin missing one acknowledgement → blocked ────────
{
  const c = freshComponent('admin');
  c.ngOnInit(); c.calls[0].observer.next(PREVIEW_CRITICAL_150);
  c.openCriticalForm(); c.calls[1].observer.next(PREVIEW_CRITICAL_150);
  c.criticalReason = 'ship despite known risk, approved verbally';
  c.criticalPhrase = CRITICAL_OVERRIDE_PHRASE;
  c.criticalAcks = { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: false };
  assert.equal(c.criticalFormValid, false, 'any one of the three acknowledgements missing must block');
  c.submitCriticalAuthorization();
  assert.equal(c.calls.length, 2);
  console.log('F5 PASS');
}

// ── F6 — CRITICAL admin wrong typed phrase → blocked ──────────────────
{
  const c = freshComponent('admin');
  c.ngOnInit(); c.calls[0].observer.next(PREVIEW_CRITICAL_150);
  c.openCriticalForm(); c.calls[1].observer.next(PREVIEW_CRITICAL_150);
  c.criticalReason = 'ship despite known risk, approved verbally';
  c.criticalAcks = { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true };
  c.criticalPhrase = 'deployer malgré les risques'; // wrong case
  assert.equal(c.criticalFormValid, false, 'phrase must match EXACTLY, case included');
  c.criticalPhrase = 'DEPLOYER MALGRE LES RISQUES'; // missing accent
  assert.equal(c.criticalFormValid, false);
  c.submitCriticalAuthorization();
  assert.equal(c.calls.length, 2);
  console.log('F6 PASS');
}

// ── F7 — CRITICAL admin complete → authorize request correct ─────────
{
  const c = freshComponent('admin');
  c.ngOnInit(); c.calls[0].observer.next(PREVIEW_CRITICAL_150);
  c.openCriticalForm(); c.calls[1].observer.next(PREVIEW_CRITICAL_150);
  c.criticalReason = 'ship despite known risk, approved verbally';
  c.criticalAcks = { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true };
  c.criticalPhrase = CRITICAL_OVERRIDE_PHRASE;
  assert.equal(c.criticalFormValid, true);
  c.submitCriticalAuthorization();
  assert.equal(c.calls[2].kind, 'authorize');
  assert.deepEqual(plain(c.calls[2].args[1]), {
    mode: 'CRITICAL_OVERRIDE', reason: 'ship despite known risk, approved verbally',
    acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
    confirmationPhrase: CRITICAL_OVERRIDE_PHRASE,
  });
  c.calls[2].observer.next({ authorizationId: 'auth-150', governanceClass: 'CRITICAL_RISK', expiresAt: '2026-01-01T00:15:00Z' });
  assert.equal(c.calls[3].kind, 'deploy', 'a successful critical override authorization must also proceed to deploy');
  console.log('F7 PASS');
}

// ── F8 — TECHNICALLY_IMPOSSIBLE → no deploy action, even for admin ───
{
  const c = freshComponent('admin');
  c.ngOnInit(); c.calls[0].observer.next(PREVIEW_IMPOSSIBLE);
  c.submitNormalAuthorization();
  c.openConditionalForm();
  c.openCriticalForm();
  assert.equal(c.calls.length, 1, 'no action of any kind may fire for TECHNICALLY_IMPOSSIBLE, admin included');
  assert.equal(c.authorization, null);
  console.log('F8 PASS');
}

// ── F9 — stale preview / authorization rejection → preview refresh ───
{
  const c = freshComponent('developer');
  c.ngOnInit(); c.calls[0].observer.next(PREVIEW_READY);
  c.submitNormalAuthorization();
  c.calls[1].observer.error({ status: 409, error: { error: 'DEPLOY_AUTHORIZATION_MODE_MISMATCH', message: 'Décision CRITICAL_RISK requiert CRITICAL_OVERRIDE.', governanceClass: 'CRITICAL_RISK' } });
  assert.ok(c.authorizeError);
  assert.equal(c.staleNotice, 'Les conditions de déploiement ont changé. Veuillez revoir les risques.');
  assert.equal(c.authorization, null);
  assert.equal(c.calls[2].kind, 'preview', 'a denied authorization must trigger a fresh preview fetch');
  console.log('F9 PASS');
}

// ── F10 — expired authorization → no automatic deploy retry ──────────
{
  const c = freshComponent('developer');
  c.ngOnInit(); c.calls[0].observer.next(PREVIEW_READY);
  c.submitNormalAuthorization();
  c.calls[1].observer.next({ authorizationId: 'auth-2', governanceClass: 'READY', expiresAt: '2026-01-01T00:00:00Z' });
  assert.equal(c.calls[2].kind, 'deploy');
  const requestIdBefore = c.deployRequestId;
  c.calls[2].observer.error({ status: 409, error: { error: 'DEPLOY_AUTHORIZATION_EXPIRED', message: 'Autorisation expirée.' } });
  assert.equal(c.authorization, null, 'expired authorization must be cleared');
  assert.equal(c.deployRequestId, null, 'requestId must be cleared too — a new authorization needs a new deploy attempt');
  assert.equal(c.deploying, false);
  assert.equal(c.calls[3].kind, 'preview', 'must refresh governance preview, never auto-retry deploy');
  assert.equal(c.calls.length, 4, 'no automatic deploy retry was fired');
  console.log('F10 PASS');
}

// ── F11 — double click → one deploy request ───────────────────────────
{
  const c = freshComponent('developer');
  // A configured, READY project — startDeploy() is now additionally gated on
  // the deployment capability (§7), so the preview must be loaded first.
  c.ngOnInit();
  c.calls[0].observer.next(PREVIEW_READY);
  assert.equal(c.showsDeployAction, true);
  const base = c.calls.length;
  c.authorization = { authorizationId: 'auth-3', governanceClass: 'READY', expiresAt: '2026-01-01T00:00:00Z', mode: 'NORMAL' };
  c['startDeploy']();
  assert.equal(c.calls.length - base, 1);
  assert.equal(c.deploying, true);
  c['startDeploy'](); // second "click" while the first is still in flight
  assert.equal(c.calls.length - base, 1, 'a second deploy call must never fire while one is already in flight');
  console.log('F11 PASS');
}

// ── F12 — governed flow never uses legacy no-authorization deploy ────
{
  assert.doesNotMatch(componentSource, /deployToAzure/, 'the removed legacy method must not be referenced');
  assert.match(componentSource, /deployGoverned\(this\.projectId, this\.deployRequestId, this\.authorization\.authorizationId\)/, 'the only deploy call site must always pass authorizationId');
  assert.doesNotMatch(projectDetailSource, /deployToAzure|requestDeployConfirmation|cancelDeployConfirmation/, 'project-detail must no longer contain the legacy direct-deploy flow');
  assert.doesNotMatch(projectDetailTemplate, /deployToAzure|requestDeployConfirmation/, 'project-detail template must no longer wire the legacy deploy button');
  assert.match(projectDetailTemplate, /<app-deployment-governance\s+\[projectId\]="id"/, 'project-detail must embed the new governed component');
  assert.match(projectDetailTemplate, /\[requiredStages\]="deployReadiness\?\.requiredStages \|\| null"/, '§5 — backend stage list must be passed down, never re-derived');
  assert.match(apiServiceSource, /deployGoverned\(projectId: string, requestId: string, authorizationId: string\)/, 'the only azure-deploy/deploy-calling method kept must require authorizationId');
  assert.doesNotMatch(apiServiceSource, /deployToAzure/, 'legacy imageTag-only deploy method must be removed from ApiService');
  console.log('F12 PASS');
}

// ── §21 — API trust: no authoritative/trusted field ever sent ────────
{
  const forbidden = ['decision', 'commitSha', 'artifactDigest', 'riskSnapshot', 'failedControls', 'environmentIdentityHash'];
  const c = freshComponent('admin');
  c.ngOnInit(); c.calls[0].observer.next(PREVIEW_CRITICAL_150);
  c.openCriticalForm(); c.calls[1].observer.next(PREVIEW_CRITICAL_150);
  c.criticalReason = 'ship despite known risk, approved verbally';
  c.criticalAcks = { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true };
  c.criticalPhrase = CRITICAL_OVERRIDE_PHRASE;
  c.submitCriticalAuthorization();
  const authorizeBody = c.calls[2].args[1];
  for (const field of forbidden) assert.equal(Object.prototype.hasOwnProperty.call(authorizeBody, field), false, `authorize body must never carry "${field}"`);
  c.calls[2].observer.next({ authorizationId: 'auth-150', governanceClass: 'CRITICAL_RISK', expiresAt: '2026-01-01T00:15:00Z' });
  const deployArgs = c.calls[3].args; // [projectId, requestId, authorizationId]
  assert.equal(deployArgs.length, 3, 'deployGoverned must be called with exactly projectId/requestId/authorizationId — nothing else');
  assert.doesNotMatch(componentSource, /this\.api\.(authorizeDeployment|deployGoverned)\([^)]*\b(commitSha|artifactDigest|riskSnapshot|failedControls|environmentIdentityHash|decision)\b/, 'no forbidden field must ever be threaded into an authorize/deploy call site');
  assert.doesNotMatch(componentSource, /(localStorage|sessionStorage)\s*\.\s*(setItem|getItem)/, '§12 — the held authorization must never be persisted to browser storage');
  console.log('API_TRUST_TESTS PASS');
}

// ── §19 — real build #150 fixture rendering expectations ─────────────
{
  const c = freshComponent('developer');
  c.ngOnInit(); c.calls[0].observer.next(PREVIEW_CRITICAL_150);
  assert.equal(c.decision, 'CRITICAL_RISK');
  assert.deepEqual(c.preview.failedControls, ['Validation de sécurité WF3 absente']);
  assert.equal(c.canAuthorizeCurrentDecision, false, 'developer must not be able to authorize the real #150 critical override');
  assert.equal(c.securityValidationLabel(c.preview.securityValidation.applicability), 'Aucune validation sécurité applicable à cet artefact');
  const admin = freshComponent('admin');
  admin.ngOnInit(); admin.calls[0].observer.next(PREVIEW_CRITICAL_150);
  assert.equal(admin.isAdmin, true);
  console.log('REAL_150_FRONTEND_FIXTURE PASS');
}

// ── §9 — security validation wording, all five values ─────────────────
{
  const c = freshComponent('admin');
  assert.equal(c.securityValidationLabel('MISSING'), 'Aucune validation sécurité applicable à cet artefact');
  assert.equal(c.securityValidationLabel('NOT_APPLICABLE'), 'Une validation existe, mais elle concerne un autre artefact/commit');
  assert.equal(c.securityValidationLabel('FAILED'), 'Validation sécurité échouée');
  assert.equal(c.securityValidationLabel('APPLICABLE'), 'Validation sécurité applicable');
  assert.doesNotMatch(c.securityValidationLabel('NOT_APPLICABLE'), /corromp/i, 'NOT_APPLICABLE must never be worded as commit corruption');
  console.log('SECURITY_VALIDATION_WORDING PASS');
}

// ── Template assertions — the four states, identity panel, critical
// form fields, and the exact phrase are all actually wired in markup ──
{
  assert.match(template, /decisionPresentation\.icon/, '§4 — status card must render an icon');
  assert.match(template, /decisionPresentation\.label/, '§4 — status card must render the text label');
  assert.match(template, /nonOverridableNotice/, '§9 — the non-overridable notice must be rendered');
  assert.match(componentSource, /Ce blocage ne peut pas être contourné par une acceptation de risque\./, '§9 — exact sentence');
  assert.match(template, /Déploiement critique réservé aux administrateurs/);
  assert.match(template, /Déployer sur Azure/, '§6 — exact primary action label');
  assert.match(template, /Autoriser et déployer/, '§7 — exact conditional action label');
  assert.match(template, /Forcer le déploiement/, '§8 — exact critical action label');
  assert.match(template, /J’accepte les risques identifiés\./, '§7 — exact acceptance wording');
  assert.match(template, /Voir tous les contrôles/, '§5 — expandable control list');
  assert.match(template, /role="dialog"[\s\S]*?aria-modal="true"/, '§17 — accessible modal semantics');
  assert.match(template, /criticalAcks\.criticalRiskAccepted/);
  assert.match(template, /criticalAcks\.securityControlsMayHaveFailed/);
  assert.match(template, /criticalAcks\.deploymentMayExposeKnownRisk/);
  assert.match(template, /\[\(ngModel\)\]="criticalPhrase"/);
  assert.doesNotMatch(template, /value="DEPLOYER MALGRÉ LES RISQUES"/, 'the phrase must never be pre-filled as a default value');
  assert.match(template, /autocomplete="off"/);
  assert.match(template, /preview\.artifact\.digest/);
  assert.match(template, /preview\.buildIdentity\.commitSha/);
  console.log('TEMPLATE_WIRING PASS');
}


// Reaches a held authorization + dispatch in flight, so the deploy response
// handling can be exercised directly. Returns the deploy call.
function dispatched(role = 'developer', preview = PREVIEW_READY) {
  const c = freshComponent(role);
  c.ngOnInit();
  c.calls[0].observer.next(preview);
  c.submitNormalAuthorization();
  c.calls[1].observer.next({ authorizationId: 'auth-1', governanceClass: preview.decision, expiresAt: '2026-01-01T00:00:00Z' });
  return c;
}

// ── F13 — §12: HTTP 200 with success=false is NEVER rendered as deployed ──
{
  const c = dispatched();
  assert.equal(c.deployPhase, 'DISPATCHING');
  c.calls[2].observer.next({ success: false, state: 'Terminated', healthOk: true });
  assert.equal(c.deploySuccessInfo, null, 'success=false must never produce a success panel');
  assert.equal(c.deployPhase, 'FAILED');
  assert.ok(c.deployErrorMessage);
  console.log('F13 PASS');
}

// ── F14 — §12: HTTP 200 with healthOk=false is NEVER deployed ─────────
{
  const c = dispatched();
  c.calls[2].observer.next({ success: true, state: 'Running', healthOk: false, authorizationId: 'auth-1' });
  assert.equal(c.deploySuccessInfo, null, 'healthOk=false must never produce a success panel');
  assert.equal(c.deployPhase, 'FAILED');
  assert.equal(c.deployErrorCode, 'AGENT_HEALTH_FAILED');
  assert.match(c.deployErrorMessage, /santé/i);
  assert.equal(c.authorizationConsumed, true, 'dispatch consumed the authorization');
  console.log('F14 PASS');
}

// ── F15 — §12/§15: an idempotent replay that already DEPLOYED must be
//         reconciled as success, never reported as a failure. The duplicate
//         envelope carries `status`, never `success`. ───────────────────
{
  const c = dispatched();
  c.calls[2].observer.next({
    duplicate: true, requestId: c.deployRequestId, attemptId: 'attempt-9',
    authorizationId: 'auth-1', status: 'DEPLOYED', imageTag: '5',
    result: { success: true, healthOk: true, state: 'Running', artifactDigest: PREVIEW_READY.artifact.digest },
  });
  assert.equal(c.deployPhase, 'DEPLOYED');
  assert.ok(c.deploySuccessInfo, 'a duplicate DEPLOYED replay must reconcile to success');
  assert.equal(c.deploySuccessInfo.state, 'Running');
  assert.equal(c.deployErrorMessage, null);
  assert.equal(c.deployAttemptId, 'attempt-9');
  assert.equal(c.deployAmbiguous, false);
  console.log('F15 PASS');
}

// ── F16 — §12: a duplicate replay that FAILED stays a failure, with the
//         backend's own persisted failure code. ───────────────────────
{
  const c = dispatched();
  c.calls[2].observer.next({
    duplicate: true, requestId: c.deployRequestId, attemptId: 'attempt-10',
    status: 'FAILED', failureCode: 'AGENT_HEALTH_FAILED', failureReason: 'Le contrôle de santé a échoué',
  });
  assert.equal(c.deployPhase, 'FAILED');
  assert.equal(c.deploySuccessInfo, null);
  assert.equal(c.deployErrorCode, 'AGENT_HEALTH_FAILED');
  assert.equal(c.canRetryDeploy, false, 'a terminal duplicate failure is not a transport ambiguity');
  console.log('F16 PASS');
}

// ── F17 — §11: a duplicate replay still DISPATCHING is neither success
//         nor failure. ────────────────────────────────────────────────
{
  const c = dispatched();
  c.calls[2].observer.next({ duplicate: true, requestId: c.deployRequestId, attemptId: 'attempt-11', status: 'DISPATCHING' });
  assert.equal(c.deployPhase, 'DISPATCHING');
  assert.equal(c.deploySuccessInfo, null);
  console.log('F17 PASS');
}

// ── F18 — §13: a semantic dispatch failure surfaces code, attempt id and
//         whether the authorization was consumed — never a stack trace. ─
{
  const c = dispatched();
  c.calls[2].observer.error({ status: 502, error: {
    success: false, error: 'AGENT_DEPLOYMENT_FAILED', message: 'Le conteneur ne fonctionne pas',
    deploymentSuccess: false, attemptId: 'attempt-12', authorizationId: 'auth-1', requestId: c.deployRequestId,
  } });
  assert.equal(c.deployPhase, 'FAILED');
  assert.equal(c.deployErrorCode, 'AGENT_DEPLOYMENT_FAILED');
  assert.equal(c.deployAttemptId, 'attempt-12');
  assert.equal(c.authorizationConsumed, true);
  assert.equal(c.deploySuccessInfo, null);
  assert.doesNotMatch(c.deployErrorMessage, /at .*\(|Error:|stack/i, 'no stack trace may reach the UI');
  console.log('F18 PASS');
}

// ── F19 — §15: governance API failure offers no deployment action ─────
{
  const c = freshComponent('admin');
  c.ngOnInit();
  c.calls[0].observer.error({ status: 500 });
  assert.equal(c.preview, null, 'a failed governance call must never leave a usable decision');
  assert.equal(c.decision, null);
  assert.ok(c.previewError);
  assert.equal(c.previewLoading, false);
  assert.equal(c.controlRows.length, 0, 'no controls may be invented without a preview');
  console.log('F19 PASS');
}

// ── F20 — §5: control statuses are faithful; NOT_RUN/UNKNOWN are never
//         promoted to PASS, and blocking semantics come from the backend. ─
{
  assert.equal(mod.stageControlStatus('SUCCESS'), 'PASS');
  assert.equal(mod.stageControlStatus('FAILURE'), 'FAIL');
  assert.equal(mod.stageControlStatus('UNSTABLE'), 'WARNING');
  assert.equal(mod.stageControlStatus('NOT_RUN'), 'NOT_RUN');
  assert.equal(mod.stageControlStatus('SKIPPED'), 'NOT_RUN');
  assert.equal(mod.stageControlStatus(undefined), 'UNKNOWN');
  assert.equal(mod.stageControlStatus('something-new'), 'UNKNOWN');
  assert.equal(mod.securityValidationControlStatus('APPLICABLE'), 'PASS');
  assert.equal(mod.securityValidationControlStatus('MISSING'), 'NOT_RUN');
  assert.equal(mod.securityValidationControlStatus('NOT_APPLICABLE'), 'NOT_RUN');
  assert.equal(mod.securityValidationControlStatus('FAILED'), 'FAIL');
  assert.equal(mod.securityValidationControlStatus('AMBIGUOUS'), 'UNKNOWN');

  const c = freshComponent('admin');
  c.ngOnInit();
  c.calls[0].observer.next(PREVIEW_CRITICAL_150);
  c.requiredStages = [
    { stage: 'Trivy', status: 'NOT_RUN', blocking: true, required: true, source: 'Trivy', findingCount: 0 },
    { stage: 'SonarQube', status: 'SUCCESS', blocking: false, required: true, source: 'Sonar', findingCount: 3 },
    { stage: 'ZAP', status: 'mystery-state', source: 'ZAP' },
  ];
  const rows = c.controlRows;
  const byName = n => rows.find(r => r.name === n);
  assert.equal(byName('Trivy').status, 'NOT_RUN');
  assert.equal(byName('Trivy').blocking, true);
  assert.equal(byName('SonarQube').status, 'PASS');
  assert.equal(byName('SonarQube').blocking, false);
  assert.equal(byName('ZAP').status, 'UNKNOWN');
  assert.equal(byName('ZAP').blocking, null, 'absent blocking semantics must stay null, never invented');
  // securityValidation MISSING on this fixture must not read as a pass
  assert.equal(byName('Validation sécurité (WF3)').status, 'NOT_RUN');
  assert.ok(!rows.some(r => r.status === 'PASS' && /Trivy|ZAP/.test(r.name)));
  // §5 disclosure
  assert.equal(c.hasHiddenControls, true);
  assert.equal(c.visibleControlRows.length, mod.CONTROLS_COLLAPSED_LIMIT);
  c.toggleControls();
  assert.equal(c.visibleControlRows.length, rows.length);
  console.log('F20 PASS');
}

// ── F21 — §7/§8: double submission of an authorization is impossible ───
{
  const c = freshComponent('developer');
  c.ngOnInit(); c.calls[0].observer.next(PREVIEW_CONDITIONAL);
  c.openConditionalForm();
  c.conditionalReason = 'Exception acceptée pour la démonstration';
  c.conditionalAck = true;
  assert.equal(c.conditionalFormValid, true);
  const before = c.calls.length;
  c.submitConditionalAuthorization();
  c.submitConditionalAuthorization();
  c.submitConditionalAuthorization();
  assert.equal(c.calls.length - before, 1, 'only one authorize request may be issued');

  const a = freshComponent('admin');
  a.ngOnInit(); a.calls[0].observer.next(PREVIEW_CRITICAL_150);
  a.openCriticalForm();
  a.criticalReason = 'Dérogation critique justifiée pour la soutenance';
  a.criticalAcks = { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true };
  a.criticalPhrase = CRITICAL_OVERRIDE_PHRASE;
  assert.equal(a.criticalFormValid, true);
  const aBefore = a.calls.length;
  a.submitCriticalAuthorization();
  a.submitCriticalAuthorization();
  assert.equal(a.calls.length - aBefore, 1, 'only one critical authorize request may be issued');
  console.log('F21 PASS');
}

// ── F22 — §10/§13: a dead authorization offers no retry at all; only a
//         transport ambiguity may be retried, with the same pair. ──────
{
  const dead = dispatched();
  dead.calls[2].observer.error({ status: 409, error: { error: 'DEPLOY_AUTHORIZATION_CONSUMED' } });
  assert.equal(dead.authorization, null, 'a consumed authorization must be dropped');
  assert.equal(dead.canRetryDeploy, false, 'no retry without a fresh authorization');
  assert.equal(dead.authorizationConsumed, true);
  assert.ok(dead.staleNotice);

  const ambiguous = dispatched();
  const reqId = ambiguous.deployRequestId;
  const authId = ambiguous.authorization.authorizationId;
  ambiguous.calls[2].observer.error({ status: 0 });
  assert.equal(ambiguous.deployAmbiguous, true);
  assert.equal(ambiguous.canRetryDeploy, true);
  ambiguous.retryAmbiguousDeploy();
  const retry = ambiguous.calls[ambiguous.calls.length - 1];
  assert.equal(retry.kind, 'deploy');
  assert.deepEqual(plain(retry.args), ['proj-1', reqId, authId], 'retry must reuse the SAME requestId and authorizationId');
  console.log('F22 PASS');
}

// ── F23 — §3: absent identity values read "Non disponible", never
//         fabricated or rendered as "?" ──────────────────────────────
{
  const c = freshComponent('admin');
  assert.equal(c.orNotAvailable(null), 'Non disponible');
  assert.equal(c.orNotAvailable(undefined), 'Non disponible');
  assert.equal(c.orNotAvailable('   '), 'Non disponible');
  assert.equal(c.orNotAvailable('acrpfedevsecops'), 'acrpfedevsecops');
  assert.equal(c.shortDigest(null), 'Non disponible');
  assert.equal(c.shortSha(null), 'Non disponible');
  assert.doesNotMatch(template, /\|\| '\?'/, 'identity fields must not fall back to "?"');
  assert.match(template, /Groupe de ressources/, '§3 — resource group row present');
  assert.match(template, /Environnement/, '§3 — environment row present');
  console.log('F23 PASS');
}

// ── F24 — §4: every governance class has an icon AND a text label, and
//         the required exact wording. ──────────────────────────────────
{
  const P = mod.DECISION_PRESENTATION;
  assert.equal(P.READY.label, 'Prêt au déploiement');
  assert.equal(P.CONDITIONAL.label, 'Déploiement conditionnel');
  assert.equal(P.CRITICAL_RISK.label, 'Risque critique');
  assert.equal(P.TECHNICALLY_IMPOSSIBLE.label, 'Déploiement techniquement impossible');
  for (const k of Object.keys(P)) {
    assert.ok(P[k].icon && P[k].icon.length, `${k} must carry an icon`);
    assert.ok(P[k].label && P[k].label.length, `${k} must carry a text label`);
  }
  const c = freshComponent('admin');
  c.ngOnInit(); c.calls[0].observer.next(PREVIEW_IMPOSSIBLE);
  assert.equal(c.decisionPresentation.label, 'Déploiement techniquement impossible');
  console.log('F24 PASS');
}

// ── F25 — §14: deployment history is deferred, never faked client-side ─
{
  assert.equal(mod.DEPLOYMENT_HISTORY_UI_DEFERRED, true);
  assert.doesNotMatch(apiServiceSource, /azure-deploy\/(attempts|history)/, 'no invented history endpoint');
  assert.doesNotMatch(componentSource, /deploymentHistory\s*[:=]\s*\[/, 'no fabricated local history array');
  console.log('F25 PASS');
}


// ── F26 — §5 real-runtime fixture: the EXACT requiredStages payload the
//         deployed backend returned for project pfe-app-test on
//         2026-10-07 (GET /api/azure-deploy/ready/3aa1c9b9-…). Verifies the
//         live vocabulary maps faithfully and that NOT_RUN/WARNING are never
//         promoted to PASS. ──────────────────────────────────────────────
{
  const REAL_READY_STAGES = [
    { stage: 'zap',    status: 'WARNING', blocking: false, required: true },
    { stage: 'build',  status: 'PASSED',  blocking: false, required: true },
    { stage: 'owasp',  status: 'FAILED',  blocking: true,  required: true },
    { stage: 'sonar',  status: 'FAILED',  blocking: true,  required: true },
    { stage: 'tests',  status: 'NOT_RUN', blocking: false, required: true },
    { stage: 'trivy',  status: 'FAILED',  blocking: true,  required: true },
    { stage: 'deploy', status: 'NOT_RUN', blocking: false, required: true },
    { stage: 'docker', status: 'PASSED',  blocking: false, required: true },
  ];
  const c = freshComponent('admin');
  c.ngOnInit();
  c.calls[0].observer.next(PREVIEW_CRITICAL_150);
  c.requiredStages = REAL_READY_STAGES;
  const rows = c.controlRows;
  const get = n => rows.find(r => r.name === n);
  assert.equal(get('zap').status, 'WARNING');
  assert.equal(get('zap').blocking, false);
  assert.equal(get('build').status, 'PASS');
  assert.equal(get('owasp').status, 'FAIL');
  assert.equal(get('owasp').blocking, true);
  assert.equal(get('sonar').status, 'FAIL');
  assert.equal(get('tests').status, 'NOT_RUN');
  assert.equal(get('trivy').status, 'FAIL');
  assert.equal(get('deploy').status, 'NOT_RUN');
  assert.equal(get('docker').status, 'PASS');
  // No live stage may be rendered as a pass unless the backend said PASSED.
  for (const r of rows.filter(r => REAL_READY_STAGES.some(s => s.stage === r.name))) {
    const src = REAL_READY_STAGES.find(s => s.stage === r.name);
    if (r.status === 'PASS') assert.equal(src.status, 'PASSED', `${r.name} may only be PASS when the backend said PASSED`);
  }
  // Eight live stages plus the five preview-derived rows.
  assert.equal(rows.length, 13);
  assert.equal(c.hasHiddenControls, true);
  console.log('F26 PASS');
}


// ══════════════════════════════════════════════════════════════════════
//  MULTI-PROJECT (dynamic project architecture)
//  Arbitrary project identifiers that appear NOWHERE in the frontend
//  source — if any of these had to be registered somewhere, the
//  architecture would not be generic.
// ══════════════════════════════════════════════════════════════════════
const PROJECT_A = 'a1111111-2222-4333-8444-555555555555';
const PROJECT_B = 'b9999999-8888-4777-8666-555555555555';
const PROJECT_NEVER_SEEN = 'f0e1d2c3-b4a5-4968-8877-66554433221100'.slice(0, 36);

const previewFor = (projectId, overrides = {}) => ({
  ...PREVIEW_READY, projectId, ...overrides,
  environment: { ...PREVIEW_READY.environment, ...(overrides.environment || {}) },
  artifact: { ...PREVIEW_READY.artifact, ...(overrides.artifact || {}) },
});

// ── M1 — the component is project-agnostic: it calls the API with whatever
//         projectId it is given, including an id never seen before. ───────
{
  for (const pid of [PROJECT_A, PROJECT_B, PROJECT_NEVER_SEEN]) {
    const c = freshComponent('admin');
    c.projectId = pid;
    c.ngOnInit();
    assert.equal(c.calls[0].kind, 'preview');
    assert.equal(c.calls[0].args[0], pid, 'governance must be requested for the given projectId');
    c.calls[0].observer.next(previewFor(pid));
    assert.equal(c.decision, 'READY');
    assert.equal(c.showsDeployAction, true);
    c.submitNormalAuthorization();
    assert.equal(c.calls[1].kind, 'authorize');
    assert.equal(c.calls[1].args[0], pid, 'authorize must target the same projectId');
    c.calls[1].observer.next({ authorizationId: 'auth-' + pid, governanceClass: 'READY', expiresAt: '2026-01-01T00:00:00Z' });
    assert.equal(c.calls[2].kind, 'deploy');
    assert.equal(c.calls[2].args[0], pid, 'deploy must target the same projectId');
  }
  // No arbitrary identifier may be baked into the component or the API client.
  for (const pid of [PROJECT_A, PROJECT_B, PROJECT_NEVER_SEEN]) {
    assert.doesNotMatch(componentSource, new RegExp(pid), 'no project id may appear in the component');
    assert.doesNotMatch(apiServiceSource, new RegExp(pid), 'no project id may appear in the API client');
  }
  console.log('M1 PASS');
}

// ── M2 — §17: a project with NO deployment configuration still renders the
//         section, says so plainly, and exposes no deploy action. ────────
{
  const c = freshComponent('admin');
  c.projectId = PROJECT_B;
  c.deploymentConfigured = false;          // GET /ready: no azureConfig
  c.ngOnInit();
  // The backend classifies an unresolved environment TECHNICALLY_IMPOSSIBLE.
  c.calls[0].observer.next(previewFor(PROJECT_B, {
    decision: 'TECHNICALLY_IMPOSSIBLE',
    environment: { resolved: false, identityHash: null, targetName: null, region: null },
    failedControls: ["Identité d'environnement non résolue (DEPLOY_ENVIRONMENT_UNRESOLVED)"],
    authorizationPolicy: { requiredMode: null, rolesAllowed: [], adminRequired: false, reasonRequired: false, acknowledgementRequirements: [], confirmationPhraseRequired: false },
  }));
  assert.equal(c.capability, 'DEPLOYMENT_NOT_CONFIGURED');
  assert.equal(c.capabilityInfo.label, 'Déploiement non configuré');
  assert.match(c.capabilityInfo.detail, /Aucun environnement de déploiement n'est encore configuré pour ce projet\./);
  assert.equal(c.showsDeployAction, false, 'no deploy action without a configured environment');
  assert.equal(c.isConfigured, false);
  // Even an admin forcing the entry points directly gets nothing.
  const before = c.calls.length;
  c.submitNormalAuthorization(); c.openConditionalForm(); c.openCriticalForm();
  assert.equal(c.calls.length, before, 'no request may be issued for an unconfigured project');
  assert.equal(c.showConditionalForm, false);
  assert.equal(c.showCriticalForm, false);
  console.log('M2 PASS');
}

// ── M3 — §7: config present but unresolvable is a DISTINCT state ────────
{
  const c = freshComponent('admin');
  c.projectId = PROJECT_A;
  c.deploymentConfigured = true;           // azureConfig exists…
  c.ngOnInit();
  c.calls[0].observer.next(previewFor(PROJECT_A, {
    decision: 'TECHNICALLY_IMPOSSIBLE',
    environment: { resolved: false, identityHash: null, targetName: null, region: null }, // …but does not resolve
  }));
  assert.equal(c.capability, 'DEPLOYMENT_CONFIGURATION_INVALID');
  assert.equal(c.capabilityInfo.label, 'Configuration invalide');
  assert.equal(c.showsDeployAction, false);
  console.log('M3 PASS');
}

// ── M4 — §7: a configured project that is genuinely technically impossible
//         is NOT reported as "not configured". ─────────────────────────────
{
  const c = freshComponent('admin');
  c.projectId = PROJECT_A;
  c.deploymentConfigured = true;
  c.ngOnInit();
  c.calls[0].observer.next(previewFor(PROJECT_A, { decision: 'TECHNICALLY_IMPOSSIBLE' })); // env resolved
  assert.equal(c.capability, 'DEPLOYMENT_TECHNICALLY_IMPOSSIBLE');
  assert.equal(c.showsDeployAction, false, 'no override exists for a technical block');
  console.log('M4 PASS');
}

// ── M5 — §7: governance unavailable is its own state, never "configured" ─
{
  const c = freshComponent('admin');
  c.projectId = PROJECT_A;
  c.deploymentConfigured = true;
  c.ngOnInit();
  c.calls[0].observer.error({ status: 500 });
  assert.equal(c.capability, 'DEPLOYMENT_GOVERNANCE_UNAVAILABLE');
  assert.equal(c.showsDeployAction, false);
  assert.equal(c.decision, null);
  console.log('M5 PASS');
}

// ── M6 — §23: switching project replaces ALL deployment data; nothing from
//         the previous project survives, and A -> B -> A is clean. ────────
{
  const c = freshComponent('admin');
  c.projectId = PROJECT_A;
  c.ngOnInit();
  c.calls[0].observer.next(previewFor(PROJECT_A, { mainBuildNumber: 11, artifact: { ...PREVIEW_READY.artifact, tag: '11', digest: 'sha256:' + 'a'.repeat(64) } }));
  assert.equal(c.preview.mainBuildNumber, 11);
  // Hold an authorization for A, then navigate to B.
  c.submitNormalAuthorization();
  c.calls[1].observer.next({ authorizationId: 'auth-A', governanceClass: 'READY', expiresAt: '2026-01-01T00:00:00Z' });
  assert.equal(c.authorization.authorizationId, 'auth-A');

  c.projectId = PROJECT_B;
  c.ngOnChanges({ projectId: { firstChange: false, currentValue: PROJECT_B, previousValue: PROJECT_A } });
  // §24 — the authorization for A must be gone the instant the project changes.
  assert.equal(c.authorization, null, 'an authorization must never cross a project boundary');
  assert.equal(c.preview, null, "the previous project's governance must not remain on screen");
  assert.equal(c.decision, null);
  assert.equal(c.deployRequestId, null);
  assert.equal(c.deploySuccessInfo, null);
  assert.equal(c.deployPhase, 'IDLE');
  assert.equal(c.previewLoading, true);
  const bCall = c.calls[c.calls.length - 1];
  assert.equal(bCall.kind, 'preview');
  assert.equal(bCall.args[0], PROJECT_B, 'the reload must target the NEW project');
  bCall.observer.next(previewFor(PROJECT_B, { mainBuildNumber: 22, artifact: { ...PREVIEW_READY.artifact, tag: '22' } }));
  assert.equal(c.preview.mainBuildNumber, 22);
  assert.equal(c.preview.projectId, PROJECT_B);

  // Back to A — fresh data again, never B's.
  c.projectId = PROJECT_A;
  c.ngOnChanges({ projectId: { firstChange: false, currentValue: PROJECT_A, previousValue: PROJECT_B } });
  const aCall = c.calls[c.calls.length - 1];
  assert.equal(aCall.args[0], PROJECT_A);
  aCall.observer.next(previewFor(PROJECT_A, { mainBuildNumber: 11 }));
  assert.equal(c.preview.mainBuildNumber, 11);
  assert.equal(c.preview.projectId, PROJECT_A);
  console.log('M6 PASS');
}

// ── M7 — §23: a SLOW response for the previous project must never paint
//         over the project now displayed (rapid A -> B navigation). ───────
{
  const c = freshComponent('admin');
  c.projectId = PROJECT_A;
  c.ngOnInit();
  const slowA = c.calls[0];                       // A's request, still in flight
  c.projectId = PROJECT_B;
  c.ngOnChanges({ projectId: { firstChange: false, currentValue: PROJECT_B, previousValue: PROJECT_A } });
  const bCall = c.calls[c.calls.length - 1];
  // A's response arrives LATE, after the user already moved to B.
  slowA.observer.next(previewFor(PROJECT_A, { mainBuildNumber: 11 }));
  assert.equal(c.preview, null, "a stale response must not be applied to the new project");
  assert.equal(c.decision, null);
  // B's own response is applied normally.
  bCall.observer.next(previewFor(PROJECT_B, { mainBuildNumber: 22 }));
  assert.equal(c.preview.projectId, PROJECT_B);
  assert.equal(c.preview.mainBuildNumber, 22);

  // A late ERROR for A must not surface as B's error either.
  const c2 = freshComponent('admin');
  c2.projectId = PROJECT_A;
  c2.ngOnInit();
  const slowErrA = c2.calls[0];
  c2.projectId = PROJECT_B;
  c2.ngOnChanges({ projectId: { firstChange: false, currentValue: PROJECT_B, previousValue: PROJECT_A } });
  const b2 = c2.calls[c2.calls.length - 1];
  slowErrA.observer.error({ status: 500 });
  assert.equal(c2.previewError, null, "a stale error must not be shown under the new project");
  b2.observer.next(previewFor(PROJECT_B));
  assert.equal(c2.preview.projectId, PROJECT_B);
  console.log('M7 PASS');
}

// ── M8 — a preview is never trusted across a project change even if it is
//         somehow still held (defence in depth behind M6/M7). ─────────────
{
  const c = freshComponent('admin');
  c.projectId = PROJECT_A;
  c.ngOnInit();
  c.calls[0].observer.next(previewFor(PROJECT_A));
  assert.equal(c.previewIsForCurrentProject, true);
  c.projectId = PROJECT_B;                        // input changed, no hook run
  assert.equal(c.previewIsForCurrentProject, false);
  assert.equal(c.decision, null, 'a decision must never be reported for another project');
  assert.equal(c.showsDeployAction, false);
  console.log('M8 PASS');
}

// ── M9 — §25/§8: the project shell exposes Déploiement as its OWN tab and
//         the overview's deployment stage opens it, never Jenkins. ────────
{
  const detailTs = projectDetailSource;
  assert.match(detailTs, /VALID_TABS\s*=\s*\[[^\]]*'deploiement'/, 'a generic deployment tab must exist');
  assert.match(projectDetailTemplate, /activeTab==='deploiement'/, 'a Déploiement tab button must exist');
  // P1-D — le bloc est monté à la première ouverture puis gardé masqué,
  // pour ne pas repayer la vérification Azure de 10-12 s à chaque retour.
  // Ce qui compte ici reste inchangé : un bloc de contenu dédié, piloté par
  // activeTab.
  assert.match(projectDetailTemplate, /\*ngIf="visitedTabs\.has\('deploiement'\)"\s*\[hidden\]="activeTab !== 'deploiement'"/,
    'the deployment tab must have its own content block, mounted on first visit');
  assert.match(detailTs, /deploiement:\s*'deploiement'/, 'the overview deployment stage must map to the deployment tab');

  // The governance component must live in the deployment tab, NOT inside the
  // security tab where it was previously buried.
  const depTabIdx = projectDetailTemplate.indexOf("*ngIf=\"visitedTabs.has('deploiement')\"");
  const secTabIdx = projectDetailTemplate.indexOf("*ngIf=\"activeTab === 'securite'\"");
  const compIdx = projectDetailTemplate.indexOf('<app-deployment-governance');
  assert.ok(depTabIdx > -1 && compIdx > depTabIdx, 'the governance component must be inside the deployment tab');
  const incTabIdx = projectDetailTemplate.indexOf("*ngIf=\"activeTab === 'incidents'\"");
  assert.ok(compIdx < incTabIdx, 'the governance component must be within the deployment tab block');
  assert.ok(!(compIdx > secTabIdx && compIdx < depTabIdx), 'the governance component must no longer sit in the security tab');

  // Jenkins stays reachable, as its own separate tab.
  assert.match(projectDetailTemplate, /activeTab==='jenkins'/, 'Jenkins must remain separately accessible');
  // The deployment component is handed the ROUTE project id, nothing fixed.
  assert.match(projectDetailTemplate, /<app-deployment-governance[\s\S]{0,400}\[projectId\]="id"/);
  console.log('M9 PASS');
}

// ── M10 — the overview no longer routes any deployment affordance to Jenkins ─
{
  const overview = read('../src/app/features/projects/project-overview.component.ts');
  assert.match(overview, /key:\s*'deploy',\s*label:\s*'Déploiement',\s*tab:\s*'deploiement'/,
    "the overview's Déploiement stage must target the deployment tab");
  assert.match(overview, /deploy:\s*'deploiement'/, 'the governed stage tab map must route deploy to the deployment tab');
  assert.doesNotMatch(overview, /deploy:\s*'jenkins'/, 'no deployment affordance may route to Jenkins');
  console.log('M10 PASS');
}

// ── M11 — §11: the information card shows backend-provided target metadata
//         and "Non disponible" for anything genuinely absent. ─────────────
{
  const c = freshComponent('admin');
  c.projectId = PROJECT_A;
  c.projectName = 'arbitrary-project';
  c.deploymentTarget = {
    provider: 'azure-container-instances', resourceGroup: 'rg-arbitrary',
    targetName: 'aci-arbitrary', registry: 'acrarbitrary', imageRepository: 'arbitrary',
    region: 'westeurope', healthCheck: { path: '/actuator/health', port: '8080' },
  };
  c.ngOnInit();
  c.calls[0].observer.next(previewFor(PROJECT_A));
  assert.equal(c.healthTargetLabel, ':8080/actuator/health');
  assert.equal(c.orNotAvailable(c.deploymentTarget.resourceGroup), 'rg-arbitrary');
  assert.equal(c.orNotAvailable(c.deploymentTarget.provider), 'azure-container-instances');
  // Absent health config must read "Non disponible", never an invented value.
  c.deploymentTarget = { provider: 'azure-container-instances' };
  assert.equal(c.healthTargetLabel, 'Non disponible');
  c.deploymentTarget = null;
  assert.equal(c.healthTargetLabel, 'Non disponible');
  // No region/registry constant may be baked into the component.
  for (const v of ['francecentral', 'acrpfedevsecops', 'aci-pfe-app-test', 'pfe-app-test']) {
    assert.doesNotMatch(componentSource, new RegExp(v), `${v} must not appear in the component source`);
  }
  console.log('M11 PASS');
}

// ── M12 — the Jenkins link is build EVIDENCE in the deployment section, and
//         is clearly not the deploy action. ───────────────────────────────
{
  // The evidence links now come from the backend-derived source/evidence
  // table (GET /api/source-evidence/*) instead of a pre-built URL input.
  // The invariant under test is UNCHANGED: these are inspection links, and
  // the section says so, so they can never be mistaken for the deploy action.
  assert.match(template, /app-source-evidence-list/, 'an evidence block must exist');
  assert.match(template, /\[slots\]="sourceEvidence"/, 'evidence must come from an input, never a constant');
  assert.match(template, /\[sections\]="sourceEvidenceSections"/, 'the evidence layout must come from an input');
  assert.match(template, /n’exécute de déploiement/, 'the evidence links must be labelled as non-deploying');
  assert.doesNotMatch(componentSource, /localhost:808|https?:\/\/[0-9]/, 'no hardcoded Jenkins host in the component');
  // No URL is composed in this component any more — only consumed.
  assert.doesNotMatch(componentSource, /\/job\/|\/dashboard\?id=|portal\.azure\.com/,
    'the deployment view must never build a tool URL itself');
  // §7 — the capability states are all rendered from backend-derived values.
  assert.match(template, /capabilityInfo\.label/);
  assert.match(template, /capabilityInfo\.detail/);
  console.log('M12 PASS');
}

// ── M13 — capability derivation is a pure function of backend fields ─────
{
  const d = mod.deriveDeploymentCapability;
  assert.equal(d({ previewFailed: true,  deploymentConfigured: true,  environmentResolved: true,  decision: 'READY' }), 'DEPLOYMENT_GOVERNANCE_UNAVAILABLE');
  assert.equal(d({ previewFailed: false, deploymentConfigured: true,  environmentResolved: true,  decision: null }),    'DEPLOYMENT_GOVERNANCE_UNAVAILABLE');
  assert.equal(d({ previewFailed: false, deploymentConfigured: false, environmentResolved: false, decision: 'TECHNICALLY_IMPOSSIBLE' }), 'DEPLOYMENT_NOT_CONFIGURED');
  assert.equal(d({ previewFailed: false, deploymentConfigured: null,  environmentResolved: false, decision: 'TECHNICALLY_IMPOSSIBLE' }), 'DEPLOYMENT_NOT_CONFIGURED');
  assert.equal(d({ previewFailed: false, deploymentConfigured: true,  environmentResolved: false, decision: 'TECHNICALLY_IMPOSSIBLE' }), 'DEPLOYMENT_CONFIGURATION_INVALID');
  assert.equal(d({ previewFailed: false, deploymentConfigured: true,  environmentResolved: true,  decision: 'TECHNICALLY_IMPOSSIBLE' }), 'DEPLOYMENT_TECHNICALLY_IMPOSSIBLE');
  for (const dec of ['READY', 'CONDITIONAL', 'CRITICAL_RISK']) {
    assert.equal(d({ previewFailed: false, deploymentConfigured: true, environmentResolved: true, decision: dec }), 'DEPLOYMENT_CONFIGURED');
    assert.equal(mod.capabilityAllowsDeployAction(d({ previewFailed: false, deploymentConfigured: true, environmentResolved: true, decision: dec })), true);
  }
  // Only a configured project may ever act.
  for (const cap of ['DEPLOYMENT_NOT_CONFIGURED','DEPLOYMENT_CONFIGURATION_INVALID','DEPLOYMENT_GOVERNANCE_UNAVAILABLE','DEPLOYMENT_TECHNICALLY_IMPOSSIBLE']) {
    assert.equal(mod.capabilityAllowsDeployAction(cap), false);
  }
  console.log('M13 PASS');
}

// ── M14 — the full governance matrix works on an arbitrary project, with the
//         same component and the same semantics (§12). ────────────────────
{
  const matrix = [
    ['READY',                  'developer', true,  'Prêt au déploiement'],
    ['CONDITIONAL',            'developer', true,  'Déploiement conditionnel'],
    ['CRITICAL_RISK',          'admin',     true,  'Risque critique'],
    ['CRITICAL_RISK',          'developer', false, 'Risque critique'],
    ['TECHNICALLY_IMPOSSIBLE', 'admin',     false, 'Déploiement techniquement impossible'],
  ];
  for (const [decision, role, actionable, label] of matrix) {
    const c = freshComponent(role);
    c.projectId = PROJECT_NEVER_SEEN;
    c.deploymentConfigured = true;
    c.ngOnInit();
    const policy = decision === 'CRITICAL_RISK'
      ? { requiredMode: 'CRITICAL_OVERRIDE', rolesAllowed: ['admin'], adminRequired: true, reasonRequired: true, acknowledgementRequirements: ['criticalRiskAccepted','securityControlsMayHaveFailed','deploymentMayExposeKnownRisk'], confirmationPhraseRequired: true }
      : decision === 'CONDITIONAL'
        ? { requiredMode: 'CONDITIONAL_EXCEPTION', rolesAllowed: ['admin','developer'], adminRequired: false, reasonRequired: true, acknowledgementRequirements: ['conditionalRiskAccepted'], confirmationPhraseRequired: false }
        : decision === 'READY'
          ? { requiredMode: 'NORMAL', rolesAllowed: ['admin','developer'], adminRequired: false, reasonRequired: false, acknowledgementRequirements: [], confirmationPhraseRequired: false }
          : { requiredMode: null, rolesAllowed: [], adminRequired: false, reasonRequired: false, acknowledgementRequirements: [], confirmationPhraseRequired: false };
    c.calls[0].observer.next(previewFor(PROJECT_NEVER_SEEN, { decision, authorizationPolicy: policy }));
    assert.equal(c.decision, decision);
    assert.equal(c.decisionPresentation.label, label);
    const canAct = decision === 'CRITICAL_RISK' ? (c.showsDeployAction && c.isAdmin) : (c.showsDeployAction && c.canAuthorizeCurrentDecision);
    assert.equal(!!canAct, actionable, `${decision}/${role} actionable should be ${actionable}`);
    if (decision === 'TECHNICALLY_IMPOSSIBLE') {
      assert.equal(c.capability, 'DEPLOYMENT_TECHNICALLY_IMPOSSIBLE');
      assert.equal(c.showsDeployAction, false);
    }
  }
  console.log('M14 PASS');
}

console.log('deployment-governance.spec: ALL PASS');

// ════════════════════════════════════════════════════════════════════════════
// R53 §11 — etats PRECIS de l'identite d'artefact
// Le backend calcule un motif exact ; les fondre en « deploiement impossible »
// efface la seule information actionnable.
// ════════════════════════════════════════════════════════════════════════════
{
  const src = readFileSync(new URL('../src/app/features/projects/deployment-governance.component.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../src/app/features/projects/deployment-governance.component.html', import.meta.url), 'utf8');

  // Chaque motif que le backend peut emettre a sa phrase.
  for (const code of [
    'DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE', 'DEPLOY_ARTIFACT_DIGEST_MISSING',
    'DEPLOY_ARTIFACT_DIGEST_MISMATCH', 'DEPLOY_ARTIFACT_COMMIT_MISMATCH',
    'DEPLOY_BUILD_MISMATCH', 'DEPLOY_ARTIFACT_REGISTRY_MISMATCH',
    'DEPLOY_ARTIFACT_REPOSITORY_MISMATCH', 'DEPLOY_ARTIFACT_REVISION_MISSING',
    'DEPLOY_ARTIFACT_REVISION_MISMATCH', 'DEPLOY_COMMIT_MISSING',
    'DEPLOY_ENVIRONMENT_UNRESOLVED',
  ]) {
    assert.ok(new RegExp(`${code}: *\\{`).test(src), `le motif ${code} doit avoir sa presentation`);
  }

  // Les libelles sont distincts : aucun fourre-tout.
  const labels = [...src.matchAll(/label: '([^']+)',\s*\n\s*detail:/g)].map(m => m[1]);
  assert.ok(labels.length >= 11, 'chaque motif doit porter son propre libelle');
  assert.equal(new Set(labels).size, labels.length, 'aucun libelle ne doit etre reutilise pour deux motifs');
  for (const l of labels) {
    assert.ok(!/impossible/i.test(l), `« ${l} » ne doit pas retomber sur « impossible »`);
  }

  // Provenance acquise => rien a expliquer ; motif inconnu ou absent => muet.
  assert.ok(/art\.provenanceVerified === true\) return null/.test(src),
    'un artefact verifie ne doit afficher aucun motif d absence');
  assert.ok(/if \(!code\) return null/.test(src),
    'un champ failureCode absent (backend anterieur) ne doit rien inventer');
  assert.ok(/ARTIFACT_STATE_PRESENTATION\[code\] \?\? null/.test(src),
    'un code inconnu doit rester muet plutot que devine');

  // « pret » vient du backend, jamais deduit d un digest non nul.
  assert.ok(/provenanceVerified === true; }/.test(src),
    'artifactReady doit lire provenanceVerified, pas la presence d un digest');
  assert.ok(!/artifactReady[^\n]*digest/.test(src),
    'artifactReady ne doit pas se deduire du digest');

  // La vue affiche les deux cas, et ne confond pas pret et deploye.
  assert.ok(html.includes('artifactStatePresentation as artifactState'), 'la vue affiche le motif precis');
  assert.ok(html.includes('artifactReady'), 'la vue affiche l etat pret');
  assert.ok(/Pr.te à être déployée ne veut pas dire déployée/.test(html),
    'la vue doit dire explicitement que pret n est pas deploye');

  // Genericite.
  for (const needle of ['app-test-pfe-vermeg', 'pfe-app-test', 'acrpfedevsecops']) {
    const body = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    assert.ok(!body.includes(needle), `deployment-governance.component.ts ne doit pas nommer ${needle}`);
  }
  console.log('R53 precise artifact states: PASS');
}
