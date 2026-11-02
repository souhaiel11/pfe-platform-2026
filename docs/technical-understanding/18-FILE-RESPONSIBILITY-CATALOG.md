# 18 — CATALOGUE DE RESPONSABILITÉ DES FICHIERS

Catalogue **généré depuis l'arborescence réelle**. Les dossiers `node_modules/`,
`dist/` et les artefacts générés sont exclus, conformément à la consigne.

- Backend : **347 fichiers `.ts`** — 217 de runtime, 130 de test (`*.spec.ts`)
- Frontend : **38 fichiers** dont 26 composants

Le `kind` est déduit du suffixe réel du fichier (`.controller.ts`, `.service.ts`,
`.entity.ts`, `.module.ts`, `dto/`, `.types.ts`), `logic` désignant un module de
logique pure sans décorateur NestJS — c'est dans cette catégorie que vit l'essentiel
des règles déterministes (politiques, classifieurs, normaliseurs).

## `backend/src/security-remediation/` — 38 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/security-remediation/security-remediation.controller.ts` | controller | 394 |
| `backend/src/security-remediation/maven-security-patch-writer.ts` | logic | 249 |
| `backend/src/security-remediation/security-remediation-orchestration.types.ts` | types | 246 |
| `backend/src/security-remediation/maven-provenance-resolver.ts` | logic | 237 |
| `backend/src/security-remediation/maven-parent-patch-writer.ts` | logic | 227 |
| `backend/src/security-remediation/security-patch-guard.ts` | logic | 224 |
| `backend/src/security-remediation/maven-remediation-scope.ts` | logic | 218 |
| `backend/src/security-remediation/security-finding-resolver.service.ts` | service | 145 |
| `backend/src/security-remediation/security-remediation-batch-orchestration.types.ts` | types | 141 |
| `backend/src/security-remediation/maven-security-patch-writer-batch.ts` | logic | 115 |
| `backend/src/security-remediation/security-artifact-scan.ts` | logic | 110 |
| `backend/src/security-remediation/security-eligibility-classifier.ts` | logic | 110 |
| `backend/src/security-remediation/version-selection-policy.ts` | logic | 105 |
| `backend/src/security-remediation/retry-e2e-harness.service.ts` | service | 100 |
| `backend/src/security-remediation/grounded-maven-provenance.types.ts` | types | 92 |
| `backend/src/security-remediation/security-finding-decision.types.ts` | types | 88 |
| `backend/src/security-remediation/security-candidate-identity.ts` | logic | 83 |
| `backend/src/security-remediation/wf6-remediation-result.dto.ts` | dto | 82 |
| `backend/src/security-remediation/security-remediation-git-metadata.ts` | logic | 81 |
| `backend/src/security-remediation/security-remediation-batch-closure.ts` | logic | 66 |
| `backend/src/security-remediation/wf6-batch-remediation-result.dto.ts` | dto | 63 |
| `backend/src/security-remediation/security-remediation-deadline-contract.ts` | logic | 59 |
| `backend/src/security-remediation/dependency-provenance.types.ts` | types | 57 |
| `backend/src/security-remediation/parent-version-effective-model-check.ts` | logic | 55 |
| `backend/src/security-remediation/retry-e2e-harness.logic.ts` | logic | 55 |
| `backend/src/security-remediation/security-patch-request.types.ts` | types | 55 |
| `backend/src/security-remediation/security-remediation-batch-git-metadata.ts` | logic | 52 |
| `backend/src/security-remediation/fixed-version-normalizer.ts` | logic | 38 |
| `backend/src/security-remediation/security-remediation-revalidate-batch.dto.ts` | dto | 31 |
| `backend/src/security-remediation/security-remediation-evaluate-batch.dto.ts` | dto | 26 |
| `backend/src/security-remediation/security-branch-name.ts` | logic | 25 |
| `backend/src/security-remediation/retry-e2e-harness.controller.ts` | controller | 24 |
| `backend/src/security-remediation/maven-dependency-resolution-check.ts` | logic | 22 |
| `backend/src/security-remediation/retry-e2e-test-plan.entity.ts` | entity | 22 |
| `backend/src/security-remediation/security-remediation-revalidate.dto.ts` | dto | 21 |
| `backend/src/security-remediation/security-remediation-evaluate.dto.ts` | dto | 18 |
| `backend/src/security-remediation/security-remediation.module.ts` | module | 18 |
| `backend/src/security-remediation/wf6-attempt-correlation.dto.ts` | dto | 6 |

