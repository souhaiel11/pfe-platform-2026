# Build contrôlé app-test-pfe-vermeg — preuve d'artefact R56

**Date** : 2026-10-09 · **Build** : #9 · **Résultat** : SUCCESS (663 s)

> **Un seul build a été lancé. Aucune relance.** Aucun déploiement Azure.
> `deployment_attempts` = 0 avant et après.
>
> La chaîne a fonctionné **jusqu'à l'ingestion WF1 incluse**. Elle s'est arrêtée
> au dernier maillon — l'enregistrement de provenance — à cause d'un défaut de
> portée Groovy **dans mon propre code de pipeline**. Aucun artefact n'a donc été
> créé, et le blocage de gouvernance persiste honnêtement.

---

## Porte d'envol (étape 0) — PASS

```
backend      revision bf0e677 == r95 attendu · /healthz 200 · 0 redémarrage
WF1          50 nœuds · actif · binaryMode separate · Merge b06c628e · provenance_status présent
credentials  ACR_CREDENTIALS présent (username jenkins-acr-push → principal AcrPush)
             N8N_INTERNAL_SECRET présent (Secret text)
bibliothèque origin/feat/acr-publish-provenance = 55a1a5a
DISPATCH OFF · HARNESS OFF · artefacts 2 · tentatives 0
```

Les deux identifiants avaient bien été créés par l'opérateur, et `ACR_CREDENTIALS`
porte le principal à portée `AcrPush` recommandé — pas le compte administrateur
du registre.

## Épinglage (étape 1) — vérifié dans le log Jenkins

```
Loading library pfe-devsecops@feat/acr-publish-provenance
Found match: refs/heads/feat/acr-publish-provenance revision 55a1a5a317e83add0690afdc9538d1a6edee8fa4
```

`main` n'a pas été touchée : aucun autre projet n'a changé de pipeline.

## Base de référence (étape 2)

```
PROJECT_ID   078b5e76-c6f3-4014-9f52-ea5e4f435399
jenkinsJob   app-test-pfe-vermeg
registry     acrpfedevsecops        (azureConfig du projet)
imageRepo    app-test-pfe-vermeg    (azureConfig du projet)
dernier build Jenkins  #8 (SUCCESS) · prochain #9
artefacts 2 · tentatives 0
gouvernance  TECHNICALLY_IMPOSSIBLE · artifact.failureCode DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE
```

## Étapes du build (étape 4)

| Étape | Statut |
|---|---|
| Init · Checkout · Build | SUCCESS |
| SonarQube Analysis | SUCCESS |
| Docker Build | SUCCESS |
| **Publish Image (ACR)** | **SUCCESS** |
| Trivy Scan · OWASP Dependency Check | SUCCESS |
| Kubernetes Target Check · ZAP DAST Scan | SUCCESS |
| **Record Image Provenance** | **jamais exécutée** ← le défaut |

## Ce que la publication a réellement fait (étapes 5–8)

```
+ docker login acrpfedevsecops.azurecr.io --username jenkins-acr-push --password-stdin
+ echo ****                                              ← mot de passe masqué
+ docker tag app-test-pfe-vermeg:9 acrpfedevsecops.azurecr.io/app-test-pfe-vermeg:9-f02b6fb4d2b2
+ docker push acrpfedevsecops.azurecr.io/app-test-pfe-vermeg:9-f02b6fb4d2b2
  …
  9-f02b6fb4d2b2: digest: sha256:a80a679ec30ad9b101cdabd9ce2fbaa0179f8f1f2226bf9a8e2bdc49b6affe53 size: 1993
+ docker logout acrpfedevsecops.azurecr.io
Image published: acrpfedevsecops.azurecr.io/app-test-pfe-vermeg:9-f02b6fb4d2b2
  (provenance registration deferred until the platform has ingested this build)
```

