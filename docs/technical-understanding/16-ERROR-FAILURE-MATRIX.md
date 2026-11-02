# 16 — MATRICE DES PANNES

« Et si tel composant tombe ? » — une question quasi certaine en soutenance.
La réponse générale : **presque tout échoue fermé**.

---

## 1. La matrice

| Panne | Détectée où | Code d'erreur | Rejouable ? | Changement d'état | Effet visible | Nettoyage |
|---|---|---|---|---|---|---|
| **PostgreSQL indisponible** | `GET /healthz` (vrai `SELECT 1`) | — | — | aucun (rien ne s'écrit) | plateforme non pilotable | aucun nécessaire |
| **n8n indisponible** | `launchBatchRemediation()` | `DISPATCH_FAILED` | **oui** | tentative créée puis marquée échouée | « dispatch échoué » | réservation retenue en `WAITING_RETRY` |
| **Timeout WF6** | timeout du nœud HTTP | `VERIFIER_TIMEOUT` | **oui** | `TECHNICAL_FAILURE` | tentative rejouable | claim en `WAITING_RETRY` |
| **candidate-verifier indisponible** | appel backend | `VERIFIER_TIMEOUT` | **oui** | `TECHNICAL_FAILURE` | idem | idem |
| **builder-scanner indisponible** | appel du verifier | `INCOMPLETE_SECURITY_SCAN` | non | pas de fermeture prouvée | « scan incomplet » | libération si échec pré-Git sûr |
| **GitHub indisponible** | nœud WF6 (timeout explicite) | enveloppe d'échec nommée | selon le motif | aucune écriture | échec nommé | si une branche existe ⇒ **`QUARANTINED`** |
| **Jenkins indisponible** | — | — | — | aucun | pas de nouvel incident | aucun |
| **Trivy en échec / rapport malformé** | `cveTargets()` | `INCOMPLETE_SECURITY_SCAN`, `MALFORMED_SECURITY_SCAN`, `MALFORMED_OR_FILTERED_SECURITY_SCAN` | non | **jamais un succès** | « scan invalide » | libération sûre |
| **OWASP non exécuté** | `dependency-compatibility-decision.ts` | `NOT_TESTED` / `SECURITY_RESCAN_NOT_RUN` | — | pas de recommandation validée | « non testé » | — |
| **Sonar : analyse OK mais QG non corrélé** | `scanner-diagnostics.ts` | `qualityGateResolved = null` | — | QG **indéterminé** ⇒ motif de risque | message explicite : *« ce n'est pas un défaut du code analysé »* | — |
| **Registre d'images indisponible** | `podman build` | `INCOMPLETE_SECURITY_SCAN` | non | pas de fermeture | — | — |
| **Azure / agent injoignable** | `classifyAgentDeploymentResult(null, …)` | `AGENT_TRANSPORT_FAILED` | — | `deployment_attempts = FAILED` | échec affiché avec son code | autorisation **consommée** |
| **Contrôle de santé en échec** | `classifyAgentDeploymentResult()` | `AGENT_HEALTH_FAILED` | — | `FAILED` | *« le conteneur a démarré mais le contrôle de santé a échoué »* | autorisation consommée |
| **Agent renvoie 200 sans booléens** | idem | `AGENT_RESULT_INVALID` | — | `FAILED` | — | idem |
| **Callback dupliqué** | `completionDigest` | — | — | **aucun** (idempotent) | rien | — |
| **Callback périmé** | `verifyWf6AttemptContext()` | contexte invalide | — | **aucun** sur la tentative courante | rien | — |
| **Dispatch concurrent (déploiement)** | `reserveAndConsume…` | `DEPLOY_DEPLOYMENT_IN_PROGRESS` | — | aucun | « un autre déploiement est en cours » | autorisation **reste `CREATED`** |
| **Dérive d'identité d'artefact** | recalcul vs instantané | `DEPLOY_AUTHORIZATION_IDENTITY_CHANGED` | — | aucun | « nouvelle autorisation requise » | autorisation **reste `CREATED`** |
| **Autorisation expirée** | `expiresAt < now` | `DEPLOY_AUTHORIZATION_EXPIRED` | — | marquée `EXPIRED` | — | — |
| **Autorisation déjà consommée** | `status !== 'CREATED'` | `DEPLOY_AUTHORIZATION_CONSUMED` | — | aucun | — | — |
| **Secret d'agent non configuré** | `assertConfigured()` | **503** | — | aucun | « agent inatteignable en toute sécurité » | — |
| **`N8N_INTERNAL_SECRET` absent côté serveur** | `InternalSecretGuard` | **403 systématique** | — | aucun | n8n ne peut plus rappeler | — |
| **Dispatch gelé** | `assertSecurityRemediationDispatchEnabled()` | **503** `SECURITY_REMEDIATION_TEMPORARILY_DISABLED` | — | aucun | *« Les corrections automatiques sont temporairement suspendues »* | — |
| **Redémarrage backend en pleine tentative** | — | — | **oui**, assisté | réservation reste `ACTIVE` | tâche bloquée | `staleTargets()` + `reconcileStaleWf6Dispatch()` (admin) |
| **Lecture du log Jenkins en échec** | `try/catch` + timeout 15 s | — | — | incident **quand même créé** | repli sur `error_message` | — |

---

## 2. Classement par comportement

| Comportement | Nombre | Pannes concernées |
|---|---|---|
| **SAFE** (rien de corrompu) | 11 | PostgreSQL, Jenkins, Trivy malformé, callbacks périmé/dupliqué, dérives, expiration, secrets absents, dispatch gelé, lecture de log |
| **RETRYABLE** | 5 | n8n, timeout WF6, verifier, dispatch, redémarrage backend |
| **NONRETRYABLE mais fermé** | 5 | scanner, registre, santé, résultat invalide, transport agent |
| **FAIL-OPEN** | **0** sur le chemin de décision de sécurité | — |

---

## 3. Les deux défauts *fail-open* historiquement identifiés

Honnêteté intellectuelle : deux chemins *fail-open* ont existé dans le projet. Les deux
sont **corrigés dans l'image déployée**, mais il faut savoir en parler.

### a) Le défaut du drapeau de dispatch

```ts
const value = process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED;
if (value === undefined || value.trim().toLowerCase() === 'true') return;  // AUTORISE
```

**Variable absente ⇒ dispatch autorisé.** Pour un interrupteur de sûreté, le défaut
devrait être l'inverse.

**Mitigation réelle** : le `backend/Dockerfile` de la révision déployée cuit les valeurs
sûres dans l'image :

```dockerfile
ENV NODE_ENV=production
    SECURITY_REMEDIATION_DISPATCH_ENABLED=false
    SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED=false
    DB_SYNCHRONIZE=false
```

Le conteneur en marche porte bien `dispatch=false`, `harness=false`.

### b) Le compteur HIGH/CRITICAL

`countHighCriticalVulnerabilities()` renvoie **0** sur un rapport malformé, et
`dependency-compatibility-decision.ts` lit `> 0` comme une régression. Un rapport
malformé se lirait donc « aucune régression ».

**Mitigation réelle, double** : `null` est correctement distingué de `0`
(`NOT_TESTED` / `SECURITY_RESCAN_NOT_RUN`), et surtout `cveTargets()` **lève** sur un
rapport malformé **plus tôt** dans le même flux. Le compteur est documenté comme
télémétrie pure, jamais comme porte.

**Ce qu'il faut répondre si le jury le trouve** : *« C'est une asymétrie réelle. Elle est
atténuée en amont par la validation structurelle de `cveTargets()` et par la distinction
null/0. Si ce compteur devenait un jour une porte, il faudrait qu'il lève au lieu de
renvoyer 0. »*

---

## 4. Le cas de dérive de contrat réellement survenu

Le meilleur exemple pour expliquer pourquoi le backend ne fait jamais confiance à n8n.

```
2026-10-04  l arbre de travail ajoute 3 routes d annulation WF2 :
              execution-started · pre-write-gate · cancel
2026-10-06  WF2 est promu en ligne et APPELLE ces routes
2026-10-07  le backend deploye est construit depuis une AUTRE lignee,
            qui ne contient pas ces routes
      ->  sonde live : pre-write-gate / execution-started / cancel  ->  404
          (temoin de methode : reconcile-stale-dispatch -> 401, donc la route existe)
```

**Conséquence réelle** : WF2 s'arrêtait au premier nœud HTTP. Les nœuds concernés ont
`onError` non défini, donc le comportement par défaut de n8n : **arrêter l'exécution**.
Le flux échouait donc **fermé** — aucune écriture GitHub n'a été produite par un workflow
amputé.

**L'enseignement** : une dérive de contrat entre deux composants déployés séparément est
un risque **réel**, et la bonne protection n'est pas d'espérer qu'elle n'arrive pas, mais
de faire en sorte que son issue par défaut soit l'arrêt. C'est exactement ce qui s'est
produit.

---

## 5. Résumé en une phrase

> *« Sur le chemin de décision de sécurité, aucun échec ne se transforme en succès. Un
> composant absent, lent, ou qui répond mal, produit un refus typé — jamais une
> validation par défaut. »*
