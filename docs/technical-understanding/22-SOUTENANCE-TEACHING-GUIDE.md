# 22 — GUIDE DE SOUTENANCE

Quatre niveaux d'explication, puis **56 questions de jury** avec les réponses attendues,
puis la section « À ne pas confondre ».

---

# NIVEAU 1 — L'explication en 2 minutes

> « Une chaîne CI/CD moderne détecte énormément de vulnérabilités. Sur mon projet de
> test, le dernier build en porte 14 critiques côté Trivy et 23 côté OWASP, avec 38
> problèmes bloquants. Détecter n'est pas corriger : le développeur se retrouve devant
> une liste, sans savoir ce qui est corrigeable ni si la correction casse le build.
>
> Ma plateforme automatise le chemin détection → correction → **preuve** → publication.
> Un modèle de langage **propose** une correction ; du code déterministe la **valide**.
>
> Concrètement, la plateforme ne déclare jamais une vulnérabilité corrigée parce qu'une
> IA l'a dit, ni parce qu'une Pull Request existe. Elle le déclare quand le projet patché
> compile réellement, que ses tests passent, qu'une image est réellement construite, et
> que Trivy **et** OWASP confirment sur cette image que la CVE a disparu — et seulement
> alors elle touche à Git.
>
> La phrase qui résume tout : **l'IA propose, le déterminisme décide.** »

**À ne pas dire** : « j'ai fait une plateforme DevSecOps avec de l'IA ». Trop vague, et
ça invite les mauvaises questions.

---

# NIVEAU 2 — L'architecture en 10 minutes

Dessiner **quatre plans**, dans cet ordre.

### 1) Le plan de contrôle (2 min)
Frontend Angular + backend NestJS + PostgreSQL.
« Le backend est la **source de vérité unique**. Il détient tous les secrets, prend
toutes les décisions, et — point important — **n'écrit jamais dans Git lui-même**. »

### 2) Le plan de workflow (2 min)
n8n, 7 workflows actifs, 539 nœuds.
« WF6 fait la remédiation de CVE : 184 nœuds, et **39 portes de validation avant la
première écriture GitHub**. C'est là que vit la capacité d'écrire, séparée de l'autorité
de décider. »

### 3) Le plan d'exécution (3 min) — **le point fort**
« Le `candidate-verifier` exécute du code venant d'un dépôt, donc potentiellement
hostile. Il tourne à **capacité nulle** : pas de base de données, pas de `JWT_SECRET`,
pas de jeton GitHub, aucun port publié. Même compromis, il ne peut rien exfiltrer et
rien écrire.
>
> Le `builder-scanner` est le **seul** à avoir `CAP_SYS_ADMIN`, parce qu'il lui faut
> Podman rootless pour construire l'image — et il ne prend **aucune** décision métier.
>
> Le gradient est inversé : qui décide n'a aucun privilège, qui a un privilège ne décide
> rien. Et aucun `docker.sock` n'est monté nulle part dans le plan de remédiation. »

### 4) Le plan d'outillage (1 min)
Jenkins + DinD, SonarQube, Nexus, Prometheus/Grafana, Ollama.

### La conclusion (2 min)
« Les deux seules flèches qui écrivent à l'extérieur sont WF6 → GitHub et agent → Azure.
On peut donc auditer la sûreté du système en n'examinant que deux arêtes. »

---

# NIVEAU 3 — L'explication technique en 30 minutes

Six blocs de 5 minutes.

| # | Bloc | Le message | La preuve à montrer |
|---|---|---|---|
| 1 | Le vocabulaire | 7 concepts séparés exprès : détection, finding, tâche, tentative, candidat, validation, publication | les **deux** colonnes `status` / `scannerStatus` |
| 2 | La preuve de fermeture | absence de CVE **+** présence positive du paquet corrigé | `provesSecurityClosure()` à l'écran |
| 3 | La barrière pré-Git | 39 portes, 1 prédécesseur par nœud mutant | le canevas WF6 dans n8n |
| 4 | Le retry | identité par tentative, `attemptId` **et** `batchId` neufs | la tâche réelle `a390e383…` |
| 5 | L'écrivain unique | invariant garanti par **PostgreSQL** | `\d remediation_target_reservations` |
| 6 | La gouvernance de déploiement | 4 états, recalcul serveur, TTL, usage unique | la décision `CRITICAL_RISK` et ses 11 motifs |

---

# NIVEAU 4 — LES 61 QUESTIONS DE JURY

## A. Architecture et choix de conception

