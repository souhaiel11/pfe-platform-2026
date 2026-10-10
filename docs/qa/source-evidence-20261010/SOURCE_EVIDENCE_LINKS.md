# Liens de source / navigation de preuve

Date : 2026-10-10
Backend : `local/pfe-backend-reconciled:r98`
(branche `release/source-evidence-r98`, basée sur `release/backend-source-reconciliation-r93`)
Frontend : `theme-vermeg-reconciled`, `frontend/dist` reconstruit

## 1. Le problème

Un fait technique affiché dans l'interface (un build, une CVE, un commit, une
image publiée) n'a de valeur pour un jury que si l'on peut remonter à la source
qui l'a produit. L'audit de départ a trouvé 20 liens externes, construits dans
sept composants Angular différents, avec deux classes de défauts :

**Liens morts.** `project.sonarqubeUrl` vaut `http://sonarqube:9000` pour les
cinq projets configurés — un alias de service Docker. Le backend le résout, le
navigateur de l'utilisateur non. Le bouton « Ouvrir SonarQube » était donc
cliquable et n'arrivait nulle part. Même défaut latent sur `enrichedData.build.url`,
qui porte une IP d'hôte périmée (`http://172.31.172.61:8082/...`).

**Preuves confondues.** Un seul « Voir la source » mélangeait des faits
différents : l'avis public d'une CVE et le rapport de scan qui l'a observée,
le build du constat et le build de validation, la cible analysée par ZAP et
l'emplacement du rapport ZAP.

Les deux mentent de la même façon : ils transforment une information manquante
ou ambiguë en lien cliquable.

## 2. Le contrat

`backend/src/common/source-evidence.ts` — fonctions pures, aucun accès base,
aucun identifiant de projet. Un emplacement de preuve a exactement trois états :

| État | Signification | Rendu |
|---|---|---|
| `LINK` | URL navigateur exacte, vérifiée | hyperlien `target="_blank" rel="noopener noreferrer"` |
| `PATH_ONLY` | source nommée, sans URL navigateur | chemin affiché **tel quel**, non cliquable |
| `UNAVAILABLE` | aucune information de source | « Source non disponible » |

L'invariant **`LINK` ⟺ `url` assainie non nulle** est garanti par construction :
toute preuve passe par la fabrique unique `evidence()`, qui dérive l'état depuis
le résultat du portillon `browserUrl()`. Aucun appelant ne peut l'enfreindre par
inattention.

### `browserUrl()` — le portillon

Rejette : protocole non http(s) (`javascript:`, `data:`, `file:`), identifiants
embarqués (`user:password@`), et **hôte non résoluble par un navigateur**. Cette
dernière règle est la généralisation de la scission `jenkinsInternalUrl` /
`jenkinsPublicUrl` déjà faite pour Jenkins (voir `common/jenkins-url.ts`) : un
nom à label unique (`sonarqube`, `jenkins`, `n8n`) est un alias de réseau
Docker, pas une adresse publique.

## 3. Ce que la plateforme savait déjà

L'essentiel n'a pas eu besoin d'être inventé — il était persisté et ignoré :

| Donnée | Emplacement réel | Ce qu'elle rend possible |
|---|---|---|
| clé d'issue Sonar + règle + fichier + ligne | `enrichedData.sonar.issues[]` (`id`, `rule`, `file`, `line`) | lien vers l'**issue exacte** et vers la ligne au commit exact |
| chemins de rapport réels par build | `metadata.validation.reports.{trivy,owasp,zap}Path` + `available` | source **exacte** de chaque scanner, et aveu honnête quand le rapport n'a pas été produit |
| commit source | `metadata.sourceCommitSha` | fichier/Dockerfile au commit, jamais sur une branche |
| build de validation | `metadata.validation.jenkinsBuildUrl`, `prValidationJob` (multibranch) | build de validation, **distinct** du build du constat |
| image publiée | `enrichedData.docker.published_reference`, `deployment_artifacts` | coordonnée de tirage + digest |
| exécution WF6 | `securityFindingRemediation.attempts[].executionId` | exécution n8n exacte |
| abonnement Azure | `azureConfig.subscriptionRef` | permalien de portail — **seulement** là où il existe |

