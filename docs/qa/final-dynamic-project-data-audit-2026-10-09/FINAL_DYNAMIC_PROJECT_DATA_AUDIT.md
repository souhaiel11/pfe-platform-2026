# Audit final — vérité des données et affichage dynamique multi-projet

**Date** : 2026-10-09
**Périmètre** : toute information liée à un projet, de la source autoritaire jusqu'à l'écran
**Projets audités** : 7 (tous les projets réels de la plateforme)

> Chaque valeur de ce rapport vient d'une requête exécutée contre l'outil
> autoritaire, d'une réponse d'API relevée, ou d'une lecture de la source servie.
> Aucune n'est estimée.
>
> **Limite de méthode, énoncée d'emblée** : je n'ai pas de navigateur. La
> vérification « écran » est faite sur **le bundle réellement servi** (identique
> par md5 au `dist` monté en bind dans `pfe-frontend`), sur la source dont il est
> issu, et sur les réponses d'API que l'écran consomme — pas par des clics. Les
> conclusions sur le changement de projet sont donc prouvées au niveau du code et
> de l'API, pas par observation visuelle.

---

## 0. Ce que l'audit a réellement établi

Deux défauts réels, trouvés en comparant l'outil à la plateforme :

| # | Défaut | Classe | État |
|---|---|---|---|
| 1 | La couverture affichait **0 %** pour des projets dont l'étape de tests avait été **sautée** | FAUX ZÉRO | **corrigé, en ligne** |
| 2 | SonarQube détenait de vraies mesures que la plateforme rapportait `SONAR_NOT_CONFIGURED` | DONNÉE PERDUE | **corrigé en source** |

Et un constat de placement sémantique, signalé sans être corrigé parce qu'il
demande une décision de sens (§7).

Le reste de l'audit confirme une discipline de vérité des données déjà solide :
`RUNTIME_PROJECT_HARDCODING = 0`, aucune fuite inter-projet, et des états
d'absence réellement différenciés.

---

## 1. Inventaire et provenance

**360 valeurs interpolées distinctes** sur les pages projet :

| Fichier | Valeurs |
|---|---|
| `project-detail.component.html` (8 onglets) | 205 |
| `cve-table.component.ts` (Trivy / OWASP) | 67 |
| `deployment-governance.component.html` | 48 |
| `project-overview.component.ts` | 21 |
| `zap-table.component.ts` | 18 |
| `projects.component.html` | 9 |

Chaîne de provenance réelle, vérifiée bout en bout :

```
projet sélectionné (route /projects/:id)
  → api.service.ts  (55 appels, un seul client HTTP centralisé)
  → /api/project-reads/incidents?projectId=…&analysisOnly=true   (résumés légers)
  → /api/incidents/:id                                           (détail à la demande)
  → incident.metadata.enrichedData                               (écrit par WF1)
  → this.ed  = metadata.enrichedData
  → data-truth.ts  (scannerHasResult / scannerMetric / scannerState / sonarQualityGate)
  → cartes, tableaux, badges
```

Point d'architecture notable : **deux chemins Sonar parallèles existent**.

| Chemin | Source | Consommé par l'UI |
|---|---|---|
| `/api/projects/:id/sonar-metrics` | API SonarQube **en direct** | **non — 0 référence dans `frontend/src`** |
| `enrichedData.sonar` | instantané écrit par WF1 au build | **oui, c'est ce que l'écran affiche** |

L'écran montre donc l'analyse **de ce build**, pas l'état courant de Sonar. C'est
défendable (un rapport de build est un instantané), mais cela signifie que
l'endpoint live, plus riche, n'alimente aucun écran (§6).

---

## 2. Défaut 1 — la couverture présentait une absence de mesure comme un vrai 0 %

`enrichedData.tests` porte `coverage: 0` **même quand l'étape n'a pas tourné**.
Les quatre liaisons de couverture lisaient ce 0 via `availableNumber()`, qui
accepte 0 comme un nombre valide — sans jamais regarder `tests.status`.