**Q1. Pourquoi n8n, si le backend peut orchestrer ?**
Trois raisons. (1) Séparation des privilèges : les écritures GitHub vivent dans n8n, pas
dans le backend ; la capacité d'écrire est séparée de l'autorité de décider, et on audite
6 nœuds au lieu de 217 fichiers. (2) Lisibilité : une remédiation est une suite de
dizaines de gardes conditionnelles ; sur un canevas elles sont **visibles** — WF6 porte
d'ailleurs 7 zones documentaires. (3) Isolation des appels LLM : les 3 appels Anthropic
sont des nœuds identifiés dont les credentials restent dans n8n.
Le coût : un contrat réseau supplémentaire, donc un risque de dérive — que j'ai
réellement rencontré, et que l'architecture absorbe parce que le backend **recalcule
toujours**.

**Q2. Pourquoi deux services d'exécution (verifier et scanner) plutôt qu'un ?**
Pour garder le processus **décisionnel** à capacité nulle. Construire une image exige
`CAP_SYS_ADMIN` pour Podman rootless. Si tout était dans un seul service, le processus
qui décide de la fermeture de sécurité aurait un privilège élevé. En séparant, le
`candidate-verifier` reste à capacité nulle et le `builder-scanner`, qui a le privilège,
ne décide de rien.

**Q3. Pourquoi Podman et pas Docker pour les candidats ?**
Parce que Docker exigerait de monter `docker.sock` dans le plan d'exécution, ce qui
équivaut à donner un accès root à l'hôte à un service qui manipule du code venant d'un
dépôt. Podman rootless évite cela. `platform/docker-compose.yml` ne monte **aucun**
`docker.sock`.

**Q4. Pourquoi le backend ne fait-il pas les écritures Git, puisqu'il a le jeton ?**
Exactement pour séparer capacité et autorité. Le backend décide *qu'il faut* publier ;
n8n *exécute* la publication derrière 39 portes. Un bug dans un service backend ne peut
donc pas produire une écriture Git non validée.

**Q5. Qu'est-ce qui garantit qu'on ne publie pas un correctif non validé ?**
La barrière pré-Git : 39 portes, dont les trois dernières (`Revalidate Before Write`,
`Fresh Candidate Matches`, `Write Authorized?`) revalident **juste avant** l'écriture.
Et structurellement : chaque nœud mutant a **exactement un** prédécesseur, qui est une
porte `if`. Il n'existe aucun chemin alternatif.

**Q6. Pourquoi deux fichiers Docker Compose ?**
Pour séparer le produit (5 services) de l'outillage (9 services). Les deux plans ont des
postures de sécurité différentes : DinD privilégié d'un côté, capacité minimale de
l'autre. On peut redéployer le produit sans toucher à l'outillage.

**Q7. Pourquoi PostgreSQL et pas une base NoSQL ?**
Parce que les invariants du projet sont **relationnels et transactionnels**. L'écrivain
unique est un index unique partiel ; la cohérence des réservations est une contrainte
`CHECK` ; la consommation d'autorisation est une transaction avec verrous pessimistes.
Ce sont des garanties que je délègue au SGBD plutôt que de les coder.

**Q8. Qu'est-ce qui rend la plateforme multi-projet ?**
La route `/projects/:projectId` avec `withComponentInputBinding()` : l'identifiant vient
de l'URL et traverse tous les composants comme une donnée. Aucun registre de projet,
aucune route par projet. Et toute la configuration vit dans la table `projects`
(`azureConfig`). Je l'ai vérifié avec un UUID arbitraire jamais présent dans le code :
la page fonctionne et affiche l'état correct.

## B. Le vocabulaire et le modèle

**Q9. Quelle différence entre un finding et une tâche de remédiation ?**
Le propriétaire. Le **scanner** possède le finding ; la **plateforme** possède la tâche.
D'où deux colonnes de statut : `status` pour le travail, `scannerStatus` pour la vérité
du scanner. Sans cette séparation, je ne pourrais pas représenter l'état le plus
fréquent : « j'ai traité, mais le scanner n'a pas encore reconfirmé ».

**Q10. Différence entre une tâche et une tentative ?**
Une tentative est une **exécution** de la tâche. Un timeout du vérificateur ne doit pas
condamner la tâche : on rejoue une nouvelle tentative, avec une identité neuve, sans
effacer l'historique de la précédente.

**Q11. Et entre une tentative et un lot (batch) ?**
Une tentative concerne une tâche ; un lot regroupe les tâches envoyées **ensemble** à
WF6. Un `batchId` neuf est émis à **chaque** tentative, ce qui donne une seconde
dimension indépendante pour détecter un callback périmé.