**L'image est réellement dans ACR.** Le digest ci-dessus est celui que le
**registre a renvoyé au démon pendant le push** — c'est une corroboration que le
push a abouti, **pas** le digest résolu par le backend, qui reste l'autorité et
n'a jamais été sollicité (voir plus bas).

### Identité exacte

| Élément | Valeur |
|---|---|
| commit complet | `f02b6fb4d2b2e9f46afcdc9ca88dc1d086187248` |
| référence locale | `app-test-pfe-vermeg:9` |
| tag publié | `9-f02b6fb4d2b2` |
| préfixe du tag ↔ commit | `f02b6fb4d2b2` = 12 premiers caractères ✅ |
| garde de révision OCI | **passée** — elle échoue *avant* tout push ; le push a eu lieu, donc le label égalait le commit du run |

## Ingestion WF1 (étapes 10–11) — parfaite

```
WF1_EXECUTION_ID  2104   status success   17:48:36 → 17:50:20
incident          a2f40383-ba05-4930-ad24-c8affe520e31   build 9
sourceCommitSha   f02b6fb4d2b2e9f46afcdc9ca88dc1d086187248
enrichedData.docker = {
  "build_status": "SUCCESS",
  "push_status": "SUCCESS",
  "registry": "acrpfedevsecops",
  "repository": "app-test-pfe-vermeg",
  "published_tag": "9-f02b6fb4d2b2",
  "published_reference": "acrpfedevsecops.azurecr.io/app-test-pfe-vermeg:9-f02b6fb4d2b2",
  "provenance_status": "PENDING",
  "digest": null
}
```

**Tous les faits de publication ont survécu à la normalisation.** `PENDING` est
l'état attendu à l'heure du rapport — ce n'est pas un échec. `digest: null` est
correct : le pipeline ne revendique aucun digest, le backend en est l'autorité.

## Le défaut réel (étape 21) — couche PROVENANCE

Dernière ligne utile du log :

```
Reporting failed (non-fatal, original build result preserved):
No such property: imagePublication for class: devSecOpsPipeline
```

**Cause racine, dans mon code.** `Map imagePublication` était déclarée dans le
bloc `node {}`, **affectée depuis la closure `withCredentials {}`**, puis relue
dans le bloc de rapport *à l'extérieur* de cette closure. Sous Jenkins CPS, la
locale typée n'y est pas visible : la garde a levé une exception, le `catch` l'a
avalée comme non fatale, et l'étape `Record Image Provenance` n'a **jamais**
tourné.

Conséquences, et ce qui n'a **pas** été réécrit :

| Fait | État | Préservé ? |
|---|---|---|
| push vers ACR | **SUCCESS** | ✅ vrai, conservé tel quel |
| coordonnées publiées | réelles | ✅ conservées |
| provenance | **PENDING**, jamais progressée | ✅ pas de faux succès |
| digest résolu par le backend | jamais sollicité | — |
| `deployment_artifacts` | **+0** | attendu +1 ❌ |
| `deployment_attempts` | **0** | ✅ conforme |

Le backend se comporte exactement comme conçu : l'identité de build a bien
basculé sur le nouveau commit (`buildIdentity.commitSha =
f02b6fb4d2b2e9f46afcdc9ca88dc1d086187248`, build 9), mais
`candidateArtifact: null` → `DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE` **persiste
à juste titre**, et `freshLookup: null` montre que le résolveur de digest n'a
même pas été appelé, faute de candidat. Aucun artefact fantôme, aucune
gouvernance forcée.

### Correctif, en source — sans relancer de build

`telemetry` traverse déjà toutes ces closures : c'est lui qui construit la charge
du rapport dans le bloc même qui ne voyait pas la locale. Le résultat de
publication vit donc maintenant sur `StageTelemetry.imagePublication`, posé par
`publishImage()` **sur les deux chemins** (publié et `NOT_CONFIGURED`), et relu
par l'étape de provenance.

```
commit  1831020 → publié : origin/feat/acr-publish-provenance = e802469
suite   296 assertions vertes (9 nouvelles, section 10)
```