## `backend/src/dependency-compatibility/` — 25 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/dependency-compatibility/owner-version-discovery.ts` | logic | 247 |
| `backend/src/dependency-compatibility/v1_8_phase3_shadow_report.ts` | logic | 245 |
| `backend/src/dependency-compatibility/v1_8_phase4_generate_evidence_store.ts` | logic | 231 |
| `backend/src/dependency-compatibility/dependency-control-profile-resolver.ts` | logic | 211 |
| `backend/src/dependency-compatibility/dependency-compatibility-decision.ts` | logic | 196 |
| `backend/src/dependency-compatibility/v1_8_phase2_shadow_report.ts` | logic | 192 |
| `backend/src/dependency-compatibility/remediation-plan.ts` | logic | 161 |
| `backend/src/dependency-compatibility/owner-discovery-trial.ts` | logic | 141 |
| `backend/src/dependency-compatibility/security-candidate-collector.ts` | logic | 127 |
| `backend/src/dependency-compatibility/maven-qualifier-comparator.ts` | logic | 119 |
| `backend/src/dependency-compatibility/v1_8_phase4_dual_decision_comparison.ts` | logic | 110 |
| `backend/src/dependency-compatibility/v1_8-security-remediation-gate.ts` | logic | 108 |
| `backend/src/dependency-compatibility/v1_8_phase7_parent_dry_run.ts` | logic | 105 |
| `backend/src/dependency-compatibility/v1_8-compatibility-decision.types.ts` | types | 86 |
| `backend/src/dependency-compatibility/unified-security-finding.ts` | logic | 85 |
| `backend/src/dependency-compatibility/candidate-version-policy.ts` | logic | 83 |
| `backend/src/dependency-compatibility/owner-pom-edit.ts` | logic | 81 |
| `backend/src/dependency-compatibility/candidate-existence-checker.ts` | logic | 80 |
| `backend/src/dependency-compatibility/v1_8_phase5_dry_run.ts` | logic | 73 |
| `backend/src/dependency-compatibility/v1_8_phase3_live_results.ts` | logic | 67 |
| `backend/src/dependency-compatibility/v1_8-compatibility-decision.service.ts` | service | 60 |
| `backend/src/dependency-compatibility/v1_8_phase6_control_gate_check.ts` | logic | 57 |
| `backend/src/dependency-compatibility/dependency-control-profile.types.ts` | types | 49 |
| `backend/src/dependency-compatibility/v1_8-remediation-plan-payload.types.ts` | types | 49 |
| `backend/src/dependency-compatibility/v1_8-enforcement-mode.ts` | logic | 23 |

## `backend/src/manual-remediation/` — 20 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/manual-remediation/manual-remediation.service.ts` | service | 871 |
| `backend/src/manual-remediation/security-remediation-lifecycle.ts` | logic | 215 |
| `backend/src/manual-remediation/owasp-trivy-fixed-version-correlation.ts` | logic | 188 |
| `backend/src/manual-remediation/legacy-reconciliation-catalog.ts` | logic | 152 |
| `backend/src/manual-remediation/legacy-reconciliation.service.ts` | service | 103 |
| `backend/src/manual-remediation/remediation-target-reservation.ts` | logic | 89 |
| `backend/src/manual-remediation/legacy-remote-settlement.ts` | logic | 70 |
| `backend/src/manual-remediation/manual-remediation.entity.ts` | entity | 68 |
| `backend/src/manual-remediation/finding-task-id-enrichment.ts` | logic | 51 |
| `backend/src/manual-remediation/manual-remediation.controller.ts` | controller | 42 |
| `backend/src/manual-remediation/finding-fingerprint.ts` | logic | 36 |
| `backend/src/manual-remediation/legacy-reconciliation.ts` | logic | 35 |
| `backend/src/manual-remediation/manual-remediation.module.ts` | module | 25 |
| `backend/src/manual-remediation/legacy-reconciliation.controller.ts` | controller | 21 |
| `backend/src/manual-remediation/owasp-task-identity.ts` | logic | 15 |
| `backend/src/manual-remediation/reconcile-stale-wf6-dispatch.dto.ts` | dto | 14 |
| `backend/src/manual-remediation/target-reservation-test-query.ts` | logic | 12 |
| `backend/src/manual-remediation/lifecycle-test-transaction.ts` | logic | 9 |
| `backend/src/manual-remediation/legacy-reconciliation.dto.ts` | dto | 8 |
| `backend/src/manual-remediation/retry-security-remediation.dto.ts` | dto | 4 |

