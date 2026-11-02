# 20 — CATALOGUE DES TABLES DE BASE DE DONNÉES

Lu **en lecture seule sur la base réelle** (`pfe-postgres`, base `devsecops`).
**16 tables** dans le schéma `public`.

> Aucune table de registre de migrations n'existe : le schéma est appliqué par
> procédure opérateur à partir de `backend/migrations/*.sql`, et l'état appliqué
> est attesté par les rapports de campagne sous `docs/qa/`. C'est une limitation
> assumée, documentée en `38` (limitations connues).

## `bugs`

Anomalies de qualité ingérées depuis les webhooks SonarQube.

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 0

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `uuid_generate_v4()` |
| `projectId` | uuid | non | — |
| `title` | character varying | non | — |
| `rawMessage` | text | oui | — |
| `humanReadableExplanation` | text | oui | — |
| `aiFixSuggestion` | text | oui | — |
| `filePath` | character varying | oui | — |
| `lineNumber` | integer | oui | — |
| `ruleId` | character varying | oui | — |
| `severity` | USER-DEFINED | non | `'medium'::bugs_severity_enum` |
| `status` | USER-DEFINED | non | `'open'::bugs_status_enum` |
| `source` | USER-DEFINED | non | `'manual'::bugs_source_enum` |
| `prUrl` | character varying | oui | — |
| `prNumber` | integer | oui | — |
| `fixConfidence` | double precision | oui | — |
| `n8nWorkflowId` | character varying | oui | — |
| `metadata` | jsonb | oui | — |
| `createdAt` | timestamp without time zone | non | `now()` |
| `updatedAt` | timestamp without time zone | non | `now()` |

**Clés étrangères**

- `FK_b2b8219ad96da5bb8df99c8ea39 : projectId -> projects(id) ON DELETE CASCADE`

**Index**

- `CREATE UNIQUE INDEX "PK_dadac7f01b703d50496ae1d3e74" ON public.bugs USING btree (id)`

## `deployment_artifacts`

Artefacts (images) dont la provenance a été prouvée pour un commit/build donné.

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 2

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `gen_random_uuid()` |
| `projectId` | character varying | non | — |
| `buildNumber` | integer | non | — |
| `commitSha` | character varying | non | — |
| `registry` | character varying | non | — |
| `repository` | character varying | non | — |
| `tag` | character varying | non | — |
| `digest` | character varying | non | — |
| `source` | USER-DEFINED | non | — |
| `provenanceVerified` | boolean | non | `false` |
| `provenanceEvidence` | text | oui | — |
| `createdAt` | timestamp without time zone | non | `now()` |

**Index**

- `CREATE INDEX "IDX_deployment_artifact_project_build" ON public.deployment_artifacts USING btree ("projectId", "buildNumber")`
- `CREATE UNIQUE INDEX "UQ_deployment_artifact_digest" ON public.deployment_artifacts USING btree (registry, repository, digest)`
- `CREATE UNIQUE INDEX deployment_artifacts_pkey ON public.deployment_artifacts USING btree (id)`

## `deployment_attempts`

Trace d'audit append-only d'un dispatch de déploiement : identité immuable + instantané de risque + statut terminal.

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 0

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `gen_random_uuid()` |
| `authorizationId` | uuid | non | — |
| `requestId` | character varying | non | — |
| `projectId` | uuid | non | — |
| `incidentId` | uuid | oui | — |
| `mainBuildNumber` | integer | non | — |
| `actorUserId` | character varying | non | — |
| `actorRole` | character varying | non | — |
| `commitSha` | character varying | non | — |
| `artifactDigest` | character varying | non | — |
| `registry` | character varying | non | — |
| `repository` | character varying | non | — |
| `environmentIdentityHash` | character varying | non | — |
| `governanceDecision` | text | non | — |
| `authorizationMode` | text | non | — |
| `reason` | text | oui | — |
| `riskSnapshot` | jsonb | non | `'{}'::jsonb` |
| `dispatchStatus` | USER-DEFINED | non | `'DISPATCHING'::deployment_attempts_dispatch_status_enum` |
| `dispatchResult` | jsonb | oui | — |
| `createdAt` | timestamp without time zone | non | `now()` |
| `completedAt` | timestamp without time zone | oui | — |

