# 19 — CATALOGUE DES CONTRATS D'API

Inventaire **généré depuis les décorateurs NestJS réels** de `backend/src` (toutes les
classes annotées `@Controller`, y compris celles déclarées dans un `*.module.ts` —
c'est le cas de `jenkins`, `dockerfile` et `azure-deploy`).
Total : **119 routes** sous le préfixe global `/api`
(`backend/src/main.ts` : `setGlobalPrefix('api', { exclude: [{ path: 'healthz' }] })`).

| Garde | Signification |
|---|---|
| `JwtAuthGuard` | jeton JWT utilisateur requis (interface web) |
| `InternalSecretGuard` | en-tête `X-Internal-Secret` requis — appelé **uniquement** par n8n ; refuse toujours si le secret serveur n'est pas défini (*fail-closed*) |
| `JwtOrInternalSecretGuard` | accepte l'un **ou** l'autre (route partagée front/n8n) |
| `RetryE2EOperatorGuard` | secret opérateur dédié au harnais de test E2E |
| `-` | aucune garde déclarée (voir la note sous la table `webhooks`) |

## Domaine `/auth`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `POST` | `/api/auth/login` | `AuthController` | `login()` | `-` | `backend/src/auth/auth.controller.ts` |
| `POST` | `/api/auth/register` | `AuthController` | `register()` | `JwtAuthGuard` | `backend/src/auth/auth.controller.ts` |
| `GET` | `/api/auth/users` | `AuthController` | `findAll()` | `JwtAuthGuard` | `backend/src/auth/auth.controller.ts` |
| `DELETE` | `/api/auth/users/:id` | `AuthController` | `remove()` | `JwtAuthGuard` | `backend/src/auth/auth.controller.ts` |

## Domaine `/azure-deploy`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `POST` | `/api/azure-deploy/artifacts/provenance` | `AzureDeployController` | `artifactProvenanceCallback()` | `JwtOrInternalSecretGuard` | `backend/src/azure-deploy/azure-deploy.module.ts` |
| `GET` | `/api/azure-deploy/artifacts/provenance/:projectId` | `AzureDeployController` | `provenance()` | `JwtAuthGuard` | `backend/src/azure-deploy/azure-deploy.module.ts` |
| `POST` | `/api/azure-deploy/artifacts/register` | `AzureDeployController` | `registerArtifact()` | `JwtAuthGuard` | `backend/src/azure-deploy/azure-deploy.module.ts` |
| `POST` | `/api/azure-deploy/authorize/:projectId` | `AzureDeployController` | `authorize()` | `JwtAuthGuard` | `backend/src/azure-deploy/azure-deploy.module.ts` |
| `POST` | `/api/azure-deploy/deploy` | `AzureDeployController` | `deploy()` | `JwtAuthGuard` | `backend/src/azure-deploy/azure-deploy.module.ts` |
| `GET` | `/api/azure-deploy/governance/:projectId` | `AzureDeployController` | `governance()` | `JwtAuthGuard` | `backend/src/azure-deploy/azure-deploy.module.ts` |
| `GET` | `/api/azure-deploy/identity/:projectId` | `AzureDeployController` | `identity()` | `JwtAuthGuard` | `backend/src/azure-deploy/azure-deploy.module.ts` |
| `GET` | `/api/azure-deploy/projects` | `AzureDeployController` | `projects()` | `JwtAuthGuard` | `backend/src/azure-deploy/azure-deploy.module.ts` |
| `GET` | `/api/azure-deploy/ready/:projectId` | `AzureDeployController` | `ready()` | `JwtAuthGuard` | `backend/src/azure-deploy/azure-deploy.module.ts` |
| `GET` | `/api/azure-deploy/session-status` | `AzureDeployController` | `sessionStatus()` | `JwtAuthGuard` | `backend/src/azure-deploy/azure-deploy.module.ts` |

## Domaine `/bugs`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `GET` | `/api/bugs` | `BugsController` | `findAll()` | `-` | `backend/src/bugs/bugs.controller.ts` |
| `POST` | `/api/bugs` | `BugsController` | `create()` | `-` | `backend/src/bugs/bugs.controller.ts` |
| `DELETE` | `/api/bugs/:id` | `BugsController` | `remove()` | `-` | `backend/src/bugs/bugs.controller.ts` |
| `GET` | `/api/bugs/:id` | `BugsController` | `findOne()` | `-` | `backend/src/bugs/bugs.controller.ts` |
| `POST` | `/api/bugs/:id/ai-fix` | `BugsController` | `triggerFix()` | `-` | `backend/src/bugs/bugs.controller.ts` |
| `PUT` | `/api/bugs/:id/n8n-result` | `BugsController` | `updateFromN8n()` | `-` | `backend/src/bugs/bugs.controller.ts` |
| `PUT` | `/api/bugs/:id/status` | `BugsController` | `updateStatus()` | `-` | `backend/src/bugs/bugs.controller.ts` |

## Domaine `/candidate-verification`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `POST` | `/api/candidate-verification/remote-head-drift` | `CandidateVerificationController` | `remoteHeadDrift()` | `InternalSecretGuard` | `backend/src/candidate-verification/candidate-verification.controller.ts` |
| `POST` | `/api/candidate-verification/verify` | `CandidateVerificationController` | `verify()` | `InternalSecretGuard` | `backend/src/candidate-verification/candidate-verification.controller.ts` |
| `POST` | `/api/candidate-verification/write-guard` | `CandidateVerificationController` | `writeGuard()` | `InternalSecretGuard` | `backend/src/candidate-verification/candidate-verification.controller.ts` |

## Domaine `/chat`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `POST` | `/api/chat/ask` | `ChatController` | `HttpCode()` | `-` | `backend/src/chat/chat.controller.ts` |

## Domaine `/config`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `GET` | `/api/config/effective` | `EffectiveConfigController` | `getEffective()` | `-` | `backend/src/effective-config/effective-config.controller.ts` |

## Domaine `/dashboard`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `GET` | `/api/dashboard/capabilities` | `DashboardController` | `getCapabilities()` | `-` | `backend/src/dashboard/dashboard.controller.ts` |
| `GET` | `/api/dashboard/global` | `DashboardController` | `getGlobal()` | `-` | `backend/src/dashboard/dashboard.controller.ts` |
| `GET` | `/api/dashboard/jenkins-global` | `DashboardController` | `getJenkinsGlobal()` | `-` | `backend/src/dashboard/dashboard.controller.ts` |
| `GET` | `/api/dashboard/project/:id` | `DashboardController` | `getProject()` | `-` | `backend/src/dashboard/dashboard.controller.ts` |
| `GET` | `/api/dashboard/risk-indicators` | `DashboardController` | `getRiskIndicators()` | `-` | `backend/src/dashboard/dashboard.controller.ts` |
| `GET` | `/api/dashboard/security-global` | `DashboardController` | `getSecurityGlobal()` | `-` | `backend/src/dashboard/dashboard.controller.ts` |

## Domaine `/dockerfile`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `POST` | `/api/dockerfile/apply` | `DockerfileOptimizerController` | `apply()` | `JwtAuthGuard` | `backend/src/dockerfile-optimizer/dockerfile-optimizer.module.ts` |
| `POST` | `/api/dockerfile/fetch` | `DockerfileOptimizerController` | `fetch()` | `JwtAuthGuard` | `backend/src/dockerfile-optimizer/dockerfile-optimizer.module.ts` |
| `POST` | `/api/dockerfile/optimize` | `DockerfileOptimizerController` | `optimize()` | `JwtAuthGuard` | `backend/src/dockerfile-optimizer/dockerfile-optimizer.module.ts` |
| `POST` | `/api/dockerfile/optimize/:id/callback` | `DockerfileOptimizerController` | `receiveOptimizeCallback()` | `-` | `backend/src/dockerfile-optimizer/dockerfile-optimizer.module.ts` |
| `GET` | `/api/dockerfile/optimize/:id/status` | `DockerfileOptimizerController` | `getOptimizeStatus()` | `JwtAuthGuard` | `backend/src/dockerfile-optimizer/dockerfile-optimizer.module.ts` |

## Domaine `/healthz`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `GET` | `/api/healthz` | `HealthController` | `health()` | `-` | `backend/src/health.controller.ts` |

## Domaine `/incidents`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `GET` | `/api/incidents` | `IncidentsController` | `findAll()` | `JwtOrInternalSecretGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents` | `IncidentsController` | `create()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `DELETE` | `/api/incidents/:id` | `IncidentsController` | `remove()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `GET` | `/api/incidents/:id` | `IncidentsController` | `findOne()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `PUT` | `/api/incidents/:id` | `IncidentsController` | `update()` | `JwtOrInternalSecretGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/approve` | `IncidentsController` | `approveFix()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/correct-and-revalidate` | `IncidentsController` | `correctAndRevalidate()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/pr-validation` | `IncidentsController` | `requestPrValidation()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/pr-validation/ensure-parameter` | `IncidentsController` | `ensurePrValidationBootstrap()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/pr-validation/re-run` | `IncidentsController` | `reRunPrValidation()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/pr-validation/recompute-policy` | `IncidentsController` | `recomputePrValidationPolicy()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/pr-validation/reconcile` | `IncidentsController` | `reconcilePrValidation()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/pr-validation/refresh-target` | `IncidentsController` | `refreshPrValidationTarget()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/recover-post-write` | `IncidentsController` | `recoverPostWrite()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/reject` | `IncidentsController` | `rejectFix()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/remediation/:requestId/cancel` | `IncidentsController` | `cancelFixRequest()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/remediation/:requestId/execution-started` | `IncidentsController` | `recordExecutionStarted()` | `InternalSecretGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/remediation/:requestId/pre-write-gate` | `IncidentsController` | `preWriteGate()` | `InternalSecretGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/remediation/:requestId/reconcile-stale-dispatch` | `IncidentsController` | `reconcileStaleDispatch()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/retry` | `IncidentsController` | `retryFix()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/trigger-build` | `IncidentsController` | `triggerBuild()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/validation` | `IncidentsController` | `saveValidation()` | `InternalSecretGuard` | `backend/src/incidents/incidents.controller.ts` |
| `POST` | `/api/incidents/:id/workflow-status` | `IncidentsController` | `saveWorkflowStatus()` | `InternalSecretGuard` | `backend/src/incidents/incidents.controller.ts` |
| `GET` | `/api/incidents/project/:projectId/cycles` | `IncidentsController` | `convergence()` | `JwtAuthGuard` | `backend/src/incidents/incidents.controller.ts` |

## Domaine `/integration-fixtures`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `DELETE` | `/api/integration-fixtures/:fixtureId` | `IntegrationFixturesController` | `cleanup()` | `JwtAuthGuard` | `backend/src/integration-fixtures/integration-fixtures.controller.ts` |
| `POST` | `/api/integration-fixtures/wf2-context` | `IntegrationFixturesController` | `provision()` | `JwtAuthGuard` | `backend/src/integration-fixtures/integration-fixtures.controller.ts` |

## Domaine `/integrations`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `GET` | `/api/integrations` | `IntegrationsController` | `findAll()` | `-` | `backend/src/integrations/integrations.controller.ts` |
| `POST` | `/api/integrations` | `IntegrationsController` | `create()` | `-` | `backend/src/integrations/integrations.controller.ts` |
| `GET` | `/api/integrations/:id` | `IntegrationsController` | `findOne()` | `-` | `backend/src/integrations/integrations.controller.ts` |
| `PUT` | `/api/integrations/:id` | `IntegrationsController` | `update()` | `-` | `backend/src/integrations/integrations.controller.ts` |
| `POST` | `/api/integrations/:id/test` | `IntegrationsController` | `test()` | `-` | `backend/src/integrations/integrations.controller.ts` |

## Domaine `/internal`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `POST` | `/api/internal/security-remediation/batch-result` | `SecurityRemediationController` | `recordBatchResult()` | `InternalSecretGuard` | `backend/src/security-remediation/security-remediation.controller.ts` |
| `POST` | `/api/internal/security-remediation/evaluate` | `SecurityRemediationController` | `evaluate()` | `InternalSecretGuard` | `backend/src/security-remediation/security-remediation.controller.ts` |
| `POST` | `/api/internal/security-remediation/evaluate-batch` | `SecurityRemediationController` | `evaluateBatch()` | `InternalSecretGuard` | `backend/src/security-remediation/security-remediation.controller.ts` |
| `POST` | `/api/internal/security-remediation/result` | `SecurityRemediationController` | `recordResult()` | `InternalSecretGuard` | `backend/src/security-remediation/security-remediation.controller.ts` |
| `POST` | `/api/internal/security-remediation/revalidate` | `SecurityRemediationController` | `revalidate()` | `InternalSecretGuard` | `backend/src/security-remediation/security-remediation.controller.ts` |
| `POST` | `/api/internal/security-remediation/revalidate-batch` | `SecurityRemediationController` | `revalidateBatch()` | `InternalSecretGuard` | `backend/src/security-remediation/security-remediation.controller.ts` |
| `POST` | `/api/internal/test/retry-e2e-plan` | `RetryE2EHarnessController` | `create()` | `RetryE2EOperatorGuard` | `backend/src/security-remediation/retry-e2e-harness.controller.ts` |
| `POST` | `/api/internal/test/retry-e2e-plan/revoke` | `RetryE2EHarnessController` | `revoke()` | `RetryE2EOperatorGuard` | `backend/src/security-remediation/retry-e2e-harness.controller.ts` |

## Domaine `/jenkins`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `GET` | `/api/jenkins/analyses` | `JenkinsOptimizerController` | `UseGuards()` | `-` | `backend/src/jenkins-optimizer/jenkins-optimizer.module.ts` |
| `POST` | `/api/jenkins/apply` | `JenkinsOptimizerController` | `apply()` | `JwtAuthGuard` | `backend/src/jenkins-optimizer/jenkins-optimizer.module.ts` |
| `POST` | `/api/jenkins/apply/:applyId/callback` | `JenkinsOptimizerController` | `receiveApplyCallback()` | `-` | `backend/src/jenkins-optimizer/jenkins-optimizer.module.ts` |
| `GET` | `/api/jenkins/apply/:applyId/status` | `JenkinsOptimizerController` | `getApplyStatus()` | `-` | `backend/src/jenkins-optimizer/jenkins-optimizer.module.ts` |
| `POST` | `/api/jenkins/fetch` | `JenkinsOptimizerController` | `fetch()` | `JwtOrInternalSecretGuard` | `backend/src/jenkins-optimizer/jenkins-optimizer.module.ts` |
| `POST` | `/api/jenkins/optimize` | `JenkinsOptimizerController` | `optimize()` | `JwtOrInternalSecretGuard` | `backend/src/jenkins-optimizer/jenkins-optimizer.module.ts` |
| `POST` | `/api/jenkins/optimize/:id/callback` | `JenkinsOptimizerController` | `receiveOptimizeCallback()` | `-` | `backend/src/jenkins-optimizer/jenkins-optimizer.module.ts` |
| `GET` | `/api/jenkins/optimize/:id/status` | `JenkinsOptimizerController` | `getOptimizeStatus()` | `JwtOrInternalSecretGuard` | `backend/src/jenkins-optimizer/jenkins-optimizer.module.ts` |

## Domaine `/manual-remediation`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `GET` | `/api/manual-remediation` | `ManualRemediationController` | `list()` | `-` | `backend/src/manual-remediation/manual-remediation.controller.ts` |
| `POST` | `/api/manual-remediation/:id/abandon-target` | `ManualRemediationController` | `abandonTarget()` | `-` | `backend/src/manual-remediation/manual-remediation.controller.ts` |
| `PATCH` | `/api/manual-remediation/:id/complete` | `ManualRemediationController` | `complete()` | `-` | `backend/src/manual-remediation/manual-remediation.controller.ts` |
| `POST` | `/api/manual-remediation/:id/reconcile-stale-dispatch` | `ManualRemediationController` | `reconcileStaleDispatch()` | `-` | `backend/src/manual-remediation/manual-remediation.controller.ts` |
| `PATCH` | `/api/manual-remediation/:id/reopen` | `ManualRemediationController` | `reopen()` | `-` | `backend/src/manual-remediation/manual-remediation.controller.ts` |
| `POST` | `/api/manual-remediation/:id/retry` | `ManualRemediationController` | `retry()` | `-` | `backend/src/manual-remediation/manual-remediation.controller.ts` |
| `POST` | `/api/manual-remediation/launch-batch` | `ManualRemediationController` | `launchBatch()` | `-` | `backend/src/manual-remediation/manual-remediation.controller.ts` |
| `POST` | `/api/manual-remediation/legacy-reconciliation/:groupId/authorize-modern` | `LegacyReconciliationController` | `authorize()` | `JwtAuthGuard` | `backend/src/manual-remediation/legacy-reconciliation.controller.ts` |
| `POST` | `/api/manual-remediation/legacy-reconciliation/:groupId/eligibility` | `LegacyReconciliationController` | `eligibility()` | `JwtAuthGuard` | `backend/src/manual-remediation/legacy-reconciliation.controller.ts` |
| `POST` | `/api/manual-remediation/legacy-reconciliation/:groupId/reconcile` | `LegacyReconciliationController` | `reconcile()` | `JwtAuthGuard` | `backend/src/manual-remediation/legacy-reconciliation.controller.ts` |
| `GET` | `/api/manual-remediation/stale-targets` | `ManualRemediationController` | `staleTargets()` | `-` | `backend/src/manual-remediation/manual-remediation.controller.ts` |
| `GET` | `/api/manual-remediation/summary` | `ManualRemediationController` | `summary()` | `-` | `backend/src/manual-remediation/manual-remediation.controller.ts` |

## Domaine `/projects`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `GET` | `/api/projects` | `ProjectsController` | `findAll()` | `JwtAuthGuard` | `backend/src/projects/projects.controller.ts` |
| `POST` | `/api/projects` | `ProjectsController` | `create()` | `JwtAuthGuard` | `backend/src/projects/projects.controller.ts` |
| `DELETE` | `/api/projects/:id` | `ProjectsController` | `remove()` | `JwtAuthGuard` | `backend/src/projects/projects.controller.ts` |
| `GET` | `/api/projects/:id` | `ProjectsController` | `findOne()` | `JwtAuthGuard` | `backend/src/projects/projects.controller.ts` |
| `PUT` | `/api/projects/:id` | `ProjectsController` | `update()` | `JwtAuthGuard` | `backend/src/projects/projects.controller.ts` |
| `GET` | `/api/projects/:id/github-stats` | `ProjectsController` | `githubStats()` | `JwtAuthGuard` | `backend/src/projects/projects.controller.ts` |
| `PUT` | `/api/projects/:id/jenkins-credentials` | `ProjectsController` | `updateJenkinsCredentials()` | `JwtAuthGuard` | `backend/src/projects/projects.controller.ts` |
| `GET` | `/api/projects/:id/jenkins-status` | `ProjectsController` | `jenkinsStatus()` | `JwtAuthGuard` | `backend/src/projects/projects.controller.ts` |
| `GET` | `/api/projects/:id/sonar-metrics` | `ProjectsController` | `sonarMetrics()` | `JwtAuthGuard` | `backend/src/projects/projects.controller.ts` |
| `GET` | `/api/projects/:id/trivy-report` | `ProjectsController` | `trivyReport()` | `JwtAuthGuard` | `backend/src/projects/projects.controller.ts` |
| `POST` | `/api/projects/:id/validate` | `ProjectsController` | `validate()` | `JwtAuthGuard` | `backend/src/projects/projects.controller.ts` |
| `GET` | `/api/projects/internal/:id/sonar-correlation` | `ProjectsController` | `sonarCorrelation()` | `-` | `backend/src/projects/projects.controller.ts` |
| `GET` | `/api/projects/internal/by-job/:jobName(.*` | `ProjectsController` | `findByJobInternal()` | `-` | `backend/src/projects/projects.controller.ts` |

## Domaine `/reports`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `GET` | `/api/reports` | `ReportsController` | `UseGuards()` | `-` | `backend/src/reports/reports.controller.ts` |
| `POST` | `/api/reports` | `ReportsController` | `create()` | `JwtAuthGuard` | `backend/src/reports/reports.controller.ts` |
| `DELETE` | `/api/reports/:id` | `ReportsController` | `UseGuards()` | `-` | `backend/src/reports/reports.controller.ts` |
| `GET` | `/api/reports/:id` | `ReportsController` | `UseGuards()` | `JwtAuthGuard` | `backend/src/reports/reports.controller.ts` |
| `PUT` | `/api/reports/:id` | `ReportsController` | `updateJudgeDecision()` | `-` | `backend/src/reports/reports.controller.ts` |

## Domaine `/webhooks`

| Méthode | Chemin | Contrôleur | Handler | Garde | Fichier |
|---|---|---|---|---|---|
| `POST` | `/api/webhooks/jenkins/:projectId` | `WebhooksController` | `jenkins()` | `-` | `backend/src/webhooks/webhooks.controller.ts` |
| `POST` | `/api/webhooks/jenkins/by-job/:jobName(.*` | `WebhooksController` | `jenkinsByJob()` | `-` | `backend/src/webhooks/webhooks.controller.ts` |
| `POST` | `/api/webhooks/sonarqube/:projectId` | `WebhooksController` | `sonar()` | `-` | `backend/src/webhooks/webhooks.controller.ts` |
| `POST` | `/api/webhooks/trivy/:projectId` | `WebhooksController` | `trivy()` | `-` | `backend/src/webhooks/webhooks.controller.ts` |

> Les quatre routes `webhooks` ne déclarent aucune garde : elles sont conçues pour
> être appelées par des outils externes (Jenkins, SonarQube, Trivy) qui ne portent
> pas de JWT. C'est une caractéristique connue de la surface d'ingestion,
> documentée en `38` (limitations connues) et en `35` (frontières de confiance).
