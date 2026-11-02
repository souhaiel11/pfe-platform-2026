# 15 — SCÉNARIOS DE BOUT EN BOUT

Neuf scénarios, chronologiques, avec les composants dans l'ordre réel.

---

## SCÉNARIO A — Détection d'une vulnérabilité (le cas nominal)

| # | Composant | Action | Table / identifiant |
|---|---|---|---|
| 1 | Jenkins | build `pfe-app-test` #151 | — |
| 2 | Trivy / OWASP / Sonar | scans dans le pipeline | — |
| 3 | Jenkins | `POST /api/webhooks/jenkins/by-job/pfe-app-test` | — |
| 4 | `WebhooksController.jenkinsByJob()` | résout le projet par nom de job | `projects` |
| 5 | `WebhooksService.handleJenkins()` | crée l'incident ; si FAILURE, lit `consoleText` | `incidents` |
| 6 | WF1 (50 nœuds) | analyse et corrèle Sonar via `ceTaskId` | — |
| 7 | `syncIncident()` | promeut les findings en tâches | `manual_remediation_tasks` |
| 8 | PostgreSQL | `UNIQUE (projectId, findingFingerprint)` | idempotence |
| 9 | Frontend | onglet Sécurité : `TODO` / `DETECTED` | — |

**Résultat** : 777 tâches existent aujourd'hui par ce chemin. Aucune correction n'a
encore été tentée.

---

## SCÉNARIO B — Remédiation réussie d'un candidat

| # | Composant | Action | Identifiant |
|---|---|---|---|
| 1 | opérateur | sélectionne la CVE, lance la correction | `taskId` |
| 2 | `launchBatchRemediation()` | `assertSecurityRemediationDispatchEnabled()` | — |
| 3 | idem | vérifie le rôle (`developer`/`admin`) | — |
| 4 | `canonicalTarget()` | `targetKey = ["v1","FILE","pom.xml"]` | — |
| 5 | `reserveTarget()` | acquisition de l'écrivain unique | `reservation.id` |
| 6 | idem | crée la tentative | `attemptId` A1, `batchId` B1, `attemptNumber` 1 |
| 7 | `bindTargetAttempt()` | `claims[taskId] = {A1, B1, DISPATCHING}` | — |
| 8 | backend → n8n | webhook WF6 (`headerAuth`) | — |
| 9 | WF6 zone 1 | `POST evaluate-batch` | — |
| 10 | candidate-verifier | clone au SHA exact, patch `pom.xml` | — |
| 11 | idem | `mvn` compile puis test | — |
| 12 | builder-scanner | `podman build` puis `trivy` | `artifactDigest`, `reportDigest` |
| 13 | candidate-verifier | rescan OWASP | `newHighCriticalCount` |
| 14 | `provesSecurityClosure()` | CVE absente **et** paquet à la version corrigée | **`CANDIDATE_READY`** |
| 15 | WF6 zones 2–5 | **39 portes** | — |
| 16 | WF6 | `Create Missing Branch` → `Write File To Branch` | GitHub |
| 17 | WF6 zone 4 | relecture et comparaison **par hash** | — |
| 18 | WF6 zone 6 | `Create Pull Request` puis relecture | `prUrl` |
| 19 | WF6 zone 7 | `POST batch-result` | A1, B1 |
| 20 | `recordWf6BatchResult()` | `verifyWf6AttemptContext()` | — |
| 21 | `settleTargetClaim()` | effet Git présent ⇒ **pas de libération** | `QUARANTINED` |
| 22 | **build ultérieur** | le scanner ne voit plus la CVE | — |
| 23 | backend | `verifiedBuild > lastSeenBuild` | `VERIFIED` / `NOT_DETECTED` |

**Le point à souligner** : l'étape 21 ne libère pas la réservation. Tant qu'une PR est
ouverte, la cible reste protégée. Et l'étape 23 — la seule qui « ferme » — n'est pas
décidée par la plateforme.

---

## SCÉNARIO C — Timeout technique puis retry *(cas réel en base)*

```
t0  tentative 1 : attemptId 93c68aed…  batchId sec-batch-61727477…
      -> candidate-verifier ne repond pas dans son budget
      -> VERIFIER_TIMEOUT · TECHNICAL_FAILURE · retryable = true
      -> claims[taskId].status = WAITING_RETRY     (reservation RETENUE)

t1  retry : retrySecurityRemediation(taskId, { expectedAttemptId: 93c68aed… })
      -> verrouillage optimiste : si une autre tentative a demarre, refus
      -> tentative 2 : attemptId 39c77b06…  batchId sec-batch-4e6f6ec2…

t2  tentative 2 -> OPERATOR_TEST_STOPPED · retryable = false
      -> AUCUNE tentative 3 (echec non rejouable)

Etat final : task.status = TODO · scannerStatus = DETECTED
             attempts[] conserve les DEUX tentatives
```

