# S4684 — limite documentée de la remédiation cross-file mono-passe

## Décision

Après douze tentatives réelles, la remédiation automatique de `java:S4684` est arrêtée. L'incident reste en `FIX_FAILED` et aucun nouveau retry n'est autorisé.

Cette décision ne signifie pas que le finding est impossible à corriger. Une preuve isolée montre qu'un candidat valide existe. La limite porte sur la convergence de la génération cross-file mono-passe de WF2, pas sur la faisabilité de la correction Java.

Périmètre étudié :

- incident : `6edab0c8-64df-4bb7-ba9c-7dff9cbcd4f3` ;
- baseline : `6ed56ff791acbf3e111431285bef7b30c8076084` ;
- workflow canonique : `u3eeMwTuhCsetfcS` ;
- exécutions : 2006 à 2017 ;
- deux findings S4684 : `b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef` et `f11d4686-a7ba-4c0c-abbb-a12998c57220`.

## Historique des douze tentatives

Le statut technique n8n de ces exécutions peut être `success`, car WF2 capture l'erreur et persiste ensuite un échec métier. La source faisant foi pour le résultat de remédiation est l'historique `fixRequest.attempts` de l'incident, corrélé aux `execution_entity` et aux `workflowData` persistés.

| # | Exécution | Version WF2 | Premier nœud d'échec | Cause observée | Classe | Durcissement appliqué ensuite | Résultat |
|---:|---:|---|---|---|---|---|---|
| 1 | 2006 | `d289ef66-56bc-4dba-9c77-2701b3eada43` | Parse - Code Patch Output | Réponse tronquée à la limite de tokens | Infrastructure/limite modèle | Opus 5, budget 32768 et blocage explicite de la troncature | Tenu : aucune troncature ultérieure |
| 2 | 2007 | `3983f10c-f957-4e1f-8260-9d9dee351b49` | Fetch Referenced API Sources | Le même SHA est déclaré différent du SHA gelé | Faux positif garde-fou | Séparation provenance du commit / identité du blob | Partiel : le garde échoue encore en 2008 |
| 3 | 2008 | `59a4e805-7327-43d3-992b-8bfa81c3e4b0` | Fetch Referenced API Sources | Provenance évaluée à `UNRESOLVED` | Faux positif garde-fou | Parsing compatible sandbox et provenance typée | Tenu : la provenance est franchie ensuite |
| 4 | 2009 | `69ed7a90-aa12-4a5a-bf47-993597358d1c` | Generic Candidate Preflight | `PLACEHOLDER_MARKER` | Faux positif garde-fou | Détection contextuelle des placeholders | Non immédiat : récidive en 2011 |
| 5 | 2010 | `69ed7a90-aa12-4a5a-bf47-993597358d1c` | Validate Generic Remediation Plan | API relationnelle planifiée considérée non grounded | Faux positif/contrat trop large | Grounding relationnel puis contrat d'opérations explicite | Non immédiat : récidive en 2012 |
| 6 | 2011 | `69ed7a90-aa12-4a5a-bf47-993597358d1c` | Generic Candidate Preflight | `PLACEHOLDER_MARKER` sur la valeur métier `TODO` | Faux positif garde-fou | Exclusion contextuelle des valeurs métier | Tenu ensuite |
| 7 | 2012 | `b5e6e246-27e2-40a0-863a-692dab615477` | Validate Generic Remediation Plan | API relationnelle planifiée considérée non grounded | Faux positif garde-fou | Fix F : `RESOLVE_BY_ID`/`PRESERVE` et équivalence des APIs réellement consommées | Partiel : une ambiguïté d'identité apparaît en 2013 |
| 8 | 2013 | `3379da3a-15ea-4fab-9e05-5f6085f8025b` | Validate Generic Remediation Plan | Opération relationnelle considérée non grounded | Contrat interne ambigu | Fix G : `ownerPath + field + relatedEntityType` | Tenu : le plan est validé dès 2014 |
| 9 | 2014 | `f33a8d8a-c49b-4235-934c-2dc321b3beba` | de Patch - HTTP Request | `read ECONNRESET` | Infrastructure | Aucun changement métier ; retry réseau borné existant | Le transport passe à l'essai suivant |
| 10 | 2015 | `f33a8d8a-c49b-4235-934c-2dc321b3beba` | Enforce Independent Review | Review mêlant six faux positifs et un vrai défaut de validation du status | Vrai défaut généré + faux positifs reviewer | Fix H : domaine fermé et politique reviewer fondée sur les preuves | Commit valide, jamais exécuté en live |
| 11 | 2016 | `f33a8d8a-c49b-4235-934c-2dc321b3beba` | Enforce Independent Review | Conversion `String -> enum` non sûre et signatures incompatibles avec les tests | Vrai défaut généré | Fix H aurait couvert le domaine fermé ; aucune promotion | Compilation des tests isolée en échec |
| 12 | 2017 | `f33a8d8a-c49b-4235-934c-2dc321b3beba` | Enforce Independent Review | Contrats de collections incompatibles entre controller et service | Vrai défaut généré | Aucun nouveau fix ; arrêt de la boucle | Compilation production isolée en échec |

