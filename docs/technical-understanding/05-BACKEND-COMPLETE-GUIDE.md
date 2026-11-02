# 05 — GUIDE COMPLET DU BACKEND

Le backend est **la source de vérité**. 347 fichiers `.ts` (217 de runtime, 130 de test),
24 modules, **119 routes**. Catalogue exhaustif : `18-FILE-RESPONSIBILITY-CATALOG.md` et
`19-API-CONTRACT-CATALOG.md`.

Ce document explique par **domaine métier**, pas par arborescence.

---

## 1. Amorçage — `backend/src/main.ts`

| Élément | Valeur | Pourquoi |
|---|---|---|
| préfixe global | `api`, avec `healthz` **exclu** | la sonde de santé doit rester à la racine |
| parseurs de corps | `json({ limit: '100mb' })` | les rapports DevSecOps sont volumineux |
| CORS | `origin: '*', credentials: true` | configuration permissive, voir `38` |
| validation | `ValidationPipe({ whitelist: true, transform: true })` | tout champ non déclaré dans un DTO est **supprimé** |
| WebSocket | `IoAdapter` | `incident:updated` temps réel |
| Swagger | `api/docs` | surface d'API exposée |
| port | `PORT ?? 3001` | — |

**`whitelist: true` est un point de sécurité** : même si le frontend envoie
`{ mode, decision, artifactDigest }`, les champs absents du DTO sont éliminés avant
d'atteindre le service. C'est la première barrière contre un client qui tenterait
d'imposer une décision.

---

## 2. Domaine *Authentification et autorisation*

**Fichiers** : `auth/auth.module.ts`, `auth.controller.ts`, `auth.service.ts`,
`jwt.strategy.ts`, `jwt-auth.guard.ts`, `internal-secret.guard.ts`,
`jwt-or-internal-secret.guard.ts`, `user.entity.ts`.

### Les quatre gardes

| Garde | Pour qui | Comportement |
|---|---|---|
| `JwtAuthGuard` | le navigateur | distingue `TOKEN_EXPIRED` de `TOKEN_INVALID`, pour que le front sache s'il peut conserver la session |
| `InternalSecretGuard` | **n8n uniquement** | `return !!N8N_INTERNAL_SECRET && secret === N8N_INTERNAL_SECRET` → **fail-closed** : secret serveur absent ⇒ refus **systématique** |
| `JwtOrInternalSecretGuard` | routes partagées | l'un **ou** l'autre |
| `RetryE2EOperatorGuard` | opérateur de test | secret dédié |

### Les rôles

Trois rôles : `admin`, `developer`, `viewer`. Point de conception notable : les
vérifications de rôle sont faites **dans les services**, pas seulement dans les
contrôleurs (ex. `manual-remediation.service.ts` lignes 465, 475, 511, 725, 803, 826,
839-841). Un futur contrôleur mal protégé ne contourne donc pas la règle métier.

---

## 3. Domaine *Projets*

**Fichiers** : `projects/project.entity.ts`, `projects.service.ts`,
`projects.controller.ts`, `dto/create-project.dto.ts`.

`Project` porte **toute la configuration par projet** (32 colonnes) : `githubRepo`,
`jenkinsJobName`, clé Sonar, `azureConfig`, `azureDeploymentState`.

### `AzureDeploymentConfig` — le modèle de configuration générique

```ts
provider: 'azure-container-instances'
resourceGroup, targetName, registry, imageRepository
region?, subscriptionRef?, cpu?, memoryInGb?, ports?
healthCheck?: { path, port, client: 'curl'|'wget', expectedBody }
```

**Aucun secret** : les credentials Azure restent dans l'environnement de l'agent hôte.
C'est ce modèle qui rend la plateforme multi-projet sans toucher au code : ajouter un
projet, c'est ajouter une ligne, pas modifier une source.

### Résolution par nom de job Jenkins

`resolveByJobName()` existe pour une raison concrète : un job multibranche Jenkins
s'appelle `<job>/<branche>`, donc contient un `/` que `path-to-regexp` ne matche pas sur
un paramètre mono-segment. D'où les routes en `(.*)`. La logique est **factorisée** afin
que `/api/projects/internal/by-job/...` et `/api/webhooks/jenkins/by-job/...` partagent
la même vérité.

---

## 4. Domaine *Ingestion (webhooks)*

**Fichiers** : `webhooks/webhooks.controller.ts`, `webhooks.service.ts`,
`console-log-errors.ts`, `jenkins-known-fixes.ts`, `routed-build.entity.ts`.