Pourquoi la réservation est retenue entre t0 et t1 : la relâcher ouvrirait une fenêtre
où une autre tâche pourrait prendre `pom.xml` entre deux tentatives du même lot.

---

## SCÉNARIO D — Le candidat reste vulnérable

| # | Composant | Action |
|---|---|---|
| 1–13 | identique au scénario B | le candidat est construit et scanné |
| 14 | `cveTargets(scan, targetCve)` | la CVE est **encore** présente → longueur ≠ 0 |
| 15 | `provesSecurityClosure()` | renvoie **`false`** |
| 16 | WF6 | `Record Batch Result (STILL_OPEN)` |
| 17 | backend | `TARGET_CVE_STILL_OPEN_AFTER_PATCH`, `retryable = false` |
| 18 | `safeTerminalTargetRelease()` | ce code **est** dans la liste blanche pré-Git |
| 19 | `releaseTargetClaim()` | réservation **libérée** |
| 20 | GitHub | **jamais touché** |
| 21 | Frontend | `STILL_OPEN`, **aucun badge positif** |

**C'est le scénario qui prouve la valeur du projet** : la correction a été tentée,
mesurée, jugée insuffisante — et **rien** n'a été publié. Aucun humain n'a eu à relire
une PR inutile.

---

## SCÉNARIO E — Deux tâches visant le même fichier

```
t0   Tache X (CVE-1) et Tache Y (CVE-2), toutes deux sur pom.xml du projet P1

t1   X : reserveTarget( (P1, ["v1","FILE","pom.xml"]) )
       INSERT ... ON CONFLICT DO NOTHING  -> insere
       SELECT ... FOR UPDATE              -> claims contient X
       -> X detient l ecrivain

t2   Y : reserveTarget( meme cle )
       INSERT ... ON CONFLICT DO NOTHING  -> NE FAIT RIEN (index unique partiel)
       SELECT ... FOR UPDATE              -> claims contient X, pas Y
       -> leve ConflictException :
          code    = REMEDIATION_TARGET_ALREADY_IN_PROGRESS
          status  = TARGET_BUSY
          message = « Correction deja en cours sur le meme fichier de dependances. »

t3   X termine -> settleTargetClaim() -> libere si echec pre-Git sur
     -> Y peut alors etre relance
```

**Variante multi-projet** : `(P1, pom.xml)` et `(P2, pom.xml)` ⇒ **aucun conflit**, car
`projectId` fait partie de la clé. C'est ce qui rend la conception réellement
multi-projet.

---

## SCÉNARIO F — Callback périmé

```
t0   Tentative A1 (B1) part
t1   A1 depasse son budget -> TECHNICAL_FAILURE, rejouable
t2   Tentative A2 (B2) part
t3   LE CALLBACK DE A1 ARRIVE :
       POST /api/internal/security-remediation/batch-result
       { attemptId: A1, batchId: B1, status: CANDIDATE_READY }

     -> InternalSecretGuard : en-tete valide, l appel est authentique
     -> verifyWf6AttemptContext(projectId, taskIds, batchId = B1)
          la tentative courante est A2 / B2  ->  CONTEXTE INVALIDE
     -> AUCUNE mutation de A2
```

Et pour un **doublon** (même A2 livré deux fois) : `completionDigest` reconnaît le second
et n'applique rien. Deux problèmes différents, deux mécanismes différents.

---

## SCÉNARIO G — Nouveau projet sans configuration Azure

| # | Composant | Action | Résultat |
|---|---|---|---|
| 1 | opérateur | crée le projet via `POST /api/projects` | nouvel `projectId` |
| 2 | — | **aucune modification de code frontend** | la route `/projects/:id` existe déjà |
| 3 | frontend | les 8 onglets apparaissent, dont **Déploiement** | — |
| 4 | `loadDeployReadiness()` | `GET /azure-deploy/ready/:id` | `deploymentConfigured: false` |
| 5 | composant | `GET /azure-deploy/governance/:id` | `environment.resolved: false` |
| 6 | `deriveDeploymentCapability()` | — | **`DEPLOYMENT_NOT_CONFIGURED`** |
| 7 | UI | *« Aucun environnement de déploiement n'est encore configuré pour ce projet. »* | **aucun bouton** |
| 8 | garde | `showsDeployAction = false` sur les 4 points d'entrée | aucune requête possible |

**Vérifié en direct** avec un UUID arbitraire (`7c3e1a90-…`) jamais présent dans aucune
source : les deux endpoints répondent 200 et l'UI atterrit dans l'état correct. C'est la
preuve que l'architecture est générique.

---

## SCÉNARIO H — Déploiement Azure `READY` (théorique aujourd'hui)