Comparaison sur données réelles, avant / après correction :

| Projet | `tests.status` | tests | brut | UI AVANT | UI APRÈS | Sonar |
|---|---|---|---|---|---|---|
| app-test-pfe-vermeg | SUCCESS | 24 | 92 | 92 % | **92 %** | 88.8 |
| pfe-app-test | **SKIPPED** | 0 | 0 | **0 %** | **Non exécuté** | 92.3 |
| vuln-testapp | **SKIPPED** | 0 | 0 | **0 %** | **Non exécuté** | 0.0 |
| devsecops-platform-testbed | SUCCESS | 2 | 0 | 0 % | **0 %** | 27.6 |
| devsecops-testbed | **UNKNOWN** | 0 | 0 | **0 %** | **Non disponible** | 0.0 |

**Trois faux zéros supprimés. Le zéro réel de `devsecops-platform-testbed`
(étape exécutée, 2 tests) est conservé** — c'est exactement la distinction
exigée : un zéro mesuré est une donnée, un zéro de remplissage n'en est pas une.

### Correctif

`frontend/src/app/shared/data-truth.ts` — un helper, dans la même discipline que
le module existant :

```ts
const TEST_STAGE_EXECUTED     = ['SUCCESS', 'UNSTABLE', 'FAILURE', 'FAILED'];
const TEST_STAGE_NOT_EXECUTED = ['SKIPPED', 'NOT_RUN', 'NOT_REACHED', 'NOT_CONFIGURED'];
export function testStageExecuted(tests: any): boolean { … }
export function testStageCoverage(tests: any): number | null { … }
export function testStageCoverageState(tests: any): string { … }
```

Un statut explicite tranche dans les deux sens. Sans statut (ou `UNKNOWN`), on
exige une **preuve positive d'exécution** (`total > 0`) — ce repli est
nécessaire : le contrat R46 existant décrit des blocs sans `status` portant une
vraie mesure, et il continue de passer.

L'étape de tests parle le vocabulaire Jenkins (`SUCCESS`/`SKIPPED`), pas le
`COMPLETED` des scanners : `scannerHasResult()` ne pouvait pas la qualifier, d'où
un helper dédié plutôt qu'un détournement du helper scanner.

Les **quatre** liaisons passent maintenant par une source unique
(`authoritativeCoverage()` + `coverageState()`), y compris celle qui lisait
`ed.tests?.coverage` directement dans le gabarit.

Couvert par `frontend/scripts/data-truth-coverage.spec.mjs` — 10 scénarios, dont
la préservation du zéro réel et un test de généricité prouvant que le résultat ne
dépend que des champs déclarés par le bloc, jamais du nom du projet. Le spec lit
les listes de statuts **dans** la source, pour qu'une divergence spec/module ne
puisse pas passer inaperçue.

---

## 3. Défaut 2 — données Sonar réelles rapportées « non configuré »

| Projet | SonarQube (interrogé en direct) | Plateforme avant correction |
|---|---|---|
| devsecops-testbed | 3 bugs, 3 vulnérabilités, **37** code smells, 488 lignes, 13,4 % duplication, note **E**, contrôle **ERROR** | `{"available":false,"reason":"SONAR_NOT_CONFIGURED"}` |
| devsecops-platform-testbed | couverture 27,6 %, 141 lignes, note A, contrôle **OK** | `{"available":false,"reason":"SONAR_TOKEN_UNAVAILABLE"}` |

Deux causes distinctes, et une seule est du code :

**(a) Code — corrigé.** `getSonarMetrics()` exigeait **à la fois**
`sonarqubeUrl` et `sonarqubeKey`, alors que `waitForSonarQualityGate()`, dans le
même service, traite déjà l'URL comme l'adresse de service de la plateforme et
lui applique un repli (`project.sonarqubeUrl || 'http://sonarqube:9000'`). Un
projet dont `sonarqubeUrl` était nul — `devsecops-testbed` — était donc déclaré
« non configuré » alors que sa `projectKey`, son jeton et Sonar répondaient
normalement. **Donnée perdue par la plateforme, pas absente de la source.**