| Route | Effet |
|---|---|
| `POST /api/webhooks/sonarqube/:projectId` | crée des `bugs` (max 20 par appel) |
| `POST /api/webhooks/jenkins/:projectId` | crée un `incident` |
| `POST /api/webhooks/jenkins/by-job/:jobName(.*)` | résout le projet puis crée l'incident |
| `POST /api/webhooks/trivy/:projectId` | ingère les résultats Trivy |

**Aucune de ces routes ne porte de garde** (voir `19`, note sous la table `webhooks`).

### Deux mécanismes à comprendre

**1. Récupération de la vraie cause d'échec.** Jenkins ne met dans `error_message` que
« script returned exit code N ». Le service va donc lire `${buildUrl}consoleText` et
extrait la cause via `extractErrorFromConsoleLog()`. L'appel est encadré par un
`try/catch` et un `AbortSignal.timeout(15000)` : un échec de lecture ne bloque jamais la
création de l'incident.

**2. Garde anti-boucle.** `routeToOptimizer()` calcule
`sha256(projectId:type:errorReason)`, le stocke dans `routed_builds` avec un TTL de 24 h,
et refuse de re-router le même échec. Sans cela, dix rebuilds identiques
déclencheraient dix appels LLM.

**Garde-fou décisif** : `classify()` est **100 % déterministe** et seuls `jenkinsfile` et
`dockerfile` déclenchent quelque chose. `vulnerability`, `code`, `infra`, `unknown` ne
déclenchent **jamais** d'auto-correction.

---

## 5. Domaine *Incidents* — `incidents.service.ts` (3460 lignes)

Le plus gros fichier du backend. Il gère le cycle de vie d'un incident et tout le
dialogue avec WF2.

### Routes notables (24, toutes gardées)

`:id/validation` (WF3), `:id/workflow-status`, `:id/approve`, `:id/retry`,
`:id/recover-post-write`, `:id/remediation/:requestId/reconcile-stale-dispatch`,
`:id/remediation/:requestId/execution-started`, `.../pre-write-gate`, `.../cancel`,
`:id/pr-validation` (+ 5 variantes), `:id/correct-and-revalidate`, `:id/reject`,
`:id/trigger-build`, `project/:projectId/cycles`.

### L'annulation WF2 (`cancelFixRequest`)

Machine à trois sorties :

| Sortie | Condition | Effet |
|---|---|---|
| `terminal` | la demande est déjà terminée | renvoie l'état, `alreadyTerminal: true` |
| `too_late` | les effets de bord ont commencé | **409 `CANCELLATION_TOO_LATE`** : *« La correction a déjà commencé à écrire sur GitHub »* |
| `requested` | annulable | passe en `CANCEL_REQUESTED`, puis demande l'arrêt à n8n |

Détails de robustesse réellement implémentés : une seconde demande n'appelle pas n8n une
deuxième fois (`alreadyRequested`), une annulation avant enregistrement de l'`executionId`
est gérée (`waitingForExecutionRegistration`), et un échec d'annulation précédent est
rejouable (`lastCancelAttemptError`).

### Fichiers de support du domaine

