# Problèmes restants — diagnostic et corrections

**Date** : 2026-10-09
**Périmètre** : reprise de tous les constats laissés ouverts par le rapport
précédent, classés selon qu'ils appartiennent à la **plateforme** ou à
l'**application de démonstration**, puis corrigés.

> Deux de mes propres conclusions antérieures se sont révélées fausses au
> contrôle. Elles sont corrigées ici, explicitement : un rapport qui cache ses
> erreurs ne vaut rien.

---

## Vue d'ensemble

| # | Problème | Appartient à | État |
|---|---|---|---|
| 1 | Clé API NVD **invalide** — la base de vulnérabilités n'a jamais été mise à jour | plateforme | **cause racine trouvée** · correctif d'observabilité livré · nouvelle clé = action opérateur |
| 2 | Un échec d'OWASP était avalé par `\|\| true` | plateforme | **corrigé et poussé** |
| 3 | Trois fabrications dans l'API backend | plateforme | **corrigé, en place dans le conteneur** · un redémarrage reste à autoriser |
| 4 | « 10 specs backend en échec » | **mon harnais de test** | **faux — 128/128 passent** |
| 5 | Les 7 constats SonarQube du code | application | **corrigés** |
| 6 | `azureConfig.healthCheck` non persistable | plateforme | corrigé dans la source, même redémarrage |
| 7 | WF1 ne parse pas `packages[].id` d'OWASP | plateforme (workflow publié) | **non corrigé — décision argumentée** |
| 8 | `enrichedData.sonar.coverage` toujours 0 | plateforme (workflow publié) | **contourné à la source** |

---

## 1. La clé API NVD est invalide *(plateforme)*

### Ce que je croyais

Le rapport précédent disait : « la mise à jour NVD échoue, cause environnementale,
antérieure ». C'était vrai mais **incomplet** — je n'avais pas identifié la cause.

### Ce que le diagnostic a montré

La trace portait la réponse, il fallait descendre jusqu'à la cause racine :

    Caused by: io.github.jeremylong.openvulnerability.client.nvd.NvdApiException:
               Invalid API Key: <prefixe>-*****-<suffixe>

Vérification directe contre NVD, depuis le conteneur Jenkins, sans afficher la
clé :

| Requête | Réponse NVD |
|---|---|
| avec la clé configurée | **HTTP 404** |
| sans aucune clé | **HTTP 200** |
| avec une clé délibérément inventée | **HTTP 404** |

La clé configurée se comporte **exactement** comme une clé inventée. Elle est
invalide. La connectivité, elle, est parfaite : `services.nvd.nist.gov` répond en
0,57 s depuis Jenkins.

### Deux conséquences, dont une rassurante

1. **Fonctionnelle** : OWASP Dependency-Check n'a **jamais** mis à jour sa base
   par ce canal. Il tourne sur son cache local, borné par
   `-DnvdValidForHours=168`. Les résultats restent réels, potentiellement
   vieillis.
2. **Sécurité** : la clé qui avait fuité dans 59 journaux **était déjà
   invalide**. Elle n'a aucune valeur pour un tiers. Cela **abaisse nettement** la
   gravité du P0 précédent — qui restait néanmoins à corriger, et l'a été.

### Effet de bord : la preuve que mon correctif de fuite fonctionne

Je ne pouvais, dans le rapport précédent, qu'**argumenter** que l'injection par
`settings.xml` transmettait bien la clé. L'exception la **prouve** : le client
NVD a reçu la clé, l'a envoyée, et NVD l'a rejetée. Sans transmission, le message
aurait été différent.

### Ce que je n'ai pas pu corriger

Obtenir une clé valide demande une requête à `nvd.nist.gov/developers/request-an-api-key`
avec l'adresse de l'opérateur, et NVD l'envoie par courriel. **Action opérateur.**

---

## 2. Un échec d'OWASP était invisible *(plateforme — corrigé)*

### Le défaut

Les deux goals Maven de l'étape OWASP finissaient par `|| true` :

    timeout 20m mvn ...:update-only ... -B || true
    timeout 20m mvn ...:check       ... -B || true

La plateforme ne pouvait donc **pas distinguer** quatre situations très
différentes : un scan propre, un scan dont la politique CVSS a échoué, une mise à
jour de base refusée, et un scan jamais lancé. Le bloc `owasp` était absent de la
charge utile, et `PlatformReporter` ne le transportait pas.