Ce qui rend un projet configuré pour Sonar, c'est sa `projectKey`. L'URL suit
maintenant le même repli que la méthode sœur → comportement identique pour tout
projet, y compris nouvellement onboardé.

**(b) Configuration — action opérateur.** `SONAR_TOKEN_UNAVAILABLE` sur
`devsecops-platform-testbed` et `devsecops-remediation-testbed` : ces projets
n'ont pas de jeton propre, et `resolveSonarToken()` se replie sur
`process.env.SONAR_TOKEN` — **qui n'est pas défini dans le conteneur backend**
(28 variables relevées, aucune `SONAR_TOKEN`). Le repli existe dans le code ; il
n'est pas approvisionné. Définir `SONAR_TOKEN` sur le backend rend les mesures
de ces projets lisibles sans aucun changement de code.

Les quatre états d'absence restent distincts et sont désormais couverts par un
test : `SONAR_NOT_CONFIGURED`, `SONAR_TOKEN_UNAVAILABLE`,
`SONAR_PROJECT_NOT_FOUND` (réellement renvoyé pour
`devsecops-remediation-testbed`, que Sonar ne connaît pas), `SONAR_API_STATUS_nnn`.

Couvert par `backend/src/projects/sonar-metrics-multiproject.spec.ts` — repli
d'URL et sa priorité, les quatre états, préservation du zéro réel, généricité sur
des noms arbitraires, et un garde-fou refusant toute identité de projet codée en
dur dans le service.

---

## 4. Matrice Sonar — outil contre plateforme

11 champs × 5 projets analysés par Sonar = **55 comparaisons de champ**.

```
MATCH                                    16
MISMATCH                                  9   → ventilés ci-dessous
LOST (source a une valeur, instantané null) 30
```

Ventilation honnête des 9 « mismatch » — aucun n'est une donnée inventée :

