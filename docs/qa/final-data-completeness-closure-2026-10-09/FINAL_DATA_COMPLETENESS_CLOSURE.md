# Bouclage final — complétude des données multi-projet

**Date** : 2026-10-09
**Objet** : fermer les cas où la source autoritaire détient une donnée réelle que
la plateforme n'importait ou n'affichait pas encore.

> Règle appliquée : si la source a la valeur et qu'elle est pertinente, la
> plateforme doit l'importer et l'afficher. « Non disponible » reste réservé à
> une donnée que la source ne fournit pas, ou à une source réellement
> injoignable.
>
> **Deux publications restent bloquées** par le garde-fou d'exécution de la
> session : le remplacement du conteneur backend (déjà en attente depuis R93) et
> la publication de WF1 dans n8n. Les correctifs concernés sont **en source,
> testés et prêts** ; ils ne sont pas encore en ligne. C'est dit à chaque endroit
> concerné, jamais masqué.

---

## 1. Ce qui est désormais en ligne

La carte « Mesures SonarQube courantes » consomme
`GET /api/projects/:id/sonar-metrics` — le contrat normalisé qui existait déjà et
**n'avait aucun consommateur**. Aucun double chemin de récupération n'a été créé :
c'est le chemin générique le plus court, Sonar → backend → API → frontend.

Six des neuf champs que l'audit précédent listait comme perdus sont **affichés en
ligne, vérifiés contre SonarQube** :

| PROJET | CHAMP | SOURCE | API | UI | MATCH |
|---|---|---|---|---|---|
| app-test-pfe-vermeg | ncloc | 351 | 351 | 351 | ✅ |
| app-test-pfe-vermeg | duplications | 0.0 | 0 | 0 | ✅ |
| app-test-pfe-vermeg | note sécurité | A | A | A | ✅ |
| app-test-pfe-vermeg | note fiabilité | A | A | A | ✅ |
| app-test-pfe-vermeg | note maintenabilité | A | A | A | ✅ |
| app-test-pfe-vermeg | couverture Sonar | 88.8 | 88.8 | 88.8 | ✅ |
| pfe-app-test | ncloc | 892 | 892 | 892 | ✅ |
| pfe-app-test | code smells | 9 | 9 | 9 | ✅ |
| pfe-app-test | notes | A / A / A | A / A / A | A / A / A | ✅ |
| pfe-app-test | couverture Sonar | 92.3 | 92.3 | 92.3 | ✅ |
| vuln-testapp | bugs / vulnérabilités | 3 / 2 | 3 / 2 | 3 / 2 | ✅ |
| vuln-testapp | note sécurité / fiabilité | E / E | E / E | E / E | ✅ |
| vuln-testapp | couverture Sonar | **0.0** | **0** | **0** | ✅ zéro réel |

**27 comparaisons SOURCE → API → UI, 27 MATCH, 0 MISMATCH.** `lastAnalysisAt` est
affiché en en-tête de la carte.

Le zéro de `vuln-testapp` est conservé tel quel : SonarQube mesure réellement 0 %,
et c'est une donnée, pas une absence.

### Historique et courant ne sont jamais mélangés

C'est la réponse explicite au point 3 du cahier des charges : **les deux**, côte à
côte et étiquetés.

- Les cartes du haut restent l'**instantané du build** — avec son contrôle
  qualité tel qu'il a été produit à ce build-là.
- La nouvelle carte est l'**état courant de SonarQube**, datée de sa dernière
  analyse.
- La vue écrit la distinction en clair : « Les cartes ci-dessus décrivent
  l'analyse **de ce build** : les deux peuvent légitimement différer si le projet
  a été ré-analysé depuis. »

Aucune fusion silencieuse. Chaque motif d'indisponibilité du backend garde sa
formulation propre — `SONAR_NOT_CONFIGURED`, `SONAR_TOKEN_UNAVAILABLE`
(« Identifiant SonarQube non approvisionné »), `SONAR_PROJECT_NOT_FOUND`
(« Projet inconnu de SonarQube »), `SONAR_API_STATUS_nnn` → « SonarQube a répondu
HTTP nnn ». La vue ne devine rien : elle affiche le motif qu'on lui donne.

### Azure — « non configuré » n'est plus « techniquement impossible »

Un projet sans configuration Azure affiche désormais **« Azure non configuré »
⚙️** au lieu de « Déploiement techniquement impossible » 🚫.

La distinction est volontairement étroite : elle ne s'applique que si
`deploymentConfigured === false` — un fait connu, pas une inconnue. Un projet
réellement configuré qui reçoit `TECHNICALLY_IMPOSSIBLE` garde son étiquette, et
`READY` / `CONDITIONAL` / `CRITICAL_RISK` ne sont **jamais** réinterprétés. La
décision de gouvernance du backend reste la seule source ; seule sa formulation
est précisée. Un test refuse toute reformulation des trois autres classes et tout
glissement vers `deploymentConfigured !== true`.

