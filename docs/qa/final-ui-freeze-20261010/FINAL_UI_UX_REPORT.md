# Gel UI/UX final — rapport

**Date :** 2026-10-10
**Statut :** `A — PRACTICAL_IMPLEMENTATION_REMAINS_FROZEN` · implémentation
pratique **GELÉE** (gel §9 · journal post-gel §10 · latence de gouvernance
Azure §11)
**Branche :** `theme-vermeg-reconciled`
**Portée :** finition UI/UX uniquement. Aucune modification d'algorithme de
remédiation, de WF1/WF2/WF3/WF6, du comportement Jenkins ni de la logique de
déploiement Azure. Aucun build déclenché, aucun déploiement exécuté.
**Backend utilisé pour la vérification :** instance live (`pfe-backend`,
`localhost:3001`), 7 projets réels, 201 incidents réels.

---

## 0 — Contexte de reprise

Cette passe reprend un travail interrompu en cours de route. L'état hérité
était fonctionnel (108 tests verts après reprise, build de production
réussi) et contenait déjà les primitives partagées :

| Déjà en place à la reprise | Fichier |
|---|---|
| Système de pastille de statut (§5/§6) | `shared/status-chip/` + `shared/status-labels.ts` |
| Bandeau de contexte projet (§3) | `shared/project-context/project-context-strip.component.ts` |
| Preuve de source (§15) | `shared/source-evidence/` |
| Fraîcheur relative (§19) | `shared/french-format.ts` (`frenchRelative`) |
| Gouvernance de déploiement (§14) | `features/projects/deployment-governance.component.*` |
| Aide contextuelle (§22) | `shared/info-hint/info-hint.component.ts` — **créée mais câblée nulle part** |

Le composant d'aide contextuelle non câblé marque précisément le point
d'arrêt. Cette passe part de là.

---

## 1 — Verdicts par chapitre

| Critère | Verdict |
|---|---|
| `UI_INFORMATION_HIERARCHY` | **PASS** |
| `PROJECT_CONTEXT` | **PASS** |
| `STATUS_SEMANTICS` | **PASS** |
| `BUTTON_HIERARCHY` | **PASS** |
| `SECURITY_UX` | **PASS** |
| `INCIDENT_UX` | **PASS** |
| `REMEDIATION_UX` | **PASS** |
| `JENKINS_UX` | **PASS** |
| `DOCKER_UX` | **PASS** |
| `DEPLOYMENT_UX` | **PASS** |
| `SOURCE_EVIDENCE_UX` | **PASS** |
| `EMPTY_STATES` | **PASS** |
| `ERROR_STATES` | **PASS** |
| `LOADING_STATES` | **PASS** |
| `FRESHNESS_DISPLAY` | **PASS** |
| `RESPONSIVE_1440` | **PASS** (revue CSS + revue visuelle en navigateur, §7.2) |
| `RESPONSIVE_1024` | **PASS** (idem) |
| `RESPONSIVE_768` | **PASS** (idem) |
| `RESPONSIVE_390` | **PASS** (idem — trois débordements réels trouvés et corrigés, §5) |
| `ACCESSIBILITY_BASIC` | **PASS** |
| `FRENCH_UI` | **PASS** |
| `CROSS_PROJECT_DATA_LEAK` | **NO** |
| `FAKE_DATA_COUNT` | **0** |
| `FAKE_LINK_COUNT` | **0** |
| `RUNTIME_PROJECT_HARDCODES` | **0** |

### Contrôles automatisés

| Contrôle | Commande | Résultat |
|---|---|---|
| `FRONTEND_TESTS` | `node --test scripts/*.spec.mjs` | **108 / 108 PASS**, 0 échec |
| `PRODUCTION_BUILD` | `npm run build:prod` | **SUCCÈS** (1 avertissement de budget CSS préexistant, voir §6) |
| `QA_FRENCH_UI` | `node scripts/qa-french-ui.mjs` | **PASS** |
| `HARDCODE_AUDIT` | `node scripts/audit-platform-hardcodes.mjs` | **`remainingRuntimeHardcodes: []`** (11 687 occurrences classées, 0 en dur à l'exécution) |
| Hygiène du diff | `git diff --check` | **propre** |

---

## 2 — Ce qui a changé, et pourquoi

### 2.1 Liste des projets (§29) — reconstruite

Avant : nom, 8 premiers caractères de l'UUID, pourcentage de score, trois
compteurs d'incidents, une barre de santé, la date de création.

Après : les cinq faits que §29 demande, dans le même ordre pour chaque
projet — **dépôt**, **dernier build**, **sécurité**, **déploiement**,
**incidents ouverts**, **dernière activité**.

Le point important n'est pas la liste des colonnes mais leur modélisation.
Chaque colonne porte un **état**, pas une valeur nullable
(`features/projects/project-list-row.ts`) :

- `build.state` ∈ `KNOWN | NO_BUILD | UNAVAILABLE` — parce que « Jenkins n'a
  pas répondu » et « ce projet n'a aucun build » produisent tous deux
  `status = null`, et les afficher pareil est faux dans les deux sens : l'un
  se réessaie, l'autre non (§17). Quand Jenkins est muet, le motif exact
  (`Timeout Jenkins après 5000ms`) est conservé en infobulle, et le numéro de
  build corrélé par la plateforme reste affiché **en disant qu'il vient de
  la plateforme**, jamais comme un résultat Jenkins.
- `security.state` ∈ `KNOWN | INCOMPLETE | UNAVAILABLE` — un score calculé
  sans tous les scanners est affiché comme partiel, avec le nombre de
  scanners sans résultat.
- `deployment.state` ∈ `READY | NOT_READY | NOT_CONFIGURED | UNAVAILABLE` —
  « non configuré » n'est pas un problème, « bloqué » en est un, et un refus
  expose son **nombre de conditions** et la première d'entre elles.

Un défaut réel a été trouvé par le test écrit pour cette passe : l'assistant
d'entier acceptait `null` (`Number(null) === 0`), ce qui transformait
« score non enregistré » en « score de 0 » — soit un projet non mesuré
affiché en rouge critique. Corrigé dans `integerOrNull`.

### 2.2 Liste des incidents (§10) — reconstruite

Titre `// incidents` → **Incidents**. Colonnes : **Sévérité · Problème ·
Projet · Source · Build · Statut · Dernière activité · Action**. La colonne
« Identifiant » a disparu : l'UUID vit maintenant sous le titre, en forme
courte copiable (§20/§21). La sévérité et la fraîcheur sont calculées une
fois dans `toIncidentRow()` et non dans le gabarit — même source et même
règle de lecture que l'écran de détail, donc impossible que la liste et le
détail affichent deux sévérités différentes du même incident.

### 2.3 Tableau de bord (§27/§28) — dégraissé et réorienté

Trois duplications supprimées :

1. **Une coquille applicative entière en doublon.** Le tableau de bord
   déclarait son propre bandeau latéral (marque « SecOpsHub »), sa propre
   barre supérieure, son propre bouton de thème, sa propre fiche utilisateur
   et son propre panneau de notifications — masqués par
   `display:none` mais toujours présents dans le DOM, à l'intérieur de la
   coquille qui fournit déjà tout cela.
2. **Un panneau d'anneaux de risque** qui affichait en graphique le score
   déjà écrit deux fois sur la carte du projet juste en dessous.
3. **Une colonne « Risque »** dérivée de ce même score : quatrième
   représentation du même nombre.

À la place, le panneau que le tableau de bord n'avait pas : **« À traiter en
priorité »**, avec le **motif exact** pour chaque projet (`Build #11 en
échec`, `10 incidents ouverts`, `Déploiement bloqué — 11 conditions non
satisfaites`, `Score de sécurité 13/100`). Le tableau de projets est trié
« ce qui va mal d'abord », les états inconnus en dernier : **ne pas savoir
n'est pas une alerte**, et le présenter comme tel noierait les vrais
problèmes.

Le modèle de ligne est **partagé** avec la liste des projets. Les deux
écrans ne peuvent donc plus affirmer deux choses différentes du même projet.

### 2.4 Formulaire de projet (§2) — défaut de thème corrigé

Le gabarit contenait une balise `<style>` **à l'intérieur du HTML**, avec
une palette GitHub-sombre codée en dur (`#0d1117`, `#e6edf3`, `#58a6ff`…).
Deux conséquences réelles :

- l'écran restait **sombre en thème clair** — le seul de la plateforme à ne
  pas suivre le thème ;
- une balise `<style>` dans un gabarit n'est **pas encapsulée** par Angular :
  des sélecteurs aussi génériques que `.alert`, `.field`, `.section`, `.hint`
  et `.divider` fuyaient dans le document et continuaient de s'appliquer aux
  autres écrans après un passage sur le formulaire.

Déplacée dans `project-form.component.scss` (encapsulée), palette convertie
en variables de thème, `min-height:100vh` et la police `'Inter'` imposée
retirées. Les émojis de libellés (`💾 Sauvegarder`, `⏳`, `🔍`, `📋`, `⚙️`,
`🔧`, `🐙`) remplacés par du texte et par les icônes `ti` du reste de la
plateforme. « Vérifier la configuration » n'a plus l'aspect d'un bouton
primaire : une seule action primaire par écran (§7).

### 2.5 Aide contextuelle (§22) — câblée

`<app-info-hint>` existait sans aucun point d'appel. Les **9** termes du
glossaire sont désormais tous branchés, sur **27** points d'appel, là où le
concept se lit :

| Terme | Où |
|---|---|
| `quality-gate` | onglet SonarQube, cartes rapport et live |
| `sast` | en-tête de la liste des problèmes SonarQube |
| `sca` | sections « Vulnérabilités conteneur » et « de dépendances », en-têtes Trivy/OWASP |
| `dast` | sections « Alertes DAST », en-tête ZAP, KPI alertes ZAP |
| `digest` | onglet Docker, identité de déploiement |
| `provenance` | onglet Docker (provenance enregistrée) |
| `security-score` | en-tête projet, liste des projets, tableau de bord, vue sécurité |
| `deployment-governance` | pilotage DevSecOps, liste des projets, décisions de gouvernance |
| `merge-authorization` | verdict de validation post-PR du tiroir SonarQube |

Une phrase, atteignable au clavier, `aria-label` portant le texte complet.
Un terme hors glossaire n'affiche **rien** plutôt qu'un point
d'interrogation vide.

### 2.6 Identifiants techniques (§20/§21) — composant dédié

`<app-copyable-id>` : forme courte à l'écran, valeur intégrale dans `title`
**et** derrière le bouton copier. Appliqué au digest (`sha256:` préservé, le
reste tronqué), au commit source, à la référence d'image publiée, à
l'identifiant de projet et à l'identifiant d'incident. Une valeur absente
n'affiche rien — l'appelant dit lui-même « Non disponible », parce que lui
seul sait si l'absence est un échec de lecture ou une donnée jamais
enregistrée.

### 2.7 Autres écrans alignés

- **Indicateurs de risque** : patron de chargement standard, état d'erreur
  distinct de l'état vide, nom de projet cliquable (l'écran était un
  cul-de-sac), glyphe non chromatique sur le niveau de risque, typographie
  de la plateforme au lieu de `'JetBrains Mono'` sur toute la page, couleur
  `#e8590c` codée en dur remplacée par une variable de thème, libellés de
  règle normalisés via `presentationText` (« Quality Gate » → « contrôle
  qualité »).