| Cause | Cellules | Nature |
|---|---|---|
| `coverage` Sonar ≠ instantané | 3 | **par conception** : WF1 lit la couverture Sonar sur la réponse `/issues`, qui ne la porte pas → 0 par construction. L'UI ne l'affiche **pas** ; elle affiche JaCoCo (§2). |
| `code_smells` Sonar ≠ instantané | 3 | **vétusté légitime** : Sonar a ré-analysé après le build (ex. pfe-app-test : build #151 à 16 h 12, analyse Sonar à 22 h 54). L'instantané est juste **pour son build**. |
| `quality_gate` non-verdict | 3 | **import échoué** au moment du build (`API_ERROR`, `QUALITY_GATE_UNAVAILABLE`) alors que Sonar porte `OK`/`ERROR`. Même cause jeton/URL que §3. L'UI l'affiche **honnêtement** « Non disponible » : `sonarQualityGate()` rejette ces marqueurs au lieu de les présenter comme des verdicts. |

Les **30 LOST** correspondent à 6 champs que le pipeline n'importe jamais :
`ncloc`, `duplicated_lines_density`, `security_rating`, `reliability_rating`,
`sqale_rating`, `security_hotspots` (§6).

---

## 5. Matrice multi-projet

| Projet | Jenkins | Sonar | Trivy | OWASP | ZAP | Git | Azure | Rapport |
|---|---|---|---|---|---|---|---|---|
| app-test-pfe-vermeg | config., source injoignable (jeton absent) | **réel** 0/0/0, QG OK | **réel** 1 crit / 4 CVE | **réel** 1 crit / 3 CVE | **réel** 1 medium | repo propre | configuré, `aci-app-test-pfe-vermeg` | build #8 |
| pfe-app-test | **live**, #151, 100 % sur 15 | **réel** 0/0/9, QG ERROR | **réel** 14 crit / 111 | **réel** 23 crit / 146 | **réel** 2 medium | repo propre | configuré, `aci-pfe-app-test` | build #151 |
| vuln-testapp | config., URL périmée | **réel** 3/2/1 | **ÉCHEC** (message réel) | **ÉCHEC** | **ÉCHEC** | repo propre | non configuré | build #41 |
| devsecops-testbed | config., URL périmée | **réel** 3/3/37 (débloqué par §3) | `NOT_RUN` + 154 CVE ⚠ | `NOT_RUN` + 169 CVE ⚠ | `NOT_RUN` `zap_k8s_unreachable` | repo propre | configuré, `aci-devsecops-testbed` | build #19 |
| devsecops-platform-testbed | config., jeton absent | **réel** 0/0/0 (jeton à approvisionner) | **réel** 0 | **réel** 2 crit / 9 | **réel** 2 low | repo propre | non configuré | build #17 |
| devsecops-remediation-testbed | config., jeton absent | **Sonar ne connaît pas ce projet** | aucun rapport | aucun rapport | aucun rapport | repo propre | non configuré | aucun |
| remediation-retry-e2e-fixture | **non configuré** (correct) | **non configuré** (correct) | — | — | — | repo propre | non configuré | aucun |

Chaque valeur est propre à son projet. Les cibles Azure sont nominatives
(`aci-<nom-du-projet>`, région `francecentral`) — aucune valeur d'un projet
n'apparaît sous un autre.

⚠ **Anomalie signalée, non corrigée** : chez `devsecops-testbed`, les blocs Trivy
et OWASP portent `status: NOT_RUN` **et** 154 / 169 CVE réelles avec leurs
compteurs. L'étiquette contredit le contenu. `scannerHasResult()` fait confiance
au `status` et masque donc 323 constats réels. Faire l'inverse — croire les
compteurs plutôt que le statut déclaré — serait un **changement de sémantique**,
pas une correction d'affichage : la règle « un scanner non exécuté n'a pas de
résultat » est exactement ce qui empêche les faux zéros. La contradiction est
écrite par WF1 à l'ingestion ; c'est là qu'elle doit être réglée. Je m'arrête et
je le signale, conformément à la politique de correction.

---

## 6. Disponible mais non affiché

**9 champs distincts** (≈ 32 cellules projet × champ) :

| Champ | Fourni par | Premier point de perte | Verdict |
|---|---|---|---|
| `ncloc` | Sonar | WF1 ne l'écrit pas ; `/sonar-metrics` **l'expose** | NON AFFICHÉ |
| `duplicated_lines_density` | Sonar | idem | NON AFFICHÉ |
| `security_rating` | Sonar | idem (traduit A–E par le backend) | NON AFFICHÉ |
| `reliability_rating` | Sonar | idem | NON AFFICHÉ |
| `sqale_rating` (maintenabilité) | Sonar | idem | NON AFFICHÉ |
| `security_hotspots` | Sonar | ni WF1 ni `/sonar-metrics` | NON AFFICHÉ |
| `lastAnalysisAt` | Sonar | `/sonar-metrics` l'expose, aucun écran ne le lit | NON AFFICHÉ (fraîcheur, §8) |
| ZAP `confidence` | ZAP | **WF1** : l'alerte normalisée ne porte pas le champ | NON AFFICHÉ |
| ZAP `pluginId` / `ruleId` | ZAP | **WF1** : idem | NON AFFICHÉ |

**Justifié de ne pas afficher** : `enrichedData.sonar.coverage` — 0 par
construction, documenté, remplacé par la mesure JaCoCo autoritaire.

Le premier point de perte est **WF1** pour tous ces champs, et c'est là que la
correction appartient (règle « corriger à la source »). Modifier un workflow n8n
publié dépasse le mandat « correctif générique à faible risque », et la condition
`NEW_PROJECT_REQUIRES_WORKFLOW_CHANGE = NO` impose que ce soit un changement
plateforme réfléchi, pas un effet de bord d'audit. **Non corrigé, documenté.**

Chemin le plus court pour les 7 champs Sonar : brancher un écran sur
`/api/projects/:id/sonar-metrics`, qui les sert déjà réellement et n'a aujourd'hui
**aucun consommateur**.

---

## 7. Placement sémantique — un constat non corrigé

Un projet **sans aucune configuration Azure** reçoit
`decision: TECHNICALLY_IMPOSSIBLE`, que l'UI rend **« Déploiement techniquement
impossible » 🚫**. Lu par un humain, cela dit « ce projet ne pourra jamais être
déployé », alors que la réalité est « Azure n'est pas configuré pour ce projet ».

Le backend fournit déjà le signal permettant de distinguer les deux :
`environment.resolved = false`. Le composant le lit (`environmentResolved`) mais
ne s'en sert pas pour l'étiquette.

Je ne l'ai pas corrigé : `TECHNICALLY_IMPOSSIBLE` **est** l'état défini par le
backend, et le remplacer par « Non configuré » dans la vue risquerait de masquer
un vrai `TECHNICALLY_IMPOSSIBLE` sur un projet réellement configuré. Trancher
demande de décider si « non configuré » est un état de gouvernance à part — une
décision de sens, pas de mapping. **Signalé séparément, comme demandé.**

Pour le reste, le placement est correct : la couverture et le contrôle qualité
sous Sonar/Rapport, le statut de build sous Jenkins/CI, `fixedVersion` et
`installedVersion` dans le détail de constat scanner, l'état de PR dans le cycle
de remédiation, la gouvernance sous Déploiement. Aucun cas de métrique affichée
sous le mauvais outil.

---

## 8. États d'absence, zéro réel, fraîcheur

`data-truth.ts` différencie réellement les états, sans les fondre :

```
scannerState():  NOT_CONFIGURED        → « Non configuré »
                 NOT_RUN/SKIPPED/…     → « Non exécuté »
                 ERROR/FAILED/TIMEOUT  → « Indisponible »
                 RUNNING/PENDING       → « En attente »
                 résultat présent      → « Résultat disponible »
sonarQualityGate():  rejette QUALITY_GATE_UNAVAILABLE, API_ERROR,
                     SONAR_ANALYSIS_FAILED/CANCELED/TIMEOUT → null, jamais un verdict
```

Vérifié sur données réelles : `vuln-testapp` porte trois scanners en `FAILED`
avec le message d'erreur n8n d'origine et des compteurs à 0 →
`scannerHasResult()` renvoie `false`, donc **aucun 0 n'est affiché**. C'est le
comportement attendu.

**Faux zéros restants : 0.** Les 20 occurrences de `|| 0` / `?? 0` de la source
frontend ont été inspectées une par une : toutes sont des **prédicats** ou du
**style** (`(x||0)>0` pour une couleur, tri, largeur de barre). Aucune n'alimente
une valeur affichée — celles-ci passent par `scannerMetric()`, qui renvoie `null`
si le scanner n'a pas de résultat.

**Fraîcheur** : chaque analyse est datée (`createdAt`) et numérotée
(`buildNumber`), et l'UI nomme le build. Le `lastAnalysisAt` de Sonar n'est pas
affiché (§6) — c'est le manque de fraîcheur le plus utile à combler, puisque
l'écart instantané/Sonar courant (§4) est précisément ce qu'il rendrait visible.

---

## 9. Changement de projet et généricité

**Changement de projet** — prouvé au niveau du code, pas visuellement :

- 14 appels d'API passent tous par `takeUntil(this.projectScopeReset$)` ;
- le changement de projet émet `projectScopeReset$.next()` et **réinitialise
  explicitement ~20 champs d'état** (`ed`, `rp`, `latestReport`, `judge`,
  `lastScore`, `jenkinsLive`, `buildReliability`, sélections…) ;