**Clés étrangères**

- `deployment_attempts_authorization_fk : authorizationId -> deployment_authorizations(id) ON DELETE RESTRICT`
- `deployment_attempts_project_fk : projectId -> projects(id) ON DELETE CASCADE`
- `deployment_attempts_incident_fk : incidentId -> incidents(id) ON DELETE SET NULL`

**Index**

- `CREATE INDEX "IDX_deployment_attempt_authorization" ON public.deployment_attempts USING btree ("authorizationId")`
- `CREATE INDEX "IDX_deployment_attempt_project" ON public.deployment_attempts USING btree ("projectId")`
- `CREATE INDEX "IDX_deployment_attempt_request" ON public.deployment_attempts USING btree ("requestId")`
- `CREATE UNIQUE INDEX deployment_attempts_authorization_uq ON public.deployment_attempts USING btree ("authorizationId")`
- `CREATE UNIQUE INDEX deployment_attempts_pkey ON public.deployment_attempts USING btree (id)`

## `deployment_authorizations`

Autorisation de déploiement Azure : gèle la décision de gouvernance et l'identité d'artefact au moment de l'autorisation. Courte durée, usage unique.

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 0

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `gen_random_uuid()` |
| `projectId` | uuid | non | — |
| `incidentId` | uuid | oui | — |
| `mainBuildNumber` | integer | non | — |
| `commitSha` | character varying | non | — |
| `artifactDigest` | character varying | non | — |
| `artifactTag` | character varying | non | — |
| `registry` | character varying | non | — |
| `repository` | character varying | non | — |
| `environmentIdentityHash` | character varying | non | — |
| `decisionAtAuthorization` | text | non | — |
| `securityValidationApplicability` | text | non | — |
| `riskSnapshot` | jsonb | non | `'{}'::jsonb` |
| `failedControls` | jsonb | non | `'[]'::jsonb` |
| `warnings` | jsonb | non | `'[]'::jsonb` |
| `requestedByUserId` | character varying | non | — |
| `requestedByRole` | character varying | non | — |
| `authorizationMode` | USER-DEFINED | non | — |
| `reason` | text | oui | — |
| `acknowledgements` | jsonb | oui | — |
| `authorizationIdentityHash` | character varying | non | — |
| `status` | USER-DEFINED | non | `'CREATED'::deployment_authorizations_status_enum` |
| `createdAt` | timestamp without time zone | non | `now()` |
| `consumedAt` | timestamp without time zone | oui | — |
| `expiresAt` | timestamp without time zone | oui | — |

**Clés étrangères**

- `deployment_authorizations_project_fk : projectId -> projects(id) ON DELETE CASCADE`
- `deployment_authorizations_incident_fk : incidentId -> incidents(id) ON DELETE SET NULL`

**Index**

- `CREATE INDEX "IDX_deployment_authorization_project_status" ON public.deployment_authorizations USING btree ("projectId", status)`
- `CREATE UNIQUE INDEX deployment_authorizations_pkey ON public.deployment_authorizations USING btree (id)`

## `dockerfile_analyses`

Analyses de Dockerfile produites par WF5.

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 25

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `uuid_generate_v4()` |
| `projectId` | uuid | non | — |
| `jobId` | character varying | non | — |
| `sourceDockerfile` | text | oui | — |
| `sourcePomXml` | text | oui | — |
| `status` | USER-DEFINED | non | `'pending'::dockerfile_analyses_status_enum` |
| `result` | jsonb | oui | — |
| `reason` | character varying | oui | — |
| `detail` | character varying | oui | — |
| `createdAt` | timestamp without time zone | non | `now()` |
| `settledAt` | timestamp without time zone | oui | — |
| `sourceAppConfig` | text | oui | — |

**Clés étrangères**