- **Sécurité — Trivy & OWASP** : carte « OBSERVATIONS MOYENNES » supprimée
  (elle affichait un « Non disponible » codé en dur, sans source ni calcul),
  libellés en capitales normalisés, `1C / 3H` → `1 critiques · 3 élevées`,
  lignes cliquables annoncées (`role="button"`, `aria-label`, Entrée **et**
  Espace), tableau dans un conteneur de défilement, mention de l'endroit où
  vivent les preuves exactes.
- **Agents IA** : titre `// agents IA` → **Agents IA**, émojis remplacés par
  les icônes `ti`, barèmes de couleurs hexadécimaux locaux (`#38bdf8`,
  `#22c55e`, `#f97316`…) remplacés par la table de tonalités partagée — cet
  écran utilisait une sémantique de couleur différente de tous les autres et
  ne suivait pas le thème. « Correctifs auto-proposés » → « Corrections
  proposées par l'IA » (§11 : proposé ≠ corrigé).
- **Détail d'incident** : titre `// détail de l'incident` → **Détail de
  l'incident** ; le cycle de vie disait `Fix proposé / WF1 / WF2 / judge /
  merge` — franglais et identifiants internes exposés comme information
  primaire. Devient `Correction proposée` / `Proposition IA · WF2`,
  `Validé` / `Validation déterministe · WF3`, `Résolu` / `Correction
  fusionnée` : libellé humain primaire, identifiant de workflow conservé en
  second rang (§5). Pastilles de validation passées sur le système partagé.
- **Paramètres**, **Administration** : titres `// xxx` normalisés ; tableau
  des utilisateurs dans un conteneur de défilement.

---

## 3 — Vérité des données : trace live

Le fichier `LIVE_DATA_TRUTH_TRACE.txt` est la sortie de
`live-data-truth-trace.mjs`, qui interroge le **backend live** puis fait
passer les réponses par les **modules de présentation réels** et imprime ce
que les gabarits rendront. Aucune donnée simulée.

Extraits des deux projets exigés :

```
── app-test-pfe-vermeg
   dépôt        : souhaiel11/app-test-pfe-vermeg
   build        : état=UNAVAILABLE statut=∅ -> « Indisponible » tonalité=neutral
                  n°=10 (corrélé plateforme) motif=Données Jenkins temporairement indisponibles
   sécurité     : état=KNOWN score=92 criticalCves=2 scannersManquants=[]
   déploiement  : état=NOT_READY -> « Non prêt » tonalité=warning bloquants=11
                  premier=La validation ne correspond pas au build courant
   incidents    : ouverts=10 analyse=0
   activité     : il y a 1 h (10 octobre 2026 à 14:26)
   À traiter    : OUI -> 10 incidents ouverts | Déploiement bloqué — 11 conditions non satisfaites

── pfe-app-test
   dépôt        : souhaiel11/pfe-app-test
   build        : état=KNOWN statut=SUCCESS -> « Réussi » tonalité=success n°=151
   sécurité     : état=KNOWN score=13 criticalCves=37 scannersManquants=[]
   déploiement  : état=NOT_READY -> « Non prêt » tonalité=warning bloquants=15
   incidents    : ouverts=77 analyse=54
   activité     : il y a 3 j (6 octobre 2026 à 18:57)
   À traiter    : OUI -> 77 incidents ouverts | Déploiement bloqué — 15 conditions
                  non satisfaites | Score de sécurité 13/100
```

Deux observations qui valident la discipline §17/§31 **sur une panne réelle** :

1. Jenkins était effectivement injoignable au moment de la trace (`Données
   Jenkins temporairement indisponibles`, `Timeout Jenkins après 5000ms` sur
   6 projets sur 7). Les six lignes concernées affichent **« Indisponible »
   en tonalité neutre**, jamais en rouge, avec le motif exact en infobulle —
   et aucune n'est comptée comme « à traiter » à ce titre.
2. `vuln-testapp` et `devsecops-testbed` remontent `incomplete: true` avec
   `missingScanners: [trivy, owasp, zap]`. Leur score est affiché comme
   **partiel**, avec le nombre de scanners sans résultat, et non comme un
   verdict.

La trace a aussi révélé un défaut de libellé : `source: 'jenkins'`
s'affichait en minuscules faute d'entrée `JENKINS` dans la table de
libellés. Corrigé (`Jenkins`, `GitHub`, `Webhook`, `Plateforme`, `SonarQube`).

---

## 4 — Tests ajoutés

