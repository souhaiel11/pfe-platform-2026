# TRIVY + OWASP — runbook de bascule coordonnée

**Préparé en Phase 4A, non exécuté.** Toute opération live nécessite l’autorisation de la phase de bascule. Ne pas lancer de remédiation réelle ni de retry E2E dans ce runbook. Ne pas modifier WF2, les états des tâches, les volumes, les credentials ou les relations propriétaire/projet. Ne pas créer de branche/PR.

## Préparation et preuves à figer

- Geler les autres déploiements pendant la bascule. Repasser les gates backend, WF6 et frontend sur les sources/artifacts exacts; les fichiers hors périmètre présents dans le workspace ne constituent pas automatiquement un périmètre de release approuvé.
- Préparer et approuver une image backend immutable contenant le pont, puis renseigner `SECURITY_REMEDIATION_RELEASE_IMAGE` avec cette référence vérifiée. Ne pas reconstruire implicitement depuis un workspace en cours de modification.
- Cible WF6 unique : `RdYyfjVpOm2LxS95`, baseline `125eb57e-ac69-4632-bf60-490ff5736d5b`, fichier `n8n-workflows/pending-live-update/WF6-SAFE-ATTEMPT-LIFECYCLE.OFFLINE.json`. Figer son SHA-256 et ses contenus exécutables avant import.
- WF2 protégé : `u3eeMwTuhCsetfcS`. Extraire fraîchement sa version active et son hash fonctionnel; les références de Phase 4 ne remplacent pas une extraction fraîche.
- Construire le frontend avec `npm run build:offline` uniquement, garder le répertoire `/tmp` affiché par `OFFLINE_BUILD_ARTIFACT`, et figer le manifeste de ses fichiers. **Le répertoire frontend/dist/devsecops-frontend/browser est monté dans nginx : ne jamais y construire pendant le preflight.**
- Sauvegarder les références des containers/images actuels, le bundle réellement servi (lecture du conteneur), WF6 actif et son historique, sa relation projet/propriétaire et ses références de credentials. Conserver les valeurs secrètes dans le mécanisme de sauvegarde sécurisé existant, jamais dans les rapports. Préparer les retours backend/WF6/frontend et leurs hashes.
- Inventorier, en lecture seule, les tâches legacy DISPATCHING. Identifier et documenter les historiques ambigus (batch legacy déjà réutilisé) : le pont les refuse. Ne pas les modifier pour les rendre compatibles.

## A — Bridge backend avec admissions fermées

1. Snapshot n8n frais, cohérent et read-only : zéro `running`, `waiting` et `new`/queued pertinent, pour tous les workflows. Si une exécution importante existe, STOP; ne pas la cancel.
2. Vérifier que l’image approuvée contient les nouveaux guards et le pont, et que les références de retour sont disponibles.
3. Déployer seulement le backend avec l’override maintenance. Les admissions de l’ancien backend cessent avec son remplacement; tout ancien résultat déjà en vol reste soumis aux guards legacy du pont.

Commande à exécuter seulement dans la phase live autorisée, depuis la racine du projet :

```sh
docker compose --project-name platform -f docker-compose.yml -f docs/qa/trivy-owasp-compatibility-bridge/backend-maintenance.override.yml up -d --no-deps --no-build --pull never --force-recreate backend
```

L’override exige `SECURITY_REMEDIATION_RELEASE_IMAGE` et injecte `SECURITY_REMEDIATION_DISPATCH_ENABLED=false`. Ne pas utiliser le Compose de base seul pendant cette fenêtre : le défaut applicatif est true. Ne pas appliquer cet override à n8n ni au frontend.

## B — Vérifier la maintenance, sans finding réel

