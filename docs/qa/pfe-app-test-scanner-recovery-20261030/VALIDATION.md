# Récupération des valeurs scanners de pfe-app-test

Le dernier rapport initial (25 octobre, build 163) indiquait Trivy NOT_RUN. Jenkins avait échoué à télécharger aquasec/trivy:latest (connection reset by peer), sans produire de trivy-report.json. OWASP avait terminé avec 41 critiques et 76 élevées ; sa mise à jour NVD avait échoué.

Le 30 octobre : scan local de l’image exacte pfe-app-test:163, image ID et commit vérifiés dans recovery.json. Trivy 0.76.1, bases CVE du 30 octobre 13:06 UTC et Java du 30 octobre 00:58 UTC. Résultat : 15 critiques, 50 élevées, 48 moyennes. Nouveau rapport combiné créé via l’API ; rapport initial conservé. OWASP conservé sans modification ni fausse actualisation de sa base NVD. Statut du build UNSTABLE conservé, aucun build ni déploiement déclenché.

Rapport source ajouté dans le volume partagé : pfe-app-test/main/163/trivy-report.json, avec trivy-recovery.json indiquant explicitement la récupération après le build.

Correctif UI : les totaux CVE Trivy/OWASP disponibles ne sont plus masqués à cause d’un scanner indépendant ZAP absent. Le score de sécurité reste non vérifié tant que ZAP manque.

Contrôles : compilation Angular production ; navigateur authentifié avec pfe-app-test sélectionné, valeurs des deux courbes égales à celles de l’API, tableau 56 critiques et 126 élevées (cumul des sources, sans dédoublonnage), risque 75/100, rendu mobile sans débordement, aucune exception JS.