`frontend/scripts/final-ui-freeze.spec.mjs` — 11 blocs, charges utiles
constituées de **réponses backend réelles** relevées le 2026-10-10 :

| Bloc | Ce qu'il empêche de régresser |
|---|---|
| 1 | Panne Jenkins, absence de build et résultat de build restent trois faits distincts ; un résultat vide ne devient pas un succès |
| 2 | Aucun repli de score, aucun 0 pour un inconnu, aucun héritage d'un autre projet |
| 3 | `NOT_CONFIGURED` / `NOT_READY` / `UNAVAILABLE` ne se confondent pas |
| 4 | « À traiter » n'est fondé que sur des faits constatés, avec motifs nommés ; tout ignorer d'un projet ne le rend pas alarmant |
| 5 | Tri dégradés-en-tête, inconnus-en-queue |
| 6 | Aucune fraîcheur fabriquée ; horodatage exact conservé |
| 7 | Sévérité d'incident lue du backend, jamais complétée ; `buildNumber` non entier ≠ `#0` |
| 8 | Forme courte d'identifiant sans perte de la valeur complète ; pas d'ellipse sur une valeur déjà courte |
| 9 | Aide contextuelle courte ; terme inconnu → rien |
| 10 | Un seul système de pastilles ; plus de coquille dupliquée dans le tableau de bord ; tableaux dans un conteneur de défilement ; plus de titre `// xxx` |
| 11 | Sur chaque liste : état vide et échec de requête restent distincts, avec reprise |

`scripts/loading-states.spec.mjs` : expressions ajustées au nouveau balisage
(l'intention — patron de chargement standard, aucun état vide provisoire —
est conservée et désormais accompagnée de `role="status"`).

---

## 5 — Responsive et accessibilité : méthode

**Deux passes distinctes, et il faut les garder distinctes.**

**Passe 1 — revue statique (automatisée, cette session).** Revue
systématique des feuilles de style et des gabarits (recherche de largeurs
fixes, de tableaux sans conteneur de défilement, de grilles sans règle de
repli), vérification que les points de rupture couvrent
1440 / 1024 / 768 / 390 px, et correctifs sur chaque défaut trouvé. Cet
environnement n'a aucun navigateur (ni Chromium, ni Firefox, ni
Playwright/Puppeteer) : cette passe ne mesure donc **pas** un rendu réel.

**Passe 2 — revue visuelle en navigateur (manuelle, opérateur).** Effectuée
et déclarée par l'opérateur le 2026-10-10 sur la construction de production
en ligne, aux quatre largeurs et sur les deux projets exigés. C'est elle qui
ferme l'exigence §33. Enregistrée en §7.2.

Les verdicts `RESPONSIVE_*` de §1 reposent sur la **conjonction** des deux.

**Trois débordements réels trouvés et corrigés :**

1. `.field-row` / `.tool-grid` du formulaire de projet : la règle mobile
   écrivait `flex-direction: column` sur une **grille**, ce qui n'a aucun
   effet. Les deux colonnes restaient côte à côte à 390 px, chaque champ
   réduit à ~150 px. → `grid-template-columns: minmax(0, 1fr)`.
2. Boîte de dialogue « Nouvel utilisateur » : `width: 400px` fixe, soit un
   débordement garanti sur un écran de 390 px. → `min(400px, calc(100vw - 32px))`.
3. Tableau ZAP : quatre colonnes dont une URL, sans conteneur de
   défilement. → `.zap-wrap { overflow-x: auto }`.

**Accessibilité (§24).** `.sr-only` n'existait que dans la feuille
**encapsulée** de `project-detail` : tout libellé réservé aux lecteurs
d'écran écrit ailleurs était donc **visible à l'écran**. Classe déplacée en
global. Ajouts : `aria-hidden` sur les icônes décoratives restantes
(bascule de thème, en-têtes de page, vue sécurité), `role="status"` sur les
zones de chargement, `role="alert"` sur les échecs, `role="button"` +
`aria-label` + Entrée/Espace sur les lignes de tableau cliquables,
`aria-label` sur le filtre de statut des incidents, focus visible sur les
contrôles du formulaire de projet, et un repère non chromatique partout où
la couleur portait seule l'information (liseré + pastille « À traiter »,
glyphe de niveau de risque, glyphes `✓`/`✕` du formulaire).

---

## 6 — Inventaire

### `FILES_CHANGED` (38)

**Nouveaux (4)**
```
frontend/src/app/shared/copyable-id/copyable-id.component.ts
frontend/src/app/features/projects/project-list-row.ts
frontend/src/app/features/projects/project-form.component.scss
frontend/scripts/final-ui-freeze.spec.mjs
```

**Modifiés (34)**
```
frontend/src/styles.scss
frontend/src/app/shared/status-labels.ts
frontend/src/app/shared/status-chip/status-tone.ts
frontend/src/app/shared/layout/layout.component.html
frontend/src/app/features/dashboard/dashboard.component.{ts,html,scss}
frontend/src/app/features/projects/projects.component.{ts,html,scss}
frontend/src/app/features/projects/project-detail.component.{ts,html,scss}
frontend/src/app/features/projects/project-form.component.{ts,html}
frontend/src/app/features/projects/deployment-governance.component.{ts,html}
frontend/src/app/features/projects/zap-table.component.ts
frontend/src/app/features/incidents/incidents.component.{ts,html,scss}
frontend/src/app/features/incidents/incident-detail.component.{ts,html}
frontend/src/app/features/analysis/analysis.component.{ts,html,scss}
frontend/src/app/features/analytics/prediction.component.{ts,html,scss}
frontend/src/app/features/tools/security.component.ts
frontend/src/app/features/admin/admin.component.{html,scss}
frontend/src/app/features/settings/settings.component.html
frontend/scripts/loading-states.spec.mjs
```

### `UI_ELEMENTS_REMOVED`

- Coquille en doublon du tableau de bord : bandeau latéral, barre
  supérieure, bouton de thème, fiche utilisateur, panneau de notifications
  (présents dans le DOM, masqués en CSS) — et le code devenu orphelin
  (`notifOpen`, `toggleNotif`, `notifications`, `toggleTheme`).
- Panneau « Scores de sécurité des projets » (anneaux de risque) : même
  score que la carte voisine, en graphique — avec `buildRiskRings`,
  `getRiskCssVar`, `cssVar`, `avatarPalette`, `mapProject`, `platformLabel`,
  `riskLabel` et le `timeAgo` local (remplacé par `frenchRelative` partagé).
- Colonne « Risque » des cartes de projet (quatrième représentation du score)
  et le doublon « Score de sécurité » du pied de carte.
- Carte KPI « OBSERVATIONS MOYENNES » de la vue sécurité (« Non disponible »
  codé en dur, sans source).
- Colonne « Identifiant » de la liste des incidents (l'UUID reste copiable
  sous le titre).
