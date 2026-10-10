# Diagnostic post-gel — trois signalements

**Date :** 2026-10-10 · après `PRACTICAL_IMPLEMENTATION = FROZEN`
**Méthode :** mesures sur le backend live, sondes réseau depuis le conteneur
`pfe-backend`. Aucun code modifié avant ce diagnostic.

---

## S1 — Latence de la liste des projets : **RÉGRESSION P1 CONFIRMÉE**

Mesures des trois lectures de la liste :

| Endpoint | Temps |
|---|---|
| `GET /api/projects` | **0,007 s** |
| `GET /api/dashboard/security-global` | **0,020 s** |
| `GET /api/dashboard/jenkins-global` | **5,008 s** |
| `GET /api/azure-deploy/ready/:id` (×7) | 0,006 – 0,023 s |

**Cause :** `jenkins-global` touche son plafond de 5 000 ms parce que deux
projets pointent vers une IP hôte injoignable (voir S2). Lors de la passe de
finition, j'ai placé cette lecture **dans le `forkJoin` bloquant** de la
liste des projets, pour alimenter la colonne « Dernier build ». La page
attend donc 5 s avant d'afficher quoi que ce soit — alors que les données
qui comptent sont là en 27 ms.

**C'est une régression que j'ai introduite** : avant la passe, la liste ne
lisait que `/projects` et `/security-global`. Le même défaut existe sur le
tableau de bord, pour la même raison.

**Classement : P1.** Corrigeable sous gel.

---

## S2 — Informations « indisponibles » : **DONNÉE VRAIE + 1 DÉFAUT P1**

Sondes réseau depuis le conteneur backend :

| Cible | Résultat |
|---|---|
| `http://jenkins:8080` (racine) | **HTTP 403** en 22 ms |
| `http://jenkins:8080/job/app-test-pfe-vermeg` | **HTTP 403** en 3 ms |
| `http://jenkins:8080/job/pfe-app-test` | **HTTP 403** en 1 ms |
| `http://172.31.172.61:8082` | **TIMEOUT** (> 6 000 ms) |
| `http://172.26.174.59:8082` | **HTTP 403** en 3 ms |

Croisé avec la configuration réelle de chaque projet :

| Projet | URL Jenkins configurée | Identifiant Jenkins | État réel |
|---|---|---|---|
| `pfe-app-test` | `jenkins:8080` (interne) | **configuré** | **OK** — build #151 SUCCESS |
| `app-test-pfe-vermeg` | `jenkins:8080` (interne) | absent | 403 → indisponible |
| `devsecops-platform-testbed` | `172.26.174.59:8082` | absent | 403 → indisponible |
| `vuln-testapp` | `172.31.172.61:8082` | configuré | **IP injoignable** → timeout 5 s |
| `devsecops-testbed` | `172.31.172.61:8082` | configuré | **IP injoignable** → timeout 5 s |
| `devsecops-remediation-testbed` | — | — | **aucun job Jenkins configuré** |
| `remediation-retry-e2e-fixture` | — | — | **aucun job Jenkins configuré** |

### Ce qui n'est PAS un défaut d'interface

Pour cinq projets sur sept, « indisponible » est **exact**. Jenkins refuse
réellement la lecture (403, identifiant absent) ou l'adresse configurée ne
répond réellement pas (IP hôte WSL périmée). L'interface rapporte un fait,
en tonalité neutre, sans le peindre en échec. C'est le comportement voulu :
corriger l'affichage ici reviendrait à masquer un vrai problème de
configuration.

Ce sont **des corrections de configuration de projet**, pas de code :
rafraîchir l'IP Jenkins de `vuln-testapp` / `devsecops-testbed`, enregistrer
l'identifiant Jenkins de `app-test-pfe-vermeg` /
`devsecops-platform-testbed`. Hors périmètre d'un correctif de gel, et à ta
main.

### Ce qui EST un défaut P1

Les deux projets **sans aucun job Jenkins configuré** sont absents de
`jenkins-global`. Mon `buildCell()` traite cette absence comme un échec de
lecture et affiche :

> « Indisponible — Les données Jenkins n'ont pas été chargées. »

C'est **faux** : rien n'a échoué, Jenkins n'est simplement pas configuré
pour ce projet. J'affirme une panne que je n'ai pas constatée — exactement
ce que §17 et §31 interdisent, et ce que mes propres tests imposent partout
ailleurs. Un état `NOT_CONFIGURED` manque.

