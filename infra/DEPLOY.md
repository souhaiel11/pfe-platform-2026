# État du déploiement Azure — devsecops-testbed

## Ce qui est prouvé aujourd'hui (2026-08-06)

- Infra durable (Terraform, `infra/terraform/`) : resource group `rg-pfe-devsecops`
  + ACR `acrpfedevsecops` (Basic) créés en `francecentral`, vérifiés `Succeeded`
  côté Azure (pas juste déclarés par Terraform).
- Image `devsecops-testbed:latest` (originale, vulnérable) buildée et poussée
  avec succès sur l'ACR.
- **Déploiement ACI prouvé sur image à base cohérente (`eclipse-temurin:11`) —
  Spring Running, 0 crash.** L'image vulnérable originale (base Java 8) crashe,
  comme attendu. Détail dans "Fondation prouvée" ci-dessous.

## Fondation prouvée : ACI Running sur image corrigée séparée

Pour prouver que la chaîne Azure (ACR → ACI privé) fonctionne réellement, sans
toucher au dépôt `devsecops-testbed` (le Dockerfile original vulnérable reste
la cible des scans Trivy, inchangé), un Dockerfile de test **temporaire** a été
créé hors de ce dépôt : `infra/docker/Dockerfile.fixed-base-testbed`. Seule
différence avec l'original : `eclipse-temurin:11-jre` au lieu de
`eclipse-temurin:8-jdk`, cohérent avec le bytecode Java 11 du jar. Même jar
réutilisé (`target/devsecops-testbed-1.0.0.jar`), aucun fichier de
`devsecops-testbed` modifié.

Image poussée sous un tag distinct : `acrpfedevsecops.azurecr.io/devsecops-testbed:fixed-base-1.0.0`.
L'ACR contient les deux tags (`latest` = vulnérable, `fixed-base-1.0.0` = corrigée).

Conteneur ACI de preuve (`aci-devsecops-testbed-fixed`, privé, `ipAddress: null`,
port 8080, cpu 1 / mémoire 1 Go) :

- État sur 45s (9 checks à 5s d'intervalle) : **`Running` en continu**, jamais `Terminated`.
- `restartCount` : **0** — pas de crash-loop.
- Logs : `Started TestbedApplication in 9.285 seconds`, Tomcat sur le port 8080,
  **aucun `UnsupportedClassVersionError`**.
- `/api/health` testé depuis l'intérieur du conteneur (`az container exec`, pas
  d'IP publique) → **`{"status":"UP"}`**.

Conteneur de preuve arrêté puis supprimé après vérification (pas de coût résiduel).

## Échec du déploiement ACI sur l'image originale (non corrigée)

Le conteneur ACI (`aci-devsecops-testbed`, privé, pas d'IP publique) crash au
démarrage avec :

```
UnsupportedClassVersionError: com/vermeg/testbed/TestbedApplication has been
compiled by a more recent version of the Java Runtime (class file version 55.0),
this version of the Java Runtime only recognizes class file versions up to 52.0
```

Cause : le `Dockerfile` de `devsecops-testbed` utilise `eclipse-temurin:8-jdk`
alors que le code est compilé en Java 11 (`pom.xml` : `java.version=11`). C'est
une des failles **volontaires** du testbed (image de base obsolète, détectable
par Trivy) — mais son auteur n'avait pas remarqué qu'elle rend le jar
inexécutable. Reproduit à l'identique en local (`docker run`), donc indépendant
d'Azure/Terraform/ACI.

## Conséquence pour la démo

La version **non corrigée** ne peut pas tourner — ce qui est cohérent avec le
principe : on ne déploie pas de code vulnérable tel quel. Le déploiement ACI
fonctionnel sera prouvé sur la version **corrigée** (image de base Java 11+),
après passage par la plateforme DevSecOps.

## Reste à faire

- [x] Prouver que la chaîne ACR → ACI privé fonctionne (fait via l'image
      `fixed-base-1.0.0`, voir ci-dessus)
- [ ] Décider comment corriger `devsecops-testbed` pour de vrai (recompiler en
      ciblant Java 8 pour garder l'image de base volontairement vulnérable, ou
      changer l'image de base — décision à prendre, voir options discutées en
      session)
- [ ] Une fois `devsecops-testbed` corrigé dans son propre dépôt, rejouer le
      déploiement ACI sur l'image officielle (pas le tag `fixed-base-1.0.0` de
      test) et documenter ici
