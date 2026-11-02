# 03b — CATALOGUE COMPLET DES NŒUDS n8n (workflows actifs)

Catalogue **extrait de l'instance n8n en cours d'exécution** via son API publique
(`GET /api/v1/workflows/:id`), le 2026-10-08. Aucun nœud n'est omis : la colonne
`Prof.` donne la profondeur en nombre de sauts depuis le déclencheur, ce qui rend
l'ordre d'exécution lisible.

Conventions :

- `ROUTING_NODE` : nœud `noOp` de pur routage/jonction, sans logique propre.
- `lane=main` : sortie normale ; `lane=error` : lane d'erreur explicite.
- `#0 / #1` : index de sortie d'un `if` — `#0` = branche vraie, `#1` = branche fausse.

> **Périmètre de ce catalogue** : les **526 nœuds exécutables** des 7 workflows actifs.
> Les 13 annotations de canevas (`n8n-nodes-base.stickyNote` : 6 dans WF2, 7 dans WF6) sont
> exclues — elles n'ont ni type exécutable, ni connexion entrante, ni connexion sortante.
> L'inventaire de `03-N8N-COMPLETE-GUIDE.md` annonce 539 : c'est le total du canevas,
> 526 + 13. Les deux chiffres sont justes, ils ne comptent pas la même chose.

## WF1 - Incident Intake & Analysis v5.1

- **ID** : `vNOQiEgnXg9Zqn2q`  ·  **actif** : `True`  ·  **versionId** : `55ba20a0-f076-49df-89ee-753c511d3722`
- **Dernière mise à jour** : `2026-10-04T23:19:10.556Z`
- **Nœuds** : 50 au total — 50 fonctionnels, 0 notes autocollantes (documentation sur le canevas)
- **Atteignables depuis les déclencheurs** : 50 / 50 (aucun nœud mort)
- **Arêtes pendantes** : 0
- **Points d'entrée** : `Incident Webhook`

Répartition par type de nœud : `code` × 23, `httpRequest` × 14, `readWriteFile` × 3, `extractFromFile` × 3, `if` × 2, `executeWorkflow` × 1, `emailSend` × 1, `switch` × 1, `merge` × 1, `webhook` × 1

### Cibles HTTP sortantes

| Destination | Nœuds | Détail |
|---|---|---|
| **api.anthropic.com** | 5 | `POST` Route cause Analysis1; `POST` Security Risk Analysis1; `POST` Remediation Feasibility 1; `POST` Developer Guidance Analysis … |
| **backend** | 8 | `GET` Lookup Project; `POST` Send Raw Incident to Backend; `GET` Resolve Exact Sonar Correlation; `POST` Save Agent Reports to Backend … |
| **sonarqube** | 1 | `GET` Fetch SonarQube Issues |

### Catalogue des nœuds