## `backend/src/azure-deploy/` — 18 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/azure-deploy/azure-deploy.module.ts` | module | 495 |
| `backend/src/azure-deploy/deployment-authorization.service.ts` | service | 419 |
| `backend/src/azure-deploy/azure-deploy-readiness.service.ts` | service | 322 |
| `backend/src/azure-deploy/deployment-identity.types.ts` | types | 314 |
| `backend/src/azure-deploy/deployment-identity.ts` | logic | 284 |
| `backend/src/azure-deploy/deployment-artifact.service.ts` | service | 282 |
| `backend/src/azure-deploy/build-identity.ts` | logic | 146 |
| `backend/src/azure-deploy/governance-decision.ts` | logic | 125 |
| `backend/src/azure-deploy/deployment-authorization-policy.ts` | logic | 114 |
| `backend/src/azure-deploy/deployment-authorization.entity.ts` | entity | 89 |
| `backend/src/azure-deploy/deployment-artifact.entity.ts` | entity | 72 |
| `backend/src/azure-deploy/deployment-attempt.entity.ts` | entity | 65 |
| `backend/src/azure-deploy/security-validation-applicability.ts` | logic | 56 |
| `backend/src/azure-deploy/dto/azure-deploy-request.dto.ts` | dto | 51 |
| `backend/src/azure-deploy/dto/register-artifact.dto.ts` | dto | 37 |
| `backend/src/azure-deploy/dto/authorize-deployment.dto.ts` | dto | 36 |
| `backend/src/azure-deploy/agent-deployment-result.ts` | logic | 24 |
| `backend/src/azure-deploy/deployment-authorization-transition.ts` | logic | 18 |

## `backend/src/validation/` — 13 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/validation/default-value-semantics-assembler.ts` | logic | 412 |
| `backend/src/validation/default-value-semantics.ts` | logic | 338 |
| `backend/src/validation/merge-authorization.ts` | logic | 331 |
| `backend/src/validation/pr-regression-engine.ts` | logic | 273 |
| `backend/src/validation/corrective-context.ts` | logic | 197 |
| `backend/src/validation/semantic-evidence-core.ts` | logic | 175 |
| `backend/src/validation/adapters/junit-semantic-evidence-adapter.ts` | logic | 124 |
| `backend/src/validation/regression-verdict.ts` | logic | 100 |
| `backend/src/validation/finding-pipeline-separation.ts` | logic | 83 |
| `backend/src/validation/adapters/structured-json-semantic-evidence-adapter.ts` | logic | 68 |
| `backend/src/validation/sonar-regression-adapter.ts` | logic | 63 |
| `backend/src/validation/finding-fingerprint.ts` | logic | 56 |
| `backend/src/validation/adapters/registry.ts` | logic | 18 |