La nouvelle section vérifie que le résultat est porté par `telemetry` dans les
deux cas, que le pipeline lit `telemetry.imagePublication`, et qu'**aucune
locale `Map imagePublication` ni affectation depuis `withCredentials` ne
subsiste** — exactement la forme qui a cassé.

**Aucun second build n'a été déclenché**, conformément à la consigne.

## Sécurité des secrets (étapes 9, 22) — CLEAN

```
mot de passe ACR en clair            0   (« echo **** », 3 lignes « Masking supported pattern »)
valeur de N8N_INTERNAL_SECRET        0   (recherchée littéralement dans les 196 740 octets du log)
blob chiffré de credential Jenkins   0
paire jenkins-acr-push:<mot de passe> 0

SECRETS_IN_PIPELINE_LOGS = 0
```

## SOURCE → API → UI (étapes 18–19)

| Champ | Source | Valeur source | API | UI | Match |
|---|---|---|---|---|---|
| numéro de build | Jenkins | 9 | 9 | 9 | ✅ |
| commit | git | `f02b6fb4d2b2…187248` | idem | idem | ✅ |
| dépôt d'image | azureConfig | `app-test-pfe-vermeg` | idem | idem | ✅ |
| tag publié | registre | `9-f02b6fb4d2b2` | idem | idem | ✅ |
| registre | azureConfig | `acrpfedevsecops` | idem | idem | ✅ |
| statut de push | Jenkins | SUCCESS | SUCCESS | « Poussée » | ✅ |
| statut de provenance | pipeline | PENDING | PENDING | « En attente d'ingestion » | ✅ |
| digest | artefact backend | *absent* | `null` | « Provenance non vérifiée » | ✅ véridique |

`MISMATCH_COUNT = 0`. Le digest est la seule case vide, et l'écran le dit au lieu
d'afficher le digest rapporté par le push — ce qui serait une autorité qu'il n'a
pas.

## Sécurité inter-projet (étape 20) · état final (étape 23)

```
spec d'identité inter-projet : PASS (aucun nouveau build lancé)
CROSS_PROJECT_ARTIFACT_LEAK = NO

WF1 50 nœuds actif · WF2 195 nœuds actif · WF6 184 nœuds actif  — intacts
DISPATCH OFF · HARNESS OFF · artefacts 2 · tentatives 0
backend 200 · frontend 200
```

---

## Verdict