- `FK_8b736e6bcaa5dfca63a61a5df74 : projectId -> projects(id) ON DELETE CASCADE`

**Index**

- `CREATE UNIQUE INDEX "PK_c9bf8152c3cd80397c224983ff3" ON public.dockerfile_analyses USING btree (id)`
- `CREATE UNIQUE INDEX "UQ_dfaddfa336d94491c571ef2eccd" ON public.dockerfile_analyses USING btree ("jobId")`

## `incidents`

Incident = une exécution de pipeline observée (build Jenkins) et son contexte. Porte `metadata.sourceCommitSha`, le commit de confiance utilisé comme ancrage d'identité.

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 249

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `uuid_generate_v4()` |
| `projectId` | uuid | non | — |
| `title` | character varying | non | — |
| `description` | text | oui | — |
| `status` | USER-DEFINED | non | `'pending'::incidents_status_enum` |
| `source` | character varying | oui | — |
| `metadata` | jsonb | oui | — |
| `prUrl` | character varying | oui | — |
| `aiAnalysis` | character varying | oui | — |
| `createdAt` | timestamp without time zone | non | `now()` |
| `updatedAt` | timestamp without time zone | non | `now()` |
| `jenkinsJobName` | character varying | oui | — |
| `buildNumber` | integer | oui | — |
| `resolvedAt` | timestamp without time zone | oui | — |
| `errorReason` | character varying | oui | — |
| `errorDetail` | text | oui | — |
| `errorStep` | character varying | oui | — |

**Clés étrangères**

- `FK_b59253407df1320b7abadc3d4dd : projectId -> projects(id) ON DELETE CASCADE`

**Index**

- `CREATE UNIQUE INDEX "PK_ccb34c01719889017e2246469f9" ON public.incidents USING btree (id)`

## `integrations`

Configuration des intégrations externes de la plateforme (URL/état), pilotée depuis l'écran Paramètres.

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 2

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `uuid_generate_v4()` |
| `toolType` | USER-DEFINED | non | — |
| `name` | character varying | non | — |
| `url` | character varying | non | — |
| `token` | character varying | oui | — |
| `username` | character varying | oui | — |
| `password` | character varying | oui | — |
| `enabled` | boolean | non | `true` |
| `status` | USER-DEFINED | non | `'disconnected'::integrations_status_enum` |
| `lastChecked` | timestamp without time zone | oui | — |
| `metadata` | jsonb | oui | — |
| `createdAt` | timestamp without time zone | non | `now()` |
| `updatedAt` | timestamp without time zone | non | `now()` |

**Index**

- `CREATE UNIQUE INDEX "PK_9adcdc6d6f3922535361ce641e8" ON public.integrations USING btree (id)`
- `CREATE UNIQUE INDEX "UQ_b5083d53bdb4291bad344a5e175" ON public.integrations USING btree ("toolType")`

## `jenkins_analyses`

Analyses de Jenkinsfile produites par WF4.

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 64

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `uuid_generate_v4()` |
| `projectId` | uuid | non | — |
| `jobId` | character varying | non | — |
| `status` | USER-DEFINED | non | `'pending'::jenkins_analyses_status_enum` |
| `result` | jsonb | oui | — |
| `reason` | character varying | oui | — |
| `detail` | character varying | oui | — |
| `createdAt` | timestamp without time zone | non | `now()` |
| `settledAt` | timestamp without time zone | oui | — |
| `sourceJenkinsfile` | text | oui | — |

**Clés étrangères**

- `FK_4d7ed692a1b91faa575d886d5e2 : projectId -> projects(id) ON DELETE CASCADE`

**Index**

- `CREATE UNIQUE INDEX "PK_fe156d6ba6ea841b7a62c99f656" ON public.jenkins_analyses USING btree (id)`
- `CREATE UNIQUE INDEX "UQ_de1d381707e4ed9c26394e0480a" ON public.jenkins_analyses USING btree ("jobId")`

## `jenkins_applies`