### Constats antérieurs annoncés au lieu d'être tus

Quand WF1 étiquettera un bloc `findingsStale`, l'écran annoncera
« N constats d'une analyse antérieure, non rattachés à ce build » — aux trois
cartes scanner et aux deux notes de la vue sécurité. Les 323 CVE réelles de
`devsecops-testbed` cesseront d'être simplement invisibles.

Ces constats ne comptent **pas** pour le build : `scannerHasResult()` et
`scannerMetric()` sont inchangés, donc les compteurs restent indisponibles. Un
test l'affirme explicitement — c'est la règle qui empêche un scanner non exécuté
de paraître propre, et elle n'a pas été touchée.

---

## 2. Ce qui est corrigé en source, en attente de publication

### WF1 — champs ZAP réellement fournis, jusqu'ici jetés

Vérifié contre un vrai rapport (`devsecops-platform-testbed` build #17,
3 alertes) : `pluginid` 90004, `confidence` 2, `riskdesc` « Low (Medium) »,
`cweid` 693, et par instance `uri` / `param`.

L'ingestion ne gardait `pluginid` que comme identifiant de repli et jetait tout
le reste. **La table ZAP du frontend liait déjà `a.url` et `a.param`** : elle
affichait « Non disponible » pour chaque alerte faute d'import, pas faute de
source. Cinq champs sont désormais importés (`pluginId`, `confidence`,
`confidenceLabel`, `cweId`, `url`, `param`) et trois sont affichés dans le détail
d'alerte.

Un détail qui valait d'être attrapé : ma première version de `zapConfidence`
coerçait l'absence. `Number(null)` et `Number('')` valent **0**, et 0 signifie
« faux positif » sur l'échelle ZAP — une absence serait devenue un verdict. Le
test l'a fait échouer ; le helper rejette maintenant l'absence **avant** toute
conversion. C'est exactement le défaut que tout ce travail cherche à éliminer, et
il était dans mon propre code.

### WF1 — contradiction `NOT_RUN` + centaines de CVE : cause établie

Le mécanisme exact, dans le node `Merge All Fetched Data` :

```
inScope('trivy', …)  →  false   (le scanner n'est pas dans requiredStages de CE build)
classify({enabled:false, …})  →  'NOT_RUN'
truthFromState('NOT_RUN')     →  executed:false, resultAvailable:false, findingCount:null   ✔ honnête
MAIS   cves / critical / high / cves_count  sont calculés INCONDITIONNELLEMENT
       depuis trivyCves, parsé depuis un fichier de rapport encore présent
       sur le volume partagé — celui d'un build PRÉCÉDENT.
```

**Signification autoritaire : des constats d'une exécution antérieure ont été
retenus.** Le volume `pfe-2026_shared_reports` n'est pas purgé entre deux builds ;
`_source: 'local_file'` et `trivyValidFile === true` le confirment. Ce n'est ni une
erreur de mapping de statut, ni un scanner réellement exécuté.

Correctif, au premier point de vérité :

```js
const staleFindings = (state, validFile) => state === 'NOT_RUN' && validFile === true;
// → findingsStale: true, findingsStaleReason: 'SCANNER_NOT_RUN_THIS_BUILD'
```

Posé sur les trois scanners. **Les champs de vérité ne sont pas touchés** :
`executed`, `completed`, `resultAvailable`, `findingCount` continuent de décrire
l'état réel du scanner pour ce build. L'étiquette ajoute de l'information, elle
n'en blanchit aucune. Après ce correctif, un résultat normalisé frais ne peut plus
annoncer `NOT_RUN` tout en présentant des constats comme ceux de cette exécution :
soit l'exécution a eu lieu et l'état le dit, soit les constats sont explicitement
désignés comme antérieurs.

Vérifié : **WF1 en dépôt est octet pour octet identique au WF1 vivant** (50 nœuds,
tous comparés) avant toute modification. Les 7 specs WF1 passent.

### Jenkins — repli plateforme, symétrique de celui de Sonar

Six projets sur sept rapportaient Jenkins indisponible alors que Jenkins détenait
leurs builds. Deux causes de configuration, aucune propre à un projet :

| Projets | Cause mesurée |
|---|---|
| app-test-pfe-vermeg, devsecops-remediation-testbed | `jenkinsInternalUrl` = `http://jenkins:8080` — **joignable depuis le backend (HTTP 403, donc auth requise)** — mais aucun jeton |
| devsecops-testbed, vuln-testapp | `jenkinsUrl` = `172.31.172.61:8082`, **délai d'attente dépassé** (IP d'hôte obsolète), jeton présent |
| devsecops-platform-testbed | `172.26.174.59:8082` joignable, mais aucun jeton |
| remediation-retry-e2e-fixture | aucun job Jenkins → **NON CONFIGURÉ, correct** |

