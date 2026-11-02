# DEPLOYMENT_GOVERNANCE_HEALTHY_ARTIFACT_REPORT

```text
DEFECT_CONFIRMED = YES
DEFECT_FILE = src/main/java/com/pfe/devsecops/repository/TaskRepository.java
DEFECT_METHOD = findByTitleUnsafe
DEFECT_LINE = 19
EXACT_FAILURE_MODE = Unterminated SQL quote; Spring Data QueryCreationException during repository initialization; application exits 1
MINIMAL_FIX_APPLIED = YES (one closing quote)
OLD_CODE_WOULD_FAIL = YES (repository initialization regression failed with the original malformed query)
FIXED_CODE_PASSES = YES
LOCAL_BUILD_PASS = YES
LOCAL_TESTS_PASS = YES (18 tests; 0 failures/errors/skips)
LOCAL_CONTAINER_RUNNING = YES
LOCAL_HEALTH_PASS = YES (GET /api/auth/health, body OK)
NEW_APP_COMMIT_SHA = 393816c250f73d907eb5a2dd43b2ec2288c7abcb
NEW_BUILD_NUMBER = 151
CHECKOUT_SHA_MATCH = YES
OCI_REVISION_MATCH = YES
OCI_SOURCE_MATCH = YES
INCIDENT_SOURCE_COMMIT_SHA_MATCH = YES
NEW_REMOTE_DIGEST = sha256:6dc3cdba69592a91a5a1569978bcfca74d4080597a769ab368ed585ba397bcf5
DEPLOYMENT_ARTIFACT_REGISTERED = YES
DEPLOYMENT_ARTIFACT_ID = 008f1b22-7f96-4659-a88c-acc4df128b7e
NEW_GOVERNANCE_DECISION = CRITICAL_RISK
NEW_SECURITY_VALIDATION_APPLICABILITY = MISSING
AGENT_HEALTH_CHECK_FIX_REQUIRED = YES
AGENT_HEALTH_CHECK_FIX_LIVE = YES
NEW_CANARY_DIGEST_EXACT = YES
DIGEST_REFERENCE_ACCEPTED = YES
IMAGE_PULL_SUCCEEDED = YES
CONTAINER_RUNNING = YES (observed before deletion)
APPLICATION_HEALTH = PASS
TAG_FALLBACK_USED = NO
CANARY_RESOURCE_DELETED = YES
BUILD_150_MODIFIED = NO
TAG_150_MODIFIED = NO
LATEST_MODIFIED = NO (ACR latest remains absent)
FINAL_TARGET_MODIFIED = NO
FINAL_GOVERNED_DEPLOYMENT_EXECUTED = NO
AUTHORIZATION_ROWS_CREATED = 0
DEPLOYMENT_ATTEMPT_ROWS_CREATED = 0
DEPLOYMENT_AUTHORIZATIONS_COUNT = 0
DEPLOYMENT_ATTEMPTS_COUNT = 0
WF2_CHANGED = NO
WF6_CHANGED = NO
PHASE_4G_CHANGED = NO
TRIVY_OWASP_ORCHESTRATION_CHANGED = NO
HEALTHY_ARTIFACT_TECHNICALLY_QUALIFIED = YES
READY_FOR_FIRST_GOVERNED_DEPLOYMENT = NO
FINAL_VERDICT = E — SECURITY_OR_IDENTITY_BLOCKER (security controls failed/missing; identity is proven)
```

The new artifact is immutable, registered, and technically healthy in both local Docker and ACI. Readiness is not a security approval: the backend preview requires an explicit administrator CRITICAL_OVERRIDE with reason, acknowledgements and confirmation phrase. No such authorization was requested or created in this phase. The final project also still has its original health configuration: the generic agent option is live, but backend normalization support remains source-only and the project's healthCheck was not persisted. A future final deployment must carry the tested legitimate health contract through its governed configuration path. This phase does not work around that by manually deploying the final target.

## Exact application diff

```diff
-    @Query(value = "SELECT * FROM tasks WHERE title = '" + "' OR '1'='1", nativeQuery = true)
+    @Query(value = "SELECT * FROM tasks WHERE title = '" + "' OR '1'='1'", nativeQuery = true)
```