**Q12. Pourquoi 777 tâches pour 5 projets ?**
Parce qu'un projet réel porte des centaines de findings. 470 sont en
`TODO`/`UNAVAILABLE` : le scanner n'a pas donné de verdict sur le dernier build. C'est
précisément le volume qui justifie l'automatisation.

**Q13. Que signifie `scannerStatus = UNAVAILABLE` ?**
Que le scanner n'a **pas** fourni de verdict. Ni bon, ni mauvais. C'est l'état qui
refuse de choisir, et il concerne 470 lignes sur 777. Si je l'avais fusionné avec
« pas détecté », j'aurais fabriqué de faux succès à grande échelle.

**Q14. J'ai vu `VERIFIED` avec `scannerStatus = UNAVAILABLE`. Contradiction ?**
Non, et c'est ma réponse préférée. Ces 3 lignes ont toutes `verifiedBuild` strictement
supérieur à `lastSeenBuild` (120 > 112, 15 > 14, 15 > 14) et un `verifiedAt`. Autrement
dit : le finding a été vu pour la dernière fois au build N, un build ultérieur a tourné
et ne l'a plus vu. La vérification repose sur une **preuve de build** ;
`scannerStatus` décrit la disponibilité **actuelle** du scanner. Deux faits différents,
deux colonnes.

**Q15. Qu'est-ce qu'un « candidat » ?**
Le projet modifié dans un espace jetable : clone au commit exact, `pom.xml` patché,
compilé, testé, empaqueté, scanné. Il vit et meurt dans un conteneur. Le dépôt réel
n'est **jamais** modifié pendant l'évaluation.

## C. L'IA

**Q16. Que fait réellement l'IA ?**
**14 appels à `api.anthropic.com`** répartis sur cinq workflows publiés : WF1 en fait 5
(quatre agents spécialisés — cause racine, risque de sécurité, faisabilité, guide
développeur — plus un « Judge » qui ne décide pas), WF2 en fait 4 (plan de correction et
deux revues sémantiques indépendantes), WF4 et WF5 en font 2 chacun (proposer puis
produire le fichier à commiter), et WF-Chat 1. Le conteneur Ollama tourne mais **rien ne
l'appelle** : c'est une capacité installée et non utilisée.

**Q17. Que l'IA ne décide-t-elle jamais ?**
Rien de ce qui engage le système. Le build réussit → Maven décide. Les tests passent →
Maven. La CVE a disparu → **Trivy**. Les dépendances sont saines → **OWASP**. Cet échec
est-il rejouable → code déterministe. Qui a le droit d'écrire ce fichier → **PostgreSQL**.
Peut-on écrire dans Git → 39 portes. Le déploiement est-il autorisé → backend. Le
déploiement a-t-il réussi → `classifyAgentDeploymentResult()`.
**L'IA n'a aucun droit d'écriture.**

**Q18. Et si le LLM hallucine un correctif ?**
Il est rejeté, et c'est le scénario D de ma documentation. Le patch est appliqué sur un
clone jetable ; si le build casse, les tests échouent, ou Trivy voit toujours la CVE,
`provesSecurityClosure()` renvoie `false` et **rien** n'est publié. Aucun humain n'a
même à relire une PR inutile.

**Q19. L'IA n'est pas déterministe. N'est-ce pas un problème pour un outil de sécurité ?**
C'est précisément pourquoi elle n'est pas dans le chemin de décision. Elle est
non déterministe sur la **proposition**, et la proposition est systématiquement soumise à
une validation déterministe. Je l'assume comme limitation de conception, atténuée par
deux revues sémantiques indépendantes.

## D. Les scanners

**Q20. Pourquoi Trivy **et** OWASP ? C'est redondant.**
Non, ce sont deux axes. Trivy analyse l'**image construite** et voit ce qui est
réellement embarqué, y compris une transitive remontée par un POM parent. OWASP analyse
l'**arbre de dépendances déclaré**. Une correction peut faire disparaître la CVE de
l'image tout en laissant une déclaration vulnérable, ou l'inverse. Exiger les deux ferme
les deux angles morts.

**Q21. Comment évitez-vous qu'un scanner en panne passe pour « tout va bien » ?**
C'est l'invariant central. `cveTargets()` valide la **structure** avant de lire le moindre
résultat : build passé, mode attendu, deux digests en 64 hexa, version de scanner,
`SchemaVersion === 2`, `ArtifactType === 'container_image'`, résultats non vides, et au
moins un paquet `jar`. Sinon elle **lève**. Et `provesSecurityClosure()` est enveloppée
dans `try { … } catch { return false }`. Un scan absent, raté ou malformé ne peut pas
produire un succès.