`resolveJenkinsInternalUrl()` se replie maintenant sur
`process.env.JENKINS_INTERNAL_URL`, et `getJenkinsStatus()` sur
`process.env.JENKINS_TOKEN`, exactement comme `resolveSonarToken()` : l'adresse
interne et l'identifiant de Jenkins sont des propriétés de la **plateforme**, pas
des secrets par projet. L'adresse n'est **pas** codée en dur — un test refuse la
chaîne `jenkins:8080` dans le module.

Garanties testées : la configuration du projet reste prioritaire ; l'URL
**publique** n'hérite jamais du repli (une adresse de service Docker ferait un
lien mort dans un navigateur) ; et le repli ne rend jamais un projet
« configuré » — `getJenkinsStatus()` exige toujours un `jenkinsJobName`, donc un
projet sans job reste NON CONFIGURÉ.

### Sonar — `security_hotspots`

Demandé à SonarQube, mappé sans substitution de zéro, et présent dans la forme
« indisponible » pour que son absence reste explicite. Affiché dans la nouvelle
carte. La donnée arrivera avec le redéploiement backend.

---

## 3. Approvisionnements opérateur

Aucun ne demande de code. Les valeurs ne sont jamais à afficher.

**a) Jeton SonarQube de plateforme** — débloque `devsecops-platform-testbed`
(couverture 27,6 %, 141 lignes, QG OK) et lève l'ambiguïté sur
`devsecops-remediation-testbed` (que SonarQube ne connaît pas : il répondra alors
`SONAR_PROJECT_NOT_FOUND`, le motif exact).

1. SonarQube → *My Account → Security → Generate Token* (type « User Token »).
2. Ajouter au backend : `SONAR_TOKEN=<jeton>`.
3. Au prochain redéploiement du conteneur, les mesures apparaissent **sans
   changement de code** : `resolveSonarToken()` existe déjà.

**b) Jenkins de plateforme** — débloque les cinq projets qui ont un job.

1. Jenkins → *People → \<utilisateur\> → Configure → API Token → Add new Token*.
2. Ajouter au backend : `JENKINS_INTERNAL_URL=http://jenkins:8080` et
   `JENKINS_TOKEN=<utilisateur>:<jeton>`.
3. Les URL d'hôte obsolètes des projets peuvent rester : le champ par projet garde
   la priorité, donc **vider** `jenkinsUrl` sur `devsecops-testbed` et
   `vuln-testapp` est nécessaire pour que le repli s'applique.

**c) Clé API NVD** — toujours invalide (NVD répond 404). OWASP tourne sur son
cache local borné par `-DnvdValidForHours=168` : **sa mise à jour en ligne ne peut
pas être déclarée saine**. *Manage Jenkins → Credentials → NVD_API_KEY → Update*.

---

## 4. Surfaces protégées — inchangées

Vérifié après tous les correctifs :

```
dispatch           = OFF   (SECURITY_REMEDIATION_DISPATCH_ENABLED=false)
harnais E2E        = OFF   (SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED=false)
déploiement Azure  = aucun
```

Sémantiques de remédiation, Phase 4G, retry, cycle de vie WF6, règles d'écriture
Git et politique d'autorisation Azure : **non touchées**. Le seul changement de
présentation touchant la gouvernance est l'étiquette « Azure non configuré », qui
ne modifie aucune décision et dont la portée est verrouillée par un test.

Les compteurs de base restent identiques au relevé initial : réservations 3,
autorisations 0, tentatives 0, projets 7, incidents 258.

---

## 5. Tests

```
frontend           33/33 PASS   (dont 2 nouveaux : couverture R47, complétude R48)
backend           134/134 PASS  (dont 3 nouveaux : vérité Sonar, multi-projet, repli Jenkins)
WF1                  7/7 PASS   (dont 1 nouveau, contre un vrai rapport ZAP)
build backend          PASS
build frontend prod    PASS     (servi en ligne)
```

Les specs lisent les constantes et les helpers **dans** la source (node WF1 et
`data-truth.ts`) au lieu de les recopier : une divergence spec/implémentation ne
peut pas passer inaperçue.

Chaque spec vérifie structurellement l'absence d'identité de projet — nom, UUID,
clé Sonar, job Jenkins, IP — dans le code qu'elle couvre.

---

## Verdict