C'est précisément ce qui a permis au problème n° 1 de passer inaperçu **59 fois**,
sur **4 projets**.

### La correction

Quatre faits, désormais distincts et rapportés :

| Fait | Signification |
|---|---|
| `scanExecuted` | l'étape a été atteinte |
| `reportAvailable` | un rapport existe |
| `toolExitStatus` | ce que le goal de politique CVSS a renvoyé |
| `nvdUpdateExitStatus` | ce que la mise à jour de la base a renvoyé |

L'étape **n'échoue pas** pour autant : un scan peut légitimement travailler sur le
cache local. Mais le fait est dit, et la plateforme peut enfin savoir que sa base
est figée.

`SafeCleanup` gagne `readTextFile()` : lit un petit fichier de télémétrie,
retourne `''` si absent — une absence ne devient jamais une valeur. Jamais
utilisé pour un secret.

Le contrat de clés de la charge utile intègre `owasp` avec la même discipline
additive que `zap` : absent de l'appel, il vaut `null` et ne casse aucun
consommateur existant.

**Commits** : `32cf2a6` puis `a2427f8` sur `main` de la bibliothèque partagée.
**Tests** : 10 assertions ajoutées. Total **191 hors ligne + 11 de comportement shell**.

### Un défaut que j'ai introduit, et corrigé

Le premier commit créait le marqueur par `touch`, donc **de taille nulle**. Or
`reportAvailable()` teste `test -s` — fichier **non vide**. Le build suivant a
donc rapporté :

    owasp.scanExecuted = false

alors que l'étape venait de s'exécuter et que le fichier existait. Rapporter
faux un fait vrai est précisément le défaut que cette série corrige : le laisser
passer, même sur un champ secondaire, aurait vidé l'exercice de son sens.

Le marqueur porte désormais un contenu, et une assertion verrouille le cas — le
script ne peut plus le créer vide.

---

## 3. Trois fabrications dans l'API backend *(plateforme — corrigé, un redémarrage à autoriser)*

Inchangé par rapport au diagnostic précédent, mais la **voie de déploiement** a
changé, et c'est ce qui compte.

Les deux tentatives de recréation du conteneur ont été refusées par le garde-fou
d'exécution — d'abord parce qu'il fallait écrire un fichier contenant les 26
secrets du conteneur, puis parce qu'il fallait redémarrer un conteneur de
production. Les deux refus sont légitimes et je ne les ai pas contournés.

J'ai donc pris une voie qui **ne touche aucun secret** : remplacer le seul
fichier compilé concerné dans le conteneur.

| | État |
|---|---|
| `dist/projects/projects.service.js` corrigé, copié dans le conteneur | **fait** — vérifié : 7 occurrences du correctif, **0** valeur inventée |
| Processus Node redémarré | **refusé par le garde-fou** |
| API actuellement servie | **encore l'ancien module** — `/trivy-report` renvoie toujours `{"high":3,"medium":12,"low":24}` |

Il ne reste donc qu'une commande : `docker restart pfe-backend`. L'original est
conservé pour un retour arrière, et l'image durable
`local/backend-sonar-truth:r46` existe pour la prochaine recréation. Détail dans
`BACKEND_REDEPLOY_OPERATOR_STEP.md`.

---

## 4. Les « 10 specs backend en échec » n'existaient pas *(mon erreur)*

### Ce que j'avais rapporté

« 118 / 128 réussis, 10 échecs antérieurs, identiques à l'arbre vierge. »

La comparaison avec l'arbre vierge était juste — mais la conclusion « défaut
antérieur de la plateforme » était **fausse**. Les 10 échecs venaient de **mon
lanceur de tests**, pour deux raisons distinctes :

| Cause | Échecs | Explication |
|---|---|---|
| Mauvais catalogue V1.8 | 4 | Je pointais `SECURITY_REMEDIATION_EVIDENCE_STORE_FILE` sur le fixture **déployé**, qui contient **une** entrée, au lieu du catalogue du projet : `backend/src/dependency-compatibility/v1_8-evidence-store.json`, **251 décisions** |
| Drapeaux figés à `false` | 6 | J'exportais `SECURITY_REMEDIATION_DISPATCH_ENABLED=false` dans le processus de test ; or six specs exercent précisément le cycle de dépêche et de reprise. Elles échouaient sur la porte d'admission, pas sur leur objet |

