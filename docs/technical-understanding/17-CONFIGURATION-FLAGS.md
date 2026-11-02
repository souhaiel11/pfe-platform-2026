# 17 — DRAPEAUX DE CONFIGURATION

**37 variables d'environnement** sont réellement lues par le runtime backend
(`process.env.X` ou `config.get('X')` hors fichiers de test). Aucune valeur de secret
n'est reproduite ici — uniquement le nom, le rôle et la valeur sûre.

## Drapeaux critiques pour la sûreté

| Drapeau | Valeur sûre | Valeur dangereuse | Rôle |
|---|---|---|---|
| `SECURITY_REMEDIATION_DISPATCH_ENABLED` | `false` | `true` / absent | Interrupteur d'admission du dispatch de remédiation. **Attention : absent ⇒ autorisé** (`security-remediation-lifecycle.ts` : `if (value === undefined || value === 'true') return;`). L'image backend qualifiée le force à `false`. |
| `SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED` | `false` | `true` | Active le harnais de test E2E. Exige en plus un plan autorisé, non expiré, à usage unique. |
| `DEPLOYMENT_AUTHORIZATION_REQUIRED` | `true` | `false` / absent | Quand `true`, **tout** `POST /azure-deploy/deploy` exige un `authorizationId` : le chemin historique sans autorisation est refusé (409). |
| `DB_SYNCHRONIZE` | `false` | `true` | `true` laisserait TypeORM modifier le schéma au démarrage. |
| `INTEGRATION_FIXTURES_ENABLED` | `false` | `true` hors production | Routes de fixtures d'intégration. Neutralisées de toute façon si `NODE_ENV=production`. |
| `NODE_ENV` | `production` | — | Ferme indépendamment les routes de fixtures. |

## Inventaire complet (lu par le runtime)