- Bouton « Ouvrir » redondant des cartes de projet (le nom est l'action).
- Balise `<style>` non encapsulée du formulaire de projet.
- Règles CSS orphelines de `project-detail` (`.deploy-azure-box`,
  `.deploy-azure-row`, `.deploy-confirm`, `.deploy-tag-input`,
  `.deploy-result*`, `.loading-state`, `.btn-action.gray`, `.tab-content`,
  `.project-name`) — balisage migré ailleurs ou supprimé.
- Émojis de libellé : `💾 ⏳ 🔍 📋 ⚙️ 🔗 🔧 🐙 ✏️ ➕ ✅ ❌ ⚠️ 📊 ◈ ◆ ⬡ ▣`
  dans le formulaire de projet et la vue Agents IA ; `🌐` de la section DAST ;
  `🐛` de l'en-tête des problèmes SonarQube.

### `UI_ELEMENTS_SIMPLIFIED`

- Liste des projets : de 6 blocs par carte à 1 identité + 4 faits alignés.
- Liste des incidents : 7 colonnes dont une d'UUID → 8 colonnes dont aucune
  d'UUID, avec `Projet`, `Build` et `Dernière activité` ajoutés.
- Tableau de bord : 5 sections dont 3 redondantes → 4 sections sans doublon.
- Barèmes de couleurs : 3 tables hexadécimales locales (Agents IA ×2,
  Indicateurs de risque ×1) → la table de tonalités partagée.
- Libellés : `1C / 3H` → `1 critiques · 3 élevées` ; `CRITIQUES — résultats
  disponibles` → `CVE critiques` ; `Fix proposé` → `Correction proposée`.
- Cycle de vie de l'incident : identifiants `WF1/WF2/WF3/judge/merge` placés
  en second rang derrière un libellé humain.

### `UI_ELEMENTS_ADDED`

- `<app-copyable-id>` : forme courte + copie + valeur complète (§20/§21).
- `<app-info-hint>` câblée sur les 9 termes du glossaire, 27 points d'appel (§22).
- Panneau « À traiter en priorité » avec motifs exacts (§28).
- Ligne de synthèse « N projets · M demandent une attention » (§28).
- Bandeau de dégradation partielle : la liste reste exacte et dit **quelle**
  lecture a échoué, au lieu de combler les colonnes concernées (§17).
- États vides explicites et distincts de l'erreur, avec reprise, sur la
  liste des projets, la liste des incidents, les indicateurs de risque, la
  vue sécurité, les Agents IA et l'onglet Incidents du projet (§16/§17).
- Classes globales `.na` (absence dite sans élargir une colonne), `.sr-only`
  (libellé lecteur d'écran), `.table-scroll` (défilement contenu).

### `KNOWN_NON_BLOCKING_ISSUES`

> **Le point n° 1 de la version précédente de ce rapport — « passe visuelle
> en navigateur non faite » — est CLOS** par la revue manuelle de l'opérateur
> enregistrée en §7.2. C'était le seul point qui empêchait un verdict A.

1. **Émojis de statut conservés** dans `deployment-governance` (`✅ ⛔ 🚫 ⚠️`)
   et `incident-detail`. Ce sont des repères non chromatiques volontaires et
   couverts par leurs propres tests ; ils restent toutefois un second jeu de
   glyphes à côté du `✓ ✕ ! … – ○` de la pastille partagée. Unification
   remise à plus tard : bénéfice cosmétique, risque de régression sur des
   écrans déjà validés.
2. **`project-detail.component.scss` au-dessus du budget souple** : 25,04 kB
   pour un budget d'avertissement de 20 kB (budget d'erreur : 26 kB). La
   suppression des règles orphelines a ramené la marge de **30 octets à
   ~960 octets** sous le seuil d'erreur — la construction de production
   échouait au premier ajout. Découper ce gabarit reste souhaitable, mais
   c'est une refonte structurelle, hors d'une passe de finition.
3. **Libellés de règle produits par le backend** (`common/risk-score.ts`,
   ex. « Quality Gate SonarQube en ERROR ») : normalisés à l'affichage par
   `presentationText` sur la vue Indicateurs de risque. Toute nouvelle
   surface qui consommerait ces chaînes devra appliquer le même filtre. Le
   backend n'a pas été modifié : §32 l'interdit en l'absence de défaut
   d'affichage bloquant.
4. **Le nombre d'incidents de la liste reste plafonné à 50** par le backend.
   L'interface le dit explicitement en infobulle ; aucune pagination n'a été
   ajoutée (ce serait une fonctionnalité, pas une finition).

---

## 7 — Qualification finale et preuves

### 7.1 — Déploiement vérifié (automatisé)

La construction de production est servie par le conteneur `pfe-frontend`,
qui monte directement `frontend/dist/devsecops-frontend/browser`. C'est
l'artefact exact sur lequel la revue visuelle de §7.2 a porté.

| Contrôle | Résultat |
|---|---|
| `GET http://localhost:4200/` | `200`, `<title>DevSecOps IA — Vermeg</title>` |
| Chargement du bundle principal | `200` |
| `POST http://localhost:4200/api/auth/login` (proxy nginx) | `201` |
| `GET http://localhost:4200/api/projects` (proxy nginx) | `200` |
| Classes globales `.na`, `.sr-only`, `.table-scroll` dans le bundle CSS | présentes |

### 7.2 — Revue visuelle réelle en navigateur (manuelle, opérateur)

**Nature de la preuve.** Revue **manuelle**, effectuée et déclarée par
l'opérateur de la plateforme. Elle n'a pas été — et ne pouvait pas être —
reproduite automatiquement : cet environnement d'exécution n'a aucun
navigateur. Elle est consignée ici comme attestation de l'opérateur, pas
comme mesure automatisée.

| | |
|---|---|
| **Date** | 2026-10-10 |
| **Cible** | `http://localhost:4200` — construction de production de §7.1 |
| **Backend** | instance live (`pfe-backend`), données réelles |
| **Largeurs** | 1440 px · 1024 px · 768 px · 390 px |
| **Projets** | `app-test-pfe-vermeg` · `pfe-app-test` |
| **Résultat déclaré** | aucun défaut bloquant — visuel, responsive, navigation, vérité des données, utilisabilité |

**Confirmations enregistrées :**

```
REAL_BROWSER_VISUAL_REVIEW = PASS
RESPONSIVE_1440            = PASS
RESPONSIVE_1024            = PASS
RESPONSIVE_768             = PASS
RESPONSIVE_390             = PASS
LIGHT_THEME                = PASS
DARK_THEME                 = PASS
NAVIGATION                 = PASS
DATA_TRUTH_VISUAL          = PASS
SOURCE_EVIDENCE_VISUAL     = PASS
NO_HORIZONTAL_OVERFLOW     = PASS
NO_BLOCKING_VISUAL_DEFECT  = YES
```

### 7.3 — Chaîne de preuve complète

| Exigence §33 | Preuve | Nature |
|---|---|---|
| Tests frontend | 108 / 108 PASS | automatisée, reproductible |
| Construction de production | `npm run build:prod` SUCCÈS | automatisée, reproductible |
| `qa-french-ui` | PASS | automatisée, reproductible |
| Audit des valeurs en dur | `remainingRuntimeHardcodes: []` | automatisée, reproductible |
| Vérité des données sur le backend live | `LIVE_DATA_TRUTH_TRACE.txt`, 7 projets réels | automatisée, reproductible |
| **Vérification réelle en navigateur** | **§7.2** | **manuelle, attestation opérateur** |

Les cinq premières lignes sont rejouables par n'importe qui depuis le dépôt.
La sixième ne l'est pas, et c'est précisément pourquoi elle est attribuée
nommément plutôt que présentée comme un contrôle de la plateforme.

---

## 8 — Verdict

```
FINAL_PRACTICAL_UI_VERDICT = A — PROFESSIONAL_UI_READY_FOR_PFE_FREEZE
```

Tous les chapitres §1 à §32 sont traités. Les quatre contrôles automatisés
exigés par §33 passent. La vérité des données est prouvée sur le backend
live pour les sept projets réels — y compris sur une panne Jenkins réelle,
où l'interface dit « Indisponible » en tonalité neutre au lieu de peindre un
échec qu'elle n'a pas constaté.

La version précédente de ce rapport concluait **B**, pour une seule raison :
§33 exige une vérification réelle en navigateur, et cet environnement n'en a
aucun. Cette réserve est **levée** par la revue visuelle manuelle de
l'opérateur, enregistrée en §7.2 — quatre largeurs, les deux thèmes, les
deux projets exigés, aucun défaut bloquant.

Les quatre points restants de §6 sont cosmétiques (un second jeu de glyphes
de statut) ou structurels (budget CSS souple, libellés de règle côté
backend, plafond de 50 incidents côté backend). Aucun n'empêche un usage et
aucun n'est un défaut de vérité des données.

**Une réserve de méthode, pour que la suite reste honnête :** la ligne §7.2
est une attestation humaine, pas un contrôle rejouable. Si cette interface
est modifiée après le gel, la chaîne de preuve automatisée (§7.3, cinq
lignes sur six) se rejoue seule, mais **la sixième doit être refaite à la
main** — un verdict A hérité ne couvre pas un rendu que personne n'a revu.

---

## 9 — Gel de l'implémentation pratique

```
PRACTICAL_IMPLEMENTATION = FROZEN
FROZEN_AT                = 2026-10-10
FROZEN_COMMIT_BASE       = theme-vermeg-reconciled
FROZEN_ARTEFACT          = frontend/dist/devsecops-frontend/browser
                           (servi par pfe-frontend sur :4200)
```

### Ce que le gel interdit

| Interdit |
|---|
| Nouvelle fonctionnalité, de quelque taille que ce soit |
| Refonte cosmétique ou nouvelle passe visuelle |
| Modification de WF1 / WF2 / WF3 / WF6 |
| Modification du comportement Jenkins, de la logique de déploiement Azure, de la sémantique d'artefact ou de provenance |
| Changement d'architecture |
| Déclenchement d'un build Jenkins sans défaut réel à reproduire |

### Ce que le gel autorise

Les corrections de défauts **P0 / P1 objectivement nécessaires**, et rien
d'autre. « Objectivement nécessaire » veut dire reproductible et énoncé comme
tel, pas ressenti : un écran qui plante, une donnée fausse affichée comme
vraie, une action qui échoue silencieusement, une régression d'un invariant
déjà testé.

### Procédure pour une correction post-gel

1. Enregistrer le défaut **avant** d'y toucher : reproduction, écran, données
   réelles concernées, invariant violé.
2. Corriger au plus près — la correction, pas son voisinage.
3. Rejouer la chaîne automatisée en entier : `node --test scripts/*.spec.mjs`,
   `npm run build:prod`, `node scripts/qa-french-ui.mjs`,
   `node scripts/audit-platform-hardcodes.mjs`, `git diff --check`.
   Attention : `npm run build` (dev) **masque** l'échec de budget CSS de
   `project-detail.component.scss` — seul `build:prod` le révèle (§6, point 2).
4. Ajouter le test de non-régression qui aurait attrapé le défaut.
5. Refaire la revue visuelle en navigateur sur les écrans touchés, et
   l'enregistrer comme en §7.2. Un correctif ne réhérite pas du A.

---

## 10 — Journal post-gel

Le gel autorise les correctifs **P0 / P1 objectivement nécessaires** (§9).
Chaque entrée ci-dessous suit la procédure §9 : défaut enregistré avant
correction, chaîne automatisée rejouée, test de non-régression ajouté.
Diagnostic complet : `POST_FREEZE_P1_DIAGNOSIS.md`.

### P1-A — Latence de 5 s sur la liste des projets et le tableau de bord

**Signalé par l'opérateur.** « Les projets prennent des secondes à charger. »

**Mesuré.** `/api/projects` 7 ms · `/dashboard/security-global` 20 ms ·
`/azure-deploy/ready/:id` 6–23 ms · **`/dashboard/jenkins-global` 5 008 ms**
(son plafond de 5 000 ms, atteint parce que deux projets pointent vers une
IP hôte WSL périmée qui ne répond pas).

**Cause — régression de la passe de finition.** J'avais placé
`jenkins-global` dans le `forkJoin` **bloquant** des deux écrans pour
alimenter la colonne « Dernier build ». Toute la page s'alignait donc sur la
plus lente des lectures. Avant la passe, la liste ne lisait que `/projects`
et `/security-global`.

**Corrigé.** Lectures étagées : `/projects` + `/security-global` ouvrent
l'écran, Jenkins et la gouvernance arrivent ensuite et recomposent les
lignes à mesure (`rebuildRows()`). La colonne « Dernier build » affiche
« Vérification… » le temps de la lecture — ce qui est exact — au lieu
d'affirmer « Indisponible » avant d'avoir lu (§18).

**Gain mesuré sur le premier affichage : 5,01 s → 0,043 s (≈ 117×).**

### P1-B — « Indisponible » affirmé pour un projet sans job Jenkins

**Signalé par l'opérateur.** « Il y a des projets où il manque des infos,
déclarées indisponible, comme l'état de build. »

**Diagnostiqué.** Sondes depuis le conteneur backend : `jenkins:8080`
répond **403** (identifiant absent), `172.31.172.61:8082` **ne répond pas**
(IP hôte périmée), `172.26.174.59:8082` répond **403**. Pour quatre projets
sur cinq, « indisponible » est donc **exact** — ce sont de vrais problèmes
de configuration de projet, pas un défaut d'affichage, et les corriger dans
l'interface reviendrait à masquer le problème.

**Le défaut réel, limité et bien à moi.** Un projet **sans aucun job
Jenkins** est absent de `jenkins-global` exactement comme un projet dont la
lecture a échoué. Mon `buildCell()` traitait les deux pareil et affichait
« Indisponible — les données Jenkins n'ont pas été chargées ». C'est une
panne affirmée sans avoir été constatée : rien n'avait échoué, il n'y avait
rien à lire. C'est précisément ce que §17 et §31 interdisent, et dans le
pire sens — cela envoie chercher une infrastructure en défaut quand il
manque une ligne de configuration.

**Corrigé.** Nouvel état `NOT_CONFIGURED` → « Non configuré », tonalité
`disabled` (jamais rouge), testé avant toute lecture distante puisqu'il n'en
dépend pas. Et il n'est **jamais** compté comme « à traiter » : un outil non
configuré n'est pas un problème.

**Ajout d'actionnabilité, sans inventer de cause.** Le motif exact du
backend est conservé mot pour mot, et un **second fait** est juxtaposé quand
il est vrai : « Aucun identifiant Jenkins n'est enregistré pour ce projet »
(champ réel `jenkinsCredentialConfigured`). Jamais « échec parce que
l'identifiant manque » — le backend ne dit pas pourquoi, et deviner à sa
place serait inventer. Un test vérifie explicitement l'absence de
formulation causale.

### S3 — Boutons de la colonne « Action » (Trivy / OWASP / ZAP) : corrigé

**Signalé par l'opérateur, en deux temps.** D'abord « les boutons de Trivy
et OWASP ne sont pas beaux », que j'ai à tort compris comme les pastilles de
filtre `.sec-chip` — lesquelles n'ont effectivement aucun défaut objectif
(focus visible, libellé accessible, contraste correct dans les deux thèmes).
Puis, après précision : « la partie **action** dans OWASP et ZAP, Trivy ».

**J'avais regardé le mauvais élément.** La seconde lecture est la bonne, et
ce n'était pas une question de goût.

**Diagnostiqué.** Les trois boutons de la colonne Action de `cve-table`
(Trivy et OWASP) — `Corriger`, `Réessayer`, `Voir le détail` — étaient des
`<button>` **sans aucune classe**. Et `styles.scss` ne définit aucune règle
pour un `button` nu : le navigateur leur appliquait donc son propre rendu —
boîte grise système, police système — qui **ne suit ni le thème clair/sombre
ni le système `.btn` de la plateforme**, et qui les rendait tous les trois
visuellement identiques, donc **sans hiérarchie lisible**. Même défaut sur
les boutons de suivi manuel de `cve-table` et `zap-table`, sur le bouton
« Annuler » des deux boîtes de confirmation, et sur les trois boutons
« Réessayer » des cartes d'erreur (détail d'incident, détail de projet,
administration).