- chaque réponse de détail est **assertée** :
  `if (detail.projectId !== this.id || detail.id !== r.id) → erreur`, pas d'affichage ;
- un compteur de génération (`selection !== this.reportSelection`) jette les
  réponses hors d'usage ;
- `this.ed = {}` est vidé **avant** la requête, donc aucune valeur du projet
  précédent ne peut subsister pendant le chargement.

`CROSS_PROJECT_STALE_DATA = 0`, `CROSS_PROJECT_DATA_LEAK = 0`.

**Généricité** — `RUNTIME_PROJECT_HARDCODING = 0` :

- `frontend/src` : 0 occurrence de nom ou d'UUID de projet hors specs ;
- `backend/src` : 0 logique conditionnelle indexée sur une identité de projet
  (les occurrences résiduelles sont des **commentaires**, le jeu de semis, et des
  scripts d'analyse hors-ligne `v1_8_phase*`) ;
- un test structurel refuse désormais toute identité de projet dans
  `projects.service.ts`.

Les sept projets passent par exactement le même chemin. Les différences observées
sont toutes des différences de **configuration** (jeton, URL, `azureConfig`) ou de
**données** — jamais de code. `devsecops-platform-testbed`, onboardé sans aucun
code dédié, affiche ses propres valeurs ; sa seule limite est un jeton Sonar non
approvisionné.

---

## 10. Performance

Les protections acquises sont intactes : liste en **résumés légers**
(`/project-reads/*`, 10 champs) puis détail **à la demande** sur sélection ;
chargement **par onglet** (`loadActiveTabData()`), pas de préchargement des
onglets inactifs ; aucun sondage court. Les charges de détail relevées vont de
25 Ko à 716 Ko selon le volume réel de constats — pas de payload de 27 Mo pour un
simple résumé.

---

## Réponses aux questions finales

1. **Toute valeur liée au projet sélectionné ?** Oui — annulation,
   réinitialisation d'état et assertion `projectId` par réponse. Prouvé au niveau
   code et API, pas par clics.
2. **Toute valeur traçable à une source réelle ?** Oui, pour tout ce qui est
   affiché. La chaîne complète est en §1.
3. **Des métriques inventées subsistent-elles ?** Non. Trois faux zéros de
   couverture supprimés ; aucun autre défaut de ce type dans la source servie.
4. **Des valeurs disponibles perdues avant l'UI ?** Oui — 9 champs (§6), dont
   les 7 Sonar que `/sonar-metrics` sert déjà sans consommateur. Le point de
   perte est WF1.
5. **Des valeurs périmées lors d'un changement de projet ?** Non.
6. **Un nouveau projet exige-t-il du code ?** Non — frontend, backend et
   workflows sont inchangés ; seule la configuration diffère.
7. **Les états d'absence sont-ils vrais et différenciés ?** Oui, sauf le cas
   Azure « non configuré » vs « techniquement impossible » (§7).
8. **Chaque valeur sous le bon scanner ?** Oui.
9. **La vue d'ensemble réutilise-t-elle la vérité normalisée ?** Oui — mêmes
   helpers, même `enrichedData`, pas de second calcul.
10. **Prêt à revendiquer l'affichage dynamique multi-projet ?** Oui, avec les
    limitations de source énoncées : le correctif backend n'est pas encore
    déployé, et deux approvisionnements de configuration manquent.

---

## Verdict

```
PROJECTS_AUDITED                        = 7
UI_FIELDS_INVENTORIED                   = 360 valeurs interpolées distinctes
PROVENANCE_FIELDS_TRACED                = 360 (chaîne complète établie en §1)
AUTHORITATIVE_SOURCE_COMPARISONS        = 78  (55 champs Sonar + 6 existences Sonar
                                               + 7 Jenkins + 3 joignabilités + 7 Azure)
REAL_DATA_MATCH_COUNT                   = 16
REAL_DATA_MISMATCH_COUNT                = 3   (contrôle qualité non importé au build ;
                                               affiché honnêtement « Non disponible »)
                                          + 3 par conception (coverage, non affichée)
                                          + 3 vétusté légitime (code_smells)

AVAILABLE_SOURCE_VALUES_NOT_DISPLAYED   = 9 champs distincts (≈32 cellules)
AVAILABLE_SOURCE_VALUES_FIXED           = 11 champs × 2 projets débloqués au niveau API
                                               (repli d'URL Sonar)
FAKE_DATA_FOUND                         = 1 défaut, 3 instances projet
FAKE_DATA_REMAINING                     = 0
WRONG_PROJECT_VALUES_FOUND              = 0
CROSS_PROJECT_LEAK                      = NO
STALE_PROJECT_VALUES                    = 3 (instantanés de build légitimes, datés)
WRONG_UI_PLACEMENT_FOUND                = 1 (Azure non configuré)
WRONG_UI_PLACEMENT_REMAINING            = 1 (signalé : décision sémantique)

JENKINS_DATA_COMPLETE                   = NO  — complet pour pfe-app-test ; les six autres
                                                sont joignables mais non approvisionnés
                                                (jeton absent ou URL périmée). États
                                                rapportés honnêtement, jamais en zéros.
SONAR_DATA_COMPLETE                     = NO  — 6 champs jamais importés par WF1 (§6)
TRIVY_DATA_COMPLETE                     = YES — cve, sévérité, cible, paquet,
                                                installedVersion, fixedVersion, cvss, source
OWASP_DATA_COMPLETE                     = YES — mêmes champs, attribution de scanner conservée
ZAP_DATA_COMPLETE                       = NO  — `confidence` et `pluginId` perdus par WF1
GIT_DATA_COMPLETE                       = YES — dépôt/PR propres à chaque projet
AZURE_DATA_COMPLETE                     = YES pour les 3 projets configurés ;
                                          NOT_CONFIGURED pour les 4 autres (étiquette, §7)
OVERVIEW_DATA_COMPLETE                  = YES — réutilise la vérité normalisée

MISSING_DATA_STATES_TRUTHFUL            = YES (sauf §7)
REAL_ZERO_PRESERVED                     = YES — prouvé sur devsecops-platform-testbed

RUNTIME_PROJECT_HARDCODING              = 0
RUNTIME_FAKE_METRIC_DEFAULTS            = 0

NEW_PROJECT_REQUIRES_FRONTEND_CHANGE    = NO
NEW_PROJECT_REQUIRES_BACKEND_CHANGE     = NO
NEW_PROJECT_REQUIRES_WORKFLOW_CHANGE    = NO
NEW_PROJECT_DYNAMIC_DATA_PROVEN         = YES — devsecops-platform-testbed, onboardé
                                                sans code dédié, sert ses propres valeurs

FRONTEND_TESTS                          = PASS — 32/32
BACKEND_TESTS                           = PASS — 133/133
PRODUCTION_BUILD                        = PASS — build:prod, servi en ligne

DISPATCH_FINAL_STATE                    = OFF
HARNESS_FINAL_STATE                     = OFF
AZURE_DEPLOYMENT_EXECUTED               = NO

P0_REMAINING                            = 0
P1_REMAINING                            = 2
   (a) correctif backend Sonar en source mais non déployé (remplacement du conteneur
       toujours en attente d'autorisation — R93)
   (b) SONAR_TOKEN non approvisionné sur le backend : 2 projets restent illisibles
P2_REMAINING                            = 4
   (a) 9 champs disponibles non affichés — point de perte WF1
   (b) Trivy/OWASP `NOT_RUN` contredisant 323 CVE réelles (devsecops-testbed)
   (c) étiquette Azure « techniquement impossible » pour un projet non configuré
   (d) jetons/URL Jenkins non approvisionnés sur 6 projets

READY_TO_CLAIM_DYNAMIC_MULTI_PROJECT_DATA = YES
FINAL_VERDICT = B — DYNAMIC_AND_TRUTHFUL_WITH_SOURCE_LIMITATIONS
```