## `backend/src/common/` — 12 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/common/report-normalizer.ts` | logic | 367 |
| `backend/src/common/phase-diagnostics.ts` | logic | 288 |
| `backend/src/common/project-cleanliness.ts` | logic | 142 |
| `backend/src/common/scanner-diagnostics.ts` | logic | 139 |
| `backend/src/common/governance.ts` | logic | 93 |
| `backend/src/common/security-score.ts` | logic | 82 |
| `backend/src/common/risk-score.ts` | logic | 69 |
| `backend/src/common/owasp-finding-normalizer.ts` | logic | 53 |
| `backend/src/common/jenkins-url.ts` | logic | 52 |
| `backend/src/common/sanitize-project.ts` | logic | 51 |
| `backend/src/common/workflow-error.ts` | logic | 23 |
| `backend/src/common/build-success-rate.ts` | logic | 16 |

## `backend/src/candidate-verification/` — 10 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/candidate-verification/candidate-verification.service.ts` | service | 352 |
| `backend/src/candidate-verification/generated-comment-guard.ts` | logic | 274 |
| `backend/src/candidate-verification/candidate-verification.types.ts` | types | 240 |
| `backend/src/candidate-verification/write-guard.ts` | logic | 109 |
| `backend/src/candidate-verification/candidate-digest.ts` | logic | 66 |
| `backend/src/candidate-verification/candidate-verification.controller.ts` | controller | 59 |
| `backend/src/candidate-verification/candidate-base-sha.ts` | logic | 39 |
| `backend/src/candidate-verification/verification-evidence.ts` | logic | 37 |
| `backend/src/candidate-verification/remote-head-drift.ts` | logic | 31 |
| `backend/src/candidate-verification/candidate-verification.module.ts` | module | 17 |

## `backend/src/incidents/` — 10 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/incidents/incidents.service.ts` | service | 3460 |
| `backend/src/incidents/post-write-recovery.ts` | logic | 179 |
| `backend/src/incidents/incidents.controller.ts` | controller | 154 |
| `backend/src/incidents/wf2-cancellation.types.ts` | types | 114 |
| `backend/src/incidents/n8n-execution-client.ts` | logic | 65 |
| `backend/src/incidents/incident-write.dto.ts` | dto | 49 |
| `backend/src/incidents/incident.entity.ts` | entity | 36 |
| `backend/src/incidents/workflow-attempt-identity.ts` | logic | 24 |
| `backend/src/incidents/incidents.module.ts` | module | 18 |
| `backend/src/incidents/incidents.gateway.ts` | logic | 9 |

## `backend/src/auth/` — 8 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/auth/auth.service.ts` | service | 49 |
| `backend/src/auth/auth.controller.ts` | controller | 44 |
| `backend/src/auth/jwt-or-internal-secret.guard.ts` | logic | 31 |
| `backend/src/auth/auth.module.ts` | module | 28 |
| `backend/src/auth/jwt-auth.guard.ts` | logic | 21 |
| `backend/src/auth/jwt.strategy.ts` | logic | 18 |
| `backend/src/auth/internal-secret.guard.ts` | logic | 15 |
| `backend/src/auth/user.entity.ts` | entity | 15 |

## `backend/src/projects/` — 7 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/projects/projects.service.ts` | service | 508 |
| `backend/src/projects/project.entity.ts` | entity | 195 |
| `backend/src/projects/projects.controller.ts` | controller | 115 |
| `backend/src/projects/dto/create-project.dto.ts` | dto | 68 |
| `backend/src/projects/projects.module.ts` | module | 15 |
| `backend/src/projects/dto/update-jenkins-credentials.dto.ts` | dto | 12 |
| `backend/src/projects/dto/update-project.dto.ts` | dto | 3 |

## `backend/src/context/` — 6 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/context/repository-research.service.ts` | service | 191 |
| `backend/src/context/context.types.ts` | types | 83 |
| `backend/src/context/scope-lock.service.ts` | service | 56 |
| `backend/src/context/wf2-state-model.ts` | logic | 50 |
| `backend/src/context/context-sufficiency.service.ts` | service | 44 |
| `backend/src/context/context.module.ts` | module | 16 |