```
PRE_FLIGHT_GATE            = PASS
BACKEND_R95_LIVE           = YES
WF1_LIVE                   = YES
JENKINS_CREDENTIALS_READY  = YES

SHARED_LIBRARY_VERSION = feat/acr-publish-provenance (epinglee pour ce build uniquement)
SHARED_LIBRARY_COMMIT  = 55a1a5a317e83add0690afdc9538d1a6edee8fa4 (resolu par Jenkins)

CONTROLLED_BUILD_EXECUTED = YES
BUILD_NUMBER              = 9
BUILD_RESULT              = SUCCESS (663 s)

FULL_COMMIT_SHA       = f02b6fb4d2b2e9f46afcdc9ca88dc1d086187248
IMAGE_BUILT           = YES
LOCAL_IMAGE_REFERENCE = app-test-pfe-vermeg:9
OCI_REVISION          = egale au commit du run (garde fail-closed passee ; le push n'a lieu qu'alors)
OCI_COMMIT_MATCH      = PASS

REGISTRY            = acrpfedevsecops          (azureConfig du projet)
IMAGE_REPOSITORY    = app-test-pfe-vermeg      (azureConfig du projet)
ACR_LOGIN           = PASS
IMAGE_PUSHED_TO_ACR = YES
PUBLISHED_TAG       = 9-f02b6fb4d2b2
PUBLISHED_REFERENCE = acrpfedevsecops.azurecr.io/app-test-pfe-vermeg:9-f02b6fb4d2b2

REPORT_SENT                 = YES (n8n HTTP 200)
PROVENANCE_PENDING_OBSERVED = YES
WF1_EXECUTION_STATUS        = success (exec 2104)
WF1_BUILD_INGESTED          = YES (incident a2f40383, build 9, tous les faits de publication)

PROVENANCE_FINAL_STATUS = PENDING — l'etape d'enregistrement n'a jamais tourne
BACKEND_DIGEST_RESOLVED = NO     — jamais sollicitee, faute de candidat
RESOLVED_DIGEST         = aucun  (le registre a repondu sha256:a80a679e… au PUSH ;
                                  ce n'est pas un digest resolu par le backend)

DEPLOYMENT_ARTIFACT_DELTA = 0    (attendu +1)
ARTIFACT_SOURCE           = n/a  (aucune ligne creee)
DEPLOYMENT_ATTEMPT_DELTA  = 0    ✅

PROJECT_MATCH    = PASS
BUILD_MATCH      = PASS
COMMIT_MATCH     = PASS
REPOSITORY_MATCH = PASS
TAG_MATCH        = PASS
DIGEST_PRESENT   = FAIL (aucun artefact enregistre)

DEPLOY_ARTIFACT_PROVENANCE_UNAVAILABLE = YES (correct : aucun artefact qualifie)
GOVERNANCE_RESULT                      = TECHNICALLY_IMPOSSIBLE
   identite de build       PASS (commit f02b6fb4…, build 9)
   provenance d'artefact   FAIL (aucun artefact)
   registre / digest       FAIL (aucun digest resolu)
   configuration Azure     PASS (aci-app-test-pfe-vermeg / francecentral)

DOCKER_UI_SOURCE_API_UI_MATCH = PASS (0 ecart ; digest absent affiche comme absent)
CROSS_PROJECT_ARTIFACT_LEAK   = NO
MANUAL_ARTIFACT_CREATED       = NO
SECRETS_IN_PIPELINE_LOGS      = 0
AZURE_DEPLOYMENT_EXECUTED     = NO
DISPATCH_FINAL_STATE          = OFF
HARNESS_FINAL_STATE           = OFF

P0_REMAINING = 0
P1_REMAINING = 1
   l'etape de provenance n'a jamais tourne (portee Groovy CPS). CORRIGEE en source
   et publiee (e802469) ; il reste UN build pour la prouver.
P2_REMAINING = 2
   (a) main de la bibliotheque non fusionnee (volontaire, epinglage prefere)
   (b) 7 workflows sondes temporaires inactifs a nettoyer dans n8n

READY_FOR_CONTROLLED_AZURE_DEPLOYMENT = NO (aucun artefact qualifie)
FINAL_VERDICT = B — BUILD_SUCCESS_ARTIFACT_CHAIN_PARTIALLY_BLOCKED
```

**Ce que ce build a prouvé pour de vrai** : l'épinglage de bibliothèque, la garde
d'identité OCI, la résolution du registre depuis la configuration du projet,
l'authentification ACR avec un principal à portée minimale, le push d'une image
réelle sous un tag unique, le masquage des secrets, et l'ingestion complète par
WF1 de tous les faits de publication. Sept maillons sur huit.

**Ce qu'il n'a pas prouvé** : la création automatique de l'artefact. Le huitième
maillon a échoué sur un défaut de portée dans mon propre pipeline, corrigé et
publié. Un seul build supplémentaire suffit — je n'en ai pas lancé.

### Pour le prochain build

Rien à reconfigurer : le Jenkinsfile épingle déjà la branche, et la branche porte
désormais le correctif (`e802469`). Un build d'`app-test-pfe-vermeg` devrait
dérouler `Publish Image (ACR)` puis `Record Image Provenance`, et créer la ligne
`deployment_artifacts` avec `source = JENKINS_PIPELINE` et le digest résolu par
le backend via l'agent.
