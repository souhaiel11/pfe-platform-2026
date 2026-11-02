WF6 V1.5.1 — revue de pré-déploiement hors ligne

Les trois blocages sont fermés. Le workflow reste inactif. Aucun commit, push, import n8n, appel de webhook live, écriture GitHub, lancement Jenkins/scanner ou déploiement n’a été effectué. Les modifications préexistantes hors WF6 sont préservées.

La base de PR provient exclusivement de `GET /repos/{repository}` avec l’identité fournie par le backend. Le workflow lit son SHA, puis compare `evaluatedSha...defaultBranchTipSha`. Seuls `ahead` et `identical`, avec les SHA de base et de merge attendus, sont acceptés. La résolution est répétée avant PR ; un changement de nom de branche, une histoire incompatible ou une erreur provoque un échec fermé. Les métadonnées GitHub ne sont jamais fusionnées avec le candidat.

La revalidation compare aussi les champs d’autorité et les octets frais, au-delà de la seule identité. Avant PR, les arbres Git immuables doivent correspondre partout sauf au fichier autorisé ; son blob doit correspondre exactement au candidat. Les arbres tronqués sont refusés. Une dernière lecture vérifie que la branche de sécurité est restée sur le commit inspecté. GitHub ne fournit pas de verrou atomique entre ces lectures et le POST de PR : la garantie est celle des preuves fraîches dans la même exécution, pas un verrou contre toute écriture concurrente ultérieure.

Chaque sortie est un `Respond to Webhook` à corps limité. Les réponses HTTP complètes conservent notamment les listes de PR vides ; les erreurs HTTP/transport et les erreurs de validation aboutissent à une réponse sûre. Une collision de création de branche renvoie `TECHNICAL_FAILURE / BRANCH_CREATE_FAILED`, sans relance. Un échec de transport d’écriture n’est jamais traité comme un succès.

La sanitation ne modifie que la présentation : valeurs malformées, contrôles, séparateurs Markdown et chaînes trop longues deviennent des libellés fixes. Les coordonnées, versions et octets utilisés par la remédiation restent intacts. Les sujets et titres sont bornés à 236 caractères.

Les tests WF6 exécutent les expressions et les nœuds Code du JSON généré, avec uniquement le transport HTTP simulé. La traversée structurelle examine tous les chemins terminaux. Les compteurs backend/vérificateur désignent des fichiers de spécifications complets ; les compteurs WF6/compatibilité désignent des tests nommés.

La régression a utilisé des copies temporaires des sources et du dépôt fixture. Seuls les chemins absolus du dépôt fixture ont été relocalisés ; les assertions sont conservées. Les clones/fetch Git utilisent des dépôts locaux, Maven utilise `-o` et un cache copié. Les échecs EPERM du sandbox ont été relancés avec autorisation. Deux références attendues par les anciens tests ont été restaurées uniquement dans le clone temporaire.

L’audit n8n utilise les sources de la version installée 2.14.2, copiées en lecture seule. Les versions existantes HTTP 4.2, IF 2.2, Webhook 2 et Respond 1.1 restent inchangées ; les nouveaux validateurs utilisent Code 2. Il s’agit d’une compatibilité statique, pas d’un essai live.

```text
PREDEPLOY_REVIEW = PASS
BLOCKERS = []
BLOCKER_1_PR_BASE = CLOSED
BLOCKER_2_WEBHOOK_TERMINALS = CLOSED
BLOCKER_3_METADATA_SANITIZATION = CLOSED
WF6_OFFLINE_ARTIFACT = IMPLEMENTED
HASH_1 = 2958774ef8b0aee54328816f94b68647c5a5d3d528bf7f6b4cf44da5d18bb4a4
HASH_2 = 2958774ef8b0aee54328816f94b68647c5a5d3d528bf7f6b4cf44da5d18bb4a4
BYTE_IDENTICAL = YES
WF6_ACTIVE = NO
WF6_NODE_COUNT = 104
PR_BASE_TRUSTED = YES
ANCESTRY_PROVEN = YES
EXACT_BASE_SHA_BRANCHING = YES
POST_REVALIDATION_RACE_SAFE = YES
EVERY_TERMINAL_RESPONDS = YES
SECRET_HANDLING = PASS
EXACT_REMOTE_CONTENT_REQUIRED = YES
METADATA_SANITIZATION = PASS
CALLER_PATCH_AUTHORITY = NONE
LLM_PATCH_AUTHORITY = NO
N8N_2_14_2_STATIC_COMPATIBILITY = PASS
BACKEND_TESTS = 67/67 spec files
CANDIDATE_VERIFIER_TESTS = 23/23 spec files
WF6_TESTS = 67/67 tests
N8N_COMPATIBILITY_TESTS = 9/9 tests
BACKEND_TSC_NO_EMIT = PASS
CANDIDATE_VERIFIER_TSC_NO_EMIT = PASS
GIT_DIFF_CHECK = PASS
WF2_CHANGED = NO
REMEDIATION_ROUTING_CHANGED = NO
LIVE_N8N_CHANGED = NO
LIVE_GITHUB_WRITE = NO
DEPLOYED = NO
COMMITTED = NO
PUSHED = NO
READY_TO_COMMIT_WF6 = YES
REACHABLE_TERMINAL_COUNT = 76
TERMINALS_WITH_RESPONSE = 76
TERMINALS_WITHOUT_RESPONSE = 0
MULTIPLE_RESPONSE_PATHS = 0
CONCURRENT_BRANCH_CREATE_BEHAVIOR = CLEAN_TECHNICAL_FAILURE_NO_RETRY
UNRELATED_FILES_VERIFIED_UNCHANGED = 674
```

Exemple de preuve **simulée**, sans lecture GitHub live :

```text
PR_BASE_BRANCH = release/stable
PR_BASE_HEAD_SHA = bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
EVALUATED_SHA = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
ANCESTRY_COMPARE_DIRECTION = evaluatedSha...defaultBranchTipSha
ANCESTRY_STATUS = ahead
ANCESTRY_VALID = YES
```

Les empreintes des sources n8n, des fichiers livrés, des 674 fichiers préservés et les 90 résultats de spécifications figurent dans [le rapport JSON](WF6-V1.5.1-PREDEPLOY-REVIEW.json).