Traces d'application d'un correctif de Jenkinsfile (callback WF4).

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 21

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `uuid_generate_v4()` |
| `applyId` | character varying | non | — |
| `analysisJobId` | character varying | non | — |
| `status` | USER-DEFINED | non | `'pending'::jenkins_applies_status_enum` |
| `result` | jsonb | oui | — |
| `createdAt` | timestamp without time zone | non | `now()` |
| `settledAt` | timestamp without time zone | oui | — |

**Index**

- `CREATE UNIQUE INDEX "PK_52ad133cb8d1c350a31b7d3e80d" ON public.jenkins_applies USING btree (id)`
- `CREATE UNIQUE INDEX "UQ_60fc56323f6a93485a674b611ce" ON public.jenkins_applies USING btree ("applyId")`

## `manual_remediation_tasks`

**Table centrale de la remédiation.** Une ligne = un finding promu en tâche suivable. Sépare `status` (cycle de vie de la tâche) de `scannerStatus` (vérité du scanner), et porte `securityFindingRemediation` (jsonb) avec la chaîne des tentatives.

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 777

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `gen_random_uuid()` |
| `projectId` | uuid | non | — |
| `incidentId` | uuid | oui | — |
| `findingId` | character varying | oui | — |
| `findingFingerprint` | character varying | non | — |
| `source` | character varying | non | — |
| `ruleOrCve` | character varying | oui | — |
| `title` | text | non | — |
| `severity` | character varying | oui | — |
| `remediationType` | character varying | oui | — |
| `findingSnapshot` | jsonb | non | `'{}'::jsonb` |
| `status` | USER-DEFINED | non | `'TODO'::manual_remediation_tasks_status_enum` |
| `scannerStatus` | USER-DEFINED | non | `'DETECTED'::manual_remediation_tasks_scanner_status_enum` |
| `completedByUserId` | character varying | oui | — |
| `completedByDisplayName` | character varying | oui | — |
| `completedAt` | timestamp without time zone | oui | — |
| `completionNote` | character varying | oui | — |
| `lastSeenBuild` | integer | oui | — |
| `verifiedBuild` | integer | oui | — |
| `verifiedAt` | timestamp without time zone | oui | — |
| `events` | jsonb | non | `'[]'::jsonb` |
| `createdAt` | timestamp without time zone | non | `now()` |
| `updatedAt` | timestamp without time zone | non | `now()` |
| `securityFindingRemediation` | jsonb | oui | — |
| `securityRemediationBatchId` | character varying | oui | — |

**Clés étrangères**

- `manual_remediation_tasks_project_fk : projectId -> projects(id) ON DELETE CASCADE`
- `manual_remediation_tasks_incident_fk : incidentId -> incidents(id) ON DELETE SET NULL`

**Index**

- `CREATE INDEX idx_manual_remediation_tasks_batch_id ON public.manual_remediation_tasks USING btree ("securityRemediationBatchId")`
- `CREATE INDEX manual_remediation_tasks_incident_idx ON public.manual_remediation_tasks USING btree ("incidentId")`
- `CREATE UNIQUE INDEX manual_remediation_tasks_pkey ON public.manual_remediation_tasks USING btree (id)`
- `CREATE UNIQUE INDEX manual_remediation_tasks_project_fingerprint_uq ON public.manual_remediation_tasks USING btree ("projectId", "findingFingerprint")`
- `CREATE INDEX manual_remediation_tasks_project_status_idx ON public.manual_remediation_tasks USING btree ("projectId", status)`

## `projects`