C'est un écart au système de conception (§6) et une absence de hiérarchie
d'action (§7), pas une préférence esthétique.

**Corrigé.** Passage au système `.btn` de la plateforme, avec hiérarchie
explicite : `Corriger` primaire (`.btn-primary`), `Réessayer` et
`Voir le détail` secondaires (`.btn-secondary`), tous en `.btn-sm`. Conteneur
`.cve-actions` en flex pour que les boutons ne se collent plus et s'empilent
au lieu d'élargir la colonne sur écran étroit (§23). Les deux classes locales
devenues orphelines (`.track-btn`, `.reopen-btn`) ont été retirées des deux
composants (§27). Émojis `☐` des libellés supprimés.

**Deux améliorations d'accessibilité au passage (§24).** Le bouton de détail
annonce son état (`aria-expanded`) et son libellé reflète la réalité
(« Voir le détail » / « Masquer le détail »). La ligne dépliante de
`zap-table` était cliquable à la souris uniquement : elle est désormais
atteignable au clavier (`tabindex`, `role="button"`, Entrée et Espace) avec
`aria-expanded` et un `aria-label` nommant l'alerte ; son caret décoratif
est masqué aux lecteurs d'écran.

**Statut dans le gel.** Enregistré comme **levée ciblée** demandée par
l'opérateur. Le constat final est cependant qu'il s'agissait d'un défaut de
cohérence objectif, et non de la refonte cosmétique que §9 exclut.