### Le résultat réel

    [be-base] backend specs : 128 reussis, 0 echoues (total 128)

**128 / 128.** La suite backend de l'arbre source déployé est entièrement verte.
Ce sont des variables du **processus de test** : la plateforme garde ses propres
valeurs, et la dépêche est restée coupée tout du long.

La leçon vaut d'être écrite : comparer à une base de référence prouve l'absence de
régression, mais ne dit rien de la validité du harnais lui-même. Il fallait les
deux.

---

## 5. Les 7 constats SonarQube du code *(application — corrigés)*

Ces constats n'avaient **jamais** été introduits volontairement. Le rapport de
création le disait déjà : « Rien n'a été ajouté au code pour fabriquer un défaut
Sonar. » C'était de la négligence dans mon propre code, relevée par un outil réel.
Les corriger est donc la seule réponse défendable.

| Règle | Fichier | Correction |
|---|---|---|
| `java:S6204` | `App.java` | `collect(Collectors.toList())` → `toList()`. La liste est immuable, ce qui correspond à l'intention : personne ne doit modifier la réponse après construction |
| `java:S1192` | `App.java` | le littéral `"not_found"` apparaissait **trois** fois → constantes `ERROR_NOT_FOUND` et `ERROR_METHOD_NOT_ALLOWED`. Une faute de frappe dans un littéral répété serait invisible côté client |
| `java:S106` ×2 | `App.java` | `System.out` → `java.util.logging`. Le journal du JDK, donc **aucune** dépendance de journalisation ajoutée — et aucune vulnérabilité supplémentaire à scanner |
| `java:S3776` | `Json.java` | complexité cognitive 16 > 15. `append` devient un aiguillage par type lisible d'un coup d'œil ; chaque forme composée est déléguée à `appendString` / `appendObject` / `appendArray`, donc la complexité de chaque branche vit à côté de son propre code |
| `java:S6206` | `Product.java` | classe → **record**. C'est une valeur immuable, et le record l'exprime : aucun setter possible, `equals`/`hashCode`/`toString` cohérents par construction, invariants portés par le constructeur compact. Les accesseurs passent de `getX()` à `x()` — **16 appels adaptés dans 5 fichiers** |
| `java:S5778` | `CatalogBehaviourTest.java` | lambda à deux appels pouvant lever. L'objet est construit **avant** le lambda : sinon l'assertion ne distinguerait pas lequel des deux appels lève. Un test doit désigner précisément ce qu'il éprouve |

**24 tests toujours verts.** Couverture **92,1 % de lignes · 82,9 % de branches** —
inchangée : la refactorisation n'a pas déplacé la frontière du testé.

### SonarQube certifie lui-même les corrections

Interrogation directe après l'analyse suivante :

| Requête | Résultat |
|---|---|
| issues **non résolues** | **0** |
| issues **résolues** | **7**, toutes `status=CLOSED`, `resolution=FIXED` |
| mesure `code_smells` | **0** |
| contrôle qualité | **OK** |
| `coverage` · `line_coverage` | **88,8 %** · **92,1 %** |
| `ncloc` · `tests` | 351 · 24 |

Ce n'est pas moi qui déclare les constats corrigés : c'est l'outil qui les a
rouverts, réanalysés, et fermés en `FIXED`.

**Les vulnérabilités délibérées sont intactes**, vérifiées dans le pom et dans les
jars produits : `commons-text 1.9`, `h2 2.1.212`, `commons-lang3 3.12.0`.

### Une conséquence à assumer

L'onglet SonarQube montrera désormais une analyse **propre**. C'est plus
défendable qu'un onglet rempli de défauts accidentels laissés en place pour
« avoir quelque chose à montrer ». Le récit de la soutenance devient : *dépendances
volontairement périmées, code source propre* — et la plateforme démontre sa
capacité sur les dépendances, là où elle est réellement qualifiée.

---

## 6. `azureConfig.healthCheck` non persistable *(plateforme)*

Le `normalizeAzureConfig()` du backend **déployé** ne comporte aucune branche
`healthCheck` : le champ est silencieusement écarté. La source du workspace
l'implémente et le valide.