## `backend/src/integrations/` — 6 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/integrations/integrations.service.ts` | service | 152 |
| `backend/src/integrations/integration.entity.ts` | entity | 56 |
| `backend/src/integrations/integrations.controller.ts` | controller | 35 |
| `backend/src/integrations/dto/create-integration.dto.ts` | dto | 26 |
| `backend/src/integrations/integrations.module.ts` | module | 14 |
| `backend/src/integrations/dto/update-integration.dto.ts` | dto | 4 |

## `backend/src/webhooks/` — 6 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/webhooks/webhooks.service.ts` | service | 253 |
| `backend/src/webhooks/jenkins-known-fixes.ts` | logic | 93 |
| `backend/src/webhooks/webhooks.controller.ts` | controller | 42 |
| `backend/src/webhooks/routed-build.entity.ts` | entity | 41 |
| `backend/src/webhooks/console-log-errors.ts` | logic | 36 |
| `backend/src/webhooks/webhooks.module.ts` | module | 34 |

## `backend/src/bugs/` — 5 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/bugs/bug.entity.ts` | entity | 88 |
| `backend/src/bugs/bugs.service.ts` | service | 61 |
| `backend/src/bugs/bugs.controller.ts` | controller | 42 |
| `backend/src/bugs/bugs.gateway.ts` | logic | 15 |
| `backend/src/bugs/bugs.module.ts` | module | 14 |

## `backend/src/seed/` — 5 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/seed/seed-data.ts` | logic | 389 |
| `backend/src/seed/seed.ts` | logic | 163 |
| `backend/src/seed/seed-clean.ts` | logic | 33 |
| `backend/src/seed/data-source.ts` | logic | 22 |
| `backend/src/seed/rng.ts` | logic | 22 |

## `backend/src/dashboard/` — 4 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/dashboard/dashboard.service.ts` | service | 391 |
| `backend/src/dashboard/platform-capabilities.ts` | logic | 36 |
| `backend/src/dashboard/dashboard.controller.ts` | controller | 20 |
| `backend/src/dashboard/dashboard.module.ts` | module | 16 |

## `backend/src/reports/` — 4 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/reports/reports.service.ts` | service | 201 |
| `backend/src/reports/report.entity.ts` | entity | 55 |
| `backend/src/reports/reports.controller.ts` | controller | 35 |
| `backend/src/reports/reports.module.ts` | module | 17 |

## `backend/src/root/` — 3 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/app.module.ts` | module | 65 |
| `backend/src/main.ts` | logic | 33 |
| `backend/src/health.controller.ts` | controller | 12 |

## `backend/src/chat/` — 3 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/chat/chat.controller.ts` | controller | 42 |
| `backend/src/chat/chat.gateway.ts` | logic | 13 |
| `backend/src/chat/chat.module.ts` | module | 12 |

## `backend/src/effective-config/` — 3 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/effective-config/effective-config.service.ts` | service | 44 |
| `backend/src/effective-config/effective-config.controller.ts` | controller | 14 |
| `backend/src/effective-config/effective-config.module.ts` | module | 9 |

## `backend/src/integration-fixtures/` — 3 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/integration-fixtures/integration-fixtures.service.ts` | service | 115 |
| `backend/src/integration-fixtures/integration-fixtures.controller.ts` | controller | 19 |
| `backend/src/integration-fixtures/integration-fixtures.module.ts` | module | 13 |

## `backend/src/jenkins-optimizer/` — 3 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/jenkins-optimizer/jenkins-optimizer.module.ts` | module | 588 |
| `backend/src/jenkins-optimizer/jenkins-analysis.entity.ts` | entity | 60 |
| `backend/src/jenkins-optimizer/jenkins-apply.entity.ts` | entity | 48 |

## `backend/src/scripts/` — 3 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/scripts/normalize-real-project.ts` | logic | 173 |
| `backend/src/scripts/owasp-controlled-resync.ts` | logic | 111 |
| `backend/src/scripts/recalculate-security-scores.ts` | logic | 97 |

## `backend/src/dockerfile-optimizer/` — 2 fichiers de runtime

| Fichier | Type | Lignes |
|---|---|---|
| `backend/src/dockerfile-optimizer/dockerfile-optimizer.module.ts` | module | 396 |
| `backend/src/dockerfile-optimizer/dockerfile-analysis.entity.ts` | entity | 67 |