No other repository method changed. This repairs SQL syntax only; the intentionally unsafe query remains a security finding. The new commit's parent is historical commit 7ae0f954f99628b69ce9b42f42c1e2acc8568d99. Neither that commit nor build/tag 150 was rewritten. Source and the one regression test are the only two changed application files; the isolated application checkout /tmp/pfe-app-test-2b7 is clean.

The added @DataJpaTest instantiates the real H2/JPA repository context. With the original malformed query it failed with the same quoted-range QueryCreationException. With the fix it passes, together with the full 18-test Maven clean verify run. The local Dockerfile build succeeded; Spring and H2 initialized, the image healthcheck became healthy, and the container stayed running for another 30 seconds after the approved endpoint first passed. The local diagnostic container was removed.

## One normal Jenkins build and immutable publication

Exactly one Jenkins build was queued: #151, queue item 9088. Its application checkout SHA, payload commitSha, incident metadata.sourceCommitSha, local image OCI revision and remote OCI revision all equal 393816c250f73d907eb5a2dd43b2ec2288c7abcb. The normal shared library revision was 8fd76d2d1e5152ec4144f9c39e0f757f9e880c97. Jenkins completed SUCCESS in 278490 ms; that result does not mean security controls passed.

The first non-parameterized build request was rejected HTTP 400 and queued no build; the parameterized submission used the job's unchanged defaults. No second build was triggered. Jenkins's separate Docker daemon built image/config ID sha256:12aba29ceacaf1411a272df99c5376cdc0dfd9baa98de2bcd2f2c1a0c9256777. Docker save/load preserved that same image ID on the host; it was not rebuilt for publication. The normal library provided existing OCI revision/source/created labels.

The remote tag 151 was confirmed absent before push. Only acrpfedevsecops.azurecr.io/pfe-app-test:151 was pushed, using existing registry authentication. Remote inspection then proved digest sha256:6dc3cdba69592a91a5a1569978bcfca74d4080597a769ab368ed585ba397bcf5, revision 393816c250f73d907eb5a2dd43b2ec2288c7abcb, and source https://github.com/souhaiel11/pfe-app-test.git. Tag 150 still resolves to sha256:2027f8ed1c023e8d34e30e5848a3ed780831b8e52945543bd00f7c3ed521718d. Remote latest did not exist before and does not exist afterward. The unmodified Jenkins pipeline updates its own daemon's local pfe-app-test:latest alias during normal image creation; that local alias was neither pushed nor used as authoritative identity.

Registration was performed through existing POST /api/azure-deploy/artifacts/provenance with the normal trusted-automation authentication, requiring independent remote provenance verification. It returned PROVENANCE_VERIFIED and artifact ID 008f1b22-7f96-4659-a88c-acc4df128b7e. No manual database INSERT was used. This was an explicit API registration, not a claim that Jenkins automatic artifact registration has been implemented.

## Actual quality/security evidence

| Evidence | Actual result |
|---|---|
| Local tests | 18 passed, including repository context initialization |
| Jenkins tests | SKIPPED, total 0, failures 0; existing Jenkinsfile skipTests=true unchanged |
| Sonar scan | SUCCESS; exact CE task b4b2949a-fc4a-4407-9c22-17ce4606d6fb |
| Sonar quality gate | ERROR; new coverage 0.0 against minimum 80; 1 new violation against threshold 0 |
| Trivy | Report produced for build #151 image; 14 CRITICAL, 50 HIGH, 47 MEDIUM records |
| OWASP | Report produced; 23 CRITICAL, 58 HIGH, 65 MEDIUM, 8 LOW records |
| ZAP | Normal scan report produced; 2 alerts; governance records non-blocking WARNING |
| WF3 security validation applicability | MISSING |
| Backend governance | CRITICAL_RISK; identity and artifact provenance resolved |

The scanner counts above are report records, not a claim of distinct CVEs. Distinct counts are preserved separately in new-build-security-evidence.json. Existing normal scan settings were not changed. The copied build report directory had no owasp.exitcode or owasp.scanExecuted marker; no tool-exit status was invented from file existence. The backend's actual normalized controls classify OWASP, Sonar and Trivy as failed.

NEW_FAILED_CONTROLS (exact backend preview):

