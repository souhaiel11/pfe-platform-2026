# État du déploiement Azure — devsecops-testbed

## Ce qui est prouvé aujourd'hui (2026-08-08)

- **Le backend déclenche réellement un déploiement Azure** (push/pull ACR +
  ACI) via l'agent hôte, sans détenir aucun credential Azure. Détail dans
  "Déploiement piloté par le backend" ci-dessous.

## Ce qui était prouvé le 2026-08-06

- Infra durable (Terraform, `infra/terraform/`) : resource group `rg-pfe-devsecops`
  + ACR `acrpfedevsecops` (Basic) créés en `francecentral`, vérifiés `Succeeded`
  côté Azure (pas juste déclarés par Terraform).
- Image `devsecops-testbed:latest` (originale, vulnérable) buildée et poussée
  avec succès sur l'ACR.
- **Déploiement ACI prouvé sur image à base cohérente (`eclipse-temurin:11`) —
  Spring Running, 0 crash.** L'image vulnérable originale (base Java 8) crashe,
  comme attendu. Détail dans "Fondation prouvée" ci-dessous.

## Fondation prouvée : ACI Running sur image corrigée séparée

Pour prouver que la chaîne Azure (ACR → ACI privé) fonctionne réellement, sans
toucher au dépôt `devsecops-testbed` (le Dockerfile original vulnérable reste
la cible des scans Trivy, inchangé), un Dockerfile de test **temporaire** a été
créé hors de ce dépôt : `infra/docker/Dockerfile.fixed-base-testbed`. Seule
différence avec l'original : `eclipse-temurin:11-jre` au lieu de
`eclipse-temurin:8-jdk`, cohérent avec le bytecode Java 11 du jar. Même jar
réutilisé (`target/devsecops-testbed-1.0.0.jar`), aucun fichier de
`devsecops-testbed` modifié.

Image poussée sous un tag distinct : `acrpfedevsecops.azurecr.io/devsecops-testbed:fixed-base-1.0.0`.
L'ACR contient les deux tags (`latest` = vulnérable, `fixed-base-1.0.0` = corrigée).

Conteneur ACI de preuve (`aci-devsecops-testbed-fixed`, privé, `ipAddress: null`,
port 8080, cpu 1 / mémoire 1 Go) :