`post-write-recovery.ts` (récupération après écriture), `n8n-execution-client.ts`
(arrêt d'exécution n8n), `workflow-attempt-identity.ts`, `finding-fingerprint.ts`,
`incident-write.dto.ts`, `wf2-cancellation.types.ts`.

---

## 6. Domaine *Remédiation de sécurité* (64 fichiers)

Le cœur fonctionnel. Dossier `security-remediation/`.

### Fichiers décisifs

| Fichier | Rôle |
|---|---|
| `security-artifact-scan.ts` | **le juge de la fermeture de sécurité** : `cveTargets()`, `provesSecurityClosure()`, `trackedSourceDigest()` |
| `security-remediation.controller.ts` | les routes internes appelées par WF6 (`/api/internal/security-remediation/...`) |
| `wf6-batch-remediation-result.dto.ts` | contrat du callback de lot |
| `security-eligibility-classifier.ts` | un finding est-il éligible à une correction automatique ? |
| `maven-security-patch-writer.ts` / `-batch.ts` | écriture du patch `pom.xml` |
| `maven-provenance-resolver.ts`, `grounded-maven-provenance.types.ts` | d'où vient réellement une dépendance |
| `version-selection-policy.ts` | quelle version corrigée choisir |
| `security-patch-guard.ts` | garde avant application d'un patch |
| `security-candidate-identity.ts` | identité du candidat |
| `security-remediation-deadline-contract.ts` | budgets de temps |
| `scoped-e2e-dispatch.ts` | politique de dispatch de test (portée exacte) |
| `retry-e2e-harness.service.ts` / `.logic.ts` | harnais E2E, actif seulement sur drapeau |

### `provesSecurityClosure()` — à savoir expliquer par cœur

```ts
export function provesSecurityClosure(scan, scope): boolean {
  try {
    if (cveTargets(scan, scope.targetCve).length !== 0) return false;
    const packages = scan.report.Results.flatMap(r => r.Packages ?? []);
    return scope.affectedPackages.every(p => {
      const found = packages.filter(x => x.Name === p.package);
      return found.length > 0 && found.every(x => x.Version === p.targetVersion);
    });
  } catch { return false; }
}
```

Trois propriétés à énoncer devant le jury :

1. **Absence de la CVE** : `cveTargets(...).length === 0`.
2. **Présence positive** : `found.length > 0 && found.every(version === targetVersion)`.
   Un rapport vide **échoue** ce test. C'est ce qui empêche « je n'ai rien trouvé » de
   valoir « c'est corrigé ».
3. **`try/catch → false`** : toute anomalie de lecture devient un refus.

### `cveTargets()` — la taxonomie d'erreur

| Erreur levée | Déclencheur |
|---|---|
| `INCOMPLETE_SECURITY_SCAN` | build non passé, mode inattendu, digests mal formés, version de scanner absente, `SchemaVersion !== 2`, `ArtifactType !== 'container_image'`, aucun résultat, ou aucun paquet `jar` |
| `MALFORMED_OR_FILTERED_SECURITY_SCAN` | présence de `ModifiedFindings` → **un rapport filtré est refusé** |
| `MALFORMED_SECURITY_SCAN` | `Vulnerabilities` non tableau, ou entrée sans `VulnerabilityID` |
| `INCOMPLETE_CVE_MATCH` | CVE trouvée mais sans `PkgName` / `InstalledVersion` |

---

## 7. Domaine *Remédiation manuelle* — `manual-remediation.service.ts` (871 lignes)

C'est le **chef d'orchestre** du cycle de remédiation.

### Fonctions importantes

| Fonction | Ligne | Entrée | Sortie | Effets de bord | Transaction |
|---|---|---|---|---|---|
| `list()` | 116 | `projectId`, filtres | tâches | — | lecture |
| `summary()` | 145 | `projectId` | agrégats | — | lecture |
| `complete()` | 188 | `id`, user, note | tâche | `status`, `completedBy*` | oui |
| `reopen()` | 203 | `id`, user | tâche | `status = REOPENED` (**admin seul**) | oui |
| `syncIncident()` | 215 | incident | — | **crée/met à jour les tâches** depuis les findings | oui |
| `verifyWf6AttemptContext()` | 413 | `projectId`, ids, `batchId` | validité | — | lecture |
| `verifyWf6TargetOwnership()` | 427 | `projectId`, ids | propriété | — | lecture |
| `recordWf6Result()` | 446 | DTO | — | transition d'état | oui |
| `retrySecurityRemediation()` | 464 | `taskId`, `expectedAttemptId` | — | **nouvelle tentative** | oui |
| `launchBatchRemediation()` | 472 | `projectId`, ids, user | — | **réservation + tentative + dispatch WF6** | oui |
| `recordWf6BatchResult()` | 666 | DTO | — | transition + règlement de réservation | oui |
| `reconcileStaleWf6Dispatch()` | 724 | `taskId`, input | — | réconciliation d'un dispatch bloqué (**admin**) | oui |
| `abandonTarget()` | 802 | `taskId`, `expectedAttemptId` | — | abandon (**admin**) | oui |
| `staleTargets()` | 825 | user | liste | — | lecture |

### `launchBatchRemediation()` — la fonction la plus importante

Déroulé réel :

1. `assertSecurityRemediationDispatchEnabled()` — porte d'admission (503 si gelé).
2. Vérification des rôles (`developer`/`admin`, `admin` seul si `ADMIN_ACTION_REQUIRED`).
3. Résolution de la cible de confiance → `canonicalTarget()`.
4. **Acquisition de la réservation** (`reserveTarget`) — écrivain unique.
5. Création de la **tentative** : nouveaux `attemptId` **et** `batchId`,
   `attemptNumber` incrémenté une fois.
6. `bindTargetAttempt()` — lie la tentative à la réservation.
7. Dispatch HTTP vers le webhook WF6.
8. En cas d'échec de dispatch : `DISPATCH_FAILED`, rejouable.

Tout cela dans **une** transaction côté base, le dispatch HTTP venant après le commit.

### Le verrou d'écrivain unique — `remediation-target-reservation.ts`

| Fonction | Rôle |
|---|---|
| `normalizeTargetFile()` | rejette traversée, alias, `.git`, chemin absolu, > 512 car. |
| `canonicalTarget()` | valide l'UUID projet et la coordonnée, produit `targetKey = JSON.stringify(['v1','FILE',file])` |
| `productionTarget()` | **renvoie `'pom.xml'`** (limitation assumée, voir `38`) |
| `reserveTarget()` | `INSERT … ON CONFLICT (projectId,targetKey) WHERE state='ACTIVE' DO NOTHING` puis `SELECT … FOR UPDATE` |
| `bindTargetAttempt()` | inscrit `attemptId`/`batchId` dans `claims` |
| `releaseTargetClaim()` | retire une revendication ; `RELEASED` seulement si `claims` devient vide |
| `settleTargetClaim()` | **met en quarantaine** si un effet Git non résolu existe |
| `safeTerminalTargetRelease()` | liste blanche des échecs pré-Git sûrs à libérer |

---

## 8. Domaine *Vérification de candidat* (19 fichiers)

`candidate-verification/` : `candidate-verification.controller.ts` (3 routes :
`verify`, `write-guard`, `remote-head-drift`), `candidate-verification.service.ts`,
`candidate-digest.ts`, `candidate-verification.types.ts`, `transport-dispatcher`.

Le backend **délègue** l'exécution au worker `candidate-verifier` via
`CANDIDATE_VERIFIER_URL`. Il garde la décision, le worker fait le travail.

---

## 9. Domaine *Compatibilité des dépendances* (39 fichiers)

`dependency-compatibility/` répond à : *« quelle version corrigée est à la fois sûre et
compatible ? »*

| Fichier | Rôle |
|---|---|
| `v1_8-compatibility-decision.service.ts` | lecture seule d'un magasin de preuves |
| `dependency-compatibility-decision.ts` | la décision ; distingue `NOT_TESTED` / `SECURITY_RESCAN_NOT_RUN` de `REJECTED` |
| `owner-version-discovery.ts`, `owner-discovery-trial.ts`, `owner-pom-edit.ts` | qui « possède » réellement la version d'une dépendance (parent POM, BOM) |
| `candidate-version-policy.ts`, `maven-qualifier-comparator.ts` | comparaison de versions Maven |

### Le défaut *fail-closed* à savoir citer

Pour un finding absent du magasin de preuves, `unknownFindingDecision()` renvoie
`NOT_YET_SANDBOXED` avec `requiresDeveloperReview: true`, `evidenceId: ''`, et le
commentaire du code précise : *« never fabricated as any other state »*. La plateforme
préfère dire « je ne sais pas » plutôt que de deviner.

---

## 10. Domaine *Déploiement Azure* (28 fichiers)

Voir `14-AZURE-DEPLOYMENT.md`. Fichiers clés : `azure-deploy.module.ts` (contrôleur
inclus, 10 routes), `deployment-authorization.service.ts`, `governance-decision.ts`,
`deployment-authorization-policy.ts`, `agent-deployment-result.ts`,
`deployment-identity.ts`, `security-validation-applicability.ts`.

---

## 11. Autres domaines

| Domaine | Fichiers | Rôle |
|---|---|---|
| `validation/` | 24 | séparation du pipeline de findings, contexte correctif |
| `common/` | 16 | `governance.ts`, `report-normalizer.ts`, `phase-diagnostics.ts`, `scanner-diagnostics.ts` |
| `context/` | 11 | `scope-lock.service.ts` et résolution de contexte |
| `dashboard/` | 5 | agrégats d'accueil, `platform-capabilities.ts` |
| `reports/` | 4 | ingestion et lecture des rapports |
| `jenkins-optimizer/` | 3 | contrôleur `jenkins` (8 routes) + entités |
| `dockerfile-optimizer/` | 2 | contrôleur `dockerfile` + entité |
| `bugs/` | 6 | anomalies Sonar |
| `chat/` | 4 | passerelle vers WF-Chat |
| `integrations/` | 6 | configuration des intégrations |
| `effective-config/` | 4 | configuration effective exposée au front |
| `integration-fixtures/` | 4 | fixtures de test, **doublement fermées** (`NODE_ENV=production` **ou** drapeau ≠ `true`, **plus** rôle admin) |
| `seed/` | 5 | amorçage de données |

---

## 12. Diagnostics de scanner — un détail qui fait la différence

`common/scanner-diagnostics.ts` et `common/phase-diagnostics.ts` modélisent
explicitement que `analysisSubmitted` et `qualityGateResolved` **peuvent diverger**, avec
ce message destiné à l'opérateur :

> *« Sonar a bien soumis l'analyse au serveur (ANALYSIS SUCCESSFUL côté Sonar) mais
> Jenkins n'a pas pu obtenir le ceTaskId au moment requis — la corrélation quality gate
> est donc indisponible pour ce build, ce n'est pas un défaut du code analysé. »*

C'est exactement la bonne sémantique : **une mesure manquante n'est pas un défaut du
code**. À citer si le jury demande comment on évite les faux positifs.