**Q22. Un rapport vide prouve-t-il la correction ?**
Non, et c'est subtil. Je n'exige pas seulement l'**absence** de la CVE, mais la
**présence positive** du paquet à la version corrigée :
`found.length > 0 && found.every(x => x.Version === p.targetVersion)`. Un rapport vide
échoue ce test. « Je n'ai rien trouvé » ne vaut pas « c'est corrigé ».

**Q23. Et si quelqu'un met la CVE sur une liste d'exclusion Trivy ?**
Refusé. Si le rapport porte `ModifiedFindings`, `cveTargets()` lève
`MALFORMED_OR_FILTERED_SECURITY_SCAN`. On ne peut pas « corriger » en filtrant.

**Q24. ZAP est-il actif ?**
**Non.** Les conteneurs ZAP sont sortis. Les findings ZAP en base sont historiques, et la
gouvernance les traite comme `zap: WARNING`, étape non bloquante. Je préfère le dire
clairement plutôt que de le présenter comme actif.

**Q25. Pourquoi Trivy en version épinglée ?**
0.72.0, téléchargée depuis l'upstream et **vérifiée par SHA-256**, jamais via apt. Un
scanner qui change de version change de verdict : la reproductibilité d'une preuve de
sécurité exige un outil épinglé. Même discipline pour Gradle 8.10.2 et pour l'image de
base, épinglée par **digest**.

**Q26. Comment gérez-vous l'asynchronisme de SonarQube ?**
Sonar renvoie un `ceTaskId` et le Quality Gate n'est connu qu'après traitement. Je
modélise explicitement que `analysisSubmitted` et `qualityGateResolved` peuvent diverger,
avec un message opérateur qui précise que la corrélation indisponible « n'est pas un
défaut du code analysé ». Un aléa de CI ne doit pas devenir un faux positif de sécurité.
Et un Quality Gate **indéterminé** est traité comme motif de risque, pas comme succès.

## E. Retry, concurrence, idempotence

**Q27. Qu'est-ce qui est rejouable, et qu'est-ce qui ne l'est pas ?**
Les échecs **techniques** (`VERIFIER_TIMEOUT`, `DISPATCH_FAILED`) le sont. Les **verdicts
métier** (`INVALID_CANDIDATE`, `STILL_OPEN`, tests en échec) ne le sont pas. Les
décisions humaines non plus. Et la liste des échecs pré-Git sûrs à libérer est une
**liste blanche** : un code inconnu n'est donc pas considéré comme sûr, il mène à la
quarantaine.

**Q28. Que se passe-t-il si un callback d'une tentative morte arrive après le départ
d'une nouvelle ?**
C'est le bug distribué classique, et il est protégé trois fois. Chaque tentative a un
`attemptId` **neuf** et un `batchId` **neuf** ; le callback annonce A1 alors que la
tentative courante est A2. Et `verifyWf6AttemptContext()` valide le triplet
`(projectId, taskIds, batchId)` **avant** toute mutation. Le callback périmé est
reconnu et ignoré.

**Q29. Et un callback dupliqué ?**
Problème différent : même tentative, livrée deux fois. Là il ne faut pas refuser mais
être **idempotent** : `completionDigest` reconnaît le second et n'applique rien.

**Q30. Pourquoi un nouveau `batchId` à chaque retry, et pas seulement un `attemptId` ?**
Pour avoir deux dimensions **indépendantes** de détection. Si une seule identité était
réutilisée, un callback périmé portant la bonne valeur sur l'autre champ pourrait passer.
Sur mes données réelles, les deux tentatives ont des identités entièrement disjointes.

**Q31. Combien de tentatives au maximum, et pourquoi borné ?**
`MAX_AUTOMATIC_ATTEMPTS = 3`. Surchargeable mais **bornée à 1–3** par une regex, et une
valeur invalide **refuse de servir** au lieu de retomber silencieusement sur un défaut.
Sans borne, un candidat systématiquement mauvais bouclerait et consommerait des appels
LLM et des builds.

**Q32. Pourquoi la réservation est-elle retenue entre deux tentatives ?**
Parce que la relâcher ouvrirait une fenêtre pendant laquelle une autre tâche pourrait
prendre la cible entre deux tentatives du même lot. Le claim passe en `WAITING_RETRY`,
mais la réservation reste `ACTIVE`.