1. Vérifier container/process/route health selon les probes de l’installation. Lire uniquement la valeur de `SECURITY_REMEDIATION_DISPATCH_ENABLED`; ne pas exporter tout l’environnement.
2. Un POST retry non authentifié sur un UUID fictif bien formé doit retourner 401.
3. Vérifier la fermeture des admissions avec un utilisateur développeur/admin authentifié et des UUID **bien formés dont l’absence en base a été confirmée par SELECT read-only** :
   - `POST /api/manual-remediation/launch-batch` avec projectId et findingTaskIds fictifs;
   - `POST /api/manual-remediation/:id/retry` sur l’id fictif, body `{}`.
4. Ces deux probes doivent retourner 503 et `code=SECURITY_REMEDIATION_TEMPORARILY_DISABLED`. Les UUID inexistants évitent une remédiation réelle même si le gate est mal configuré : le service doit alors s’arrêter sur une ressource absente. Ne jamais utiliser les CVE/tâches réelles pour cette probe.
5. Vérifier, par SELECT read-only avant/après, qu’aucune tentative ou batch n’a été réservé. Lire les APIs normales sur un projet déjà pourvu de tâches persistées (la liste historique peut effectuer un backfill pour un projet vide; éviter ce cas dans les probes read-only).
6. Repasser les fixtures v1/v2 contre le code exact de l’image; aucun callback live artificiel ne doit compléter une vraie tâche.

Si les admissions ne sont pas fermées ou les reads/guards ne sont pas corrects : conserver la maintenance et STOP, puis appliquer le retour backend approuvé. Ne pas promouvoir WF6.

## C — Promouvoir uniquement WF6

1. Refaire un snapshot read-only des exécutions n8n juste avant l’import : zéro running/waiting/queued pertinent. Toute exécution legacy arrivée avant la fermeture des admissions doit être terminée; ne pas en créer pour tester le pont.
2. Vérifier encore WF2, le nombre de workflows, WF6 baseline, propriétaire/projet et credentials.
3. Importer la cible dans **le même workflow ID** via le mécanisme approuvé de l’installation. Aucun clone. Aucun remplacement de volume/DB.
4. Obtenir le `versionId` généré par l’import et extraire cette version avant publication. Il doit identifier la version importée; ne pas republier la baseline par erreur.
5. Comparer nodes/parameters, connexions, credentials et settings de la version importée à l’artifact approuvé : zéro mismatch. Les seules métadonnées générées par n8n sont autorisées; elles ne remplacent pas le contrôle du contenu.
6. Publier explicitement ce `versionId` généré. Redémarrer n8n uniquement si cette installation l’exige pour rafraîchir la version active ou les registrations. Ne jamais supprimer un volume.
7. Vérifier immédiatement une seule occurrence de WF6, les registrations du webhook, les relations projet/propriétaire, et WF2 strictement inchangé.

En cas de mismatch ou de registration incorrecte, rester en maintenance, restaurer WF6 via son export/version de retour approuvé, vérifier l’état restauré, puis STOP.

## D — Contrat moderne extrait live, toujours sans remediation

- Extraire l’actif WF6 après publication, sans appeler son webhook.
- Exécuter les tests/expressions sur cette extraction : attemptId, attemptNumber et batchId présents dans tous les callbacks et requêtes évaluation/revalidation; comparaison exacte avec l’artifact approuvé.
- R95 EVALUATION_FAILED reste webhook/$json-only, sans dépendance à Trusted Candidate; candidate validation, planner, guards Git et PR inchangés.
- Repasser la compatibilité moderne du backend sur fixtures; vérifier workflow count, webhook count/owner et WF2.
- Le backend reste avec le flag false. Aucune tentative test ne peut être lancée.

## E — Ouvrir les admissions modernes

Uniquement si B, C et D sont tous prouvés, recréer le **même backend immutable** avec l’override enabled :

```sh
docker compose --project-name platform -f docker-compose.yml -f docs/qa/trivy-owasp-compatibility-bridge/backend-enabled.override.yml up -d --no-deps --no-build --pull never --force-recreate backend
```