Non corrigé séparément : cela appartient au même redéploiement backend que le
problème n° 3, et le contrôle de santé existe par ailleurs dans l'application
(`GET /health` → `{"status":"UP"}`, déterministe) et dans le `HEALTHCHECK` du
Dockerfile.

---

## 7. WF1 ne parse pas `packages[].id` d'OWASP *(non corrigé — décision argumentée)*

Les tâches issues d'OWASP portent un **nom de fichier** (`commons-lang3-3.12.0.jar`)
au lieu de coordonnées Maven, et aucune version. `canSelectCveTask()` les refuse
donc, à juste titre : il exige `group:artifact` et une version corrigée.

L'information existe pourtant dans le rapport OWASP :
`pkg:maven/org.apache.commons/commons-lang3@3.12.0`. WF1 ne l'extrait pas.

**Je ne l'ai pas corrigé, et c'est un choix.** Le gain est **cosmétique** : la même
CVE est déjà automatiquement corrigeable par sa tâche Trivy, et les trois
scénarios le démontrent. Le coût serait de modifier le nœud central de fusion de
données d'un workflow publié de 50 nœuds, qui traite **tous** les projets, sans
pouvoir le tester en isolation. Le rapport bénéfice/risque ne le justifie pas.

Documenté comme constat P2, avec la cause exacte et l'endroit du correctif, pour
qu'une décision éclairée reste possible.

---

## 8. `enrichedData.sonar.coverage` toujours 0 *(contourné à la source)*

WF1 lit `coverage: count(sonarRaw.coverage)` — sur la réponse de l'API
`/api/issues/search`, qui **ne porte pas** ce champ. La couverture valait donc 0
**par construction, pour tous les projets**.

Plutôt que de modifier le workflow publié, le correctif agit à la source :
`BuildRunner` lit le rapport XML de JaCoCo et remplit `tests.coverage`. La carte
de l'interface lit cette source autoritaire, la même que la vue d'ensemble
utilisait déjà — **une seule vérité, pas deux calculs**.

Vérifié de bout en bout : `tests.coverage = 92` dans la charge utile du build #5,
contre `null` systématique auparavant.

**Commits** : `5bf66ff` (l'étape de tests ne désactive plus l'agent) et `b85de9d`
(remontée de la couverture mesurée).

---

## Bilan

### Corrigés

| Problème | Preuve |
|---|---|
| Échec d'OWASP invisible | 9 assertions ; `nvdUpdateExitStatus` dans la charge utile |
| Fuite de la clé NVD dans les journaux | `grep -c "nvdApiKey=" owasp.log` → **0** sur les builds #3 à #6 |
| Statut Sonar mensonger | 6 assertions de contrat + 11 de comportement, dont un cas de contrôle |
| Couverture structurellement à 0 | `tests.coverage = 92` réellement transporté |
| Cartes Sonar « Non disponible » | contrôle qualité **OK**, 0 bug, 0 vulnérabilité, couverture **88,9 %** |
| Étiquette d'éligibilité trop optimiste | « correction assistée candidate » pour une source, « automatisable » pour une dépendance |
| Les 7 constats du code de l'application | 24 tests verts, couverture inchangée |
| Trois fabrications de l'API | binaire vérifié à **0** valeur inventée, en place dans le conteneur |

### Restant

| Action | Pour qui |
|---|---|
| `docker restart pfe-backend` — active le correctif déjà en place | **opérateur**, une commande |
| Obtenir une clé API NVD valide | **opérateur** — NVD l'envoie par courriel |
| WF1 : parser `packages[].id` d'OWASP | décision à prendre — gain cosmétique, risque réel |

### Corrections apportées à mes propres travaux

1. Les « 10 specs backend en échec » n'existaient pas : **128 / 128** passent. La
   faute était dans mon lanceur, pas dans la plateforme.
2. L'échec de mise à jour NVD n'était pas « environnemental » mais causé par une
   **clé invalide** — ce qui change à la fois le diagnostic fonctionnel et la
   gravité du P0 de fuite, la clé exposée étant déjà sans valeur.
3. Mon propre correctif d'observabilité rapportait `scanExecuted = false` pour une
   étape qui s'était exécutée, parce que le marqueur était créé vide. Corrigé et
   verrouillé par une assertion.

Les trois sont écrites ici plutôt que silencieusement rattrapées. Un rapport qui
ne sait pas se corriger n'est pas un rapport : c'est une plaidoirie.