**Q33. Expliquez le mécanisme d'écrivain unique.**
Deux CVE peuvent toucher le même `pom.xml`. Sans verrou, la seconde écriture écraserait
la première : on obtiendrait une PR prétendant corriger A alors que le correctif A a
disparu — et Trivy avait validé A sur un candidat qui n'existe plus. **La preuve
devient fausse.**
La clé de propriété est `(projectId, targetKey)` où
`targetKey = JSON.stringify(['v1','FILE',file])`, et la garantie est un **index unique
partiel PostgreSQL** `WHERE state = 'ACTIVE'`. Ce n'est pas du code applicatif.

**Q34. Pourquoi l'index est-il *partiel* ?**
Pour conserver l'historique de toutes les réservations relâchées tout en n'autorisant
qu'un seul propriétaire **actif**. Sans le `WHERE`, je ne pourrais garder aucun
historique.

**Q35. Et la contrainte `CHECK` ?**
Elle rend une ligne incohérente **impossible** : `ACTIVE` exige des claims non vides et
`releasedAt IS NULL` ; `RELEASED` exige des claims vides et `releasedAt NOT NULL`. On ne
peut pas avoir « active mais déjà relâchée », même avec un bug.

**Q36. Que se passe-t-il si deux projets différents visent le même chemin de fichier ?**
Aucun conflit : `projectId` fait partie de la clé. C'est ce qui prouve que la conception
est réellement multi-projet.

**Q37. Et deux modules d'un même projet ?**
La clé le permettrait, mais `productionTarget()` renvoie `'pom.xml'` pour toute tâche :
en pratique ils se sérialisent. C'est une limitation que j'assume — et elle est **sûre**,
parce que trop prudente. Sur-sérialiser ne corrompt rien ; sous-sérialiser, oui.

**Q38. Que se passe-t-il si une branche a été créée puis que le processus échoue ?**
La réservation passe en **`QUARANTINED`** et n'est **pas** libérée. `settleTargetClaim()`
vérifie tout effet de bord Git — branche, numéro de PR, URL de PR — sur la tentative
courante **et toutes les précédentes**. Libérer laisserait une autre remédiation écrire
par-dessus un état Git inconnu. Il faut une intervention admin (`abandonTarget()`).

## F. Git et publication

**Q39. Une Pull Request prouve-t-elle que la vulnérabilité est corrigée ?**
Non, et c'est un invariant explicite de mon code. Seul le statut `CANDIDATE_READY`
produit un badge positif dans l'UI ; le commentaire dit *« Historical CLOSED is never a
proposal »*. Une PR est une **proposition**. Quatre niveaux à distinguer : candidat
validé, branche créée, PR créée, PR mergée — et aucun ne ferme la vulnérabilité.

**Q40. Alors qu'est-ce qui la ferme ?**
Un **build ultérieur** dont le scanner ne voit plus le finding, prouvé par
`verifiedBuild > lastSeenBuild`. La plateforme ne se décerne pas le succès : elle
propose, et un scan indépendant constate.

**Q41. Pourquoi 38 nœuds pour vérifier **après** avoir écrit ?**
Parce qu'un `PUT` peut renvoyer 200 et produire autre chose que prévu (encodage, conflit,
course). La seule preuve acceptable est de **relire** GitHub et de recomparer les
empreintes. Deux chaînes jumelles le font, et si ça diverge, `Close Drifted Created PR`
ferme la PR. Le workflow nettoie derrière lui plutôt que de laisser une PR qui mente.

**Q42. Qui peut écrire dans votre dépôt ?**
**14 nœuds mutants**, répartis sur **quatre** workflows : WF6 (4), WF2 (4), WF4 (3),
WF5 (3) — tous dans n8n, tous derrière une porte déterministe **et** une autorisation
backend. Plus une sonde **inactive**, `DEBUG-create-pr-only`, qui crée une PR sans
aucune porte et que je dois supprimer. Et **aucun** chemin backend : le backend détient
le jeton mais n'écrit jamais.

Une précision méthodologique que j'assume : ma première analyse n'en avait trouvé que 6,
parce que je cherchais les écritures par l'URL `api.github.com`. Or n8n propose un
**nœud natif `github`** dont l'URL n'apparaît pas dans les paramètres : 8 des 14
écrivains utilisent ce nœud avec les opérations `edit` ou `create`. Il faut chercher les
deux formes.

**Q43. Le `candidate-verifier` peut-il pousser du code ?**
Non. Il n'a **aucun** jeton GitHub. Il clone en lecture et n'écrit jamais. C'est
important parce que c'est lui qui exécute du code potentiellement hostile.