Répartition :

- six faux positifs de garde-fous, tous corrigés sur les parcours ultérieurs ;
- trois tentatives contenant un vrai défaut de génération ;
- deux échecs d'infrastructure ou de capacité fournisseur ;
- un défaut de contrat interne entre planner et validator.

## Neuf durcissements généralisables obtenus

| # | Bug révélé | Principe corrigé | Portée générale |
|---:|---|---|---|
| 1 | Une réponse LLM tronquée pouvait être traitée comme un patch | Budget explicite, détection de `max_tokens`, rejet fail-closed | Toute génération de patch |
| 2 | Une panne réseau transitoire arrêtait le lot | Retry interne borné des appels non mutatifs, sans retry métier automatique | Tous les appels fournisseur transitoires |
| 3 | Le scanner pouvait confondre dette baseline et régression candidate | Comparaison baseline-aware et preuve de comparabilité | Tous les findings scanner |
| 4 | Le comptage d'associations incluait des annotations hors contrat | Association limitée à `ManyToOne|OneToOne` | Toute remédiation JPA relationnelle |
| 5 | SHA du commit, SHA du blob et source réellement lue étaient confondus | Provenance typée, `frozenSourceSha = baseSha`, parsing compatible sandbox | Toute génération fondée sur des sources gelées |
| 6 | Une valeur métier comme `TODO` était prise pour un placeholder | Détection contextuelle et syntaxique des placeholders | Tous les langages contenant des marqueurs lexicaux ambigus |
| 7 | Le planner raisonnait sans totalité des fichiers/API nécessaires | Manifest de sources complet et preuve exacte des APIs référencées | Toute remédiation dépendant de symboles externes |
| 8 | L'identité d'une relation et l'API requise étaient ambiguës | Opérations `RESOLVE_BY_ID`/`PRESERVE`, puis identité `ownerPath + field + relatedEntityType` | Toute remédiation de relation entity/DTO |
| 9 | Le reviewer présentait des risques spéculatifs comme des défauts certains | Review atomique du lot et taxonomie `PROVEN_DEFECT`/`VERIFICATION_REQUIRED`/`NO_DEFECT` | Toute review cross-file assistée par LLM |

Ces acquis restent utiles au-delà de S4684. Ils constituent le principal résultat positif de la campagne : les garde-fous sont devenus plus précis, plus explicites et plus fail-closed sans être aveuglément bloquants.

## Signal de non-convergence

Les trois derniers lots ne forment pas une progression monotone :

| Exécution | Propriété gagnée | Défaut restant ou introduit | Vérification isolée |
|---:|---|---|---|
| 2015 | DTO indépendant, overloads compatibles, relation CREATE résolue et UPDATE préservée | `status` devient un `String` ; les entrées invalides quittent la frontière Jackson et provoquent une `IllegalArgumentException` métier non gérée | Production compile ; 13/13 tests passent |
| 2016 | DTO entrée/sortie plus explicites | Domaine status toujours trop permissif ; suppression de compatibilité avec un call site de test | Production compile, mais test compilation échoue |
| 2017 | Enum DTO autonome : domaine HTTP fermé restauré | Le service renvoie `List<TaskDTO>` là où le controller remappe encore `List<Task>` | Compilation production échoue sur deux incompatibilités génériques |

Le défaut se déplace : validation HTTP, puis compatibilité des call sites, puis cohérence controller/service. Une nouvelle génération complète peut corriger une dimension et en régresser une autre.

## Preuve de faisabilité

### Méthode

Un checkout temporaire a été créé au baseline exact `6ed56ff791acbf3e111431285bef7b30c8076084`. Les trois candidats exacts de l'exécution 2015 ont été appliqués :

- `TaskController.java` ;
- `TaskService.java` ;
- `TaskDTO.java`.

Une seule correction manuelle a ensuite été apportée :

1. ajout d'un enum DTO autonome `TaskStatusDto` contenant `TODO`, `IN_PROGRESS`, `DONE`, `CANCELLED` ;
2. remplacement de `String status` par `TaskStatusDto status` dans `TaskDTO` ;
3. adaptation des deux mappings status dans `TaskService`.

Le controller, les signatures publiques, les overloads historiques, la résolution de `User` à la création et la préservation de `Task.user` à la mise à jour n'ont pas été modifiés.