| Prof. | Nœud | Type | Détail | Suivant(s) |
|---|---|---|---|---|
| 0 | `Incident Webhook` | `webhook` | path=`jenkins-event` method=`POST` auth=`headerAuth` creds=['httpHeaderAuth'] | `Is PR Validation` |
| 1 | `Is PR Validation` | `if` | cond: `={{ $json.body?.event ?? $json.event }} [?] pr_validation` | `Validate PR Validation Contract`, `Switch3` (main#1) |
| 2 | `Validate PR Validation Contract` | `code` | code 16 lignes | `Call WF3 - Post-PR Validation` |
| 2 | `Switch3` | `switch` | — | `Normalize Incident Payload`, `Normalize Incident Payload` (main#1), `Normalize Incident Payload` (main#2) … (+1) |
| 3 | `Call WF3 - Post-PR Validation` | `executeWorkflow` | — | *(terminal)* |
| 3 | `Normalize Incident Payload` | `code` | code 149 lignes | `Lookup Project` |
| 4 | `Lookup Project` | `httpRequest` | `GET` BACKEND `={{ $json.backendUrl \|\| 'http://backend:3001' }}/api/projects/internal/by-job/{{ $json.jenkins.job }}` timeout=`None` onError=`continueErrorOutput` | `Extract Project Config`, `Log Lookup Project Error` (main#1) |
| 5 | `Extract Project Config` | `code` | code 73 lignes | `Send Raw Incident to Backend` |
| 5 | `Log Lookup Project Error` | `code` | code 7 lignes | *(terminal)* |
| 6 | `Send Raw Incident to Backend` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/webhooks/jenkins/by-job/{{ $json.jenkins.job }}` timeout=`None` onError=`continueErrorOutput` | `Prepare Fetch URLs`, `Log Send Raw Incident Error` (main#1) |
| 7 | `Prepare Fetch URLs` | `code` | code 82 lignes | `Fetch SonarQube Issues` |
| 7 | `Log Send Raw Incident Error` | `code` | code 7 lignes | *(terminal)* |
| 8 | `Fetch SonarQube Issues` | `httpRequest` | `GET`  `http://sonarqube:9000/api/issues/search` timeout=`15000` onError=`continueErrorOutput` | `Consolidate Baseline Sonar Snapshot`, `Consolidate Baseline Sonar Snapshot` (main#1) |
| 9 | `Consolidate Baseline Sonar Snapshot` | `code` | code 34 lignes | `Resolve Exact Sonar Correlation` |
| 10 | `Resolve Exact Sonar Correlation` | `httpRequest` | `GET` BACKEND `=http://backend:3001/api/projects/internal/{{ $("Extract Project Config").first().json.projectId }}/sonar-correlation?ce` timeout=`310000` onError=`continueRegularOutput` | `Fetch Trivy Report1` |
| 11 | `Fetch Trivy Report1` | `code` | code 19 lignes | `Fetch Trivy Report3` |
| 12 | `Fetch Trivy Report3` | `readWriteFile` | — | `Parse Trivy JSON` |
| 13 | `Parse Trivy JSON` | `extractFromFile` | — | `Fetch ZAP Report1` |
| 14 | `Fetch ZAP Report1` | `code` | code 14 lignes | `Fetch ZAP Report2` |
| 15 | `Fetch ZAP Report2` | `readWriteFile` | — | `Parse ZAP JSON` |
| 16 | `Parse ZAP JSON` | `extractFromFile` | — | `Fetch OWASP Report1` |
| 17 | `Fetch OWASP Report1` | `code` | code 14 lignes | `Fetch OWASP Report2` |
| 18 | `Fetch OWASP Report2` | `readWriteFile` | — | `Parse OWASP JSON` |
| 19 | `Parse OWASP JSON` | `extractFromFile` | — | `Merge All Fetched Data` |
| 20 | `Merge All Fetched Data` | `code` | code 425 lignes | `Prepare - Root Cause Body`, `Prepare - Security Body`, `Prepare - Remediation Body` … (+1) |
| 21 | `Prepare - Root Cause Body` | `code` | code 70 lignes | `Route cause Analysis1` |
| 21 | `Prepare - Security Body` | `code` | code 52 lignes | `Security Risk Analysis1` |
| 21 | `Prepare - Remediation Body` | `code` | code 46 lignes | `Remediation Feasibility 1` |
| 21 | `Prepare - Dev Guide Body` | `code` | code 99 lignes | `Developer Guidance Analysis` |
| 22 | `Route cause Analysis1` | `httpRequest` | `POST` ANTHROPIC `https://api.anthropic.com/v1/messages` timeout=`None` onError=`continueRegularOutput` | `Parse - Root Cause Output` |
| 22 | `Security Risk Analysis1` | `httpRequest` | `POST` ANTHROPIC `https://api.anthropic.com/v1/messages` timeout=`None` onError=`continueRegularOutput` | `Parse - Security Output` |
| 22 | `Remediation Feasibility 1` | `httpRequest` | `POST` ANTHROPIC `https://api.anthropic.com/v1/messages` timeout=`None` onError=`continueRegularOutput` | `Parse - Remediation Output` |
| 22 | `Developer Guidance Analysis` | `httpRequest` | `POST` ANTHROPIC `https://api.anthropic.com/v1/messages` timeout=`None` onError=`continueRegularOutput` | `Parse - Dev Guide Output` |
| 23 | `Parse - Root Cause Output` | `code` | code 87 lignes | `Merge Agent Reports` |
| 23 | `Parse - Security Output` | `code` | code 8 lignes | `Merge Agent Reports` |
| 23 | `Parse - Remediation Output` | `code` | code 46 lignes | `Merge Agent Reports` |
| 23 | `Parse - Dev Guide Output` | `code` | code 85 lignes | `Merge Agent Reports` |
| 24 | `Merge Agent Reports` | `merge` | — | `Prepare Save Body`, `Prepare - Judge Body` |
| 25 | `Prepare Save Body` | `code` | code 15 lignes | `Save Agent Reports to Backend` |
| 25 | `Prepare - Judge Body` | `code` | code 154 lignes | `Judge - HTTP Request1` |
| 26 | `Save Agent Reports to Backend` | `httpRequest` | `POST` BACKEND `http://backend:3001/api/reports` timeout=`None` onError=`continueErrorOutput` | *(terminal)* |
| 26 | `Judge - HTTP Request1` | `httpRequest` | `POST` ANTHROPIC `https://api.anthropic.com/v1/messages` timeout=`None` onError=`continueRegularOutput` | `Judge - Parse Output` |
| 27 | `Judge - Parse Output` | `code` | code 25 lignes | `Prepare Final Report`, `Save Judge Decision to Report` |
| 28 | `Prepare Final Report` | `code` | code 141 lignes | `Save Final Decision to Backend` |
| 28 | `Save Judge Decision to Report` | `httpRequest` | `PUT` BACKEND `=http://backend:3001/api/reports/{{ $('Save Agent Reports to Backend').first().json.id }}` timeout=`None` onError=`continueRegularOutput` | *(terminal)* |
| 29 | `Save Final Decision to Backend` | `httpRequest` | `PUT` BACKEND `=http://backend:3001/api/incidents/{{ $("Send Raw Incident to Backend").first().json.id }}` timeout=`None` onError=`continueErrorOutput` | `Update Incident AI Analysis`, `Backend Error - Decision Save Failed` (main#1) |
| 30 | `Update Incident AI Analysis` | `httpRequest` | `PUT` BACKEND `=http://backend:3001/api/incidents/{{ $("Prepare Final Report").first().json.incidentUUID }}` timeout=`None` onError=`None` | `If` |
| 30 | `Backend Error - Decision Save Failed` | `httpRequest` | `PUT` BACKEND `=http://backend:3001/api/incidents/{{ $("Send Raw Incident to Backend").first().json.id }}` timeout=`None` onError=`None` | *(terminal)* |
| 31 | `If` | `if` | cond: `={{ $('Judge - Parse Output').first().json.decision }} [?] FIX_PROPOSED` | `Send an Email`, `Send an Email` (main#1) |
| 32 | `Send an Email` | `emailSend` | — | *(terminal)* |

## WF2 - Git Patch & PR v5 CANONICAL (R22E + Brique 5)

- **ID** : `u3eeMwTuhCsetfcS`  ·  **actif** : `True`  ·  **versionId** : `db31718c-c591-4ea0-aa4d-f66037988471`
- **Dernière mise à jour** : `2026-10-06T12:51:02.956Z`
- **Nœuds** : 195 au total — 189 fonctionnels, 6 notes autocollantes (documentation sur le canevas)
- **Atteignables depuis les déclencheurs** : 176 / 189 — **13 non atteignables** : `Build File Result`, `Classify GitHub Write Error`, `Transport Requires Read Back?`, `Read Back File After Write Error`, `Evaluate GitHub Write Reconciliation`, `Remote Candidate Present?`, `Lookup Head After Reconciled Write`, `Failure Envelope - Build File Result`, `Failure Envelope - Transport Requires Read Back?`, `Failure Envelope - Read Back File After Write Error`, `Failure Envelope - Evaluate GitHub Write Reconciliation`, `Failure Envelope - Remote Candidate Present?`, `Failure Envelope - Lookup Head After Reconciled Write`
- **Arêtes pendantes** : 0
- **Points d'entrée** : `Build File Result`, `Webhook`, `Classify GitHub Write Error`

Répartition par type de nœud : `code` × 127, `httpRequest` × 26, `if` × 17, `github` × 8, `crypto` × 5, `splitInBatches` × 2, `noOp` × 2, `emailSend` × 1, `webhook` × 1

### Cibles HTTP sortantes

| Destination | Nœuds | Détail |
|---|---|---|
| **api.anthropic.com** | 4 | `POST` Generate Remediation Plan; `POST` Independent Semantic Review; `POST` de Patch - HTTP Request; `POST` Independent Cross-File Semantic Review |
| **api.github.com** | 12 | `GET` Fetch Repository Metadata; `GET` Get Main Branch SHA1; `GET` Lookup Remediation Branch; `GET` Fetch Repository Tree … |
| **backend** | 10 | `POST` Register WF2 Execution; `POST` Persist WF2 Failure Status; `POST` Call Cross-File COMPILE_MAIN; `POST` Call Candidate Verification … |

### Catalogue des nœuds

| Prof. | Nœud | Type | Détail | Suivant(s) |
|---|---|---|---|---|
| 0 | `Webhook` | `webhook` | path=`wf2-r22e-test` method=`POST` auth=`<NONE>` | `Capture Correlation Envelope` |
| 1 | `Capture Correlation Envelope` | `code` | code 1 lignes | `Adapt Webhook Payload`, `Failure Envelope - Capture Correlation Envelope` (main#1) |
| 2 | `Adapt Webhook Payload` | `code` | code 10 lignes | `Register WF2 Execution`, `Failure Envelope - Adapt Webhook Payload` (main#1) |
| 2 | `Failure Envelope - Capture Correlation Envelope` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 3 | `Register WF2 Execution` | `httpRequest` | `POST` BACKEND `={{ (() => { const e=$('Capture Correlation Envelope').first().json.correlationEnvelope; return 'http://backend:3001/api` timeout=`15000` onError=`None` | `Execution May Continue?` |
| 3 | `Failure Envelope - Adapt Webhook Payload` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 3 | `Prepare WF2 Failure Status` | `code` | code 2 lignes | `Persist WF2 Failure Status` |
| 4 | `Execution May Continue?` | `if` | cond: `={{ $json.success === true && $json.cancelRequested === false && $json.cancelled === false && !$json.stale }} [?] True` | `Restore Registered Intake`, `WF2 Cancellation Terminal` (main#1) |
| 4 | `Persist WF2 Failure Status` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/incidents/{{ $json.incidentId }}/workflow-status` timeout=`15000` onError=`None` | *(terminal)* |
| 5 | `Restore Registered Intake` | `code` | code 1 lignes | `Fetch Repository Metadata` |
| 5 | `WF2 Cancellation Terminal` | `noOp` | ROUTING_NODE | *(terminal)* |
| 6 | `Fetch Repository Metadata` | `httpRequest` | `GET` GITHUB `=https://api.github.com/repos/{{ $json.incidentData.repository_owner }}/{{ $json.incidentData.repository_name }}` timeout=`None` onError=`continueErrorOutput` | `Apply Repository Metadata`, `Failure Envelope - Fetch Repository Metadata` (main#1) |
| 7 | `Apply Repository Metadata` | `code` | code 1 lignes | `Policy Gate - Validate Constraints`, `Failure Envelope - Apply Repository Metadata` (main#1) |
| 7 | `Failure Envelope - Fetch Repository Metadata` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 8 | `Policy Gate - Validate Constraints` | `code` | code 74 lignes | `Patch Allowed?`, `Failure Envelope - Policy Gate - Validate Constraints` (main#1) |
| 8 | `Failure Envelope - Apply Repository Metadata` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 9 | `Patch Allowed?` | `if` | cond: `={{ $json.blocked }}  [?] true` | `Get Main Branch SHA1`, `Return Policy Rejected` (main#1) |
| 9 | `Failure Envelope - Policy Gate - Validate Constraints` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 10 | `Get Main Branch SHA1` | `httpRequest` | `GET` GITHUB `=https://api.github.com/repos/{{ $('Policy Gate - Validate Constraints').first().json.repository_owner }}/{{ $('Policy G` timeout=`None` onError=`continueErrorOutput` | `Prepare Batch Context`, `Failure Envelope - Get Main Branch SHA1` (main#1) |
| 10 | `Return Policy Rejected` | `code` | code 1 lignes | `Failure Envelope - Return Policy Rejected` |
| 11 | `Prepare Batch Context` | `code` | code 1 lignes | `Lookup Remediation Branch`, `Failure Envelope - Prepare Batch Context` (main#1) |
| 11 | `Failure Envelope - Get Main Branch SHA1` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 11 | `Failure Envelope - Return Policy Rejected` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 12 | `Lookup Remediation Branch` | `httpRequest` | `GET` GITHUB `=https://api.github.com/repos/{{ $json.repository_owner }}/{{ $json.repository_name }}/git/ref/heads/{{ encodeURICompone` timeout=`None` onError=`continueErrorOutput` | `Branch Exists?`, `Failure Envelope - Lookup Remediation Branch` (main#1) |
| 12 | `Failure Envelope - Prepare Batch Context` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 13 | `Branch Exists?` | `if` | cond: `={{ $json.statusCode }} [?] 200` | `Use Existing Branch`, `Record New Branch Baseline` (main#1) |
| 13 | `Failure Envelope - Lookup Remediation Branch` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 14 | `Use Existing Branch` | `code` | code 1 lignes | `Fetch Repository Tree`, `Failure Envelope - Use Existing Branch` (main#1) |
| 14 | `Record New Branch Baseline` | `code` | code 1 lignes | `Fetch Repository Tree`, `Failure Envelope - Record New Branch Baseline` (main#1) |
| 15 | `Fetch Repository Tree` | `httpRequest` | `GET` GITHUB `=https://api.github.com/repos/{{ $('Prepare Batch Context').first().json.repository_owner }}/{{ $('Prepare Batch Context` timeout=`None` onError=`continueErrorOutput` | `Build Independent Repository Policy`, `Failure Envelope - Fetch Repository Tree` (main#1) |
| 15 | `Failure Envelope - Use Existing Branch` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 15 | `Failure Envelope - Record New Branch Baseline` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 16 | `Build Independent Repository Policy` | `code` | code 15 lignes | `Expand Finding Source Files`, `Failure Envelope - Build Independent Repository Policy` (main#1) |
| 16 | `Failure Envelope - Fetch Repository Tree` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 17 | `Expand Finding Source Files` | `code` | code 4 lignes | `Fetch Finding Source Context`, `Failure Envelope - Expand Finding Source Files` (main#1) |
| 17 | `Failure Envelope - Build Independent Repository Policy` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 18 | `Fetch Finding Source Context` | `github` | — | `Expand Referenced API Sources`, `Failure Envelope - Fetch Finding Source Context` (main#1) |
| 18 | `Failure Envelope - Expand Finding Source Files` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 19 | `Expand Referenced API Sources` | `code` | code 60 lignes | `Fetch Referenced API Sources`, `Failure Envelope - Expand Referenced API Sources` (main#1) |
| 19 | `Failure Envelope - Fetch Finding Source Context` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 20 | `Fetch Referenced API Sources` | `github` | — | `Validate Source Context Completeness`, `Validate Source Context Completeness` (main#1) |
| 20 | `Failure Envelope - Expand Referenced API Sources` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 21 | `Validate Source Context Completeness` | `code` | code 6 lignes | `Expand Required Dependency Sources`, `Failure Envelope - Fetch Referenced API Sources` (main#1) |
| 22 | `Expand Required Dependency Sources` | `code` | code 70 lignes | `Fetch Required Dependency Sources`, `Failure Envelope - Fetch Referenced API Sources` (main#1) |
| 22 | `Failure Envelope - Fetch Referenced API Sources` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 23 | `Fetch Required Dependency Sources` | `github` | — | `Validate Required Dependency Sources`, `Validate Required Dependency Sources` (main#1) |
| 24 | `Validate Required Dependency Sources` | `code` | code 88 lignes | `Prepare Generic Remediation Plan`, `Failure Envelope - Fetch Referenced API Sources` (main#1) |
| 25 | `Prepare Generic Remediation Plan` | `code` | code 41 lignes | `Generate Remediation Plan`, `Failure Envelope - Prepare Generic Remediation Plan` (main#1) |
| 26 | `Generate Remediation Plan` | `httpRequest` | `POST` ANTHROPIC `https://api.anthropic.com/v1/messages` timeout=`180000` onError=`continueErrorOutput` | `Validate Generic Remediation Plan`, `Failure Envelope - Generate Remediation Plan` (main#1) |
| 26 | `Failure Envelope - Prepare Generic Remediation Plan` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 27 | `Validate Generic Remediation Plan` | `code` | code 99 lignes | `Merge Effective File Results`, `Failure Envelope - Validate Generic Remediation Plan` (main#1) |
| 27 | `Failure Envelope - Generate Remediation Plan` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 28 | `Merge Effective File Results` | `splitInBatches` | — | `Prepare Candidate Manifest`, `Route Planned File Operation` (main#1) |
| 28 | `Failure Envelope - Validate Generic Remediation Plan` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 29 | `Prepare Candidate Manifest` | `code` | code 67 lignes | `Classify Candidate Coordination Scope`, `Failure Envelope - Assemble Candidate Manifest` (main#1) |
| 29 | `Route Planned File Operation` | `if` | cond: `={{ $json.fileOperation }} [?] CREATE` | `Seed New Planned File`, `Fetch Repository Files` (main#1) |
| 30 | `Classify Candidate Coordination Scope` | `if` | cond: `={{ $json.files.length }} [?] 2` | `Hash Cross-File Candidate Manifest`, `Independent Semantic Review` (main#1) |
| 30 | `Failure Envelope - Assemble Candidate Manifest` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 30 | `Seed New Planned File` | `code` | code 2 lignes | `Prepare - Code Patch Body`, `Failure Envelope - Seed New Planned File` (main#1) |
| 30 | `Fetch Repository Files` | `github` | — | `Prepare - Code Patch Body`, `Failure Envelope - Fetch Repository Files` (main#1) |
| 31 | `Hash Cross-File Candidate Manifest` | `crypto` | — | `Validate Cross-File Candidate Manifest`, `Failure Envelope - Hash Cross-File Candidate Manifest` (main#1) |
| 31 | `Independent Semantic Review` | `httpRequest` | `POST` ANTHROPIC `https://api.anthropic.com/v1/messages` timeout=`180000` onError=`continueErrorOutput` | `Enforce Independent Review`, `Failure Envelope - Independent Semantic Review` (main#1) |
| 31 | `Prepare - Code Patch Body` | `code` | code 69 lignes | `de Patch - HTTP Request`, `Failure Envelope - Prepare - Code Patch Body` (main#1) |
| 31 | `Failure Envelope - Seed New Planned File` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 31 | `Failure Envelope - Fetch Repository Files` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 32 | `Validate Cross-File Candidate Manifest` | `code` | code 7 lignes | `Validate Cross-File Type Coherence`, `Failure Envelope - Validate Cross-File Candidate Manifest` (main#1) |
| 32 | `Failure Envelope - Hash Cross-File Candidate Manifest` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 32 | `Enforce Independent Review` | `code` | code 7 lignes | `Hash Candidate Manifest`, `Failure Envelope - Enforce Independent Review` (main#1) |
| 32 | `Failure Envelope - Independent Semantic Review` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 32 | `de Patch - HTTP Request` | `httpRequest` | `POST` ANTHROPIC `https://api.anthropic.com/v1/messages` timeout=`180000` onError=`continueErrorOutput` | `Parse - Code Patch Output`, `Failure Envelope - de Patch - HTTP Request` (main#1) |
| 32 | `Failure Envelope - Prepare - Code Patch Body` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 33 | `Validate Cross-File Type Coherence` | `code` | code 12 lignes | `Prepare Cross-File COMPILE_MAIN`, `Failure Envelope - Validate Cross-File Type Coherence` (main#1) |
| 33 | `Failure Envelope - Validate Cross-File Candidate Manifest` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 33 | `Hash Candidate Manifest` | `crypto` | — | `Assemble Candidate Manifest` |
| 33 | `Failure Envelope - Enforce Independent Review` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 33 | `Parse - Code Patch Output` | `code` | code 24 lignes | `Generic Candidate Preflight`, `Failure Envelope - Parse - Code Patch Output` (main#1) |
| 33 | `Failure Envelope - de Patch - HTTP Request` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 34 | `Prepare Cross-File COMPILE_MAIN` | `code` | code 8 lignes | `Call Cross-File COMPILE_MAIN`, `Failure Envelope - Prepare Cross-File COMPILE_MAIN` (main#1) |
| 34 | `Failure Envelope - Validate Cross-File Type Coherence` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 34 | `Assemble Candidate Manifest` | `code` | code 1 lignes | `Call Candidate Verification`, `Failure Envelope - Assemble Candidate Manifest` (main#1) |
| 34 | `Generic Candidate Preflight` | `code` | code 45 lignes | `Hash Candidate File Content`, `Failure Envelope - Generic Candidate Preflight` (main#1) |
| 34 | `Failure Envelope - Parse - Code Patch Output` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 35 | `Call Cross-File COMPILE_MAIN` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/candidate-verification/verify` timeout=`300000` onError=`continueErrorOutput` | `Enforce Cross-File COMPILE_MAIN`, `Failure Envelope - Call Cross-File COMPILE_MAIN` (main#1) |
| 35 | `Failure Envelope - Prepare Cross-File COMPILE_MAIN` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 35 | `Call Candidate Verification` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/candidate-verification/verify` timeout=`300000` onError=`continueErrorOutput` | `Call Write Guard`, `Failure Envelope - Call Candidate Verification` (main#1) |
| 35 | `Hash Candidate File Content` | `crypto` | — | `Accumulate Candidate File` |
| 35 | `Failure Envelope - Generic Candidate Preflight` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 36 | `Enforce Cross-File COMPILE_MAIN` | `code` | code 7 lignes | `Prepare Cross-File COMPILE_TESTS`, `Failure Envelope - Enforce Cross-File COMPILE_MAIN` (main#1) |
| 36 | `Failure Envelope - Call Cross-File COMPILE_MAIN` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 36 | `Call Write Guard` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/candidate-verification/write-guard` timeout=`15000` onError=`continueErrorOutput` | `Write Guard Passed?`, `Failure Envelope - Call Write Guard` (main#1) |
| 36 | `Failure Envelope - Call Candidate Verification` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 36 | `Accumulate Candidate File` | `code` | code 1 lignes | `Merge Effective File Results`, `Failure Envelope - Accumulate Candidate File` (main#1) |
| 37 | `Prepare Cross-File COMPILE_TESTS` | `code` | code 8 lignes | `Call Cross-File COMPILE_TESTS`, `Failure Envelope - Prepare Cross-File COMPILE_TESTS` (main#1) |
| 37 | `Failure Envelope - Enforce Cross-File COMPILE_MAIN` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 37 | `Write Guard Passed?` | `if` | cond: `={{ $json.ok }} [?] True` | `Branch Existed At Generation?`, `Persist Verification Failure` (main#1) |
| 37 | `Failure Envelope - Call Write Guard` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 37 | `Failure Envelope - Accumulate Candidate File` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 38 | `Call Cross-File COMPILE_TESTS` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/candidate-verification/verify` timeout=`300000` onError=`continueErrorOutput` | `Enforce Cross-File COMPILE_TESTS`, `Failure Envelope - Call Cross-File COMPILE_TESTS` (main#1) |
| 38 | `Failure Envelope - Prepare Cross-File COMPILE_TESTS` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 38 | `Branch Existed At Generation?` | `if` | cond: `={{ $('Assemble Candidate Manifest').first().json.branchExists }} [?] True` | `Re-check Existing Branch Head`, `Re-lookup Baseline Ref Before Creation` (main#1) |
| 38 | `Persist Verification Failure` | `code` | code 11 lignes | `Prepare WF2 Failure Status` |
| 39 | `Enforce Cross-File COMPILE_TESTS` | `code` | code 7 lignes | `Prepare Cross-File FULL_TEST`, `Failure Envelope - Enforce Cross-File COMPILE_TESTS` (main#1) |
| 39 | `Failure Envelope - Call Cross-File COMPILE_TESTS` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 39 | `Re-check Existing Branch Head` | `httpRequest` | `GET` GITHUB `=https://api.github.com/repos/{{ $('Assemble Candidate Manifest').first().json.repository.split('/')[0] }}/{{ $('Assembl` timeout=`None` onError=`continueErrorOutput` | `Call Remote Head Drift Guard`, `Failure Envelope - Re-check Existing Branch Head` (main#1) |
| 39 | `Re-lookup Baseline Ref Before Creation` | `httpRequest` | `GET` GITHUB `=https://api.github.com/repos/{{ $('Assemble Candidate Manifest').first().json.repository.split('/')[0] }}/{{ $('Assembl` timeout=`None` onError=`continueErrorOutput` | `Call Remote Head Drift Guard`, `Failure Envelope - Re-lookup Baseline Ref Before Creation` (main#1) |
| 40 | `Prepare Cross-File FULL_TEST` | `code` | code 8 lignes | `Call Cross-File FULL_TEST`, `Failure Envelope - Prepare Cross-File FULL_TEST` (main#1) |
| 40 | `Failure Envelope - Enforce Cross-File COMPILE_TESTS` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 40 | `Call Remote Head Drift Guard` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/candidate-verification/remote-head-drift` timeout=`15000` onError=`continueErrorOutput` | `Remote Head Drift Passed?`, `Failure Envelope - Call Remote Head Drift Guard` (main#1) |
| 40 | `Failure Envelope - Re-check Existing Branch Head` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 40 | `Failure Envelope - Re-lookup Baseline Ref Before Creation` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 41 | `Call Cross-File FULL_TEST` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/candidate-verification/verify` timeout=`300000` onError=`continueErrorOutput` | `Enforce Cross-File FULL_TEST`, `Failure Envelope - Call Cross-File FULL_TEST` (main#1) |
| 41 | `Failure Envelope - Prepare Cross-File FULL_TEST` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 41 | `Remote Head Drift Passed?` | `if` | cond: `={{ $json.ok }} [?] True` | `Pre-Git Cancellation Gate`, `Persist Base Moved Failure` (main#1) |
| 41 | `Failure Envelope - Call Remote Head Drift Guard` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 42 | `Enforce Cross-File FULL_TEST` | `code` | code 7 lignes | `Prepare Cross-File Review`, `Failure Envelope - Enforce Cross-File FULL_TEST` (main#1) |
| 42 | `Failure Envelope - Call Cross-File FULL_TEST` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 42 | `Pre-Git Cancellation Gate` | `httpRequest` | `POST` BACKEND `={{ (() => { const e=$('Capture Correlation Envelope').first().json.correlationEnvelope; return 'http://backend:3001/api` timeout=`15000` onError=`None` | `Git Write Allowed?` |
| 42 | `Persist Base Moved Failure` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 43 | `Prepare Cross-File Review` | `code` | code 7 lignes | `Independent Cross-File Semantic Review`, `Failure Envelope - Prepare Cross-File Review` (main#1) |
| 43 | `Failure Envelope - Enforce Cross-File FULL_TEST` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 43 | `Git Write Allowed?` | `if` | cond: `={{ $json.allowed === true && $json.cancelRequested === false }} [?] True` | `Restore Pre-Git Context`, `WF2 Cancellation Terminal` (main#1) |
| 44 | `Independent Cross-File Semantic Review` | `httpRequest` | `POST` ANTHROPIC `https://api.anthropic.com/v1/messages` timeout=`180000` onError=`continueErrorOutput` | `Enforce Cross-File Review`, `Failure Envelope - Independent Cross-File Semantic Review` (main#1) |
| 44 | `Failure Envelope - Prepare Cross-File Review` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 44 | `Restore Pre-Git Context` | `code` | code 1 lignes | `Branch Existed At Generation? (Pass 2 Entry)` |
| 45 | `Enforce Cross-File Review` | `code` | code 7 lignes | `Hash Candidate Manifest`, `Failure Envelope - Enforce Cross-File Review` (main#1) |
| 45 | `Failure Envelope - Independent Cross-File Semantic Review` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 45 | `Branch Existed At Generation? (Pass 2 Entry)` | `if` | cond: `={{ $('Assemble Candidate Manifest').first().json.branchExists }} [?] True` | `Expand Manifest Files`, `Re-lookup Remediation Branch Before Create` (main#1) |
| 46 | `Failure Envelope - Enforce Cross-File Review` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 46 | `Expand Manifest Files` | `code` | code 1 lignes | `Loop Over Manifest Files`, `Failure Envelope - Expand Manifest Files` (main#1) |
| 46 | `Re-lookup Remediation Branch Before Create` | `httpRequest` | `GET` GITHUB `=https://api.github.com/repos/{{ $('Assemble Candidate Manifest').first().json.repository.split('/')[0] }}/{{ $('Assembl` timeout=`None` onError=`continueErrorOutput` | `Prepare Branch Creation`, `Failure Envelope - Re-lookup Remediation Branch Before Create` (main#1) |
| 47 | `Loop Over Manifest Files` | `splitInBatches` | — | `Validate Batch Completeness`, `Recompute Content Hash Before Send` (main#1) |
| 47 | `Failure Envelope - Expand Manifest Files` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 47 | `Prepare Branch Creation` | `code` | code 1 lignes | `Create Missing Branch`, `Failure Envelope - Prepare Branch Creation` (main#1) |
| 47 | `Failure Envelope - Re-lookup Remediation Branch Before Create` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 48 | `Validate Batch Completeness` | `code` | code 55 lignes | `Lookup Existing Batch PR`, `Failure Envelope - Validate Batch Completeness` (main#1) |
| 48 | `Recompute Content Hash Before Send` | `crypto` | — | `Verify Content Hash Before Send` |
| 48 | `Create Missing Branch` | `httpRequest` | `POST` GITHUB `=https://api.github.com/repos/{{ $json.repository_owner }}/{{ $json.repository_name }}/git/refs` timeout=`None` onError=`continueErrorOutput` | `Expand Manifest Files`, `Failure Envelope - Create Missing Branch` (main#1) |
| 48 | `Failure Envelope - Prepare Branch Creation` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 49 | `Lookup Existing Batch PR` | `httpRequest` | `GET` GITHUB `=https://api.github.com/repos/{{ $('Prepare Batch Context').first().json.repository_owner }}/{{ $('Prepare Batch Context` timeout=`None` onError=`continueErrorOutput` | `Select Existing PR`, `Failure Envelope - Lookup Existing Batch PR` (main#1) |
| 49 | `Failure Envelope - Validate Batch Completeness` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 49 | `Verify Content Hash Before Send` | `code` | code 1 lignes | `Candidate Creates File?`, `Failure Envelope - Verify Content Hash Before Send` (main#1) |
| 49 | `Failure Envelope - Create Missing Branch` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 50 | `Select Existing PR` | `code` | code 1 lignes | `Existing PR?`, `Failure Envelope - Select Existing PR` (main#1) |
| 50 | `Failure Envelope - Lookup Existing Batch PR` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 50 | `Candidate Creates File?` | `if` | cond: `={{ $json.fileOperation }} [?] CREATE` | `Create File in Branch`, `Update File in Branch` (main#1) |
| 50 | `Failure Envelope - Verify Content Hash Before Send` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 51 | `Existing PR?` | `if` | cond: `={{ $json.createRequired }} [?] False` | `Use Existing PR`, `Create Pull Request1` (main#1) |
| 51 | `Failure Envelope - Select Existing PR` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 51 | `Create File in Branch` | `github` | — | `Build File Result (Pass 2)`, `Failure Envelope - Create File in Branch` (main#1) |
| 51 | `Update File in Branch` | `github` | — | `Build File Result (Pass 2)`, `Classify GitHub Write Error (Pass 2)` (main#1) |
| 52 | `Use Existing PR` | `code` | code 1 lignes | `Save Execution Result to Backend`, `Failure Envelope - Use Existing PR` (main#1) |
| 52 | `Create Pull Request1` | `httpRequest` | `POST` GITHUB `=https://api.github.com/repos/{{ $('Prepare Batch Context').first().json.repository_owner }}/{{ $('Prepare Batch Context` timeout=`None` onError=`continueErrorOutput` | `Save Execution Result to Backend`, `Failure Envelope - Create Pull Request1` (main#1) |
| 52 | `Build File Result (Pass 2)` | `code` | code 1 lignes | `Merge Effective File Results 2`, `Failure Envelope - Build File Result (Pass 2)` (main#1) |
| 52 | `Failure Envelope - Create File in Branch` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 52 | `Classify GitHub Write Error (Pass 2)` | `code` | code 1 lignes | `Transport Requires Read Back? (Pass 2)` |
| 53 | `Save Execution Result to Backend` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/incidents/{{ $items('Capture Correlation Envelope',0,0)[0].json.correlationEnvelope.incidentId ` timeout=`None` onError=`continueErrorOutput` | `If`, `Failure Envelope - Save Execution Result to Backend` (main#1) |
| 53 | `Failure Envelope - Use Existing PR` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 53 | `Failure Envelope - Create Pull Request1` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 53 | `Merge Effective File Results 2` | `noOp` | ROUTING_NODE | `Loop Over Manifest Files` |
| 53 | `Failure Envelope - Build File Result (Pass 2)` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 53 | `Transport Requires Read Back? (Pass 2)` | `if` | cond: `={{ $json.requiresReadBack }} [?] True` | `Read Back File After Write Error (Pass 2)`, `Failure Envelope - Transport Requires Read Back? (Pass 2)` (main#1) |
| 54 | `If` | `if` | cond: `={{ $('Policy Gate - Validate Constraints').first().json.decision }} [?] FIX_PROPOSED` | `Send an Email` |
| 54 | `Failure Envelope - Save Execution Result to Backend` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 54 | `Read Back File After Write Error (Pass 2)` | `github` | — | `Decode Reconciled Remote Content`, `Failure Envelope - Read Back File After Write Error (Pass 2)` (main#1) |
| 54 | `Failure Envelope - Transport Requires Read Back? (Pass 2)` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 55 | `Send an Email` | `emailSend` | — | *(terminal)* |
| 55 | `Decode Reconciled Remote Content` | `code` | code 1 lignes | `Hash Reconciled Remote Content` |
| 55 | `Failure Envelope - Read Back File After Write Error (Pass 2)` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 56 | `Hash Reconciled Remote Content` | `crypto` | — | `Evaluate GitHub Write Reconciliation (Pass 2)` |
| 57 | `Evaluate GitHub Write Reconciliation (Pass 2)` | `code` | code 1 lignes | `Remote Candidate Present? (Pass 2)` |
| 58 | `Remote Candidate Present? (Pass 2)` | `if` | cond: `={{ $json.reconciledWrite }} [?] True` | `Lookup Head After Reconciled Write (Pass 2)`, `Failure Envelope - Remote Candidate Present? (Pass 2)` (main#1) |
| 59 | `Lookup Head After Reconciled Write (Pass 2)` | `httpRequest` | `GET` GITHUB `=https://api.github.com/repos/{{ $('Expand Manifest Files').item.json.repository_owner }}/{{ $('Expand Manifest Files').` timeout=`None` onError=`continueErrorOutput` | `Build Reconciled File Result`, `Failure Envelope - Lookup Head After Reconciled Write (Pass 2)` (main#1) |
| 59 | `Failure Envelope - Remote Candidate Present? (Pass 2)` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 60 | `Build Reconciled File Result` | `code` | code 1 lignes | `Merge Effective File Results 2`, `Failure Envelope - Build Reconciled File Result` (main#1) |
| 60 | `Failure Envelope - Lookup Head After Reconciled Write (Pass 2)` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| 61 | `Failure Envelope - Build Reconciled File Result` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| — | `Build File Result` | `code` | code 1 lignes | `Merge Effective File Results`, `Failure Envelope - Build File Result` (main#1) |
| — | `Classify GitHub Write Error` | `code` | code 1 lignes | `Transport Requires Read Back?` |
| — | `Transport Requires Read Back?` | `if` | cond: `={{ $json.requiresReadBack }} [?] True` | `Read Back File After Write Error`, `Failure Envelope - Transport Requires Read Back?` (main#1) |
| — | `Read Back File After Write Error` | `github` | — | `Evaluate GitHub Write Reconciliation`, `Failure Envelope - Read Back File After Write Error` (main#1) |
| — | `Evaluate GitHub Write Reconciliation` | `code` | code 1 lignes | `Remote Candidate Present?`, `Failure Envelope - Evaluate GitHub Write Reconciliation` (main#1) |
| — | `Remote Candidate Present?` | `if` | cond: `={{ $json.reconciledWrite }} [?] True` | `Lookup Head After Reconciled Write`, `Failure Envelope - Remote Candidate Present?` (main#1) |
| — | `Lookup Head After Reconciled Write` | `httpRequest` | `GET` GITHUB `=https://api.github.com/repos/{{ $('Enforce Independent Review').item.json.repository_owner }}/{{ $('Enforce Independent` timeout=`None` onError=`continueErrorOutput` | `Build Reconciled File Result`, `Failure Envelope - Lookup Head After Reconciled Write` (main#1) |
| — | `Failure Envelope - Build File Result` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| — | `Failure Envelope - Transport Requires Read Back?` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| — | `Failure Envelope - Read Back File After Write Error` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| — | `Failure Envelope - Evaluate GitHub Write Reconciliation` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| — | `Failure Envelope - Remote Candidate Present?` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |
| — | `Failure Envelope - Lookup Head After Reconciled Write` | `code` | code 1 lignes | `Prepare WF2 Failure Status` |

### Zones documentaires présentes sur le canevas

- Zone 1 — Blocs 1, 2, 3 : Reception & correlation, Grounding des sources, Planification (34 noeuds)
- Zone 2 — Blocs 4, 5 + extension cross-fichiers (Blocs 6/7) : Generation du patch, preflight, verification multi-fichiers (29 noeuds)
- Zone 3 — Bloc 8, debut : Verification du candidat et garde d'ecriture (15 noeuds)
- Zone 4 — Bloc 8, boucle Pass-2 : Ecriture et reconciliation Git (16 noeuds)
- Zone 5 — Bloc 8, fin : Completude du lot et Pull Request (10 noeuds)
- Zone 6 — Chemins d'echec, transversal, tous blocs (78 noeuds)

## WF3 - Post-PR Validation v4

- **ID** : `4JiOKpyHhx1znTYw`  ·  **actif** : `True`  ·  **versionId** : `5488b9c5-337b-4598-9c90-2b0cbc4fd21a`
- **Dernière mise à jour** : `2026-10-04T23:19:21.961Z`
- **Nœuds** : 11 au total — 11 fonctionnels, 0 notes autocollantes (documentation sur le canevas)
- **Atteignables depuis les déclencheurs** : 11 / 11 (aucun nœud mort)
- **Arêtes pendantes** : 0
- **Points d'entrée** : `WF3 Trigger`

Répartition par type de nœud : `code` × 5, `httpRequest` × 4, `postgres` × 1, `executeWorkflowTrigger` × 1

### Cibles HTTP sortantes

| Destination | Nœuds | Détail |
|---|---|---|
| **autre** | 1 | `GET` Get SonarQube Approved Findings |
| **backend** | 1 | `POST` Persist Correlated Validation |
| **sonarqube** | 2 | `GET` Get SonarQube PR Quality Gate; `GET` Get Full Candidate Sonar Snapshot |

### Catalogue des nœuds

| Prof. | Nœud | Type | Détail | Suivant(s) |
|---|---|---|---|---|
| 0 | `WF3 Trigger` | `executeWorkflowTrigger` | — | `Extract Validation Context` |
| 1 | `Extract Validation Context` | `code` | code 7 lignes | `Get SonarQube PR Quality Gate` |
| 2 | `Get SonarQube PR Quality Gate` | `httpRequest` | `GET`  `=http://sonarqube:9000/api/qualitygates/project_status?analysisId={{ $('Extract Validation Context').first().json.analys` timeout=`15000` onError=`continueRegularOutput` | `Get Incident From DB` |
| 3 | `Get Incident From DB` | `postgres` | — | `Prepare Approved Finding Validation` |
| 4 | `Prepare Approved Finding Validation` | `code` | code 17 lignes | `Get SonarQube Approved Findings` |
| 5 | `Get SonarQube Approved Findings` | `httpRequest` | `GET`  `={{ $json.url }}` timeout=`15000` onError=`continueErrorOutput` | `Collect Target Finding Evidence`, `Collect Target Finding Evidence` (main#1) |
| 6 | `Collect Target Finding Evidence` | `code` | code 53 lignes | `Get Full Candidate Sonar Snapshot` |
| 7 | `Get Full Candidate Sonar Snapshot` | `httpRequest` | `GET`  `http://sonarqube:9000/api/issues/search` timeout=`15000` onError=`continueErrorOutput` | `Consolidate Full Candidate Sonar Snapshot`, `Consolidate Full Candidate Sonar Snapshot` (main#1) |
| 8 | `Consolidate Full Candidate Sonar Snapshot` | `code` | code 45 lignes | `Consolidate Validation Result` |
| 9 | `Consolidate Validation Result` | `code` | code 20 lignes | `Persist Correlated Validation` |
| 10 | `Persist Correlated Validation` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/incidents/{{ $('Consolidate Validation Result').first().json.incidentId }}/validation` timeout=`15000` onError=`continueRegularOutput` | *(terminal)* |

## WF4 - Jenkinsfile Optimizer v5

- **ID** : `x4oTJ4HbkC1R526b`  ·  **actif** : `True`  ·  **versionId** : `63c57b0a-01b2-4fc2-a571-6c1dc7bf4e33`
- **Dernière mise à jour** : `2026-10-04T23:18:16.341Z`
- **Nœuds** : 50 au total — 50 fonctionnels, 0 notes autocollantes (documentation sur le canevas)
- **Atteignables depuis les déclencheurs** : 50 / 50 (aucun nœud mort)
- **Arêtes pendantes** : 0
- **Points d'entrée** : `Webhook - Optimize`, `Webhook - Apply`, `Webhook - Fetch`

Répartition par type de nœud : `code` × 25, `httpRequest` × 8, `github` × 7, `if` × 4, `webhook` × 3, `respondToWebhook` × 3

### Cibles HTTP sortantes

| Destination | Nœuds | Détail |
|---|---|---|
| **api.anthropic.com** | 2 | `POST` Apply Agent; `POST` Jenkinsfile Optimizer Agent |
| **api.github.com** | 3 | `GET` Get Base SHA; `POST` Create Branch; `POST` Create Pull Request |
| **backend** | 3 | `POST` Send Apply Callback; `POST` Send Result to Backend; `POST` Send Error to Backend |

### Catalogue des nœuds

| Prof. | Nœud | Type | Détail | Suivant(s) |
|---|---|---|---|---|
| 0 | `Webhook - Optimize` | `webhook` | path=`jenkinsfile-optimize` method=`POST` auth=`<NONE>` | `Prepare - Optimizer Body` |
| 0 | `Webhook - Apply` | `webhook` | path=`jenkinsfile-apply` method=`POST` auth=`<NONE>` | `Authorize Backend Approval` |
| 0 | `Webhook - Fetch` | `webhook` | path=`jenkinsfile-fetch` method=`POST` auth=`<NONE>` | `Prepare - Fetch Body` |
| 1 | `Prepare - Optimizer Body` | `code` | code 139 lignes | `Input Valid ?` |
| 1 | `Authorize Backend Approval` | `code` | code 1 lignes | `Prepare - Apply Body` |
| 1 | `Prepare - Fetch Body` | `code` | code 7 lignes | `Fetch Valid ?` |
| 2 | `Input Valid ?` | `if` | cond: `={{ $json.error }} [?] ` | `Fetch pom.xml`, `Format Input Error` (main#1) |
| 2 | `Prepare - Apply Body` | `code` | code 38 lignes | `Apply Valid ?` |
| 2 | `Fetch Valid ?` | `if` | cond: `={{ $json.error }} [?] ` | `Fetch Jenkinsfile from Git`, `Format Fetch Error` (main#1) |
| 3 | `Fetch pom.xml` | `github` | — | `Format pom.xml OK`, `Format pom.xml Err` (main#1) |
| 3 | `Format Input Error` | `code` | code 2 lignes | `Respond - Analysis` |
| 3 | `Apply Valid ?` | `if` | cond: `={{ $json.error }} [?] ` | `Build Apply Prompt`, `Format Apply Error` (main#1) |
| 3 | `Fetch Jenkinsfile from Git` | `github` | — | `Format Fetch Result`, `Format Fetch Error` (main#1) |
| 3 | `Format Fetch Error` | `code` | code 4 lignes | `Respond - Fetch` |
| 4 | `Format pom.xml OK` | `code` | code 8 lignes | `Fetch build.gradle` |
| 4 | `Format pom.xml Err` | `code` | code 1 lignes | `Fetch build.gradle` |
| 4 | `Respond - Analysis` | `respondToWebhook` | — | *(terminal)* |
| 4 | `Build Apply Prompt` | `code` | code 51 lignes | `Apply Agent` |
| 4 | `Format Apply Error` | `code` | code 12 lignes | `Send Apply Callback` |
| 4 | `Format Fetch Result` | `code` | code 13 lignes | `Respond - Fetch` |
| 4 | `Respond - Fetch` | `respondToWebhook` | — | *(terminal)* |
| 5 | `Fetch build.gradle` | `github` | — | `Format build.gradle OK`, `Format build.gradle Err` (main#1) |
| 5 | `Apply Agent` | `httpRequest` | `POST` ANTHROPIC `https://api.anthropic.com/v1/messages` timeout=`180000` onError=`continueRegularOutput` | `Parse Apply Output` |
| 5 | `Send Apply Callback` | `httpRequest` | `POST` BACKEND `=http://pfe-backend:3001/api/jenkins/apply/{{ $('Webhook - Apply').first().json.body.applyId }}/callback` timeout=`10000` onError=`continueRegularOutput` | `Respond - Apply` |
| 6 | `Format build.gradle OK` | `code` | code 8 lignes | `Fetch Dockerfile Context` |
| 6 | `Format build.gradle Err` | `code` | code 1 lignes | `Fetch Dockerfile Context` |
| 6 | `Parse Apply Output` | `code` | code 49 lignes | `Apply Gate OK ?` |
| 6 | `Respond - Apply` | `respondToWebhook` | — | *(terminal)* |
| 7 | `Fetch Dockerfile Context` | `github` | — | `Format Dockerfile OK`, `Format Dockerfile Err` (main#1) |
| 7 | `Apply Gate OK ?` | `if` | cond: `={{ $json.gateOk }} [?] True` | `Get Base SHA`, `Format Apply Error` (main#1) |
| 8 | `Format Dockerfile OK` | `code` | code 8 lignes | `Fetch mvnw` |
| 8 | `Format Dockerfile Err` | `code` | code 4 lignes | `Fetch mvnw` |
| 8 | `Get Base SHA` | `httpRequest` | `GET` GITHUB `=https://api.github.com/repos/{{ $('Prepare - Apply Body').first().json.owner }}/{{ $('Prepare - Apply Body').first().js` timeout=`None` onError=`continueErrorOutput` | `Create Branch`, `Format Apply Error` (main#1) |
| 9 | `Fetch mvnw` | `github` | — | `Format mvnw OK`, `Format mvnw Err` (main#1) |
| 9 | `Create Branch` | `httpRequest` | `POST` GITHUB `=https://api.github.com/repos/{{ $('Prepare - Apply Body').first().json.owner }}/{{ $('Prepare - Apply Body').first().js` timeout=`None` onError=`continueErrorOutput` | `Commit Jenkinsfile`, `Format Apply Error` (main#1) |
| 10 | `Format mvnw OK` | `code` | code 8 lignes | `Fetch gradlew` |
| 10 | `Format mvnw Err` | `code` | code 4 lignes | `Fetch gradlew` |
| 10 | `Commit Jenkinsfile` | `github` | — | `Create Pull Request`, `Format Apply Error` (main#1) |
| 11 | `Fetch gradlew` | `github` | — | `Format gradlew OK`, `Format gradlew Err` (main#1) |
| 11 | `Create Pull Request` | `httpRequest` | `POST` GITHUB `=https://api.github.com/repos/{{ $('Prepare - Apply Body').first().json.owner }}/{{ $('Prepare - Apply Body').first().js` timeout=`None` onError=`continueErrorOutput` | `Format Apply Result`, `Format Apply Error` (main#1) |
| 12 | `Format gradlew OK` | `code` | code 8 lignes | `Build Project Context` |
| 12 | `Format gradlew Err` | `code` | code 4 lignes | `Build Project Context` |
| 12 | `Format Apply Result` | `code` | code 10 lignes | `Send Apply Callback` |
| 13 | `Build Project Context` | `code` | code 142 lignes | `Jenkinsfile Optimizer Agent` |
| 14 | `Jenkinsfile Optimizer Agent` | `httpRequest` | `POST` ANTHROPIC `https://api.anthropic.com/v1/messages` timeout=`180000` onError=`continueErrorOutput` | `Parse - Optimizer Output`, `Format Agent Error` (main#1) |
| 15 | `Parse - Optimizer Output` | `code` | code 59 lignes | `Respond - Analysis`, `Send Result to Backend`, `Format Parse Error` (main#1) |
| 15 | `Format Agent Error` | `code` | code 6 lignes | `Send Error to Backend` |
| 16 | `Send Result to Backend` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/jenkins/optimize/{{ $('Webhook - Optimize').first().json.body.jobId }}/callback` timeout=`None` onError=`continueRegularOutput` | *(terminal)* |
| 16 | `Format Parse Error` | `code` | code 6 lignes | `Send Error to Backend` |
| 16 | `Send Error to Backend` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/jenkins/optimize/{{ $json.jobId }}/callback` timeout=`None` onError=`continueRegularOutput` | *(terminal)* |

## WF5 - Dockerfile Optimizer

- **ID** : `b7SEqPJK3weGXziV`  ·  **actif** : `True`  ·  **versionId** : `2a10b436-f8ed-40a4-b946-f5ab13b10ac8`
- **Dernière mise à jour** : `2026-10-04T23:18:28.252Z`
- **Nœuds** : 40 au total — 40 fonctionnels, 0 notes autocollantes (documentation sur le canevas)
- **Atteignables depuis les déclencheurs** : 40 / 40 (aucun nœud mort)
- **Arêtes pendantes** : 0
- **Points d'entrée** : `Webhook - Dockerfile Fetch`, `Webhook - Dockerfile Optimize`, `Webhook - Dockerfile Apply`

Répartition par type de nœud : `code` × 20, `httpRequest` × 7, `if` × 5, `respondToWebhook` × 3, `webhook` × 3, `github` × 2

### Cibles HTTP sortantes

| Destination | Nœuds | Détail |
|---|---|---|
| **api.anthropic.com** | 2 | `POST` Dockerfile Optimizer Agent; `POST` Dockerfile Apply Agent |
| **api.github.com** | 3 | `GET` Get Base SHA (Docker); `POST` Create Branch (Docker); `POST` Create Pull Request (Docker) |
| **backend** | 2 | `POST` Send Result to Backend; `POST` Send Error to Backend |

### Catalogue des nœuds

| Prof. | Nœud | Type | Détail | Suivant(s) |
|---|---|---|---|---|
| 0 | `Webhook - Dockerfile Fetch` | `webhook` | path=`dockerfile-fetch` method=`POST` auth=`<NONE>` | `Prepare - Fetch Body` |
| 0 | `Webhook - Dockerfile Optimize` | `webhook` | path=`dockerfile-optimize` method=`POST` auth=`<NONE>` | `Prepare - Optimizer Body` |
| 0 | `Webhook - Dockerfile Apply` | `webhook` | path=`dockerfile-apply` method=`POST` auth=`<NONE>` | `Authorize Backend Approval` |
| 1 | `Prepare - Fetch Body` | `code` | code 7 lignes | `Fetch Valid ?` |
| 1 | `Prepare - Optimizer Body` | `code` | code 58 lignes | `Input Valid ?` |
| 1 | `Authorize Backend Approval` | `code` | code 1 lignes | `Prepare - Apply Body` |
| 2 | `Fetch Valid ?` | `if` | cond: `={{ $json.error }} [?] ` | `Fetch Dockerfile from Git`, `Format Fetch Error` (main#1) |
| 2 | `Input Valid ?` | `if` | cond: `={{ $json.error }} [?] ` | `Runtime Coherence Checker`, `Format Input Error` (main#1) |
| 2 | `Prepare - Apply Body` | `code` | code 19 lignes | `Apply Input Valid ?` |
| 3 | `Fetch Dockerfile from Git` | `github` | — | `Format Fetch Result`, `Format Fetch Error` (main#1) |
| 3 | `Format Fetch Error` | `code` | code 4 lignes | `Respond - Fetch` |
| 3 | `Runtime Coherence Checker` | `code` | code 421 lignes | `Dockerfile Optimizer Agent` |
| 3 | `Format Input Error` | `code` | code 2 lignes | `Respond - Analysis` |
| 3 | `Apply Input Valid ?` | `if` | cond: `={{ $json.error }} [?] ` | `Build Apply Prompt`, `Format Apply Input Error` (main#1) |
| 4 | `Format Fetch Result` | `code` | code 13 lignes | `Respond - Fetch` |
| 4 | `Respond - Fetch` | `respondToWebhook` | — | *(terminal)* |
| 4 | `Dockerfile Optimizer Agent` | `httpRequest` | `POST` ANTHROPIC `https://api.anthropic.com/v1/messages` timeout=`180000` onError=`continueErrorOutput` | `Parse - Optimizer Output`, `Format Agent Error` (main#1) |
| 4 | `Respond - Analysis` | `respondToWebhook` | — | *(terminal)* |
| 4 | `Build Apply Prompt` | `code` | code 42 lignes | `Dockerfile Apply Agent` |
| 4 | `Format Apply Input Error` | `code` | code 2 lignes | `Respond - Apply Agent` |
| 5 | `Parse - Optimizer Output` | `code` | code 39 lignes | `Respond - Analysis`, `Send Result to Backend`, `Format Parse Error` (main#1) |
| 5 | `Format Agent Error` | `code` | code 6 lignes | `Send Error to Backend` |
| 5 | `Dockerfile Apply Agent` | `httpRequest` | `POST` ANTHROPIC `https://api.anthropic.com/v1/messages` timeout=`180000` onError=`continueErrorOutput` | `Parse Apply Output`, `Format Apply Agent Error` (main#1) |
| 5 | `Respond - Apply Agent` | `respondToWebhook` | — | *(terminal)* |
| 6 | `Send Result to Backend` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/dockerfile/optimize/{{ $('Webhook - Dockerfile Optimize').first().json.body.jobId }}/callback` timeout=`None` onError=`continueRegularOutput` | *(terminal)* |
| 6 | `Format Parse Error` | `code` | code 6 lignes | `Send Error to Backend` |
| 6 | `Send Error to Backend` | `httpRequest` | `POST` BACKEND `=http://backend:3001/api/dockerfile/optimize/{{ $json.jobId }}/callback` timeout=`None` onError=`continueRegularOutput` | *(terminal)* |
| 6 | `Parse Apply Output` | `code` | code 22 lignes | `Apply Gate — Docker Déterministe` |
| 6 | `Format Apply Agent Error` | `code` | code 8 lignes | `Respond - Apply Agent` |
| 7 | `Apply Gate — Docker Déterministe` | `code` | code 166 lignes | `Gate OK ?` |
| 8 | `Gate OK ?` | `if` | cond: `={{ $json.gateOk }} [?] True` | `Prepare PR Body`, `Format Gate Rejected` (main#1) |
| 9 | `Prepare PR Body` | `code` | code 48 lignes | `PR Input Valid ?` |
| 9 | `Format Gate Rejected` | `code` | code 9 lignes | `Respond - Apply Agent` |
| 10 | `PR Input Valid ?` | `if` | cond: `={{ $json.prError }} [?] ` | `Get Base SHA (Docker)`, `Format PR Input Error` (main#1) |
| 11 | `Get Base SHA (Docker)` | `httpRequest` | `GET` GITHUB `=https://api.github.com/repos/{{ $('Prepare PR Body').first().json.owner }}/{{ $('Prepare PR Body').first().json.repo }}` timeout=`None` onError=`continueErrorOutput` | `Create Branch (Docker)` |
| 11 | `Format PR Input Error` | `code` | code 2 lignes | `Respond - Apply Agent` |
| 12 | `Create Branch (Docker)` | `httpRequest` | `POST` GITHUB `=https://api.github.com/repos/{{ $('Prepare PR Body').first().json.owner }}/{{ $('Prepare PR Body').first().json.repo }}` timeout=`None` onError=`None` | `Commit Dockerfile` |
| 13 | `Commit Dockerfile` | `github` | — | `Create Pull Request (Docker)` |
| 14 | `Create Pull Request (Docker)` | `httpRequest` | `POST` GITHUB `=https://api.github.com/repos/{{ $('Prepare PR Body').first().json.owner }}/{{ $('Prepare PR Body').first().json.repo }}` timeout=`None` onError=`None` | `Format Apply PR Result` |
| 15 | `Format Apply PR Result` | `code` | code 12 lignes | `Respond - Apply Agent` |

## WF6 — Security Remediation (Maven, V1.6 offline draft)

- **ID** : `RdYyfjVpOm2LxS95`  ·  **actif** : `True`  ·  **versionId** : `0470ab42-713a-4097-a9a7-72c8f00bacde`
- **Dernière mise à jour** : `2026-10-05T16:40:02.000Z`
- **Nœuds** : 184 au total — 177 fonctionnels, 7 notes autocollantes (documentation sur le canevas)
- **Atteignables depuis les déclencheurs** : 177 / 177 (aucun nœud mort)
- **Arêtes pendantes** : 0
- **Points d'entrée** : `Webhook - Security Remediation Request`

Répartition par type de nœud : `if` × 70, `httpRequest` × 58, `noOp` × 28, `code` × 20, `webhook` × 1

### Cibles HTTP sortantes

| Destination | Nœuds | Détail |
|---|---|---|
| **api.github.com** | 26 | `GET` Verify Base Commit Still Exists; `GET` Initial Repository Metadata; `GET` Initial Default Branch Head; `GET` Initial Compare Ancestry … |
| **autre** | 32 | `POST` Evaluate Security Remediation; `POST` Record Batch Result (EVALUATION_FAILED); `POST` Record Batch Result (Not Ready); `POST` Record Batch Result (INVALID_CANDIDATE) … |

### Catalogue des nœuds

| Prof. | Nœud | Type | Détail | Suivant(s) |
|---|---|---|---|---|
| 0 | `Webhook - Security Remediation Request` | `webhook` | path=`wf6-security-remediation-evaluate` method=`POST` auth=`headerAuth` creds=['httpHeaderAuth'] | `Evaluate Security Remediation` |
| 1 | `Evaluate Security Remediation` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/evaluate-batch" }}` timeout=`920000` onError=`continueOnFail` | `Evaluation HTTP OK?` |
| 2 | `Evaluation HTTP OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 \|\| $json.statusCode === 201) }} [?] True` | `Evaluation Not Technical Failure?`, `Record Batch Result (EVALUATION_FAILED)` (main#1) |
| 3 | `Evaluation Not Technical Failure?` | `if` | cond: `={{ Boolean($json.body?.status !== "TECHNICAL_FAILURE") }} [?] True` | `Candidate Ready?`, `Record Batch Result (EVALUATION_FAILED)` (main#1) |
| 3 | `Record Batch Result (EVALUATION_FAILED)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - EVALUATION_FAILED` |
| 4 | `Candidate Ready?` | `if` | cond: `={{ Boolean($json.body?.status === "CANDIDATE_READY") }} [?] True` | `Trusted Candidate`, `Record Batch Result (Not Ready)` (main#1) |
| 4 | `Respond - EVALUATION_FAILED` | `noOp` | ROUTING_NODE | *(terminal)* |
| 5 | `Trusted Candidate` | `code` | code 17 lignes | `Trusted Candidate Valid?` |
| 5 | `Record Batch Result (Not Ready)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - Not Eligible` |
| 6 | `Trusted Candidate Valid?` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Verify Base Commit Still Exists`, `Record Batch Result (INVALID_CANDIDATE)` (main#1) |
| 6 | `Respond - Not Eligible` | `noOp` | ROUTING_NODE | *(terminal)* |
| 7 | `Verify Base Commit Still Exists` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/commits/" + $("Trusted Candidat` timeout=`30000` onError=`continueOnFail` | `Verify Base Commit Still Exists OK?` |
| 7 | `Record Batch Result (INVALID_CANDIDATE)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - INVALID_CANDIDATE` |
| 8 | `Verify Base Commit Still Exists OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Base SHA Resolvable?`, `Record Batch Result (Base SHA Unresolvable)` (main#1) |
| 8 | `Respond - INVALID_CANDIDATE` | `noOp` | ROUTING_NODE | *(terminal)* |
| 9 | `Base SHA Resolvable?` | `if` | cond: `={{ Boolean($json.body?.sha === $("Trusted Candidate").first().json.decision.evaluatedSha && /^[0-9a-f]{40}$/. [?] True` | `Initial Repository Metadata`, `Record Batch Result (Base SHA Unresolvable)` (main#1) |
| 9 | `Record Batch Result (Base SHA Unresolvable)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - Base SHA Unresolvable` |
| 10 | `Initial Repository Metadata` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "" }}` timeout=`30000` onError=`continueOnFail` | `Initial Repository Metadata OK?` |
| 10 | `Respond - Base SHA Unresolvable` | `noOp` | ROUTING_NODE | *(terminal)* |
| 11 | `Initial Repository Metadata OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Initial Trusted Default Branch`, `Record Batch Result (DEFAULT_BRANCH_UNRESOLVABLE)` (main#1) |
| 12 | `Initial Trusted Default Branch` | `code` | code 8 lignes | `Initial Default Branch Valid?` |
| 12 | `Record Batch Result (DEFAULT_BRANCH_UNRESOLVABLE)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - DEFAULT_BRANCH_UNRESOLVABLE` |
| 13 | `Initial Default Branch Valid?` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Initial Default Branch Head`, `Record Batch Result (DEFAULT_BRANCH_UNRESOLVABLE)` (main#1) |
| 13 | `Respond - DEFAULT_BRANCH_UNRESOLVABLE` | `noOp` | ROUTING_NODE | *(terminal)* |
| 14 | `Initial Default Branch Head` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/ref/heads/" + encodeURIComp` timeout=`30000` onError=`continueOnFail` | `Initial Default Branch Head OK?` |
| 15 | `Initial Default Branch Head OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Initial Head Valid?`, `Record Batch Result (DEFAULT_BRANCH_UNRESOLVABLE)` (main#1) |
| 16 | `Initial Head Valid?` | `if` | cond: `={{ Boolean($json.body?.ref === "refs/heads/" + $("Initial Trusted Default Branch").first().json.repositoryDef [?] True` | `Initial Compare Ancestry`, `Record Batch Result (DEFAULT_BRANCH_UNRESOLVABLE)` (main#1) |
| 17 | `Initial Compare Ancestry` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/compare/" + $("Trusted Candidat` timeout=`30000` onError=`continueOnFail` | `Initial Compare Ancestry OK?` |
| 18 | `Initial Compare Ancestry OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Initial Ancestry Evidence`, `Record Batch Result (ANCESTRY_UNRESOLVABLE)` (main#1) |
| 19 | `Initial Ancestry Evidence` | `code` | code 15 lignes | `Initial Ancestry Valid?` |
| 19 | `Record Batch Result (ANCESTRY_UNRESOLVABLE)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - ANCESTRY_UNRESOLVABLE` |
| 20 | `Initial Ancestry Valid?` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `PR36 Protection Check (Target)`, `Record Batch Result (ANCESTRY_INVALID)` (main#1) |
| 20 | `Respond - ANCESTRY_UNRESOLVABLE` | `noOp` | ROUTING_NODE | *(terminal)* |
| 21 | `PR36 Protection Check (Target)` | `code` | code 8 lignes | `PR36 Protection Passed? (Target)` |
| 21 | `Record Batch Result (ANCESTRY_INVALID)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - ANCESTRY_INVALID` |
| 22 | `PR36 Protection Passed? (Target)` | `if` | cond: `={{ Boolean($json.pr36Protected === false) }} [?] True` | `Early Historical PR Lookup`, `Record Batch Result (PR36_PROTECTED)` (main#1) |
| 22 | `Respond - ANCESTRY_INVALID` | `noOp` | ROUTING_NODE | *(terminal)* |
| 23 | `Early Historical PR Lookup` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/pulls?state=all&per_page=100&he` timeout=`30000` onError=`continueOnFail` | `Early Historical PR Lookup OK?` |
| 23 | `Record Batch Result (PR36_PROTECTED)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - PR36_PROTECTED` |
| 24 | `Early Historical PR Lookup OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Historical Trusted PR State`, `Record Batch Result (PR_LOOKUP_FAILED)` (main#1) |
| 24 | `Respond - PR36_PROTECTED` | `noOp` | ROUTING_NODE | *(terminal)* |
| 25 | `Historical Trusted PR State` | `code` | code 17 lignes | `PR36 Protection Check (Resolved PR)` |
| 25 | `Record Batch Result (PR_LOOKUP_FAILED)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - PR_LOOKUP_FAILED` |
| 26 | `PR36 Protection Check (Resolved PR)` | `code` | code 9 lignes | `PR36 Protection Passed? (Resolved PR)` |
| 26 | `Respond - PR_LOOKUP_FAILED` | `noOp` | ROUTING_NODE | *(terminal)* |
| 27 | `PR36 Protection Passed? (Resolved PR)` | `if` | cond: `={{ Boolean($json.pr36Protected === false) }} [?] True` | `Historical PR Shape Valid?`, `Record Batch Result (PR36_PROTECTED)` (main#1) |
| 28 | `Historical PR Shape Valid?` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Historical PR Head Valid?`, `Record Batch Result (PR_LOOKUP_INVALID)` (main#1) |
| 29 | `Historical PR Head Valid?` | `if` | cond: `={{ Boolean($json.headMatches === true) }} [?] True` | `No Historical PR?`, `Record Batch Result (PR Head SHA Mismatch)` (main#1) |
| 29 | `Record Batch Result (PR_LOOKUP_INVALID)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - PR_LOOKUP_INVALID` |
| 30 | `No Historical PR?` | `if` | cond: `={{ Boolean($json.state === "NONE") }} [?] True` | `Get Branch Ref`, `Historical Authorized Branch Commit` (main#1) |
| 30 | `Record Batch Result (PR Head SHA Mismatch)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - PR Head SHA Mismatch` |
| 30 | `Respond - PR_LOOKUP_INVALID` | `noOp` | ROUTING_NODE | *(terminal)* |
| 31 | `Get Branch Ref` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/ref/heads/" + encodeURIComp` timeout=`30000` onError=`continueOnFail` | `Branch Lookup Resolved?` |
| 31 | `Historical Authorized Branch Commit` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/commits/" + $("Historical T` timeout=`30000` onError=`continueOnFail` | `Historical Authorized Branch Commit OK?` |
| 31 | `Respond - PR Head SHA Mismatch` | `noOp` | ROUTING_NODE | *(terminal)* |
| 32 | `Branch Lookup Resolved?` | `if` | cond: `={{ Boolean(($json.statusCode === 200 \|\| $json.statusCode === 404) && !$json.error) }} [?] True` | `Branch Exists?`, `Record Batch Result (BRANCH_LOOKUP_FAILED)` (main#1) |
| 32 | `Historical Authorized Branch Commit OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Historical Authorized Branch Commit Valid?`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 33 | `Branch Exists?` | `if` | cond: `={{ Boolean($json.statusCode === 200) }} [?] True` | `Existing Branch Ref Valid?`, `Revalidate Before Write (New Branch)` (main#1) |
| 33 | `Record Batch Result (BRANCH_LOOKUP_FAILED)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - BRANCH_LOOKUP_FAILED` |
| 33 | `Historical Authorized Branch Commit Valid?` | `if` | cond: `={{ Boolean($json.body?.sha === $("Historical Trusted PR State").first().json.headSha && /^[0-9a-f]{40}$/.test [?] True` | `Historical Evaluated Base Tree`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 33 | `Record Batch Result (Branch Content Conflict)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - Branch Content Conflict` |
| 34 | `Existing Branch Ref Valid?` | `if` | cond: `={{ Boolean($json.body?.ref === "refs/heads/" + $("Trusted Candidate").first().json.branchName && $json.body?. [?] True` | `Revalidate Before Write (Reuse)`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 34 | `Revalidate Before Write (New Branch)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/revalidate-batch" }}` timeout=`920000` onError=`continueOnFail` | `Revalidation HTTP OK? (New Branch)` |
| 34 | `Respond - BRANCH_LOOKUP_FAILED` | `noOp` | ROUTING_NODE | *(terminal)* |
| 34 | `Historical Evaluated Base Tree` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/trees/" + $("Verify Base Co` timeout=`30000` onError=`continueOnFail` | `Historical Evaluated Base Tree OK?` |
| 34 | `Respond - Branch Content Conflict` | `noOp` | ROUTING_NODE | *(terminal)* |
| 35 | `Revalidate Before Write (Reuse)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/revalidate-batch" }}` timeout=`920000` onError=`continueOnFail` | `Revalidation HTTP OK? (Reuse)` |
| 35 | `Revalidation HTTP OK? (New Branch)` | `if` | cond: `={{ Boolean(($json.statusCode === 200 \|\| $json.statusCode === 201) && !$json.error) }} [?] True` | `Revalidation Not Technical? (New Branch)`, `Record Batch Result (REVALIDATION_FAILED)` (main#1) |
| 35 | `Historical Evaluated Base Tree OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Historical Authorized Branch Tree`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 36 | `Revalidation HTTP OK? (Reuse)` | `if` | cond: `={{ Boolean(($json.statusCode === 200 \|\| $json.statusCode === 201) && !$json.error) }} [?] True` | `Revalidation Not Technical? (Reuse)`, `Record Batch Result (REVALIDATION_FAILED)` (main#1) |
| 36 | `Revalidation Not Technical? (New Branch)` | `if` | cond: `={{ Boolean($json.body?.status !== "TECHNICAL_FAILURE") }} [?] True` | `Fresh Candidate Matches (New Branch)`, `Record Batch Result (REVALIDATION_FAILED)` (main#1) |
| 36 | `Record Batch Result (REVALIDATION_FAILED)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - REVALIDATION_FAILED` |
| 36 | `Historical Authorized Branch Tree` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/trees/" + $("Historical Aut` timeout=`30000` onError=`continueOnFail` | `Historical Authorized Branch Tree OK?` |
| 37 | `Revalidation Not Technical? (Reuse)` | `if` | cond: `={{ Boolean($json.body?.status !== "TECHNICAL_FAILURE") }} [?] True` | `Fresh Candidate Matches (Reuse)`, `Record Batch Result (REVALIDATION_FAILED)` (main#1) |
| 37 | `Fresh Candidate Matches (New Branch)` | `code` | code 11 lignes | `Write Authorized? (New Branch)` |
| 37 | `Respond - REVALIDATION_FAILED` | `noOp` | ROUTING_NODE | *(terminal)* |
| 37 | `Historical Authorized Branch Tree OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Historical Exact Authorized Tree`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 38 | `Fresh Candidate Matches (Reuse)` | `code` | code 11 lignes | `Write Authorized? (Reuse)` |
| 38 | `Write Authorized? (New Branch)` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Create Missing Branch`, `Record Batch Result (Candidate Drifted)` (main#1) |
| 38 | `Historical Exact Authorized Tree` | `code` | code 20 lignes | `Historical Exact Authorized Tree?` |
| 39 | `Write Authorized? (Reuse)` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Revalidate Before Write (PR)`, `Record Batch Result (Candidate Drifted)` (main#1) |
| 39 | `Create Missing Branch` | `httpRequest` | `POST` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/refs" }}` timeout=`30000` onError=`continueOnFail` | `Branch Created Exactly?` |
| 39 | `Record Batch Result (Candidate Drifted)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - Candidate Drifted` |
| 39 | `Historical Exact Authorized Tree?` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Historical Authorized Candidate Blob`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 40 | `Revalidate Before Write (PR)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/revalidate-batch" }}` timeout=`920000` onError=`continueOnFail` | `Revalidation HTTP OK? (PR)` |
| 40 | `Branch Created Exactly?` | `if` | cond: `={{ Boolean($json.statusCode === 201 && $json.body?.ref === "refs/heads/" + $("Trusted Candidate").first().jso [?] True` | `Write File To Branch`, `Record Batch Result (BRANCH_CREATE_FAILED)` (main#1) |
| 40 | `Respond - Candidate Drifted` | `noOp` | ROUTING_NODE | *(terminal)* |
| 40 | `Historical Authorized Candidate Blob` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/blobs/" + $("Historical Exa` timeout=`30000` onError=`continueOnFail` | `Historical Authorized Candidate Blob OK?` |
| 41 | `Revalidation HTTP OK? (PR)` | `if` | cond: `={{ Boolean(($json.statusCode === 200 \|\| $json.statusCode === 201) && !$json.error) }} [?] True` | `Revalidation Not Technical? (PR)`, `Record Batch Result (REVALIDATION_FAILED)` (main#1) |
| 41 | `Write File To Branch` | `httpRequest` | `PUT` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/contents/" + $("Trusted Candida` timeout=`30000` onError=`continueOnFail` | `Write Succeeded?` |
| 41 | `Record Batch Result (BRANCH_CREATE_FAILED)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - BRANCH_CREATE_FAILED` |
| 41 | `Historical Authorized Candidate Blob OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Historical Exact Authorized Bytes`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 42 | `Revalidation Not Technical? (PR)` | `if` | cond: `={{ Boolean($json.body?.status !== "TECHNICAL_FAILURE") }} [?] True` | `Fresh Candidate Matches (PR)`, `Record Batch Result (REVALIDATION_FAILED)` (main#1) |
| 42 | `Write Succeeded?` | `if` | cond: `={{ Boolean(($json.statusCode === 200 \|\| $json.statusCode === 201) && /^[0-9a-f]{40}$/.test($json.body?.conten [?] True` | `Revalidate Before Write (PR)`, `Record Batch Result (Write Conflict)` (main#1) |
| 42 | `Respond - BRANCH_CREATE_FAILED` | `noOp` | ROUTING_NODE | *(terminal)* |
| 42 | `Historical Exact Authorized Bytes` | `code` | code 9 lignes | `Historical Exact Authorized Bytes?` |
| 43 | `Fresh Candidate Matches (PR)` | `code` | code 11 lignes | `Write Authorized? (PR)` |
| 43 | `Record Batch Result (Write Conflict)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - Write Conflict` |
| 43 | `Historical Exact Authorized Bytes?` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Historical Authorized Head`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 44 | `Write Authorized? (PR)` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Authorized Branch Snapshot`, `Record Batch Result (Candidate Drifted)` (main#1) |
| 44 | `Respond - Write Conflict` | `noOp` | ROUTING_NODE | *(terminal)* |
| 44 | `Historical Authorized Head` | `code` | code 3 lignes | `Recheck Historical PR` |
| 45 | `Authorized Branch Snapshot` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/ref/heads/" + encodeURIComp` timeout=`30000` onError=`continueOnFail` | `Authorized Branch Snapshot OK?` |
| 45 | `Recheck Historical PR` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/pulls/" + $("Historical Trusted` timeout=`30000` onError=`continueOnFail` | `Recheck Historical PR OK?` |
| 46 | `Authorized Branch Snapshot OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Authorized Branch Snapshot Valid?`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 46 | `Recheck Historical PR OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Historical Recheck Trusted PR State`, `Record Batch Result (PR_LOOKUP_FAILED)` (main#1) |
| 47 | `Authorized Branch Snapshot Valid?` | `if` | cond: `={{ Boolean($json.body?.ref === "refs/heads/" + $("Trusted Candidate").first().json.branchName && $json.body?. [?] True` | `Authorized Branch Commit`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 47 | `Historical Recheck Trusted PR State` | `code` | code 17 lignes | `Historical Recheck PR Shape Valid?` |
| 48 | `Authorized Branch Commit` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/commits/" + $("Authorized B` timeout=`30000` onError=`continueOnFail` | `Authorized Branch Commit OK?` |
| 48 | `Historical Recheck PR Shape Valid?` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Historical Recheck PR Head Valid?`, `Record Batch Result (PR_LOOKUP_INVALID)` (main#1) |
| 49 | `Authorized Branch Commit OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Authorized Branch Commit Valid?`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 49 | `Historical Recheck PR Head Valid?` | `if` | cond: `={{ Boolean($json.headMatches === true) }} [?] True` | `Historical PR Merged?`, `Record Batch Result (PR Head SHA Mismatch)` (main#1) |
| 50 | `Authorized Branch Commit Valid?` | `if` | cond: `={{ Boolean($json.body?.sha === $("Authorized Branch Snapshot").first().json.body.object.sha && /^[0-9a-f]{40} [?] True` | `Evaluated Base Tree`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 50 | `Historical PR Merged?` | `if` | cond: `={{ Boolean($("Historical Recheck Trusted PR State").first().json.state === 'MERGED') }} [?] True` | `Record Batch Result (Historical Already Merged)`, `Historical PR Open?` (main#1) |
| 51 | `Evaluated Base Tree` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/trees/" + $("Verify Base Co` timeout=`30000` onError=`continueOnFail` | `Evaluated Base Tree OK?` |
| 51 | `Record Batch Result (Historical Already Merged)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - Historical Already Merged` |
| 51 | `Historical PR Open?` | `if` | cond: `={{ Boolean($("Historical Recheck Trusted PR State").first().json.state === 'OPEN') }} [?] True` | `Record Batch Result (Historical PR Reused)`, `Record Batch Result (Historical Closed Not Merged)` (main#1) |
| 52 | `Evaluated Base Tree OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Authorized Branch Tree`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 52 | `Respond - Historical Already Merged` | `noOp` | ROUTING_NODE | *(terminal)* |
| 52 | `Record Batch Result (Historical PR Reused)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - Historical PR Reused` |
| 52 | `Record Batch Result (Historical Closed Not Merged)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - Historical Closed Not Merged` |
| 53 | `Authorized Branch Tree` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/trees/" + $("Authorized Bra` timeout=`30000` onError=`continueOnFail` | `Authorized Branch Tree OK?` |
| 53 | `Respond - Historical PR Reused` | `noOp` | ROUTING_NODE | *(terminal)* |
| 53 | `Respond - Historical Closed Not Merged` | `noOp` | ROUTING_NODE | *(terminal)* |
| 54 | `Authorized Branch Tree OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Exact Authorized Tree`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 55 | `Exact Authorized Tree` | `code` | code 20 lignes | `Exact Authorized Tree?` |
| 56 | `Exact Authorized Tree?` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Authorized Candidate Blob`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 57 | `Authorized Candidate Blob` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/blobs/" + $("Exact Authoriz` timeout=`30000` onError=`continueOnFail` | `Authorized Candidate Blob OK?` |
| 58 | `Authorized Candidate Blob OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Exact Authorized Bytes`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 59 | `Exact Authorized Bytes` | `code` | code 9 lignes | `Exact Authorized Bytes?` |
| 60 | `Exact Authorized Bytes?` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Authorized Head`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 61 | `Authorized Head` | `code` | code 3 lignes | `Final PR Lookup` |
| 62 | `Final PR Lookup` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/pulls?state=all&per_page=100&he` timeout=`30000` onError=`continueOnFail` | `Final PR Lookup OK?` |
| 63 | `Final PR Lookup OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Final Trusted PR State`, `Record Batch Result (PR_LOOKUP_FAILED)` (main#1) |
| 64 | `Final Trusted PR State` | `code` | code 17 lignes | `Final PR Shape Valid?` |
| 65 | `Final PR Shape Valid?` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Final PR Head Valid?`, `Record Batch Result (PR_LOOKUP_INVALID)` (main#1) |
| 66 | `Final PR Head Valid?` | `if` | cond: `={{ Boolean($json.headMatches === true) }} [?] True` | `No Final PR?`, `Record Batch Result (PR Head SHA Mismatch)` (main#1) |
| 67 | `No Final PR?` | `if` | cond: `={{ Boolean($json.state === "NONE") }} [?] True` | `Final Repository Metadata`, `Final PR Merged?` (main#1) |
| 68 | `Final Repository Metadata` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "" }}` timeout=`30000` onError=`continueOnFail` | `Final Repository Metadata OK?` |
| 68 | `Final PR Merged?` | `if` | cond: `={{ Boolean($("Final Trusted PR State").first().json.state === 'MERGED') }} [?] True` | `Record Batch Result (Final Already Merged)`, `Final PR Open?` (main#1) |
| 69 | `Final Repository Metadata OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Final Trusted Default Branch`, `Record Batch Result (DEFAULT_BRANCH_UNRESOLVABLE)` (main#1) |
| 69 | `Record Batch Result (Final Already Merged)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - Final Already Merged` |
| 69 | `Final PR Open?` | `if` | cond: `={{ Boolean($("Final Trusted PR State").first().json.state === 'OPEN') }} [?] True` | `Record Batch Result (Final PR Reused)`, `Record Batch Result (Final Closed Not Merged)` (main#1) |
| 70 | `Final Trusted Default Branch` | `code` | code 8 lignes | `Final Default Branch Valid?` |
| 70 | `Respond - Final Already Merged` | `noOp` | ROUTING_NODE | *(terminal)* |
| 70 | `Record Batch Result (Final PR Reused)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - Final PR Reused` |
| 70 | `Record Batch Result (Final Closed Not Merged)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - Final Closed Not Merged` |
| 71 | `Final Default Branch Valid?` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Final Default Branch Head`, `Record Batch Result (DEFAULT_BRANCH_DRIFTED)` (main#1) |
| 71 | `Respond - Final PR Reused` | `noOp` | ROUTING_NODE | *(terminal)* |
| 71 | `Respond - Final Closed Not Merged` | `noOp` | ROUTING_NODE | *(terminal)* |
| 72 | `Final Default Branch Head` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/ref/heads/" + encodeURIComp` timeout=`30000` onError=`continueOnFail` | `Final Default Branch Head OK?` |
| 72 | `Record Batch Result (DEFAULT_BRANCH_DRIFTED)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - DEFAULT_BRANCH_DRIFTED` |
| 73 | `Final Default Branch Head OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Final Head Valid?`, `Record Batch Result (DEFAULT_BRANCH_UNRESOLVABLE)` (main#1) |
| 73 | `Respond - DEFAULT_BRANCH_DRIFTED` | `noOp` | ROUTING_NODE | *(terminal)* |
| 74 | `Final Head Valid?` | `if` | cond: `={{ Boolean($json.body?.ref === "refs/heads/" + $("Final Trusted Default Branch").first().json.repositoryDefau [?] True` | `Final Compare Ancestry`, `Record Batch Result (DEFAULT_BRANCH_UNRESOLVABLE)` (main#1) |
| 75 | `Final Compare Ancestry` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/compare/" + $("Trusted Candidat` timeout=`30000` onError=`continueOnFail` | `Final Compare Ancestry OK?` |
| 76 | `Final Compare Ancestry OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Final Ancestry Evidence`, `Record Batch Result (ANCESTRY_UNRESOLVABLE)` (main#1) |
| 77 | `Final Ancestry Evidence` | `code` | code 15 lignes | `Final Ancestry Valid?` |
| 78 | `Final Ancestry Valid?` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Final Security Branch Ref`, `Record Batch Result (ANCESTRY_INVALID)` (main#1) |
| 79 | `Final Security Branch Ref` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/git/ref/heads/" + encodeURIComp` timeout=`30000` onError=`continueOnFail` | `Final Security Branch Ref OK?` |
| 80 | `Final Security Branch Ref OK?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error) }} [?] True` | `Authorized Branch Unchanged?`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 81 | `Authorized Branch Unchanged?` | `if` | cond: `={{ Boolean($json.body?.ref === "refs/heads/" + $("Trusted Candidate").first().json.branchName && $json.body?. [?] True` | `Create Pull Request`, `Record Batch Result (Branch Content Conflict)` (main#1) |
| 82 | `Create Pull Request` | `httpRequest` | `POST` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/pulls" }}` timeout=`30000` onError=`continueOnFail` | `Validate Created PR` |
| 83 | `Validate Created PR` | `code` | code 10 lignes | `Created PR Target Identified?` |
| 84 | `Created PR Target Identified?` | `if` | cond: `={{ Boolean($json.safeTarget === true) }} [?] True` | `Created PR Head Exact?`, `Record Batch Result (PR_CREATE_FAILED)` (main#1) |
| 85 | `Created PR Head Exact?` | `if` | cond: `={{ Boolean($json.ok === true) }} [?] True` | `Record Batch Result (Success)`, `Close Drifted Created PR` (main#1) |
| 85 | `Record Batch Result (PR_CREATE_FAILED)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - PR_CREATE_FAILED` |
| 86 | `Record Batch Result (Success)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - PR Created` |
| 86 | `Close Drifted Created PR` | `httpRequest` | `PATCH` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/pulls/" + $("Validate Created P` timeout=`30000` onError=`continueOnFail` | `Verify Drifted PR Closed` |
| 86 | `Respond - PR_CREATE_FAILED` | `noOp` | ROUTING_NODE | *(terminal)* |
| 87 | `Respond - PR Created` | `noOp` | ROUTING_NODE | *(terminal)* |
| 87 | `Verify Drifted PR Closed` | `httpRequest` | `GET` GITHUB `={{ "https://api.github.com/repos/" + $("Trusted Candidate").first().json.repository + "/pulls/" + $("Validate Created P` timeout=`30000` onError=`continueOnFail` | `Drifted PR Closure Confirmed?` |
| 88 | `Drifted PR Closure Confirmed?` | `if` | cond: `={{ Boolean($json.statusCode === 200 && !$json.error && $json.body?.number === $("Validate Created PR").first( [?] True` | `Record Batch Result (PR Head Drifted)`, `Record Batch Result (PR Head Drift Cleanup Failed)` (main#1) |
| 89 | `Record Batch Result (PR Head Drifted)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - PR Head Drifted` |
| 89 | `Record Batch Result (PR Head Drift Cleanup Failed)` | `httpRequest` | `POST`  `={{ $env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/batch-result" }}` timeout=`15000` onError=`continueOnFail` | `Respond - PR Head Drift Cleanup Failed` |
| 90 | `Respond - PR Head Drifted` | `noOp` | ROUTING_NODE | *(terminal)* |
| 90 | `Respond - PR Head Drift Cleanup Failed` | `noOp` | ROUTING_NODE | *(terminal)* |

### Zones documentaires présentes sur le canevas

- ## Zone 1 - Reception et eligibilite (7)
- ## Zone 2 - Verification initiale et PR36/historique (24)
- ## Zone 3 - Branche et ecriture (23)
- ## Zone 4 - Verification post-ecriture (38)
- ## Zone 5 - Verification finale pre-PR (22)
- ## Zone 6 - Creation et verification PR (7)
- ## Zone 7 - Chemins succes/echec, transversal (56 = 28 paires)

## WF-Chat-V4

- **ID** : `6BVXqAsePEPAjiIQ`  ·  **actif** : `True`  ·  **versionId** : `6f97161c-70fa-40ce-b3f3-cf550ba33465`
- **Dernière mise à jour** : `2026-10-04T23:17:43.863Z`
- **Nœuds** : 9 au total — 9 fonctionnels, 0 notes autocollantes (documentation sur le canevas)
- **Atteignables depuis les déclencheurs** : 9 / 9 (aucun nœud mort)
- **Arêtes pendantes** : 0
- **Points d'entrée** : `Webhook`

Répartition par type de nœud : `code` × 5, `httpRequest` × 2, `webhook` × 1, `respondToWebhook` × 1

### Cibles HTTP sortantes

| Destination | Nœuds | Détail |
|---|---|---|
| **api.anthropic.com** | 1 | `POST` Get Incidents1 |
| **backend** | 1 | `GET` Get Incidents |

### Catalogue des nœuds

| Prof. | Nœud | Type | Détail | Suivant(s) |
|---|---|---|---|---|
| 0 | `Webhook` | `webhook` | path=`chat-agent` method=`POST` auth=`<NONE>` | `Fetch Context` |
| 1 | `Fetch Context` | `code` | code 12 lignes | `Get Incidents`, `Chat Error Response` (main#1) |
| 2 | `Get Incidents` | `httpRequest` | `GET` BACKEND `={{ 'http://backend:3001/api/incidents?size=20' + ($json.projectId ? '&projectId=' + encodeURIComponent($json.projectId)` timeout=`None` onError=`continueErrorOutput` | `Build Prompt`, `Chat Error Response` (main#1) |
| 2 | `Chat Error Response` | `code` | code 5 lignes | `Respond to Webhook` |
| 3 | `Build Prompt` | `code` | code 46 lignes | `Prepare Claude Body`, `Chat Error Response` (main#1) |
| 3 | `Respond to Webhook` | `respondToWebhook` | — | *(terminal)* |
| 4 | `Prepare Claude Body` | `code` | code 14 lignes | `Get Incidents1`, `Chat Error Response` (main#1) |
| 5 | `Get Incidents1` | `httpRequest` | `POST` ANTHROPIC `=https://api.anthropic.com/v1/messages` timeout=`None` onError=`continueErrorOutput` | `Parse Response`, `Chat Error Response` (main#1) |
| 6 | `Parse Response` | `code` | code 10 lignes | `Respond to Webhook`, `Chat Error Response` (main#1) |