Vérifier flag=true et health. Vérifier le chemin moderne avec tests/fixtures de l’image, pas avec un finding production. Aucun dispatch legacy ne doit être créé : le seul chemin de réservation génère UUID de tentative, numéro unique et batch frais.

## F — Frontend Phase 3 en dernier

- Revalider les 38 tests Phase 3 et 24 suites existantes, puis construire seulement avec `npm run build:offline` si un nouveau build est nécessaire.
- Promouvoir volontairement le bundle `/tmp` validé vers le montage nginx, assets d’abord, index en dernier. Ne pas reconstruire dans le montage live.
- Relire les fichiers depuis le conteneur nginx et comparer leur manifeste SHA-256 à celui du build Phase 3. Ne pas se contenter du fichier index ou du répertoire hôte.

## G — Vérification serveur/UI sur données existantes

- CVE-2022-38749 et CVE-2022-38751 restent visibles; WF6_STALE_DISPATCH_RECONCILED sans raison sous-jacente temporaire préservée ne donne aucun retry aveugle.
- `CLOSED` WF6 seul n’est jamais « Vulnérabilité corrigée ». Seul VERIFIED ET NOT_DETECTED donne la ligne grisée, visible et read-only, pour Trivy comme OWASP.
- Vérifier l’union des findings de scan et des tâches persistées : absence de doublons, historiques corrigés présents, identités exactes. Une ambiguïté ne doit pas être compensée par un matching approximatif.
- Vérifier les six compteurs/tabs : À corriger / En cours (DISPATCHING) / Proposées / Échecs retryables / Corrigées projet-vérifiées / Manuel. Aucun double comptage.
- Si dispatching=0, aucune bannière de traitement en cours. Aucun retry pour unknown/retryable=false, plafond atteint ou effet Git/PR non résolu.
- Aucune mutation de task, aucun webhook/remediation/retry réel pour vérifier ces états.

## H — Autorisation E2E séparée

Après stabilité de la release et passage des contrôles G, retourner READY_FOR_REAL_RETRY_E2E=YES comme proposition. Attendre l’autorisation explicite d’une phase E2E distincte avant de lancer un retry réel.

## Retour coordonné

Fermer d’abord les admissions avec le bridge en maintenance, puis vérifier les exécutions et résultats attendus avant toute restauration. Le couple ancien backend + WF6 moderne n’est pas un fallback sûr. Ne pas remettre l’ancien backend alors qu’un résultat moderne est encore attendu. Si des tentatives modernes existent, les laisser finir via le bridge ou les auditer; ne pas modifier/cancel leur état manuellement.

Pour un retour complet approuvé après drainage : restaurer WF6 baseline en gardant le bridge en maintenance, vérifier l’extraction/registrations/WF2, puis restaurer l’ancien backend et le bundle frontend sauvegardés comme couple cohérent. Si ce drainage ne peut pas être prouvé, garder les admissions fermées et STOP.

## Retrait ultérieur du v1

Le retrait se fait dans une release distincte, jamais pendant cette bascule. Conditions cumulatives : zéro tâche courante legacy DISPATCHING (y compris les lignes ambiguës à traiter séparément par une procédure autorisée); WF6 moderne stable; aucune exécution R95 running/waiting/queued ni callback ancien encore attendu; historique d’exécution audité; intervalle de sécurité écoulé.

Cet intervalle doit couvrir le maximum vérifié des deadlines de l’ancien WF6/worker, cleanup et délais de livraison/retry des callbacks, avec une marge opérationnelle documentée. Si une borne est inconnue, le retrait reste bloqué; ne pas inventer un délai fixe. Une fois les conditions prouvées, retirer le chemin v1 (ou conserver le garde uniquement avec justification et date de revue), tout en conservant la lecture des historiques JSONB. Un doublon terminal v1 accepté par le pont est un no-op, jamais une autorisation de compléter une nouvelle tentative.