| Drapeau | Fichier(s) qui le lisent |
|---|---|
| `AZURE_DEPLOY_AGENT_SECRET` | `backend/src/azure-deploy/azure-deploy.module.ts` |
| `AZURE_DEPLOY_AGENT_URL` | `backend/src/azure-deploy/azure-deploy.module.ts` |
| `BUILDER_SCANNER_URL` | `backend/src/dependency-compatibility/v1_8-enforcement-mode.ts` |
| `CANDIDATE_VERIFIER_URL` | `backend/src/candidate-verification/candidate-verification.service.ts` |
| `DB_HOST` | `backend/src/app.module.ts`, `backend/src/scripts/normalize-real-project.ts`, `backend/src/scripts/owasp-controlled-resync.ts` … |
| `DB_NAME` | `backend/src/app.module.ts`, `backend/src/scripts/normalize-real-project.ts`, `backend/src/scripts/owasp-controlled-resync.ts` … |
| `DB_PASS` | `backend/src/app.module.ts`, `backend/src/scripts/normalize-real-project.ts`, `backend/src/scripts/owasp-controlled-resync.ts` … |
| `DB_PORT` | `backend/src/scripts/normalize-real-project.ts`, `backend/src/scripts/owasp-controlled-resync.ts`, `backend/src/scripts/recalculate-security-scores.ts` … |
| `DB_SYNCHRONIZE` | `backend/src/app.module.ts` |
| `DB_USER` | `backend/src/app.module.ts`, `backend/src/scripts/normalize-real-project.ts`, `backend/src/scripts/owasp-controlled-resync.ts` … |
| `DEPLOYMENT_AUTHORIZATION_REQUIRED` | `backend/src/azure-deploy/azure-deploy.module.ts` |
| `INTEGRATION_FIXTURES_ENABLED` | `backend/src/integration-fixtures/integration-fixtures.service.ts` |
| `JWT_SECRET` | `backend/src/auth/auth.module.ts`, `backend/src/auth/jwt.strategy.ts`, `backend/src/webhooks/webhooks.module.ts` |
| `N8N_API_KEY` | `backend/src/incidents/incidents.service.ts`, `backend/src/incidents/n8n-execution-client.ts`, `backend/src/manual-remediation/legacy-remote-settlement.ts` |
| `N8N_API_URL` | `backend/src/incidents/n8n-execution-client.ts`, `backend/src/manual-remediation/legacy-remote-settlement.ts` |
| `N8N_CALLBACK_SECRET` | `backend/src/dockerfile-optimizer/dockerfile-optimizer.module.ts`, `backend/src/jenkins-optimizer/jenkins-optimizer.module.ts` |
| `N8N_INTERNAL_SECRET` | `backend/src/auth/internal-secret.guard.ts`, `backend/src/auth/jwt-or-internal-secret.guard.ts`, `backend/src/dockerfile-optimizer/dockerfile-optimizer.module.ts` … |
| `N8N_URL` | `backend/src/chat/chat.controller.ts`, `backend/src/dependency-compatibility/v1_8-enforcement-mode.ts`, `backend/src/dockerfile-optimizer/dockerfile-optimizer.module.ts` … |
| `N8N_WF2_ID` | `backend/src/incidents/incidents.service.ts`, `backend/src/integration-fixtures/integration-fixtures.service.ts` |
| `N8N_WF2_WEBHOOK` | `backend/src/incidents/incidents.service.ts` |
| `N8N_WF4_APPLY_WEBHOOK` | `backend/src/incidents/incidents.service.ts` |
| `N8N_WF5_APPLY_WEBHOOK` | `backend/src/incidents/incidents.service.ts` |
| `NODE_ENV` | `backend/src/integration-fixtures/integration-fixtures.service.ts` |
| `PORT` | `backend/src/main.ts` |
| `ROUTED_BUILD_TTL_MS` | `backend/src/webhooks/webhooks.service.ts` |
| `SECURITY_LEGACY_RECONCILIATION_ENABLED` | `backend/src/manual-remediation/legacy-reconciliation.service.ts` |
| `SECURITY_LEGACY_SETTLEMENT_RECEIPTS_FILE` | `backend/src/manual-remediation/legacy-remote-settlement.ts` |
| `SECURITY_REMEDIATION_DISPATCH_ENABLED` | `backend/src/manual-remediation/legacy-reconciliation.service.ts`, `backend/src/manual-remediation/legacy-remote-settlement.ts`, `backend/src/manual-remediation/security-remediation-lifecycle.ts` |
| `SECURITY_REMEDIATION_E2E_OPERATOR_SECRET` | `backend/src/security-remediation/retry-e2e-harness.controller.ts` |
| `SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED` | `backend/src/security-remediation/retry-e2e-harness.logic.ts` |
| `SECURITY_REMEDIATION_E2E_TEST_PROJECT_ID` | `backend/src/security-remediation/retry-e2e-harness.service.ts` |
| `SECURITY_REMEDIATION_MAX_ATTEMPTS` | `backend/src/manual-remediation/security-remediation-lifecycle.ts` |
| `SECURITY_TEST_REPO` | `backend/src/dependency-compatibility/v1_8_phase2_shadow_report.ts`, `backend/src/dependency-compatibility/v1_8_phase3_shadow_report.ts`, `backend/src/dependency-compatibility/v1_8_phase4_generate_evidence_store.ts` |
| `SELF_API_URL` | `backend/src/webhooks/webhooks.service.ts` |
| `V1_8_SECURITY_ENFORCEMENT` | `backend/src/dependency-compatibility/v1_8-enforcement-mode.ts` |
| `WF2_STALE_DISPATCH_MS` | `backend/src/incidents/incidents.service.ts` |
| `WF6_STALE_DISPATCH_MS` | `backend/src/manual-remediation/manual-remediation.service.ts` |

Les secrets (`JWT_SECRET`, `DB_PASS`, `N8N_*_SECRET`, `AZURE_DEPLOY_AGENT_SECRET`,
`BUILDER_INTERNAL_SECRET`, `N8N_API_KEY`) sont lus depuis l'environnement et ne sont
**jamais** transmis au frontend ni au plan d'exécution. Voir `35-` dans
`01-GLOBAL-ARCHITECTURE.md` pour les frontières de confiance.