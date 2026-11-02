# Chaîne Azure — mise à jour du 14 octobre 2026

## Changements actifs

- Librairie Jenkins : `main` confirmé sur GitHub à `8bcface0168254dc5179616562de48b1ad9db227`, contenant la publication ACR. Le checkout voisin est en retard : il n'a pas été réinitialisé.
- Backend : `local/pfe-azure-chain:20261014`, image `sha256:c7c57ffb87b189eb4e5b99277db20ecb056d034953be20006780444706007f36`. Superposition de deux fichiers JavaScript sur le runtime qualifié `local/pfe-build-view:20261012` (`sha256:9be7a2089553802cbe20bca553e125e8967362b613965f3f7b4b60bc0a273ab7`). Les autres modules, notamment R59, sont conservés.
- Création de projet : attribution d'une cible depuis les défauts de plateforme, slug normalisé, refus des collisions ; verrou transactionnel PostgreSQL partagé par création et mise à jour. Une configuration explicitement `null` conserve le choix de ne pas avoir de cible.
- Réglages : création possible d'une configuration Azure précédemment absente ; tous les champs obligatoires doivent être remplis.
- Agent : sans contrat HTTP, connexion TCP depuis l'hôte vers l'IP publique ACI et le premier port déclaré. Aucune dépendance à curl/wget dans l'image pour ce mode. Les créations ACI demandent explicitement une IP publique ; les cibles privées ne sont pas prises en charge par cette sonde. Un contrat HTTP explicite conserve sa vérification existante.
- nginx : résolution Docker dynamique du nom `backend`, pour supporter le remplacement de son conteneur.
- Frontend : `frontend/releases/azure-chain-20261014/browser`. Par rapport à la publication précédente, seuls le chunk des réglages, le point d'entrée et l'index changent. Les anciens chunks sont conservés pour les onglets déjà ouverts.

Les défauts locaux non secrets sont configurés dans `.env` : groupe `rg-pfe-devsecops`, registre `acrpfedevsecops`, port `8080`. Les deux services backend des fichiers Compose transmettent ces variables. Un autre port doit être déclaré par le projet ou configuré au niveau plateforme.

## Contrôles réalisés

- Build NestJS réussi ; build Angular production réussi, avec l'avertissement de budget CSS préexistant sur project-detail.
- Tests Python : 22 réussis, plus les contrôles de digest du script existant. Une vraie socket locale vérifie un service TCP sans protocole HTTP.
- Tests TypeScript : dérivation et raccordement du service, configuration de santé, provenance d'artefact et preuve de publication réussis.
- Image démarrée sur une instance séparée, port 3002, avant bascule.
- Contrôles API sur l'instance de validation puis sur le backend actif : créations concurrentes de noms de même slug => 201/409 ; défauts Azure présents ; aucun healthCheck inventé ; opt-out explicite ; partage de cible refusé ; création manuelle de configuration ; port invalide refusé ; mise à jour de sa propre cible acceptée.
- Les projets temporaires ont été supprimés ; nombre de projets inchangé.
- API : documentation 200, accès anonyme aux projets 401. Le runtime qualifié ne possède pas `/api/healthz` (404), cette route n'est pas utilisée comme preuve de santé.
- nginx : configuration valide, index et nouveau chunk servis, documentation API accessible via le proxy.
- Agent actif après redémarrage ; `/session-status` répond 200 avec `valid: true`, sans divulgation de secret.

## Périmètre et limites

Aucun nouveau build Jenkins ni déploiement ACI réel n'a été déclenché pendant cette validation. Le parcours complet nouveau build → push → provenance → autorisation → ACI reste donc à éprouver sur un build contrôlé. Les contrôles locaux/API ne constituent pas cette preuve.

La comparaison avec le runtime a révélé que ce checkout ne contient pas tous ses modules : le service de réconciliation R59 et certaines corrections d'autorité existent dans l'image active et dans des worktrees voisins. Une reconstruction complète de `backend/` ferait perdre ces fonctions. Cette livraison évite ce risque par superposition ciblée. Aucun second service de provenance n'a été ajouté.

## Retour arrière

1. Dans `docker-compose.r99.yml`, remettre l'image backend à `local/pfe-build-view:20261012`, puis recréer uniquement `backend-r99` avec les deux fichiers Compose habituels.
2. Pour l'interface, remettre le montage frontend précédent : `../frontend-releases/dast-coverage-20261013/browser:/usr/share/nginx/html:ro`, puis recréer uniquement `frontend`.
3. Pour l'agent, restaurer `agent-before-tcp.py` sur `infra/azure-deploy-agent/agent.py`, puis redémarrer le service utilisateur `azure-deploy-agent`. Ce fichier conserve les changements initiaux de Claude, avant la vraie sonde TCP.

Le script `infra/azure-chain-release/verify-runtime.cjs` s'exécute dans le conteneur backend, utilise ses variables d'environnement sans les afficher, crée uniquement ses projets temporaires et les supprime dans un bloc de nettoyage.
