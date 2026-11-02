# Documentation technique pédagogique — Plateforme DevSecOps AI Remediation

Cette documentation a un seul objectif : **te permettre d'expliquer cette plateforme
en détail devant un jury**, sans rien apprendre par cœur, parce que tu auras compris
le *pourquoi* de chaque mécanisme.

Elle est écrite à partir du projet **réel** : code source ouvert et lu, workflows n8n
extraits de l'instance en cours d'exécution, schéma lu sur la base de données réelle,
conteneurs inspectés. Quand un point n'a pas pu être établi, c'est écrit
« Non déterminé à partir du code actuel » plutôt qu'inventé.

## Dans quel ordre lire ?

### Étape 1 — Comprendre l'idée (30 minutes)

1. **`00-MASTER-GUIDE.md`** — le problème résolu, la philosophie, le vocabulaire.
   **C'est le fichier par lequel il faut commencer.**
2. `01-GLOBAL-ARCHITECTURE.md` — la carte générale et chaque flèche entre composants.
3. `23-GLOSSARY.md` — à garder ouvert à côté pendant toute la lecture.

### Étape 2 — Comprendre les concepts qui font la valeur du projet (1 h)

4. `11-REMEDIATION-LIFECYCLE.md` — de la détection à la fermeture.
5. `21-IDENTIFIER-DATA-FLOW.md` — les identifiants : la clé de tout le reste.
6. `12-RETRY-CONCURRENCY-IDEMPOTENCY.md` — retry, écrivain unique, callbacks périmés.
7. `10-SECURITY-SCANNERS.md` — Trivy, OWASP, Sonar, ZAP, et pourquoi « pas de scan ≠ propre ».

### Étape 3 — Comprendre les composants (2 h)

8. `03-N8N-COMPLETE-GUIDE.md` puis `03b-N8N-NODE-CATALOG.md`
9. `04-N8N-BACKEND-MAPPING.md` — comment n8n et le backend se parlent
10. `05-BACKEND-COMPLETE-GUIDE.md`
11. `06-FRONTEND-COMPLETE-GUIDE.md`
12. `07-DATABASE-DATA-MODEL.md`
13. `13-GIT-GITHUB-INTEGRATION.md`, `14-AZURE-DEPLOYMENT.md`
14. `08-JENKINS-CICD.md`, `09-DOCKER-RUNTIME.md`

### Étape 4 — Se préparer au jury (1 h, à refaire la veille)

15. **`22-SOUTENANCE-TEACHING-GUIDE.md`** — explications à 2/10/30 minutes,
    50+ questions de jury avec les réponses attendues, et la section
    « À ne pas confondre ».
16. `15-END-TO-END-SCENARIOS.md` — neuf scénarios complets, chronologiques.
17. `16-ERROR-FAILURE-MATRIX.md` — « et si tel composant tombe ? »
18. `38` (dans `00-MASTER-GUIDE.md`) — les limitations, à assumer plutôt qu'à cacher.

## Documents de référence (à consulter, pas à lire d'un bout à l'autre)

| Fichier | Contenu |
|---|---|
| `02-COMPONENT-INVENTORY.md` | fiche par composant |
| `03b-N8N-NODE-CATALOG.md` | les 539 nœuds des 7 workflows actifs |
| `17-CONFIGURATION-FLAGS.md` | les 37 variables d'environnement du runtime |
| `18-FILE-RESPONSIBILITY-CATALOG.md` | les 347 fichiers backend + 38 frontend |
| `19-API-CONTRACT-CATALOG.md` | les 119 routes HTTP |
| `20-DATABASE-TABLE-CATALOG.md` | les 16 tables, colonnes, contraintes, index |

## Avertissement de lecture

Cette documentation **décrit**, elle n'audite pas. Là où le code a une limitation,
elle le dit (section `38`), mais son but est l'explication, pas la correction.
Les constats d'audit et le registre d'anomalies vivent ailleurs :
`docs/qa/FINAL-PROJECT-AUDIT-20261007/`.