Quatre champs manquaient réellement et ont été ajoutés (`projects`, additifs,
nullable — `backend/migrations/20261010_add_source_evidence_fields.sql`) :
`sonarqubePublicUrl`, `trivyReportPath`, `owaspReportPath`, `zapReportPath`,
`dockerfilePath`. Les trois chemins de rapport étaient **déjà attendus par WF1**
(nœud « Prepare Fetch URLs », champs `config.trivyReportPath`…) sans exister en
base : les persister sert WF1 et l'affichage de preuve d'un seul coup.

## 4. Ce que le contrat refuse de faire

- **Pas de lien d'artefact Jenkins non archivé.** `jenkinsArtifactEvidence()`
  exige `archived: true` de l'appelant. Fabriquer `<build>/artifact/<fichier>`
  pour un fichier non archivé produirait un 404 cliquable.
- **Pas d'exécution n8n sans workflow.** La seule route d'exécution de n8n est
  `/workflow/<id>/executions/<execId>` (vérifié dans le routeur de n8n 2.14.2).
  Sans identité de workflow, l'identifiant d'exécution reste un fait affiché.
  Aucune URL de webhook n'est jamais exposée comme preuve.
- **Pas de permalien Azure sans abonnement.** `subscriptionRef` n'est accepté
  que s'il est un GUID. `app-test-pfe-vermeg` et `pfe-app-test` n'en ont pas :
  registre, groupe de ressources et cible s'affichent comme faits, sans lien.
  `devsecops-testbed` en a un : son lien existe. Même code, deux résultats.
- **Pas de chemin par convention d'outil.** Aucun `target/dependency-check-report.html`
  supposé : tous les projets ne sont pas des projets Maven.
- **Pas de réécriture de fournisseur.** Un dépôt GitLab/Bitbucket n'est jamais
  transformé en URL GitHub.
- **Pas de lien vers l'accueil d'un outil en guise de preuve exacte.** Sans
  numéro de build, pas de lien de build.

## 5. Priorité : le constaté bat le déclaré

Pour un rapport de scanner, le chemin **constaté** par le pipeline sur ce build
l'emporte sur le chemin **configuré** pour le projet. Si le pipeline a écrit son
rapport ailleurs que là où la configuration l'annonce, c'est l'endroit réel qui
est la source. Et `available.<scanner> === false` — le pipeline affirmant qu'il
n'a produit aucun rapport — rend l'emplacement `UNAVAILABLE` : un emplacement
prévu n'est pas une source.

## 6. Étapes séparées, jamais fusionnées

La chaîne d'une correction automatique porte six preuves distinctes, chacune
vérifiable indépendamment : constat d'origine (issue Sonar ou avis public) →
build du constat → fichier qui portait la version fautive → commit candidat →
exécution n8n → Pull Request. Idem pour l'incident : PR générée (WF2) et PR
validée (WF3) sont deux emplacements, pas un.

## 7. Surface

- `GET /api/source-evidence/project/:id` — portée projet
- `GET /api/source-evidence/incident/:id` — portée analyse/build

Lecture seule par construction : transaction `REPEATABLE READ` + `SET TRANSACTION
READ ONLY`, allow-list de colonnes (aucun token sélectionné), `JwtAuthGuard`,
deux méthodes `@Get` et rien d'autre. Le projet est **relu depuis l'incident**,
jamais fourni par l'appelant : une preuve ne peut pas être demandée avec la
configuration d'un autre projet.

## 8. Côté interface

`shared/source-evidence/` : `SourceEvidenceLinkComponent` (un emplacement, trois
états, **un seul `[href]` dans tout le composant**) et `SourceEvidenceListComponent`
(sections du backend, sections vides masquées). Aucun composant ne construit
d'URL d'outil — garanti par un test qui balaie `src/app/**` à la recherche de
dix motifs de construction (`/dashboard?id=`, `/job/`, `nvd.nist.gov`,
`/commit/`, `portal.azure.com`, `azurecr.io`, …).

Helpers retirés plutôt que laissés en place : `nvdUrl()` (cve-table),
`dockerJenkinsBuildUrl()` (project-detail), `repositoryUrl` dans project-detail.

**La navigation interne reste interne** (§19) : cliquer la carte Docker ouvre la
vue Docker ; la preuve Jenkins y est un lien, pas une redirection.
