# WF1 — identité des scanners + fraîcheur NVD · R101 · VALIDÉ, NON APPLIQUÉ

```
workflowId      vNOQiEgnXg9Zqn2q      ("WF1 - Incident Intake & Analysis v5.1", active)
nodeName        Merge All Fetched Data
versionId live  0cbf1d99-1f97-4806-8abd-ad639d5995ef   ← inchangé depuis l'analyse r100
sauvegarde      n8n-workflows/backups/wf1-vNOQiEgnXg9Zqn2q.before-scanner-identity-20261012.json
statut          corps de mise à jour prêt, PUT refusé par le garde-fou de session
date            2026-10-12
```

Ce correctif met en œuvre les défauts 1 et 2 documentés dans
`WF1-SCANNER-IDENTITY.OFFLINE-NODE-PATCH.md` (branche `fix/owasp-trivy-eligibility-r100`),
plus la remontée de la fraîcheur de la base NVD et la transparence du filtre de sévérité
(constats O2, O3, O4, Z4 de l'audit du 12 octobre 2026).

## Les cinq modifications, toutes dans un seul nœud

| # | Objet | Nature |
|---|---|---|
| E1 | Aides `parseMavenPurl` / `owaspDependencyIdentity` / `trivyIdentity` / `mavenIdentityFields` — miroir de `backend/src/common/scanner-maven-identity.ts` | ajout |
| E2 | Branche Trivy : `...mavenIdentityFields(trivyIdentity(v))` + `legacyPackage` | ajout de champs |
| E3 | Branche OWASP : identité lue dans `packages[].id` (PURL) au lieu de `dep.fileName`, `installedVersion` lu dans le PURL au lieu de `dep.version` (champ inexistant), `legacyPackage` conservé | remplacement d'identité |
| E4 | Bloc `owasp` : `vulnerabilityDataAsOf`, `vulnerabilityDataStale`, `vulnerabilityDataStaleReason`, `reportFindingCount`, `severityFilteredOut` | ajout de champs |
| E5 | Bloc `zap` : `target_url` retombe sur le site du rapport ZAP quand toutes les entrées convergent | ajout de repli |

`fixedVersion` reste `null` côté OWASP : Dependency-Check publie
`versionEndIncluding`, c'est-à-dire la plus haute version VULNÉRABLE, jamais une version
corrigée. La cible vient de la corrélation Trivy, ou de nulle part.
`remediationType` est laissé tel quel (le retirer est une décision distincte, hors de ce
correctif).

## Validation hors ligne — rejeu du nœud sur les fichiers réels du build #156

Bancs d'essai livrés à côté de ce document :
`WF1-R101-harness.js` (rejeu), `WF1-R101-compare.js` (diff champ par champ),
`WF1-R101-sync-simulation.js` (simulation de la synchronisation des tâches).

**1. Fidélité du banc d'essai.** Le nœud actuel rejoué hors ligne reproduit exactement ce que
la base contient pour le build #156 : OWASP 146 / 23 critiques / 58 élevées, Trivy 112 / 14 / 50,
ZAP 2 moyennes.

**2. Effet du correctif.**

| | avant | après |
|---|---|---|
| Constats OWASP | 146 | 146 |
| OWASP avec identité Maven | 0 | **146** |
| Constats Trivy | 112 | 112 |
| Trivy avec identité Maven | 0 | **111** (le 112ᵉ est un paquet système, sans PURL Maven) |
| Alertes ZAP | 2 | 2 |
| `vulnerabilityDataAsOf` | absent | `2026-07-10T14:42:24Z` |
| `vulnerabilityDataStale` / raison | absent | `true` / `NVD_UPDATE_FAILED` |
| `reportFindingCount` / `severityFilteredOut` | absent | `154` / `8` |
| `zap.target_url` | `""` | `http://app-test:8080` |

**3. Rien d'autre ne bouge.** Diff champ par champ sur les trois listes de constats :

```
OWASP  146 → 146   ajoutés: legacyPackage, packageType, purl, groupId, artifactId (146×)
                   modifiés: package, pkg, installedVersion (146×)   ← l'objet du correctif
TRIVY  112 → 112   ajoutés: legacyPackage (112×), packageType/purl/groupId/artifactId (111×)
                   modifiés: AUCUN       ← pkg/package/installedVersion strictement identiques
ZAP      2 → 2     ajoutés: AUCUN   modifiés: AUCUN
étages de gouvernance (statut, blocage, findingCount, executed, resultAvailable) : identiques
compteurs owasp / trivy / zap : identiques
```

**4. Migration des tâches existantes.** Le changement d'identité OWASP change l'empreinte des
constats (`sha256(source + CVE + pkg)`). Le backend en service (image `3a58440`) embarque déjà
la passerelle : `owaspLegacyFingerprint()` retrouve la tâche par le nom de JAR conservé dans
`legacyPackage`, et `taskFingerprintAliases()` fait répondre une tâche migrée aux deux
empreintes. Simulation de `syncFromIncident()` sur les **155 tâches OWASP et 135 tâches Trivy
réelles** du projet :

```
AVANT   OWASP 146 constats → 146 rattachées, 0 nouvelle, aucune ambiguïté
        TRIVY 112 constats → 112 rattachées, 0 nouvelle, aucune ambiguïté
APRÈS   OWASP 146 constats → 146 rattachées, 0 nouvelle, aucune ambiguïté
        TRIVY 112 constats → 112 rattachées, 0 nouvelle, aucune ambiguïté
```

Aucun doublon, aucun historique perdu, aucune levée de
`BadRequestException('Correspondance OWASP ambiguë')`.

## Application

```bash
# depuis platform/ — la clé API vit dans l'environnement du backend
KEY=$(docker exec pfe-backend-r99 printenv N8N_API_KEY)
curl -s -X PUT -H "X-N8N-API-KEY: $KEY" -H "Content-Type: application/json" \
  --data-binary @n8n-workflows/pending-live-update/WF1-update-body.SCANNER-IDENTITY-R101.json \
  http://localhost:5678/api/v1/workflows/vNOQiEgnXg9Zqn2q | head -c 400
```

Vérifier ensuite que `active` vaut toujours `true` ; sinon
`POST /api/v1/workflows/vNOQiEgnXg9Zqn2q/activate`.

## Retour arrière

```bash
KEY=$(docker exec pfe-backend-r99 printenv N8N_API_KEY)
python3 - <<'PY' > /tmp/wf1-rollback.json
import json
d=json.load(open('n8n-workflows/backups/wf1-vNOQiEgnXg9Zqn2q.before-scanner-identity-20261012.json'))
json.dump({'name':d['name'],'nodes':d['nodes'],'connections':d['connections'],'settings':d.get('settings',{})}, open('/dev/stdout','w'))
PY
curl -s -X PUT -H "X-N8N-API-KEY: $KEY" -H "Content-Type: application/json" \
  --data-binary @/tmp/wf1-rollback.json http://localhost:5678/api/v1/workflows/vNOQiEgnXg9Zqn2q
```

Les constats déjà enregistrés ne sont pas réécrits par un retour arrière : les tâches migrées
conservent leur identité Maven, et `taskFingerprintAliases()` les fait toujours répondre à
l'empreinte héritée. Le retour arrière est donc sans perte dans les deux sens.

## Ce que ce correctif ne fait PAS

- Il ne rend pas la base NVD à jour (constat O1) : il la rend **visible**. La clé API NVD
  reste invalide tant qu'elle n'est pas renouvelée dans les identifiants Jenkins.
- Il ne change pas la cible analysée par ZAP (constat Z1), qui est un problème de déploiement
  Kubernetes, pas d'ingestion.
- Il ne change aucun seuil de gouvernance ni aucun compteur affiché aujourd'hui.
