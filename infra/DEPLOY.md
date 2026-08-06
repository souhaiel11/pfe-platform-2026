# État du déploiement Azure — devsecops-testbed

## Ce qui est prouvé aujourd'hui (2026-08-06)

- Infra durable (Terraform, `infra/terraform/`) : resource group `rg-pfe-devsecops`
  + ACR `acrpfedevsecops` (Basic) créés en `francecentral`, vérifiés `Succeeded`
  côté Azure (pas juste déclarés par Terraform).
- Image `devsecops-testbed:latest` buildée et poussée avec succès sur l'ACR.

Le run ACI reste à valider — voir ci-dessous.

## Échec du déploiement ACI

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

- [ ] Corriger l'image de base Java du testbed (ou recompiler en ciblant Java 8 —
      décision à prendre : voir options discutées en session)
- [ ] Relancer `az container create` sur l'image corrigée, en privé, port 8080
- [ ] Prouver le démarrage (logs Spring Boot + `/api/health` via `az container exec`)
- [ ] Documenter le run ACI réussi ici une fois obtenu