### Résultat

Commande : `mvn -q clean test`.

- compilation production : **PASS** ;
- compilation des tests : **PASS** ;
- tests exécutés : **13** ;
- tests réussis : **13** ;
- échecs : **0** ;
- erreurs : **0** ;
- tests ignorés : **0**.

Répartition : 10 tests `TaskServiceTest` et 3 tests `AuthControllerTest`.

Cette preuve établit qu'un candidat cohérent pour S4684 existe. Le finding n'est pas impossible à remédier et les contraintes relationnelles ne sont pas contradictoires. Le blocage est la capacité de WF2 à générer ce point fixe en une passe, puis à le faire évaluer dans un ordre probant.

Limite de la preuve : la suite baseline ne contient pas un test HTTP dédié à chaque valeur invalide de `status`. Néanmoins, le champ étant de type enum DTO, Jackson conserve le domaine fermé à la frontière de désérialisation, contrairement au `String` de 2015.

## Cause structurelle

S4684 exige la préservation simultanée de six contrats :

1. contrat HTTP : `Task` ne traverse plus `@RequestBody` et les erreurs d'entrée restent observables de façon équivalente ;
2. contrat DTO : indépendance vis-à-vis des types persistants et conservation des domaines fermés ;
3. signatures service : compatibilité des méthodes publiques et de leurs types de retour ;
4. mapping : cohérence bidirectionnelle DTO/entity pour tous les champs concernés ;
5. relation : résolution de `User` par API grounded à la création et préservation à la mise à jour ;
6. call sites : controller, tests et appels internes continuent à compiler et à conserver leur comportement.

La génération mono-passe produit plusieurs fichiers, mais ne garantit pas un modèle de signatures partagé et stable entre eux. La review LLM intervient avant la preuve déterministe de compilation. Elle peut donc bloquer un lot valide sur une hypothèse, ou décrire imparfaitement un vrai défaut que le compilateur aurait localisé exactement.

## Architecture cible

L'évolution cible décompose la remédiation en sorties vérifiées :

1. créer le DTO et ses domaines fermés ;
2. compiler le modèle DTO ;
3. ajouter les mappings ;
4. compiler et tester les mappings ;
5. adapter le service tout en préservant les call sites ;
6. compiler et tester ;
7. modifier les deux frontières controller ;
8. compiler, tester puis exécuter Sonar ;
9. seulement ensuite autoriser les écritures Git/PR.

Chaque étape doit consommer le manifest exact et le digest du candidat produit par l'étape précédente, sans régénérer les parties déjà validées.

Le second axe est `compile-before-review` : compilation/tests isolés et non mutatifs avant review sémantique, puis transmission au reviewer d'une preuve liée au digest du lot. Les contrôles sandbox et le modèle de menace sont détaillés dans [WF2-COMPILE-BEFORE-REVIEW-TARGET.md](./WF2-COMPILE-BEFORE-REVIEW-TARGET.md).

## Contraste avec S6813

S6813 correspond à un contrat essentiellement local : remplacer une injection de champ par une injection constructeur dans un fichier, avec une surface limitée et des signatures mécaniquement vérifiables. Ce type de transformation mono-fichier a convergé, a été mergé et le finding a disparu du code traité.

S4684 impose au contraire une migration de frontière architecturale. Le controller, le DTO, le service, le mapper, le repository et les call sites doivent évoluer comme une unité cohérente. La différence de résultat ne vient donc pas seulement de la difficulté du code : elle montre la frontière entre une transformation locale adaptée à la chaîne actuelle et une migration cross-file qui exige des étapes intermédiaires vérifiées.

## État final et conservation de Fix H

Fix H est conservé dans le commit `93c87bd2a11376f62589624934615e5e9b407f79`, présent sur `origin/theme-vermeg-reconciled`. Il n'a pas été promu ni exécuté par les tentatives 2016–2017.

Fix H reste valide comme amélioration générale du générateur et de la politique reviewer. Il n'est cependant pas nécessaire de le promouvoir dans le cadre de cet arrêt : sans nouveau retry S4684, une promotion live ajouterait un changement opérationnel sans bénéfice immédiat et sans occasion autorisée de le valider sur le cas qui l'a motivé. Le commit fournit la traçabilité et permet une promotion future dans une campagne distincte, avec son propre objectif et ses propres validations.

État de clôture retenu :

- incident S4684 : `FIX_FAILED`, état terminal honnête ;
- aucun retry supplémentaire ;
- aucune promotion Fix H dans cette campagne ;
- aucune branche ou PR S4684 résiduelle ;
- reprise éventuelle uniquement dans le cadre du chantier architectural décrit ci-dessus.