## G. Déploiement Azure

**Q44. Expliquez les quatre états de gouvernance.**
`TECHNICALLY_IMPOSSIBLE` : identité de build, d'environnement ou de provenance d'artefact
non résolue — **non contournable**, parce que ce n'est pas un jugement de risque mais
« on ne sait pas ce qu'on déploierait ». `CRITICAL_RISK` : risques connus, contournable
par un admin avec motif, 3 reconnaissances et phrase exacte. `CONDITIONAL` : une étape en
avertissement non bloquante. `READY` : aucun motif.

**Q45. Pourquoi `TECHNICALLY_IMPOSSIBLE` ne peut-il pas être contourné, même par un admin ?**
Parce qu'accepter un risque n'a aucun sens quand l'objet du risque est inconnu. Un admin
peut assumer « je déploie malgré 14 CVE » ; il ne peut pas assumer « je déploie je ne sais
pas quoi ». Le backend répond `DEPLOY_TECHNICALLY_IMPOSSIBLE_NO_OVERRIDE`.

**Q46. Qu'est-ce qui empêche le frontend de s'auto-autoriser ?**
Le frontend n'envoie que de l'**intention** : `mode`, `reason`, `acknowledgements`,
`confirmationPhrase`. Les champs `decision`, `commitSha`, `artifactDigest`,
`riskSnapshot` **n'existent même pas** sur le DTO backend, et `ValidationPipe({whitelist:true})`
supprimerait tout champ non déclaré. Le serveur **recalcule tout**.

**Q47. Pourquoi geler un instantané dans l'autorisation ?**
Pour pouvoir recalculer et **comparer** au moment du dispatch. Si le digest ou le commit
a bougé entre l'autorisation et le déploiement, l'autorisation est refusée
(`DEPLOY_AUTHORIZATION_IDENTITY_CHANGED`) et **reste `CREATED`** — rien n'est consommé.
On ne déploie jamais autre chose que ce qui a été autorisé.

**Q48. Pourquoi un TTL de 15 minutes et un usage unique ?**
Parce qu'une autorisation est un droit d'agir sur la production. 15 minutes, c'est le
temps d'un déploiement, pas celui d'une journée de travail. Et l'usage unique empêche
de rejouer une autorisation légitime pour un second déploiement non examiné. J'ai vérifié
le TTL effectif sur PostgreSQL réel : 900 secondes.

**Q49. Comment garantissez-vous qu'un HTTP 200 n'est pas pris pour un succès ?**
`classifyAgentDeploymentResult()` sépare `transportSuccess` de `deploymentSuccess`. Il
exige `success === true` **et** `healthOk === true`, **tous deux booléens**. Un corps 2xx
sans ces deux booléens donne `AGENT_RESULT_INVALID`. Un conteneur démarré dont la santé
échoue donne `AGENT_HEALTH_FAILED`. Et sur échec sémantique le backend **lève**, donc le
frontend prend sa branche d'erreur.

**Q50. Pourquoi déployer par digest et pas par tag ?**
Un tag est **mutable** : `:151` peut être repoussé sur un autre contenu. Un
`sha256:…` est immuable par construction. Le backend envoie le digest de l'autorisation
et laisse l'agent construire la référence ; le tag ne voyage plus que pour l'affichage.

**Q51. Pourquoi un agent sur l'hôte plutôt qu'un service principal Azure ?**
Contrainte externe : la politique du tenant interdit de créer une App Registration. La
session `az` personnelle a le rôle *Owner* sur toute la souscription. J'ai donc choisi de
ne **jamais** faire sortir ce jeton de l'hôte : seul l'agent Python lit `~/.azure`, et il
écoute sur `172.19.0.1` — la passerelle du bridge Docker — **jamais** sur `0.0.0.0`. Le
backend ne détient aucun credential Azure.

**Q52. Avez-vous testé la concurrence sur l'autorisation ?**
Oui, sur une base PostgreSQL jetable, avec de **vrais** processus séparés et des PID de
backend PostgreSQL distincts — donc les verrous pessimistes sont réellement exercés. Deux
consommateurs concurrents de la même autorisation : **exactement une** consommation
réussit, l'autre reçoit `DEPLOY_AUTHORIZATION_CONSUMED`, et **exactement une** ligne
`deployment_attempts` est créée.

## H. Qualité, tests, limites