**Restent non corrigés, assumés :** `aria-pressed` absent sur le groupe de
pastilles de filtre, et `#fff` / deux `rgba()` en dur dans `.sec-chip`. Ni
l'un ni l'autre n'empêche un usage.

### Chaîne de validation rejouée après P1-A et P1-B

| Contrôle | Résultat |
|---|---|
| `node --test scripts/*.spec.mjs` | **109 / 109 PASS** (+1 fichier : `post-freeze-p1.spec.mjs`, 6 blocs) |
| `npm run build:prod` | **SUCCÈS** |
| `node scripts/qa-french-ui.mjs` | **PASS** |
| `node scripts/audit-platform-hardcodes.mjs` | **0** valeur en dur à l'exécution |
| `git diff --check` | **propre** |
| Trace de vérité live régénérée | `LIVE_DATA_TRUTH_TRACE.txt` (5 projets — voir note de traçabilité du diagnostic) |

**Revue visuelle en navigateur : à refaire sur les écrans touchés** —
`/projects`, `/dashboard`, et l'onglet **Sécurité** d'un projet (tables
Trivy / OWASP / ZAP, en thème clair **et** sombre, puisque le défaut corrigé
était précisément une non-prise en compte du thème). Conformément à §8, un
correctif n'hérite pas du verdict A : la ligne §7.2 est une attestation
humaine, et ces écrans ont changé depuis.

```
PRACTICAL_IMPLEMENTATION = FROZEN (maintenu)
POST_FREEZE_FIXES        = 2 × P1 (régression de latence, vérité des données)
                         + 1 × écart au système de conception (boutons d'action)
COSMETIC_REQUESTS_OPEN   = 0
PENDING                  = revue visuelle des écrans touchés
```

### P1-C — Latence de 5 s sur « Indicateurs de risque » (et partout)

**Signalé par l'opérateur.** « Le chargement pour Indicateurs de risque prend
du temps, corrige cette latence, et si tu trouves d'autres latences on les
corrige aussi si possible. »

**Balayage complet des endpoints.** Deux coupables, un seul péage :

| Endpoint | Avant | Après | Gain |
|---|---|---|---|
| `/dashboard/risk-indicators` | **5,011 s** | **0,171 s** | **29×** |
| `/dashboard/jenkins-global` | **5,006 s** | **0,047 s** | **106×** |
| `/projects/:id/jenkins-status` (×2 projets) | **5,004 s** | **0,016 s** | **310×** |
| `/dashboard/security-global` | 0,024 s | 0,023 s | — |
| `/projects` | 0,006 s | 0,004 s | — |
| `/incidents?size=50` | 0,300 s | — | — |
| `/reports` | 0,252 s | — | — |

**Cause unique.** `risk-indicators` attend `getJenkinsGlobal()`, qui attend
chaque projet. Deux projets — `vuln-testapp` et `devsecops-testbed` —
pointaient vers `http://172.31.172.61:8082`, une **IP hôte WSL périmée** qui
ne répond plus. Chacun consommait donc intégralement le délai de garde de
5 000 ms, et tout endpoint touchant Jenkins payait ce péage.

**Deux corrections possibles, une seule retenue.**

*Écartée — correctif backend.* Un budget de délai court pour
`risk-indicators` aurait ramené la lecture à ~0,8 s. Mais le conteneur en
service tourne sur l'image `local/pfe-backend-reconciled:r98`, **sans
montage de source**, et `backend/src` sur cette branche diverge de la lignée
de cette image de **141 fichiers (+19 738 / −7 371)**. Reconstruire le
backend depuis ici écraserait ce travail. Écartée sur décision de
l'opérateur : risque hors de proportion avec le gain, d'autant que la
correction de configuration fait mieux.

*Retenue — correction de configuration, sur décision de l'opérateur.*
Ajout de `jenkinsInternalUrl = http://jenkins:8080` et
`jenkinsPublicUrl = http://localhost:8082` sur les deux projets, via
`PUT /api/projects/:id`. L'adresse `jenkinsUrl` d'origine est **laissée
intacte** : le changement est additif et réversible. Valeurs d'origine
sauvegardées dans `JENKINS_URL_ROLLBACK.json`.

**Effet secondaire, et c'est le meilleur de l'affaire.** Ces deux projets
avaient déjà leurs identifiants Jenkins enregistrés. Dès l'adresse corrigée,
leurs builds sont **réapparus** :

| Projet | Avant | Après |
|---|---|---|
| `vuln-testapp` | Indisponible (timeout 5 s) | **Build #42 · Instable** |
| `devsecops-testbed` | Indisponible (timeout 5 s) | **Build #20 · Instable** |