- Validation de sécurité WF3 absente
- Tests applicatifs non exécutés
- Quality Gate SonarQube en échec (ERROR)
- 14 CVE critique(s) Trivy
- 23 CVE critique(s) OWASP Dependency-Check
- Décision de gouvernance : BLOCK
- 38 problème(s) bloquant(s) non résolu(s)
- Étape requise bloquante : owasp (FAILED)
- Étape requise bloquante : sonar (FAILED)
- Étape requise bloquante : trivy (FAILED)
- Étape en avertissement, non bloquante : zap

## Agent health patch audit and promotion

HEALTH_CHECK_OLD_BEHAVIOR = fixed curl request to localhost:8080/api/health, expecting an UP substring.

HEALTH_CHECK_EXPECTED_BEHAVIOR = configured local endpoint and approved client, exact expected body. For this image, GET /api/auth/health -> HTTP success and OK, using wget already declared by the Dockerfile.

SOURCE_FIX = optional healthCheck {path, port, client, expectedBody} with fixed localhost destination, restricted path characters, port membership validation, curl/wget-only client selection, rejection of unknown fields, and exact configured response matching. Existing legacy behavior remains when no option is supplied.

WHY_GENERIC = no project name, secret or pfe-app-test special case is hardcoded in the agent capability. No arbitrary shell/exec command, arbitrary environment forwarding or network destination was added. Allowlists, digest validation/selection, session guard and registry authentication are preserved.

TESTS = five offline health tests and existing digest-dispatch checks passed; Phase 2B.6's backend normalization test and TypeScript validation passed. The promoted source and unchanged allowlist hashes were checked before restarting only azure-deploy-agent. Live /validate-target accepted the legitimate contract and rejected an arbitrary client sh with INVALID_HEALTH_CHECK before any Azure creation.

Promotion restarted only the Azure agent (PID 50592); no backend/frontend deployment or project configuration update was performed. The narrowly scoped change is documented in agent-health-only.diff; agent-health-audit.md records its generic contract. The backend configuration support remains source-only, so future governed deployment preparation still needs that configuration path made live and the approved health contract persisted; no project database field was edited here.

## New digest ACI qualification and cleanup

Resource group rg-pfe-devsecops; target aci-pfe-app-test-healthy-canary; region francecentral. The live allowlists remain registry acrpfedevsecops and resource group rg-pfe-devsecops. Target validation remained unchanged.

Exact selected and Azure-reported reference:

```text
acrpfedevsecops.azurecr.io/pfe-app-test@sha256:6dc3cdba69592a91a5a1569978bcfca74d4080597a769ab368ed585ba397bcf5
```

The agent's az container create succeeded. Azure provisioningState=Succeeded; events separately record Successfully pulled image and Started container. The agent observed Running and healthOk=true with body OK. Another state check after 30 seconds remained Running, with no finishTime or exitCode. Captured container logs contain completed Spring startup and H2 initialization. A separate approved wget health check returned OK successfully. No tag fallback or command/environment workaround was used. CPU=1, memory=1 GiB, restartPolicy=Never, image entrypoint inherited, and no extra environment variables supplied.

Before deletion, canary-observed.json captured instanceView, events, image and full Azure state; canary-logs.json captured application output; canary-health.json captured the actual endpoint result. Deletion succeeded. canary-cleanup.json proves absence and identical pre/post Azure resource inventories, including existing resource metadata. No final/production ACI was created or modified and no additional Azure resources remain.

## Final invariants and remaining governance gate

Authorization and deployment-attempt tables remain 0/0. Final project azureConfig and azureDeploymentState=null match the baseline. All 24 workflow definitions match their baseline hashes, including WF2 and WF6. No 4G source or Trivy/OWASP orchestration was changed. The only GitHub mutation was the authorized minimal application commit pushed as a fast-forward to main. The only ACR push was new tag 151.

This is a healthy, proven artifact candidate for governed review. It is not cleared for a final deployment under ordinary security controls. The recorded policy requires administrator CRITICAL_OVERRIDE, a reason, explicit critical-risk/control-failure acknowledgements and a confirmation phrase; no automatic override or manufactured governance history was performed. Final health configuration preparation remains as described above.

Evidence directory includes the exact source diff/test, local Maven/runtime logs, Jenkins console and payload, actual scanner reports, exact Sonar gate, incident identity, OCI/digest inspection, registration API response, governance preview, live agent patch tests, ACI logs/events/health/cleanup, and final invariants.

STOP. No final application deployment.