**Q53. Comment testez-vous tout ça ?**
287 fichiers de spécification. Côté backend, 78 passent sur la lignée qualifiée, exécutés
par le runner natif de Node. Côté frontend, 28 fichiers dont un de 45 cas pour la
gouvernance du déploiement — et ces tests chargent le **vrai** composant dans un bac à
sable et vérifient le **vrai** template, sans TestBed. Plus une gate PostgreSQL réelle
pour la concurrence.

**Q54. Quelles sont les limites de votre projet ?**
Quatre que j'assume. (1) **Maven uniquement** : le pipeline d'admission ne gère que Maven ;
les tests d'extensibilité démontrent la capacité d'extension, pas un support multi-écosystème.
(2) **Sur-sérialisation multi-module**, sûre mais trop prudente. (3) **Pas de registre de
migrations** : l'état appliqué est attesté par mes rapports de campagne, pas lisible depuis
la base. (4) **ZAP non actif**. Et deux points opérationnels : déploiement mono-nœud, et
observabilité qui passe par la base plutôt que par des logs structurés.

**Q55. Si c'était à refaire, que changeriez-vous ?**
Trois choses. (1) Inverser le défaut du drapeau de dispatch : aujourd'hui « variable
absente » vaut « autorisé », ce qui est le mauvais sens pour un interrupteur de sûreté —
c'est corrigé en cuisant la valeur sûre dans l'image, mais le code devrait l'être aussi.
(2) Authentifier le webhook de WF2 comme celui de WF6. (3) Ajouter un logger structuré
avec identifiant de corrélation : aujourd'hui la traçabilité passe par la base, ce qui
marche très bien mais oblige à requêter SQL.

**Q56. Comment un opérateur reconstitue-t-il l'histoire d'un finding ?**
Entièrement depuis la base, en 12 étapes : `reports.rawData` pour la détection,
`UNIQUE (projectId, findingFingerprint)` pour la tâche, les deux colonnes de statut,
`attempts[]` pour chaque tentative avec son `reasonCode` et son `retryable`,
`securityRemediationBatchId` indexé pour le lot, `claims` pour savoir qui détenait
l'écrivain, `n8nExecutionId` pour l'exécution, `prUrl`/`branchName` pour Git,
`verifiedBuild`/`lastSeenBuild` pour la vérification, et `events` pour la piste d'audit.
C'est la vraie force d'observabilité du projet.

**Q57. Vous avez un nœud qui s'appelle « Judge » et qui appelle un LLM. C'est donc bien
l'IA qui décide ?**
Non, et c'est mon meilleur exemple. Dans WF1, `Prepare - Judge Body` calcule la
recommandation en **154 lignes de règles déterministes** *avant* d'appeler le modèle :
étape requise indisponible → `BLOCK`, CVE critique → `BLOCK`, blockers Sonar →
`FIX_PROPOSED`, sinon `NOTIFY_ONLY`. Le payload envoyé au modèle porte le commentaire
« validation + rédaction, **PAS décision** ». Et `Judge - Parse Output` écrase la réponse
du modèle : `parsed.decision = governance.recommendation`, l'avis de l'IA étant conservé
séparément sous `aiSuggestedDecision`. En l'absence de donnée de gouvernance, le défaut
est `BLOCK`. Le modèle rédige la justification ; la règle décide.

**Q58. Pourquoi conserver `aiSuggestedDecision` si elle n'est pas utilisée ?**
Pour pouvoir comparer, après coup, ce que l'IA aurait décidé et ce que la règle a décidé.
C'est une donnée d'évaluation : elle permet de mesurer la qualité du modèle sans jamais
lui déléguer la décision. Et si un jour on voulait faire évoluer les règles, on aurait
l'historique des divergences.

**Q59. Que signifie « aucun PASS implicite autorisé » dans WF1 ?**
Que l'absence de résultat ne vaut jamais succès. Une étape requise (`build`, `tests`,
`sonar`, `trivy`, `owasp`, `zap`) en `NOT_RUN` **ou** `NOT_REACHED` provoque un `BLOCK`.
Le code distingue même les deux : `NOT_REACHED` signifie un échec *avant* l'étape — un
checkout SCM raté, par exemple — et le commentaire précise « ce n'est PAS un stage
désactivé par config, c'est un stage jamais atteint du tout ».

**Q60. Un scanner en échec bloque-t-il donc toujours ?**
Non, et la nuance est intéressante. Une étape `FAILED` qui porte `resultAvailable === true`
est traitée comme « un scan complet et digne de confiance qui rapporte de mauvaises
nouvelles » — pas comme une étape indisponible. Elle ne compte donc pas dans les étapes
indisponibles, parce que l'information existe. C'est exactement la distinction entre
*« le scanner dit non »* et *« le scanner n'a rien dit »*.