Référentiel des projets audités. Porte toute la configuration **par projet** : dépôt GitHub, job Jenkins, clé Sonar, `azureConfig` (cible de déploiement, sans secret) et `azureDeploymentState` (registre d'idempotence du dernier dispatch).

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 5

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `uuid_generate_v4()` |
| `name` | character varying | non | — |
| `description` | character varying | oui | — |
| `githubRepo` | character varying | oui | — |
| `githubToken` | character varying | oui | — |
| `sonarqubeKey` | character varying | oui | — |
| `sonarqubeUrl` | character varying | oui | — |
| `sonarqubeToken` | character varying | oui | — |
| `jenkinsUrl` | character varying | oui | — |
| `jenkinsJobName` | character varying | oui | — |
| `jenkinsToken` | character varying | oui | — |
| `environment` | USER-DEFINED | non | `'dev'::projects_environment_enum` |
| `status` | USER-DEFINED | non | `'healthy'::projects_status_enum` |
| `tags` | text | oui | — |
| `securityScore` | double precision | oui | `'100'::double precision` |
| `isActive` | boolean | non | `true` |
| `createdAt` | timestamp without time zone | non | `now()` |
| `updatedAt` | timestamp without time zone | non | `now()` |
| `cicdTool` | USER-DEFINED | non | `'jenkins'::projects_cicdtool_enum` |
| `emailEnabled` | boolean | non | `false` |
| `emailRecipient` | character varying | oui | — |
| `slackEnabled` | boolean | non | `false` |
| `slackChannel` | character varying | oui | — |
| `slackToken` | character varying | oui | — |
| `validationStatus` | jsonb | oui | — |
| `source` | character varying | oui | — |
| `jenkinsJobPath` | character varying | oui | — |
| `deployReadyNotified` | boolean | non | `false` |
| `azureConfig` | jsonb | oui | — |
| `azureDeploymentState` | jsonb | oui | — |
| `jenkinsInternalUrl` | character varying | oui | — |
| `jenkinsPublicUrl` | character varying | oui | — |

**Index**

- `CREATE UNIQUE INDEX "PK_6271df0a7aed1d6c0691ce6ac50" ON public.projects USING btree (id)`
- `CREATE UNIQUE INDEX "UQ_2187088ab5ef2a918473cb99007" ON public.projects USING btree (name)`

## `remediation_target_reservations`

Verrou **écrivain unique** (Phase 4G) sur un couple (projet, fichier cible). Garantit par contrainte PostgreSQL qu'une seule remédiation écrit un fichier donné à la fois.

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 2

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | — |
| `projectId` | uuid | non | — |
| `targetKey` | text | non | — |
| `targetFile` | character varying | non | — |
| `ownerTaskId` | uuid | non | — |
| `ownerAttemptId` | uuid | oui | — |
| `ownerBatchId` | character varying | oui | — |
| `claims` | jsonb | non | — |
| `state` | character varying | non | — |
| `createdAt` | timestamp with time zone | non | `now()` |
| `updatedAt` | timestamp with time zone | non | `now()` |
| `expiresAt` | timestamp with time zone | oui | — |
| `releasedAt` | timestamp with time zone | oui | — |
| `releaseReason` | text | oui | — |

**Contraintes CHECK** (invariants garantis par PostgreSQL, pas seulement par le code)

- `CHECK ((jsonb_typeof(claims) = 'object'::text))`
- `CHECK (((state)::text = ANY ((ARRAY['ACTIVE'::character varying, 'RELEASED'::character varying])::text[])))`
- `CHECK (("expiresAt" IS NULL))`
- `CHECK (((((state)::text = 'ACTIVE'::text) AND (claims <> '{}'::jsonb) AND ("releasedAt" IS NULL)) OR (((state)::text = 'RELEASED'::text) AND (claims = '{}'::jsonb) AND ("releasedAt" IS NOT NULL))))`

**Index**

- `CREATE UNIQUE INDEX remediation_target_one_active ON public.remediation_target_reservations USING btree ("projectId", "targetKey") WHERE ((state)::text = 'ACTIVE'::text)`
- `CREATE UNIQUE INDEX remediation_target_reservations_pkey ON public.remediation_target_reservations USING btree (id)`
- `CREATE INDEX remediation_target_stale ON public.remediation_target_reservations USING btree ("updatedAt") WHERE ((state)::text = 'ACTIVE'::text)`

## `reports`

Rapports d'analyse produits par la chaîne CI (type `COMBINED` notamment). `rawData` contient le bloc brut normalisé des scanners ; c'est la source des signaux de risque de la gouvernance.

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 63

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `uuid_generate_v4()` |
| `projectId` | uuid | non | — |
| `type` | USER-DEFINED | non | — |
| `rawData` | jsonb | non | — |
| `aiSummary` | text | oui | — |
| `securityScore` | double precision | oui | — |
| `riskLevel` | character varying | oui | — |
| `createdAt` | timestamp without time zone | non | `now()` |
| `judgeDecision` | character varying | oui | — |
| `judgeConfidence` | double precision | oui | — |
| `archived` | boolean | non | `false` |

**Clés étrangères**

- `FK_b123aed1a96e282b13ac2abcb31 : projectId -> projects(id) ON DELETE CASCADE`

**Index**

- `CREATE UNIQUE INDEX "PK_d9013193989303580053c0b5ef6" ON public.reports USING btree (id)`

## `routed_builds`

Garde anti-boucle du routage automatique WF4/WF5 : empreinte `sha256(projectId:type:errorReason)` + TTL.

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 3

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `uuid_generate_v4()` |
| `hash` | character varying | non | — |
| `projectId` | character varying | non | — |
| `classificationType` | character varying | non | — |
| `errorReason` | text | non | — |
| `routedAt` | timestamp without time zone | non | `now()` |
| `expiresAt` | timestamp without time zone | non | — |

**Index**

- `CREATE INDEX "IDX_b03b4e53fb4e9cc7cafc01e1ee" ON public.routed_builds USING btree (hash)`
- `CREATE UNIQUE INDEX "PK_7f63a9abcc9a91056766ae695a5" ON public.routed_builds USING btree (id)`

## `security_remediation_retry_e2e_plans`

Plans d'autorisation du harnais de test E2E de retry : portée exacte, expiration, consommation unique.

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 2

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | — |
| `projectId` | uuid | non | — |
| `taskId` | uuid | non | — |
| `state` | character varying | non | — |
| `plan` | jsonb | non | — |
| `createdAt` | timestamp with time zone | non | `now()` |
| `updatedAt` | timestamp with time zone | non | `now()` |

**Contraintes CHECK** (invariants garantis par PostgreSQL, pas seulement par le code)

- `CHECK (((state)::text = ANY ((ARRAY['ACTIVE'::character varying, 'COMPLETED'::character varying, 'REVOKED'::character varying, 'EXPIRED'::character varying])::text[])))`
- `CHECK ((((plan ->> 'projectId'::text) IS NOT NULL) AND ((plan ->> 'taskId'::text) IS NOT NULL) AND ((plan ->> 'projectId'::text) = ("projectId")::text) AND ((plan ->> 'taskId'::text) = ("taskId")::text)))`

**Index**

- `CREATE UNIQUE INDEX security_remediation_retry_e2e_one_active ON public.security_remediation_retry_e2e_plans USING btree (state) WHERE ((state)::text = 'ACTIVE'::text)`
- `CREATE UNIQUE INDEX security_remediation_retry_e2e_plans_pkey ON public.security_remediation_retry_e2e_plans USING btree (id)`
- `CREATE UNIQUE INDEX "security_remediation_retry_e2e_plans_taskId_key" ON public.security_remediation_retry_e2e_plans USING btree ("taskId")`

## `users`

Comptes de la plateforme et leur rôle (`admin`, `developer`, `viewer`).

- **Clé primaire** : `id`
- **Lignes au moment de la rédaction** : 5

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| `id` | uuid | non | `uuid_generate_v4()` |
| `email` | character varying | non | — |
| `password` | character varying | non | — |
| `name` | character varying | oui | — |
| `role` | USER-DEFINED | non | `'developer'::users_role_enum` |
| `isActive` | boolean | non | `true` |
| `createdAt` | timestamp without time zone | non | `now()` |

**Index**

- `CREATE UNIQUE INDEX "PK_a3ffb1c0c8416b9fc6f907b7433" ON public.users USING btree (id)`
- `CREATE UNIQUE INDEX "UQ_97672ac88f789774dd47f7c8be3" ON public.users USING btree (email)`