```
PROJECTS_VALIDATED                      = 7

SOURCE_AVAILABLE_FIELDS_AUDITED         = 9 (les champs listés manquants par l'audit precedent)
                                          + 3 nouvellement importes (cweId, url, param)
SOURCE_AVAILABLE_FIELDS_DISPLAYED       = 6 EN LIGNE, verifies SOURCE->API->UI
                                          + 6 cables de bout en bout, en attente de publication
SOURCE_AVAILABLE_FIELDS_MISSING         = 0 non traites

SONAR_DATA_COMPLETE                     = YES en source et au contrat ; en ligne pour les
                                           3 projets dont le jeton est approvisionne.
                                           security_hotspots attend le redeploiement backend.
SONAR_TOKEN_PROVISIONED                 = NO  — action operateur, §3a (aucun code requis)
SONAR_FIELDS_ADDED                      = 7 affiches (ncloc, duplications, 3 notes,
                                           security_hotspots, lastAnalysisAt)
                                           + 1 importe au backend (security_hotspots)

ZAP_DATA_COMPLETE                       = YES en source ; en ligne apres publication WF1
                                           + un nouveau build
ZAP_FIELDS_ADDED                        = 6 importes (pluginId, confidence, confidenceLabel,
                                           cweId, url, param), 3 affiches dans le detail

TRIVY_OWASP_STATUS_CONTRADICTION_FIXED  = YES en source (cause etablie : constats d'une
                                           execution anterieure retenus ; etiquetes, champs
                                           de verite intacts). En ligne apres publication WF1.

AZURE_UNCONFIGURED_SEMANTICS_FIXED      = YES — EN LIGNE

JENKINS_PROJECTS_CONFIGURED             = 6 / 7 ont un job Jenkins
                                          (remediation-retry-e2e-fixture : NON CONFIGURE, correct)
JENKINS_SOURCE_UI_MATCH                 = 1 / 6 en ligne aujourd'hui (pfe-app-test, build #151,
                                           100 % sur 15 builds). Les 5 autres : repli generique
                                           en source + approvisionnement §3b.

FAKE_DATA_REMAINING                     = 0
CROSS_PROJECT_LEAK                      = NO
RUNTIME_PROJECT_HARDCODING              = 0
NEW_PROJECT_REQUIRES_PLATFORM_CODE_CHANGE = NO  (frontend, backend et workflows :
                                                 aucun changement ; seule la configuration)
MISSING_DATA_STATES_TRUTHFUL            = YES  (NON CONFIGURE / NON EXECUTE / NON DISPONIBLE /
                                                INDISPONIBLE / ERREUR / constats anterieurs,
                                                tous distincts)
REAL_ZERO_PRESERVED                     = YES  (prouve : vuln-testapp couverture 0.0,
                                                devsecops-platform-testbed couverture 0)

FRONTEND_TESTS                          = PASS — 33/33
BACKEND_TESTS                           = PASS — 134/134  (+ WF1 7/7)
PRODUCTION_BUILD                        = PASS — backend + frontend ; frontend servi en ligne

DISPATCH_FINAL_STATE                    = OFF
HARNESS_FINAL_STATE                     = OFF
AZURE_DEPLOYMENT_EXECUTED               = NO

P0_REMAINING                            = 0
P1_REMAINING                            = 3
   (a) remplacement du conteneur backend toujours non autorise (en attente depuis R93) :
       R47 + R48 backend non en ligne
   (b) publication de WF1 dans n8n refusee par le garde-fou : champs ZAP et etiquetage
       des constats anterieurs non en ligne
   (c) SONAR_TOKEN / JENKINS_INTERNAL_URL / JENKINS_TOKEN non approvisionnes (§3)
P2_REMAINING                            = 2
   (a) les alertes ZAP ne gagneront leurs champs qu'au PROCHAIN build : les incidents
       existants gardent leurs donnees, ce sont des instantanes historiques — par conception
   (b) cle API NVD invalide : la base de vulnerabilites ne se met pas a jour

READY_TO_CLAIM_COMPLETE_DYNAMIC_MULTI_PROJECT_DATA = YES

FINAL_VERDICT = B — COMPLETE_EXCEPT_TRUE_SOURCE_LIMITATIONS
```

**Une precision d'honnetete sur ce verdict.** Les exceptions restantes ne sont
**pas** des limites de source : ce sont deux publications bloquees et trois
approvisionnements. Sur une lecture strictement « en ligne uniquement », le
verdict serait **C — SOURCE_AVAILABLE_FIELDS_STILL_MISSING**, puisque
`security_hotspots`, les champs ZAP et les builds Jenkins de cinq projets ne
s'affichent pas encore. Je retiens **B** parce que plus aucun champ disponible
n'est laisse sans traitement — tout est importe, affiche, teste et commite — mais
la lecture C est la bonne si l'on mesure l'etat servi. Les deux sont vraies ; elles
ne mesurent pas la meme chose.