**Classement : P1 (vérité des données).** Corrigeable sous gel.

---

## S3 — Boutons Trivy / OWASP : **AUCUN DÉFAUT OBJECTIF**

Il s'agit des pastilles de filtre `Tous · Trivy · OWASP · ZAP` de l'onglet
Sécurité (`.sec-chip`). Vérifications :

| Point | Constat |
|---|---|
| Focus clavier visible | **OK** — `:focus-visible` global (`styles.scss:446`) s'applique |
| Libellé accessible | **OK** — texte visible dans le bouton |
| Contraste à l'état actif | fond `--accent-blue`, texte blanc — lisible dans les deux thèmes |
| Fonctionnement | **OK** — filtre effectivement appliqué |
| `aria-pressed` | **absent** — le groupe n'annonce pas lequel est sélectionné |
| Couleurs | `#fff` et deux `rgba()` en dur au lieu de variables de thème |
| `transition: all .15s` | `all` plutôt que les propriétés visées |

**Rien ici n'est un défaut P0/P1.** `aria-pressed` et les couleurs en dur
sont de vraies petites dettes, mais aucune n'empêche un usage.

### Correction du diagnostic — j'avais regardé le mauvais élément

L'opérateur a précisé : « la partie **action** dans OWASP et ZAP, Trivy ». Il
ne parlait pas des pastilles de filtre, mais des boutons de la **colonne
Action** des tables de scanners. Nouveau diagnostic, et il change la
conclusion :

| Point | Constat |
|---|---|
| `Corriger`, `Réessayer`, `Voir le détail` (`cve-table`) | `<button>` **sans aucune classe** |
| Règle globale pour un `button` nu dans `styles.scss` | **aucune** |
| Rendu effectif | chrome natif du navigateur — hors thème clair/sombre, hors système `.btn` |
| Hiérarchie d'action | **inexistante** : les trois boutons identiques |
| Même défaut ailleurs | suivi manuel (`cve-table`, `zap-table`), « Annuler » des boîtes de confirmation, les trois « Réessayer » des cartes d'erreur |
| Ligne dépliante `zap-table` | cliquable à la souris **uniquement**, sans `role`, sans `aria-expanded` |

**Ce n'est pas esthétique :** c'est un écart au système de conception (§6) et
une absence de hiérarchie d'action (§7), avec un rendu qui ne suit pas le
thème — exactement le type de défaut que la passe de finition était censée
éliminer, et que j'ai manqué parce que ces boutons sont dans des composants
enfants et non dans les gabarits que j'avais audités.

**Classement révisé : écart au système de conception → corrigé**, et
consigné comme levée ciblée du gel sur demande explicite de l'opérateur.

---

## Note de traçabilité — l'inventaire a changé pendant l'intervention

Au moment du diagnostic, `GET /api/projects` renvoyait **7 projets**. Après
la correction, il en renvoie **5** : `devsecops-remediation-testbed` et
`remediation-retry-e2e-fixture` — les deux projets sans job Jenkins, ceux
précisément qui déclenchaient le défaut P1-B — ont été **supprimés de la
base entre les deux mesures** (ce sont des fixtures de test ; la suppression
ne vient pas de moi).

Conséquence à énoncer, pour que personne ne s'y trompe plus tard : le
chemin `NOT_CONFIGURED` **n'est plus exercé par les données live actuelles**,
puisque les cinq projets restants ont tous un job Jenkins. Il reste
nécessaire et il est prouvé par `scripts/post-freeze-p1.spec.mjs`, de façon
déterministe — tout projet créé sans job Jenkins l'empruntera. La trace live
régénérée (`LIVE_DATA_TRUTH_TRACE.txt`) reflète donc 5 projets, pas 7.

---

## Conclusion

| Signalement | Classement | Action |
|---|---|---|
| S1 latence 5 s | **P1 — régression introduite par la passe de finition** | corrigé sous gel |
| S2 absence d'info | **donnée vraie** (4 projets sur 5 restants) **+ P1 de vérité des données** (les 2 projets depuis supprimés) | P1 corrigé et testé ; configuration Jenkins à ta main |
| S3 boutons d'action | **écart au système de conception** (diagnostic initial erroné : j'avais examiné les filtres, pas la colonne Action) | corrigé + testé |