- État sur 45s (9 checks à 5s d'intervalle) : **`Running` en continu**, jamais `Terminated`.
- `restartCount` : **0** — pas de crash-loop.
- Logs : `Started TestbedApplication in 9.285 seconds`, Tomcat sur le port 8080,
  **aucun `UnsupportedClassVersionError`**.
- `/api/health` testé depuis l'intérieur du conteneur (`az container exec`, pas
  d'IP publique) → **`{"status":"UP"}`**.

Conteneur de preuve arrêté puis supprimé après vérification (pas de coût résiduel).

## Déploiement piloté par le backend — session Azure de l'hôte, pas de service principal

### Pourquoi pas un service principal

Un SP scopé au strict minimum (`AcrPush` sur l'ACR + `Azure Container
Instances Contributor Role` sur `rg-pfe-devsecops` uniquement) était l'option
retenue initialement — moindre privilège, credential dédié, révocable
indépendamment du compte personnel. **Impossible à créer** : le tenant Azure
AD `esprit.tn` bloque la création d'App Registration pour ce compte
(`allowedToCreateApps: false`, politique d'autorisation du tenant, vérifié via
Microsoft Graph), malgré un rôle Owner sur la subscription (RBAC Azure ≠
permissions Entra ID — deux systèmes séparés). Pas d'admin Entra ID
sollicitable pour ce projet. Aucune subscription alternative disponible avec
les mêmes ACR/RG déjà en place.

### Architecture retenue : le backend délègue, il ne détient jamais de token

```
Frontend (bouton Déployer, futur)
        │ JWT
        ▼
Backend (conteneur Docker, pfe-backend)      ── AUCUN credential Azure ici
        │ HTTP + secret partagé (X-Agent-Secret)
        │ → 172.19.0.1:7799 (gateway du bridge Docker "pfe-network")
        ▼
Agent hôte (infra/azure-deploy-agent/agent.py) ── seul processus à lire ~/.azure
        │ az acr login / az acr credential show / az container create
        ▼
Azure (ACR acrpfedevsecops + ACI rg-pfe-devsecops)
```

Le refresh token MSAL de la session personnelle (`~/.azure/msal_token_cache.json`)
donne un accès **Owner sur toute la subscription** — bien plus large que ce
qu'un SP scopé aurait donné. Le laisser **ne jamais quitter l'hôte** (jamais
monté dans un conteneur, jamais transmis au backend) est donc la seule façon
de ne pas regagner en surface d'attaque ce qu'on a perdu en granularité :
compromettre le conteneur backend (dépendances npm, réseau exposé) ne donne
accès qu'au déclenchement d'un déploiement pré-défini, jamais au token lui-même.

L'agent applique 3 garde-fous, dans cet ordre, à chaque appel :
1. Secret partagé absent côté agent → l'agent refuse de démarrer (fail-closed).
2. Secret fourni par le backend invalide → `403`, rien d'exécuté.
3. `resourceGroup` demandé ≠ `rg-pfe-devsecops` → `400`, rejeté même si la
   session sous-jacente aurait les droits d'agir ailleurs (prouvé : requête
   vers `rg-musee-virtuel` refusée par l'agent, jamais transmise à `az`).
4. Session `az` invalide (`az account show` échoue) → `409` avec un message
   clair (`AZURE_SESSION_EXPIRED`, "faire az login"), jamais un crash ni une
   tentative de déploiement. Vérifié systématiquement à chaque déploiement,
   jamais mis en cache d'un appel précédent.

Secret partagé (`AZURE_DEPLOY_AGENT_SECRET`) : même pattern que
`N8N_CALLBACK_SECRET`/`N8N_INTERNAL_SECRET` — variable d'env dans
`backend/.env` (gitignored) et `docker-compose.yml`. **Dette notée** : comme
les secrets N8N_*, il est en clair dans `docker-compose.yml`, qui est
lui-même versionné — cette modification spécifique n'est volontairement PAS
committée (secret changé à chaque régénération de l'agent). Externalisation
propre (fichier `.env` référencé par `env_file:`, jamais de valeur littérale
dans un fichier suivi par git) documentée comme dette pour tous ces secrets,
pas seulement celui-ci.

### Limite connue

Le déploiement ne fonctionne QUE si la session `az login` de l'hôte est
active. Ce n'est pas automatisable sans intervention humaine périodique
(`az login` expire). **En production, ce mécanisme ne serait pas utilisé** —
un service principal scopé (comme celui initialement visé) est la bonne
solution ; il est bloqué ici uniquement par la politique du tenant Esprit,
propre à cet environnement d'études, pas une limite d'architecture.

### Preuve (2026-08-08)

Déploiement déclenché par un appel HTTP au backend (`POST
/api/azure-deploy/deploy`), pas depuis un terminal :

- `az acr login` + `az acr credential show` : OK (via la session hôte).
- `az container create` (image `fixed-base-1.0.0` déjà prouvée, ACR
  `acrpfedevsecops`, RG `rg-pfe-devsecops`) : OK.
- État poll jusqu'à `Running`, `restartCount: 0`.
- `/api/health` via `az container exec` (pas d'IP publique, cohérent avec la
  preuve du 06/08) → `{"status":"UP"}`.
- Garde-fou session testé positif (`~/.azure` temporairement absent →
  réponse `409 AZURE_SESSION_EXPIRED` propre côté backend, pas de crash) et
  négatif (session restaurée → `200`).
- Garde-fou RG testé : requête vers `rg-musee-virtuel` → `400
  RESOURCE_GROUP_NOT_ALLOWED`, jamais transmise à Azure.
- Conteneur de preuve supprimé immédiatement après vérification (pas de coût
  résiduel), comme pour la preuve du 06/08.

## Échec du déploiement ACI sur l'image originale (non corrigée)

Le conteneur ACI (`aci-devsecops-testbed`, privé, pas d'IP publique) crash au
démarrage avec :

```
UnsupportedClassVersionError: com/vermeg/testbed/TestbedApplication has been
compiled by a more recent version of the Java Runtime (class file version 55.0),
this version of the Java Runtime only recognizes class file versions up to 52.0
```

Cause : le `Dockerfile` de `devsecops-testbed` utilise `eclipse-temurin:8-jdk`
alors que le code est compilé en Java 11 (`pom.xml` : `java.version=11`). C'est
une des failles **volontaires** du testbed (image de base obsolète, détectable
par Trivy) — mais son auteur n'avait pas remarqué qu'elle rend le jar
inexécutable. Reproduit à l'identique en local (`docker run`), donc indépendant
d'Azure/Terraform/ACI.

## Conséquence pour la démo

La version **non corrigée** ne peut pas tourner — ce qui est cohérent avec le
principe : on ne déploie pas de code vulnérable tel quel. Le déploiement ACI
fonctionnel sera prouvé sur la version **corrigée** (image de base Java 11+),
après passage par la plateforme DevSecOps.

## Reste à faire

- [x] Prouver que la chaîne ACR → ACI privé fonctionne (fait via l'image
      `fixed-base-1.0.0`, voir ci-dessus)
- [x] Prouver que le BACKEND (pas un terminal) peut déclencher ce
      déploiement, sans détenir de credential Azure (agent hôte, voir
      "Déploiement piloté par le backend" ci-dessus)
- [ ] Endpoint/notification/bouton "Déployer" côté plateforme (front +
      validation humaine avant déclenchement) — pas encore construit,
      volontairement hors scope de cette étape
- [ ] Rendre l'agent hôte persistant (aujourd'hui lancé manuellement en
      arrière-plan, pas de service systemd/supervision)
- [ ] Décider comment corriger `devsecops-testbed` pour de vrai (recompiler en
      ciblant Java 8 pour garder l'image de base volontairement vulnérable, ou
      changer l'image de base — décision à prendre, voir options discutées en
      session)
- [ ] Une fois `devsecops-testbed` corrigé dans son propre dépôt, rejouer le
      déploiement ACI sur l'image officielle (pas le tag `fixed-base-1.0.0` de
      test) et documenter ici