| # | Composant | Action |
|---|---|---|
| 1 | frontend | `GET governance/:id` → `READY`, 0 motif |
| 2 | UI | bouton **« Déployer sur Azure »** |
| 3 | opérateur | clic |
| 4 | frontend | `POST authorize/:id` avec `{ mode: 'NORMAL' }` |
| 5 | backend | **recalcul intégral**, `evaluateAuthorizationRequest()` |
| 6 | base | autorisation `CREATED`, TTL 15 min, instantané gelé |
| 7 | frontend | `POST deploy` avec `{ requestId, authorizationId }` |
| 8 | backend | verrous ordonnés, recalcul, comparaison |
| 9 | base | réservation + `deployment_attempts` + `CONSUMED` |
| 10 | agent hôte | `POST /deploy` avec **`artifactDigest`** |
| 11 | Azure ACI | création du conteneur + contrôle de santé |
| 12 | `classifyAgentDeploymentResult()` | `success && healthOk` ⇒ **`DEPLOYED`** |
| 13 | UI | phases `AUTHORISING` → `AUTHORIZED` → `DISPATCHING` → `DEPLOYED` |

**Aujourd'hui aucun projet n'est `READY`** : `pfe-app-test` est en `CRITICAL_RISK`, les
autres en `TECHNICALLY_IMPOSSIBLE`. Ce scénario est donc à **expliquer**, pas à
démontrer.

---

## SCÉNARIO I — Dérogation `CRITICAL_RISK` par un administrateur

| # | Composant | Action |
|---|---|---|
| 1 | frontend | `CRITICAL_RISK`, 11 motifs, `rolesAllowed: ['admin']` |
| 2 | UI, non-admin | *« Déploiement critique réservé aux administrateurs »*, **aucun bouton** |
| 3 | UI, admin | bouton **« Forcer le déploiement »** |
| 4 | formulaire | motif ≥ 10 car. + **3** cases + phrase `DEPLOYER MALGRÉ LES RISQUES` |
| 5 | frontend | bouton **désactivé** tant que tout n'est pas satisfait, avec explication accessible |
| 6 | frontend | `POST authorize/:id` avec `{ mode: 'CRITICAL_OVERRIDE', … }` |
| 7 | backend | **revérifie tout côté serveur** : rôle, motif, 3 reconnaissances, phrase exacte, mode attendu |
| 8 | base | autorisation `CRITICAL_OVERRIDE`, instantané gelé, `riskSnapshot` conservé pour l'audit |
| 9 | suite | identique au scénario H |

**Preuves live des refus serveur** (avec un jeton admin, donc la garde de rôle n'est pas
en cause) :

| Tentative | Réponse |
|---|---|
| `mode: NORMAL` sur une décision `CRITICAL_RISK` | `409 DEPLOY_AUTHORIZATION_MODE_MISMATCH` |
| `mode: CONDITIONAL_EXCEPTION` | `409 DEPLOY_AUTHORIZATION_MODE_MISMATCH` |
| `CRITICAL_OVERRIDE` sans motif | `409 DEPLOY_AUTHORIZATION_REASON_REQUIRED` |
| une reconnaissance manquante | `409 DEPLOY_AUTHORIZATION_ACKNOWLEDGEMENT_MISSING` |
| phrase `DEPLOYER MALGRE LES RISQUES` (sans accent) | `409 DEPLOY_AUTHORIZATION_PHRASE_MISMATCH` |
| phrase absente | `409 DEPLOY_AUTHORIZATION_PHRASE_MISMATCH` |

**Et sur un projet `TECHNICALLY_IMPOSSIBLE`** : `DEPLOY_TECHNICALLY_IMPOSSIBLE_NO_OVERRIDE`
— *« aucun mode d'autorisation ne peut la satisfaire, y compris pour un administrateur »*.
Aucune de ces tentatives n'a laissé de ligne en base.

---

## Scénario de démonstration recommandé

Dans cet ordre, parce qu'il raconte une histoire :

1. **Le problème** — onglet Sécurité de `pfe-app-test` : des centaines de findings.
2. **Finding ≠ tâche** — les deux colonnes `status` / `scannerStatus`, et `UNAVAILABLE`
   qui refuse de conclure.
3. **La preuve, pas l'opinion** — `provesSecurityClosure()` à l'écran : absence de CVE
   **plus** présence positive, le tout en `try/catch → false`.
4. **La barrière** — ouvrir WF6 dans n8n et compter les portes jusqu'à la première
   écriture GitHub.
5. **Le retry** — montrer la tâche réelle `a390e383…` et ses deux tentatives aux
   identités disjointes.
6. **L'écrivain unique** — `\d remediation_target_reservations` : l'index unique partiel
   et le `CHECK`. *« L'invariant est dans PostgreSQL, pas dans mon code. »*
7. **Le gel de sûreté** — `POST /deploy` sans autorisation ⇒ **409**.
8. **Le multi-projet** — naviguer d'un projet configuré vers un projet non configuré :
   la section existe toujours, l'état change, aucun bouton n'apparaît.
