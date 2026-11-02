# Correction du lancement OWASP / Trivy — 23 octobre 2026

## Cause confirmée

Le service déployé dans `local/pfe-depfix-autoclassify:20261022` appelle
`assertSecurityRemediationDispatchEnabled` depuis `launchBatchRemediation`
et `retrySecurityRemediation`. Le module de cycle de vie livré dans cette
image n'exportait pas cette fonction. Les requêtes échouaient avec un
TypeError HTTP 500 avant toute réservation ou transmission WF6.

## Correctif déployé

Image : `local/pfe-security-dispatch:20261023`
ID : `sha256:af46aab7cfc461e86cd0069a60770948df73b6e914bf382469c6f6d4eab20e50`

Superposition du module déployé existant, avec ajout du seul export manquant
et du corps de la fonction déjà présent dans la source TypeScript locale.
Les autres fonctions du module sont conservées. Le fichier de configuration
`docker-compose.r99.yml` référence la nouvelle image.

Le Dockerfile exécute `verify-dispatch.cjs` : tous les exports de cycle de
vie appelés par le service doivent exister ; le garde doit accepter les
valeurs autorisées et refuser les autres avec le code de maintenance 503.
Le test invoque également la méthode de lancement du service déployé avec
un dépôt simulé pour prouver qu'elle franchit le garde.

## Vérifications effectuées après déploiement

- Même test de contrat réussi dans le conteneur actif.
- POST via le proxy frontend, lot vide sur le projet existant : HTTP 400,
  « Au moins une CVE doit être sélectionnée. »
- POST via le proxy frontend, retry d'une tâche inexistante : HTTP 404,
  « Tâche de correction introuvable. »
- GET tâches OWASP via le proxy frontend : HTTP 200, 295 éléments.
- GET tâches Trivy via le proxy frontend : HTTP 200, 182 éléments.
- Backend redémarré ; aucun TypeError observé pendant ces vérifications.

Aucune correction réelle ni PR créée par ces tests. Ils valident le
rétablissement des routes et du contrat de lancement, pas un cycle WF6
complet avec build, scan et création de PR.

Suite source complémentaire `security-remediation-bridge.spec.ts` :
35/36 tests réussis. Le test G4 échoue dans son mock de lecture
(`this.incidents.findOne is not a function`), hors du garde corrigé.
La lecture des deux scanners dans le service déployé réussit (voir ci-dessus).

## Retour arrière

Remettre `local/pfe-depfix-autoclassify:20261022` dans
`docker-compose.r99.yml`, puis :

```sh
docker compose -f docker-compose.yml -f docker-compose.r99.yml up -d --no-deps backend-r99
```

L'image précédente est conservée. Elle réintroduit le TypeError identifié.

## Deuxième blocage et correctif complet (r2)

Une sélection non vide atteignait ensuite un deuxième export absent :
`productionTarget` du module `remediation-target-reservation`. Le contrôle
précédent avec un lot vide ne couvrait pas ce chemin. Logs observés à
00:08:12 et 00:08:17 le 23 octobre 2026.

Image finale : `local/pfe-security-dispatch:20261023-r2`
ID : `sha256:726ff3a314af7829e65dc95e142fadf53919de21dfa871747b0e933c2b87f532`

Ajout de l’adaptateur `productionTarget`, qui valide les coordonnées Maven
puis utilise le `canonicalTarget` de l’image qualifiée. Celui-ci conserve
ses champs `targetType=FILE` et `trustedTargetPath=pom.xml`, absents de la
version source locale : le module déployé entier n’est donc pas remplacé
par une compilation locale incompatible.

L’image exécute désormais un audit récursif de tous les exports importés
par le service de remédiation : 27 modules vérifiés, aucun export absent.

Test après déploiement sur la vraie base applicative : lancement par la
méthode réelle du service, puis exception volontaire dans la transaction
après retour du callback, avant commit et avant appel du dispatcher WF6.

| Scanner | Tâche | CVE | Résultat |
| --- | --- | --- | --- |
| OWASP | 52a6a76d-ea4e-4d86-9329-adc1adbf9425 | CVE-2023-24998 | Réservation + liaison tentative OK, rollback OK |
| TRIVY | c06070fe-f039-44ff-9d39-f9de8e988ea8 | CVE-2026-54514 | Réservation + liaison tentative OK, rollback OK |

Dans les deux cas, la tâche relue après rollback était identique à l’état
initial et aucune réservation active pour cette tâche ne subsistait.
Zéro dispatch WF6. Test conservé dans `rollback-check.cjs`.
