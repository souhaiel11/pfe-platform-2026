# SONAR_DATA_PROVENANCE_MATRIX

**Phase 2.** Traçage de bout en bout de chaque champ Sonar visible par le jury,
avant toute modification du frontend. Établi par lecture du code déployé et par
interrogation réelle de SonarQube.

## Le chemin réel, et la surprise qu'il recèle

```
SonarQube  ──(1)──►  mvn sonar:sonar (bibliothèque partagée)
                        │ imprime « More about the report processing at .../api/ce/task?id=… »
                        ▼
                     ceTaskId  ──(2)──►  charge utile Jenkins → WF1
                                            │
                        (3) WF1 « Resolve Exact Sonar Correlation »
                            GET backend:3001/api/projects/internal/:id/sonar-correlation?ceTaskId=…
                                            │
                        (4) backend resolveSonarCorrelation()
                            ce/task → analysisId → /api/qualitygates/project_status
                                            │
                        (5) WF1 « Merge All Fetched Data » → enrichedData.sonar
                                            │
                        (6) incident.metadata → GET /api/reports/:id
                                            │
                        (7) frontend  ed.sonar  →  cartes de l'onglet SonarQube
```

**La surprise** : les endpoints `GET /api/projects/:id/sonar-metrics` et
`/trivy-report` **ne sont consommés par aucun écran** (0 référence dans
`frontend/src`). Ils existaient, servaient des valeurs **inventées**, et
n'alimentaient pourtant aucune carte. Les cartes lisent `ed.sonar`, c'est-à-dire
l'évidence de l'incident produite par WF1. Les deux chemins étaient confondus
dans l'énoncé du problème ; ils sont distincts.

## Matrice, champ par champ

| UI_FIELD | FRONTEND_MODEL | BACKEND_ENDPOINT | BACKEND_FIELD | AUTHORITATIVE_SONAR_API | CURRENT_VALUE (avant) | WHY_MISSING |
|---|---|---|---|---|---|---|
| Contrôle qualité | `qualityGatePresentation(ed.sonar)` | `GET /api/reports/:id` → `metadata.enrichedData.sonar` | `quality_gate` | `/api/qualitygates/project_status` (via `analysisId`) | `QUALITY_GATE_UNAVAILABLE` → « Non disponible » | **Cas B.** `resolveSonarCorrelation()` sort immédiatement si `project.sonarqubeToken` est absent (ligne 121 du code déployé). Le projet n'en avait pas, et aucune route d'API ne permet d'en poser un : `update()` retire volontairement `sonarqubeToken`. Valeur réelle chez Sonar : **OK**. |
| Bugs | `scannerMetric(ed.sonar,'bugs')` | idem | `bugs` | `/api/measures/component` | **0 présent dans la donnée**, affiché « Non disponible » | **Cas E.** `scannerHasResult()` rejetait tout le bloc sur `resultAvailable === false`. Or pour Sonar ce drapeau porte la résolution du **contrôle qualité**, pas la disponibilité des **mesures**. |
| Vulnérabilités | `scannerMetric(ed.sonar,'vulnerabilities')` | idem | `vulnerabilities` | `/api/measures/component` | **0 présent**, affiché « Non disponible » | **Cas E**, même cause. |
| Maintenabilité | `scannerMetric(ed.sonar,'code_smells')` | idem | `code_smells` | `/api/measures/component` | **7 présent**, affiché « Non disponible » | **Cas E**, même cause. Les 7 issues étaient pourtant listées juste en dessous, avec fichier et ligne. |
| Couverture | `ed.sonar.coverage` | idem | `coverage` | `/api/measures/component` | `0` — **réel** | **Cas C.** Aucun rapport JaCoCo n'était produit ni importé. 0 % était exact mais trompeur : « non mesuré » et « rien de couvert » ne sont pas la même information. Corrigé en phase 4. |
| Duplications | non affiché dans l'onglet | idem | `duplicated_lines_density` | `/api/measures/component` | — | sans objet |
| Statut d'analyse | `ed.sonar.status \| stageStatusLabel` | idem | `status` | `/api/ce/task` | `COMPLETED` — correct | — |
| Horodatage d'analyse | non affiché | — | — | `/api/project_analyses/search` | — | ajouté à `getSonarMetrics()` (champ `lastAnalysisAt`) |

## Ce que SonarQube répondait réellement, au même instant

Interrogation authentifiée directe de `app-test-pfe-vermeg`, avant toute correction :

| Métrique | Valeur réelle |
|---|---|
| `quality_gate` | **OK** |
| `bugs` | 0 |
| `vulnerabilities` | 0 |
| `code_smells` | **7** |
| `coverage` | 0.0 |
| `ncloc` | 276 |
| `security_rating` / `reliability_rating` / `sqale_rating` | 1.0 (= A) |
| issues | 7 — 5 MAJOR, 2 CRITICAL, toutes `CODE_SMELL` |

## Deux distinctions que l'énoncé confondait

1. **Statut d'exécution ≠ contrôle qualité.** L'analyse s'était parfaitement
   exécutée (`COMPLETED`, `ceTaskId` présent) alors que le contrôle qualité
   n'était pas résolu. Les deux sont rapportés séparément et ne sont jamais
   fusionnés.
2. **Contrôle qualité « OK » ≠ aucun problème.** Le contrôle est OK **et** il y
   a 7 code smells : les conditions par défaut portent sur le code nouveau.
   C'est un point à expliquer au jury, pas une incohérence.
