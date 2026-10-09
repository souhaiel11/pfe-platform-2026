# Étape opérateur — une seule commande

Redémarrer le conteneur du backend :

    docker restart pfe-backend

C'est tout. Le code corrigé est **déjà en place dans le conteneur** ; il ne lui
manque qu'un redémarrage du processus Node pour être chargé.

## Où en est-on exactement

| | État |
|---|---|
| Fichier compilé corrigé copié dans `pfe-backend:/app/dist/projects/` | **fait** — vérifié : 7 occurrences du correctif, **0** valeur inventée |
| Processus Node redémarré | **bloqué** — le redémarrage d'un conteneur de production a été refusé par le garde-fou d'exécution de la session |
| API actuellement servie | **encore l'ancien module**, vérifié : `/trivy-report` renvoie toujours `{"high":3,"medium":12,"low":24}` |

Je n'ai pas contourné le garde-fou. Les deux refus successifs portaient sur des
actions qu'il est légitime de protéger : écrire un fichier contenant les 26
secrets du conteneur, puis redémarrer un conteneur de production. La voie
retenue — remplacer un seul fichier compilé — évite entièrement la manipulation
de secrets, et ne laisse qu'un redémarrage à autoriser.

## Vérification après redémarrage

Interroger les deux routes concernées avec un jeton d'opérateur :

- `GET /api/projects/<PROJECT_ID>/trivy-report`
  attendu : `{"available":false,"reason":"TRIVY_NOT_QUERYABLE_BY_API",
  "critical":null,"high":null,"medium":null,"low":null, ...}`

- `GET /api/projects/<PROJECT_ID>/sonar-metrics`
  attendu : mesures réelles accompagnées de `qualityGate` et `lastAnalysisAt`,
  ou `{"available":false,"reason":"SONAR_..."}` — **jamais** 85 % de couverture.

## Revenir en arrière

L'original est conservé sous
`<scratchpad>/be-rollback/projects.service.js.original`. Le restaurer consiste à
le recopier vers `pfe-backend:/app/dist/projects/projects.service.js`, puis à
redémarrer le conteneur.

## Correctif durable

Le patch ci-dessus vit dans le **conteneur**, pas dans l'image : il
disparaîtrait si le conteneur était recréé. L'image durable existe pour ce cas :

    local/backend-sonar-truth:r46
      base  : local/backend-read-qualified:20261008   (l'image actuellement servie)
      ajout : dist/projects/projects.service.{js,js.map,d.ts}   — ce seul fichier

Construite en couche, depuis l'arbre source exact de l'image déployée
(`platform.source-tree = f84bdefac8b1a0c8f500b505ec48aba2cafc214e`, extrait par
`git archive`) plus ce correctif. À utiliser lors de la prochaine recréation du
conteneur, en conservant ses variables d'environnement actuelles.

## Ce que le correctif change

| Avant (module actuellement chargé) | Après |
|---|---|
| `getSonarMetrics()` retombe sur un faux jeu : couverture **85 %**, **12** code smells, **1500** lignes, notes **A** | mesures réelles + contrôle qualité + date d'analyse, ou `available: false` avec un motif |
| `getTrivyReport()` renvoie **toujours** `{high: 3, medium: 12, low: 24}` sans même tenter d'appel | `available: false`, `reason: TRIVY_NOT_QUERYABLE_BY_API`, compteurs à `null` |
| `getGithubStats()` retombe sur `{openPRs: 2, mergedPRs: 18, totalPRs: 25}` | `available: false` avec `GITHUB_REPO_NOT_CONFIGURED` ou `GITHUB_API_ERROR` |
| `parseSonarMetrics()` substitue `'0'` et `'A'` aux mesures absentes | une mesure absente reste `null` ; les notes 1.0…5.0 sont traduites A…E |
| Jeton Sonar : celui du projet uniquement | repli sur `process.env.SONAR_TOKEN` *(sans effet aujourd'hui : le jeton du projet est renseigné, et c'est lui qui a rendu le contrôle qualité réel)* |

Spec dédiée : `sonar-metrics-truth.spec.R46.ts`, 8 scénarios, **PASS**.