Et la plateforme les signale désormais correctement comme « à traiter », avec
le motif exact (« Build #42 instable ou interrompu ») — information qui
n'était tout simplement pas disponible auparavant.

**Reste indisponible, et pour une raison nommée.**
`app-test-pfe-vermeg` et `devsecops-platform-testbed` n'ont **aucun
identifiant Jenkins enregistré** : `jenkins:8080` leur répond `403` en
quelques millisecondes. Ce n'est plus de la latence, c'est une
authentification manquante — et l'interface le dit exactement, grâce au
second fait ajouté en P1-B : « Données Jenkins temporairement indisponibles
— Aucun identifiant Jenkins n'est enregistré pour ce projet. » Seul
l'opérateur peut fournir ces identifiants.

### Déclaration des zones : Information / Action

**Demandé par l'opérateur.** « Pour améliorer l'affichage, je veux qu'on
déclare la partie qui contient juste des informations — on écrit par exemple
Information — et la partie qui contient des actions ou une intervention
humaine, on la déclare aussi, pour faciliter la complexité d'affichage. »

**Mis en œuvre.** Composant partagé `<app-zone-label>`, deux natures :

| Nature | Libellé | Sens |
|---|---|---|
| `information` | ◇ **Information** | Zone de lecture : constats, mesures, preuves. Rien à décider, rien à déclencher. |
| `action` | ◆ **Action** | Zone d'intervention humaine : un bouton y engage la plateforme. |

Chaque étiquette porte une phrase courte disant ce qu'on y lit, ou ce qu'on y
engage. Le glyphe (◇ creux / ◆ plein) et le libellé portent la distinction ;
la couleur ne fait que la renforcer (§24).

**Pourquoi le dire plutôt que le laisser deviner.** Sur un écran dense, un
tableau de résultats et un panneau de décision se ressemblent — même carte,
même bordure, même densité. Le développeur doit alors lire le contenu pour
savoir s'il est concerné. L'étiquette répond **avant** la lecture : elle
réduit le coût d'orientation, pas le volume d'information.

**Couverture : 20 zones déclarées sur 10 écrans.**

| Écran | Déclaration |
|---|---|
| Tableau de bord | Information |
| Liste des projets | Action si droits d'édition, sinon Information |
| Liste des incidents | Information |
| Indicateurs de risque | Information |
| Agents IA | Information |
| Sécurité — Trivy & OWASP | Information |
| Administration | Action |
| Détail de projet — Rapport IA, Incidents | Information |
| Détail de projet — Jenkins, Docker, SonarQube, Configuration | Action si droits, sinon Information |
| Détail de projet — Sécurité | Information, **plus deux zones d'action distinctes** : demande de correction automatique, et suivi manuel |
| Détail de projet — Déploiement | Action |
| Détail d'incident — Analyse IA, Guide, Données brutes | Information |
| Détail d'incident — Validation PR | Action si droits, sinon Information |

**La nature dépend des droits réels de l'utilisateur** : un lecteur voit
« Information » là où un développeur voit « Action », parce que l'étiquette
décrit ce qui est *vraiment* là pour lui.

**Garde-fou important.** L'étiquette n'est **jamais** un contrôle d'accès.
Le composant n'injecte aucun service, ne lit aucun rôle, n'a aucune garde :
il rend deux chaînes. L'autorisation réelle reste décidée par la garde de
chaque bouton, et in fine par le backend. Un test le vérifie explicitement —
une étiquette devenue source d'autorisation serait un contresens de
sécurité.

**Tests ajoutés** (`scripts/zone-label.spec.mjs`, 5 blocs) :

| Bloc | Ce qu'il empêche |
|---|---|
| 1 | Une troisième nature inventée en passant |
| 2 | Perte du libellé humain ou du repère non chromatique |
| 3 | **Une zone « Action » sans aucun contrôle actionnable** — l'étiquette qui mentirait en envoyant chercher un bouton inexistant |
| 4 | Un écran de lecture non déclaré, ou l'onglet Déploiement cessant d'être déclaré « Action » |
| 5 | L'étiquette devenant un contrôle d'accès |

### Chaîne de validation rejouée après P1-C et la déclaration de zones

| Contrôle | Résultat |
|---|---|
| `node --test scripts/*.spec.mjs` | **110 / 110 PASS** (+1 fichier : `zone-label.spec.mjs`) |
| `npm run build:prod` | **SUCCÈS** |
| `node scripts/qa-french-ui.mjs` | **PASS** |
| `node scripts/audit-platform-hardcodes.mjs` | **0** valeur en dur à l'exécution |
| `git diff --check` | **propre** |
| Trace de vérité live régénérée | 5 projets, dont 3 builds réellement lus (#42, #20, #151) |

```
PRACTICAL_IMPLEMENTATION = FROZEN (maintenu)
POST_FREEZE_FIXES        = 3 × P1 (latence liste/tableau de bord, vérité des
                           données, latence Jenkins de 5 s)
                         + 1 × écart au système de conception (boutons d'action)
UI_CONVENTIONS_ADDED     = 1 (déclaration de zone Information / Action)
BACKEND_CHANGES          = 0 (écarté : divergence de 141 fichiers avec l'image en service)
CONFIG_CHANGES           = 2 projets (URL Jenkins interne — réversible,
                           JENKINS_URL_ROLLBACK.json)
PENDING                  = revue visuelle des écrans touchés
```

### P1-D — Vue Déploiement : 10 à 12 s de chargement

**Signalé par l'opérateur.** « La partie déploiement prend aussi beaucoup de
temps pour se charger. »

**Mesuré, par projet.** `GET /azure-deploy/governance/:id` :

| Projet | Temps | Artefact publié |
|---|---|---|
| `app-test-pfe-vermeg` | **12,44 s** puis 9,77 s | oui |
| `pfe-app-test` | **10,69 s** | oui |
| `devsecops-testbed` | 0,017 s | non |
| `vuln-testapp` | 0,008 s | non |
| `devsecops-platform-testbed` | 0,012 s | non |

Seuls les projets ayant un artefact à vérifier sont lents. Le reste de
l'écran est instantané : `GET /azure-deploy/ready/:id` répond en 6 à 22 ms.

**Cause, remontée jusqu'au bout.** Le backend délègue à un agent local
(`AZURE_DEPLOY_AGENT_URL`, un service Python sur l'hôte) qui exécute l'outil
`az`. Chronométrage des deux opérations de l'agent :

| Opération de l'agent | Temps |
|---|---|
| `/resolve-digest` — résolution de l'empreinte dans le registre | **4,88 s** |
| `/inspect-artifact` — lecture des étiquettes de l'image | **5,92 s** |
| **somme** | **10,80 s** |

La somme de ces deux durées **recouvre approximativement** la latence de
gouvernance observée. C'est une corrélation de mesures, rien de plus : je
n'ai pas pu lire l'enchaînement dans le binaire compilé en service, et je
n'affirme donc **pas** que ces deux opérations s'exécutent l'une après
l'autre. Toute optimisation partant de cette hypothèse devra d'abord la
prouver.

Fausses pistes écartées en chemin, pour mémoire : le registre ACR est
joignable en 341 ms, l'API de gestion Azure en 356 ms, et l'agent lui-même
répond en 2 à 9 ms. Le service de métadonnées d'instance Azure
(`169.254.169.254`) expire bien après 5 s depuis le conteneur, mais le
backend n'embarque aucun SDK Azure — ce n'était pas la cause.

**Ce n'est pas un défaut.** Ces 10 s sont le prix d'une garantie : la
plateforme interroge réellement le registre Azure pour résoudre l'empreinte
immuable de l'image et lire ses étiquettes, au lieu de rendre une décision
sur une copie locale potentiellement périmée. L'artefact est d'ailleurs bien
trouvé et sa provenance vérifiée (`tag 10-f02b6fb4d2b2`, digest
`sha256:f87baecf…`).

**Où la latence NE vient PAS, d'après les mesures.** Le registre ACR répond
en 341 ms et l'API de gestion Azure en 356 ms. La distance réseau et la
région ne sont donc **pas** démontrées comme le goulot — ce qui coûte les
secondes se situe ailleurs, entre l'agent et ces réponses, et n'a pas été
profilé.

**Non corrigé, et pourquoi.** Paralléliser les deux appels de l'agent
diviserait l'attente par deux. C'est une modification backend, écartée pour
la raison déjà établie en P1-C : l'image en service diverge de cette branche
de 141 fichiers.

**Corrigé côté interface — deux choses.**

*1. L'attente est désormais dite.* Un squelette muet pendant 12 s se lit
comme une interface figée. Le bloc de chargement nomme maintenant ce qu'il
attend — vérification de l'artefact auprès du registre Azure, aller-retour
distant d'une dizaine de secondes — et rappelle qu'aucune décision n'est
rendue avant qu'il aboutisse. On ne subit plus un blocage : on attend une
vérification dont on connaît l'objet.

*2. L'attente n'est plus payée qu'une fois par visite.* Le composant était
sous `*ngIf` seul : détruit à chaque changement d'onglet, il **repayait les
12 s à chaque retour** sur Déploiement. Il est désormais monté à la première
ouverture puis simplement masqué (`visitedTabs`).

Deux garde-fous tenus sur ce point :

- **Rien n'est anticipé.** Seul l'onglet initial est marqué visité au
  départ : aucune requête ne part vers Azure tant que l'onglet n'a pas été
  ouvert. Monter le composant d'avance aurait ralenti de 12 s chaque visite
  de projet, y compris pour qui n'ouvre jamais cet onglet — strictement
  pire que le défaut d'origine.
- **Ce n'est pas une mise en cache de la décision.** Le composant conserve
  le résultat qu'il a déjà obtenu, exactement comme s'il était resté
  affiché. Le bouton « Réévaluer » reste le chemin vers une décision
  fraîche, et le serveur reste seul à la calculer (§14).

**Pistes restantes, non chiffrées et non implémentées.** Voir la section
« Optimisations futures » plus bas : aucune n'est accessible depuis cette
branche, et aucune ne doit être engagée sans profilage préalable.

### Chaîne de validation rejouée après P1-D

| Contrôle | Résultat |
|---|---|
| `node --test scripts/*.spec.mjs` | **110 / 110 PASS** |
| `npm run build:prod` | **SUCCÈS** |
| `node scripts/qa-french-ui.mjs` | **PASS** |
| `node scripts/audit-platform-hardcodes.mjs` | **0** |
| `git diff --check` | **propre** |

Deux tests existants ont dû être mis à jour, et c'est normal :
`deployment-governance.spec.mjs` et `zone-label.spec.mjs` vérifiaient la
condition de montage littérale `*ngIf="activeTab === 'deploiement'"`. Leur
intention — un bloc de contenu dédié, piloté par `activeTab`, contenant le
composant de gouvernance — est préservée telle quelle.

```
PRACTICAL_IMPLEMENTATION = FROZEN (maintenu)
POST_FREEZE_FIXES        = 4 × P1 + 1 × écart au système de conception
UI_CONVENTIONS_ADDED     = 1 (déclaration de zone Information / Action)
BACKEND_CHANGES          = 0
PENDING                  = revue visuelle des écrans touchés
```

> **Classement final de la latence de gouvernance Azure : §11.** Elle n'est
> ni un bug ni un P1 — c'est une limite opérationnelle connue et non
> bloquante, atténuée côté interface et documentée avec ses réserves de
> mesure. Elle ne rouvre pas le gel.

---

## 11 — Latence de vérification de la gouvernance Azure

Classement officiel de cette latence, après mesure et après correction de
l'interface.

```
AZURE_GOVERNANCE_REMOTE_VERIFICATION_LATENCY
  = KNOWN_NON_BLOCKING_OPERATIONAL_LATENCY
```

Ce n'est ni un `BUG`, ni un `P0`, ni un `P1`. Les quatre raisons, chacune
vérifiée et non supposée : l'exactitude est préservée, la sémantique de
sécurité est préservée, la vérification distante **aboutit** (artefact
trouvé, provenance vérifiée), et l'utilisateur reçoit pendant l'attente une
information vraie sur ce qui se passe.

### 11.1 — Comportement mesuré

| Endpoint | Latence mesurée |
|---|---|
| `GET /api/projects` | ~0,007 s |
| `GET /dashboard/security-global` | ~0,020 s |
| `GET /azure-deploy/ready/:id` | ~0,006 – 0,023 s |
| `GET /dashboard/jenkins-global` | ~0,047 s *(après la correction de configuration P1-C ; ~5,0 s avant)* |
| `GET /azure-deploy/governance/:id` — `app-test-pfe-vermeg` | **~12,44 s** |
| `GET /azure-deploy/governance/:id` — `pfe-app-test` | **~10,69 s** |

Côté agent :

| Opération | Latence mesurée |
|---|---|
| `/resolve-digest` | ~4,88 s |
| `/inspect-artifact` | ~5,92 s |

### 11.2 — Ce que les mesures établissent

**Seuls les projets ayant un artefact publié paient la vérification
longue.** Les trois projets sans artefact répondent en 8 à 17 ms sur le
même endpoint. La latence est donc strictement corrélée à la présence
d'un artefact à vérifier, pas à l'écran ni au projet.

**La vérification distante est intentionnelle et porte la sécurité.** Elle
interroge l'état réel du registre pour résoudre l'empreinte immuable de
l'image et lire ses étiquettes. C'est ce qui empêche une décision de
gouvernance d'être rendue sur une copie locale potentiellement périmée. La
supprimer ou la contourner reviendrait à affaiblir la garantie que la
plateforme existe pour tenir.

### 11.3 — Ce que les mesures n'établissent PAS

Deux réserves explicites, parce qu'une mesure mal lue envoie la prochaine
optimisation dans le vide.

**L'enchaînement des deux opérations n'est pas prouvé.** La somme
4,88 + 5,92 ≈ 10,8 s **recouvre approximativement** la latence observée.
C'est une corrélation de durées. L'enchaînement n'a pas pu être lu dans le
binaire en service, et n'est donc **pas** affirmé.

**La région Azure n'est pas la cause démontrée.** Le registre ACR répond en
~341 ms et l'API de gestion Azure en ~356 ms. Le trajet réseau et la région
ne peuvent donc pas, à eux seuls, expliquer des secondes. Le coût se situe
ailleurs — entre l'invocation de l'agent et ces réponses — et **n'a pas été
profilé**. Changer de région sur cette base serait une correction à
l'aveugle.

### 11.4 — Atténuation côté interface (déjà en place)

| Mesure | État |
|---|---|
| État de chargement **nommé** : ce qui est attendu est écrit | fait |
| Plus de squelette muet se lisant comme une interface figée | fait |
| **Aucune décision affichée avant la fin de la vérification** | fait |
| Activation **paresseuse** : montage à la première ouverture de l'onglet | fait |
| **Aucun préchargement** à l'entrée sur un projet | fait |
| Résultat conservé tant que le composant reste monté | fait |
| « Réévaluer » comme chemin explicite vers une décision fraîche | fait |

**Distinction à ne jamais perdre de vue :**

```
réutilisation d'affichage  ≠  autorité de cache de gouvernance
```

Le composant conserve le résultat qu'il a **déjà obtenu du serveur**,
exactement comme s'il était resté affiché à l'écran. Il ne recalcule rien,
ne déduit rien, ne prolonge la validité de rien. **Le serveur reste la
seule autorité de la décision de gouvernance**, et « Réévaluer » est le
moyen de la lui redemander.

### 11.5 — Optimisations futures (aucune implémentée)

Pistes enregistrées pour plus tard. **Aucune n'est engagée ici**, et aucune
ne doit l'être sans la preuve que chacune réclame.

**Piste A — paralléliser les deux vérifications distantes**, *si et
seulement si* une inspection du code source prouve qu'elles sont
indépendantes et que les paralléliser est sûr.

Gain théorique maximal, d'après les durées observées :

```
max(4,88 s ; 5,92 s)   et non   4,88 s + 5,92 s
```

Soit un plancher aux alentours de **6 s**, pas moins d'une seconde. Toute
promesse de passer sous la seconde par ce seul levier serait fausse.

**Piste B — remplacer les contrôles Azure répétés en ligne de commande** par
une intégration plus directe, ou par un client / une session à durée de vie
plus longue. **Après** avoir profilé d'où vient réellement la latence, pas
avant.

**Piste C — profiler le coût de démarrage de processus, d'authentification
et de la CLI** avant d'envisager tout changement de région Azure. L'ordre
compte : mesurer, puis décider.

### 11.6 — Qualification

```
MEASURED_GOVERNANCE_LATENCY        = 10,69 – 12,44 s pour les projets
                                     exigeant la vérification d'un
                                     artefact publié
REMOTE_VERIFICATION_FUNCTIONAL     = YES
SECURITY_GUARANTEES_PRESERVED      = YES
UI_WAIT_STATE_EXPLICIT             = YES
REPEATED_TAB_RELOAD_AVOIDED        = YES
PREFETCH_ADDED                     = NO
BACKEND_OPTIMIZATION_IMPLEMENTED   = NO
BACKEND_REWORK_REQUIRED_FOR_FREEZE = NO
KNOWN_NON_BLOCKING_LIMITATION      = YES
PRACTICAL_IMPLEMENTATION           = FROZEN

FINAL_VERDICT = A — PRACTICAL_IMPLEMENTATION_REMAINS_FROZEN
```

**Le gel tient.** Cette latence ne le rouvre pas : seuls des défauts P0/P1
reproductibles le peuvent, et celui-ci n'en est pas un — il n'y a ni perte
d'exactitude, ni perte de garantie, ni information fausse affichée.

### 11.7 — Deux corrections de formulation apportées à ce rapport

Signalées parce qu'elles portaient sur des affirmations **à moi**, et
qu'elles auraient mal orienté la suite :

1. J'avais écrit que les deux opérations de l'agent étaient « successives ».
   La mesure ne le prouve pas — seule la somme des durées concorde. Reformulé
   en corrélation, et la réserve est désormais explicite.
2. J'avais attribué la latence à la région **France Central**, ici et dans
   deux commentaires de code. Les mesures la contredisent : registre et API
   Azure répondent en quelques centaines de millisecondes. L'attribution est
   retirée du rapport **et des deux commentaires**, remplacée par le constat
   exact — la cause n'est pas établie.

Aucun comportement n'a changé dans ces corrections : uniquement du texte de
rapport et deux commentaires de code.