## Frontend

| Fichier | Type | Sélecteur | Lignes |
|---|---|---|---|
| `frontend/src/app/app.component.ts` | component | `app-root` | 14 |
| `frontend/src/app/features/admin/admin.component.ts` | component | `app-admin` | 64 |
| `frontend/src/app/features/analysis/analysis.component.ts` | component | `app-analysis` | 144 |
| `frontend/src/app/features/analytics/prediction.component.ts` | component | `app-prediction` | 61 |
| `frontend/src/app/features/auth/login.component.ts` | component | `app-login` | 124 |
| `frontend/src/app/features/dashboard/dashboard.component.ts` | component | `app-dashboard` | 265 |
| `frontend/src/app/features/incidents/developer-guide/developer-guide-tab.component.ts` | component | `app-developer-guide-tab` | 316 |
| `frontend/src/app/features/incidents/incident-detail.component.ts` | component | `app-incident-detail` | 1240 |
| `frontend/src/app/features/incidents/incidents.component.ts` | component | `app-incidents` | 84 |
| `frontend/src/app/features/incidents/remediation-card.component.ts` | component | `app-remediation-card` | 223 |
| `frontend/src/app/features/projects/cve-table.component.ts` | component | `app-cve-table` | 576 |
| `frontend/src/app/features/projects/deployment-governance.component.ts` | component | `app-deployment-governance` | 781 |
| `frontend/src/app/features/projects/dockerfile-optimizer.component.ts` | component | `app-dockerfile-optimizer` | 377 |
| `frontend/src/app/features/projects/jenkinsfile-optimizer.component.ts` | component | `app-jenkinsfile-optimizer` | 778 |
| `frontend/src/app/features/projects/project-detail.component.ts` | component | `app-project-detail` | 1371 |
| `frontend/src/app/features/projects/project-form.component.ts` | component | `app-project-form` | 171 |
| `frontend/src/app/features/projects/project-overview.component.ts` | component | `app-project-overview` | 485 |
| `frontend/src/app/features/projects/projects.component.ts` | component | `app-projects` | 81 |
| `frontend/src/app/features/projects/zap-table.component.ts` | component | `app-zap-table` | 187 |
| `frontend/src/app/features/settings/settings.component.ts` | component | `app-settings` | 374 |
| `frontend/src/app/features/tools/security.component.ts` | component | `app-security` | 150 |
| `frontend/src/app/shared/chat-widget/chat-markdown.component.ts` | component | `app-chat-markdown` | 21 |
| `frontend/src/app/shared/chat-widget/chat-widget.component.ts` | component | `app-chat-widget` | 72 |
| `frontend/src/app/shared/layout/layout.component.ts` | component | `app-layout` | 70 |
| `frontend/src/app/shared/not-found.component.ts` | component | `app-not-found` | 24 |
| `frontend/src/app/shared/toast/toast.component.ts` | component | `app-toast` | 32 |
| `frontend/src/app/core/guards/admin.guard.ts` | guard | — | 8 |
| `frontend/src/app/core/guards/auth.guard.ts` | guard | — | 10 |
| `frontend/src/app/core/guards/editor.guard.ts` | guard | — | 9 |
| `frontend/src/app/core/guards/unsaved-changes.guard.ts` | guard | — | 9 |
| `frontend/src/app/core/services/api.service.ts` | service | — | 168 |
| `frontend/src/app/core/services/auth.service.ts` | service | — | 36 |
| `frontend/src/app/core/services/chat.service.ts` | service | — | 77 |
| `frontend/src/app/core/services/project-events.service.ts` | service | — | 15 |
| `frontend/src/app/core/services/risk-state.service.ts` | service | — | 15 |
| `frontend/src/app/core/services/theme.service.ts` | service | — | 28 |
| `frontend/src/app/core/services/toast.service.ts` | service | — | 31 |
| `frontend/src/app/core/services/websocket.service.ts` | service | — | 32 |