**Q61. Pourquoi quatre agents LLM dans WF1 plutôt qu'un seul ?**
Quatre prompts spécialisés — cause racine, risque de sécurité, faisabilité de
remédiation, guide développeur — produisent des analyses plus exploitables qu'un prompt
généraliste. Et surtout, l'étape suivante **exige les quatre** :
`if (items.length < 4) throw new Error(...)`. Une analyse partielle échoue au lieu de
produire un verdict incomplet.

---

# « À NE PAS CONFONDRE » *(PART 41)*

| Ne pas confondre | Différence essentielle |
|---|---|
| **Jenkins** vs **n8n** | Jenkins **construit et mesure** l'existant ; n8n **orchestre** la correction. Jenkins ne décide d'aucune remédiation |
| **Jenkins** vs **candidate-verifier** | Jenkins mesure le dépôt réel ; le verifier mesure une **hypothèse** dans un espace jetable |
| **Trivy** vs **OWASP** | Trivy = l'**image construite** ; OWASP = l'**arbre de dépendances déclaré** |
| **SAST** vs **SCA** vs **DAST** | Sonar lit le **code** ; Trivy/OWASP les **dépendances** ; ZAP l'**application en marche** |
| **détection** vs **finding** | la détection est un événement ; le finding est l'élément individuel qui en sort |
| **finding** vs **tâche** | le scanner possède le finding ; la plateforme possède la tâche. D'où **deux** colonnes de statut |
| **tâche** vs **tentative** | une tâche peut avoir jusqu'à 3 tentatives, chacune avec une identité neuve |
| **tentative** vs **lot** | la tentative concerne une tâche ; le lot regroupe les tâches envoyées ensemble. Nouveau `batchId` à **chaque** tentative |
| **candidat** vs **projet** | le candidat vit dans un conteneur jetable ; le dépôt réel n'est pas modifié pendant l'évaluation |
| **validé** vs **corrigé** | validé = prouvé sur un candidat ; corrigé = un **build ultérieur** ne voit plus le finding |
| **branche créée** vs **PR créée** vs **PR mergée** vs **corrigé** | quatre niveaux distincts ; seul le dernier ferme |
| **image Docker** vs **conteneur** | l'image est l'artefact scanné (identifié par **digest**) ; le conteneur est son exécution |
| **tag** vs **digest** | le tag est **mutable**, le digest **immuable**. Le dispatch utilise le digest |
| **autorisé** vs **réussi** (déploiement) | l'autorisation est un droit d'agir ; le succès exige `success && healthOk` |
| **`transportSuccess`** vs **`deploymentSuccess`** | HTTP 200 vs résultat sémantique de l'agent |
| **scan sans résultat** vs **scan non exécuté** | `NO_FINDINGS` vs `SCAN_NOT_RUN` — seul le premier *peut* mener à une fermeture |
| **`NOT_RUN`** vs **`FAILED`** (étape) | non exécuté vs exécuté et échoué. Jamais converti en `PASSED` |
| **`null`** vs **`0`** (compteur OWASP) | `null` = non testé ; `0` = testé sans régression |
| **non configuré** vs **techniquement impossible** | état de **configuration** vs **verdict** de gouvernance. `devsecops-testbed` est configuré **et** impossible |
| **`DEPLOYMENT_CONFIGURED`** vs **`READY`** | capacité (une cible existe) vs décision (aucun risque) |
| **écrivain unique** vs **verrou de fichier** | c'est un verrou **logique** sur `(projectId, targetKey)`, garanti par un index PostgreSQL |
| **`QUARANTINED`** vs **`RELEASED`** | quarantaine = effet Git non résolu, intervention requise ; relâché = cible libre |
| **callback périmé** vs **callback dupliqué** | périmé = **refuser** ; dupliqué = **être idempotent** |
| **WF2** vs **WF6** | WF2 corrige un **incident** avec l'aide d'un LLM ; WF6 remédie une **CVE** avec preuve déterministe |
| **Docker** vs **Podman** | Docker (DinD privilégié) pour la CI ; Podman rootless pour les candidats |
| **l'IA propose** vs **l'IA décide** | elle propose. Elle ne décide **jamais** |
| **le nœud « Judge »** vs **la décision de gouvernance** | le nœud appelle un LLM qui *rédige* ; la décision vient de 154 lignes de règles qui **écrasent** sa réponse |
