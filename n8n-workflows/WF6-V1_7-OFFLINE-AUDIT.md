WF6 security remediation V1.7 — offline implementation and audit

The coordinated Logback candidate is proven eligible at exact base
7ae0f954f99628b69ce9b42f42c1e2acc8568d99. Two independent exact-SHA
worktree runs built and scanned the candidate image and returned
CANDIDATE_READY with zero CVE-2023-6378 matches. No live workflow, GitHub
write, PR operation, deployment, routing change, commit or push was performed.

Predeploy readiness remains NO pending the two runtime prerequisites below.
The isolated proof adapter exercised real Maven, package/image builds and
Trivy; it does not establish that the default rootless adapter is provisioned
in the current verifier deployment.

ROOT_CAUSE = V1.6 validated the direct artifact version but did not derive all
controls needed for candidate-wide CVE closure. Inherited dependencyManagement
continued to pin logback-core through the unchanged local logback.version.
V1_6_TARGET_VERSION_SELECTION_CORRECT = YES
V1_6_REMEDIATION_SCOPE_COMPLETE = NO

Fresh Maven evidence (all dependency graph entries retained in audit-evidence.json):

| Exact-base experiment | classic | core |
| --- | --- | --- |
| Original | 1.2.11 | 1.2.11 |
| V1.6 direct literal only | 1.2.13 | 1.2.11 |
| Property only | 1.2.11 | 1.2.13 |
| Coordinated | 1.2.13 | 1.2.13 |

LOCAL_VERSION_CONTROLS = [direct logback-classic version, local logback.version]
LOG_BACK_PROPERTY_CONTROL_PROVEN = YES
LOG_BACK_PROPERTY_AFFECTS = [resolved logback-core; inherited managed versions
of logback-access, logback-classic, logback-core]
AFFECTED_LOG_BACK_ARTIFACTS = [ch.qos.logback:logback-classic, ch.qos.logback:logback-core]

The verbose effective models attribute the managed Logback entries to
org.springframework.boot:spring-boot-dependencies:2.7.0 (lines 1548–1560),
inherited via spring-boot-starter-parent:2.7.0. The project's direct literal
wins for classic. There is no local core dependency/version declaration or
local dependencyManagement override. logback-access is managed but absent
from the packaged/resolved graph. Parent 2.7.0 was inspected and never changed.
The property-only experiment proves actual graph causality; its name supplies
no authority. Every fresh tree matches the previously retained fixture.

TARGET_CVE_MATCHES_BEFORE (base) =
- ch.qos.logback:logback-classic 1.2.11; target Java;
  app/app.jar/BOOT-INF/lib/logback-classic-1.2.11.jar
- ch.qos.logback:logback-core 1.2.11; target Java;
  app/app.jar/BOOT-INF/lib/logback-core-1.2.11.jar

TARGET_CVE_MATCHES_BEFORE (V1.6 / PR36) =
- ch.qos.logback:logback-core 1.2.11; target Java;
  app/app.jar/BOOT-INF/lib/logback-core-1.2.11.jar

TARGET_CVE_FIXED_VERSION_EVIDENCE = both affected packages explicitly report
[1.3.12, 1.4.12, 1.2.13]. The recovered PR36 full scan independently reports
this same list for residual logback-core. No inference from family naming or
classic's fixed version was needed. Original /tmp evidence had disappeared;
full retained reports were recovered read-only from Jenkins local storage:
/shared/reports/pfe-app-test/149/trivy-report.json and
/tmp/wf6-pr36-validation/trivy-report.json.

COORDINATED_AUTO_FIX_ELIGIBLE = YES (this exact fixture and verified candidate)
COORDINATED_PATCH_CONTROLS =
- LOCAL_PROPERTY logback.version: 1.2.11 -> 1.2.13, source span [967,973)
- DEPENDENCY_VERSION ch.qos.logback:logback-classic:
  1.2.11 -> 1.2.13, source span [2299,2305)
Spans are exact JavaScript string offsets in the retained UTF-8-decoded POM;
unchanged source text is preserved verbatim. Controls are ordered by offset
and applied from right to left. No XML serialization or generic replaceAll.
COORDINATED_PATCH_CHANGED_FILES = [pom.xml]
COORDINATED_PATCH_SUBSTITUTION_COUNT = 2
CLASSIC_VERSION_AFTER = 1.2.13
CORE_VERSION_AFTER = 1.2.13
MAVEN_DEPENDENCY_CLOSURE = PASS
BUILD_VALIDATION = PASS (clean package -DskipTests; tests compiled but not run)
TARGET_CVE_MATCH_COUNT_AFTER = 0 (both complete image scans)
TARGET_CVE_CLOSED = YES
CANDIDATE_IDENTITY_CHANGED_FOR_COORDINATED_SCOPE = YES

The original provenance remains DIRECT_EXPLICIT. The separate
remediationScope commits to exact SHA/blob, file, complete affected-package
set, ordered source offsets, old values and targets. Scanner findings for
the exact CVE, effective models and one-control experiments determine the
smallest unique plan. At most eight controls are considered and four can be
authorized. Unsupported profiles/modules/local BOM imports, ambiguous
controls, graph additions/removals, unrelated resolved-version changes,
missing common same-major targets or incomplete evidence reject eligibility.
TRANSITIVE, BOM_MANAGED, PLUGIN and UNRESOLVED provenance stay non-eligible.

The writer independently derives the scope from grounded evidence; the guard
freshly re-derives the complete candidate and requires byte equality. Extra,
missing, wrong-version, duplicate/ambiguous, reordered/deleted-dependency,
exclusion, scanner weakening and test-disabling mutations are rejected.
Build or scanner failure never returns CANDIDATE_READY. The backend also
rejects READY responses missing candidate-bound closure/identity evidence.
Maven/build/scanner source mutation is checked against the candidate digest.
Malformed reports and reported filtered findings fail closed. WF6 owns no
version selection, scope derivation or LLM authority.

The real offline proof uses the retained complete base-image scan and fresh
Maven experiments. It builds the candidate with a local copied Maven cache,
including fixed JARs recovered from a retained offline image. Only the audit
build context substitutes cache injection for Maven's network-prefetch step;
the package goal and entire runtime stage are retained. Candidate repository
bytes still differ only in pom.xml. Scanner mode is Trivy image archive,
vuln,misconfig, all severities, full package inventory. Final scanner
containers have network=none and all DB/check/version updates disabled.
Trivy 0.72.0 uses the retained vulnerability DB updated 2026-09-24 and Java DB
updated 2026-08-24. This proves this target CVE against that recorded DB, not
absence of other vulnerabilities. Original full reports and verbose models
remain under /tmp/wf6-v17-audit; durable selected evidence and hashes are in
backend/src/security-remediation/fixtures/v17/audit-evidence.json.

BACKEND_TESTS = PASS (68 spec files, fresh full suite)
CANDIDATE_VERIFIER_TESTS = PASS (21 spec files)
WF6_TESTS = PASS (117 offline cases)
N8N_COMPATIBILITY_TESTS = PASS (14 cases against copied installed 2.14.2 source)
BACKEND_TSC = PASS
CANDIDATE_VERIFIER_TSC = PASS
GIT_DIFF_CHECK = PASS

Verifier tests used local Git transport and offline Maven wrappers; GitHub
clone URLs were redirected to the disposable local fixture, and commit/push
were blocked. The HEAD test supports an existing-commit fixture to avoid
creating a commit. The workspace test initially lacked a main ref in the
isolated clone; restoring that local ref made the unchanged test pass.
Sandbox process restrictions were resolved through explicit tool approvals.
Real package tests remain SKIPPED, distinct from the passing platform specs.

DETERMINISTIC_ARTIFACT_HASH_1 = eb2789a4a9c51b0a2506ab561803ac6af97e8e4f78d88428c736f731a86b2aae
DETERMINISTIC_ARTIFACT_HASH_2 = eb2789a4a9c51b0a2506ab561803ac6af97e8e4f78d88428c736f731a86b2aae
DETERMINISTIC_GENERATION = YES
The hashed artifact is canonical generated candidate identity + scope +
manifest, from two independent exact-SHA worktrees. Timestamped scan reports
are separately hashed. This is not a cache-free OCI reproducibility claim.

PR36_MODIFIED = NO
PR36_MERGED = NO
WF6_EXECUTED = NO
LIVE_GITHUB_WRITE = NO
ROUTING_CHANGED = NO
LIVE_DEPLOYMENT = NO
COMMIT_PUSH = NO
PR36_STRUCTURALLY_VALID_PATCH = YES
PR36_SECURITY_CLOSURE_VALIDATED = NO

BLOCKERS =
- Default TrivyImageArtifactValidator requires provisioned rootless Podman,
  Trivy and caches. The current verifier Dockerfile does not supply them;
  the isolated Docker proof is not a default-adapter runtime acceptance test.
- WF6's unchanged 30-second HTTP timeout must be reconciled with synchronous
  exact-SHA grounding, model experiments, builds and full-image scans before
  deployment. This audit does not weaken timeout guards or alter routing.

READY_FOR_V1_7_PREDEPLOY_REVIEW = NO (offline fixture closure is proven;
operational integration prerequisites remain unresolved)

FILES_CHANGED (V1.7 implementation/audit, including the partial work already
present at start; unrelated frontend/WF2 work is excluded and preserved) =
- backend/src/candidate-verification/candidate-verification.service.spec.ts
- backend/src/candidate-verification/candidate-verification.service.ts
- backend/src/security-remediation/maven-security-patch-writer.ts
- backend/src/security-remediation/security-candidate-identity.ts
- backend/src/security-remediation/security-finding-decision.types.ts
- backend/src/security-remediation/security-finding-resolver.service.ts
- backend/src/security-remediation/security-patch-guard.ts
- backend/src/security-remediation/security-patch-request.types.ts
- backend/src/security-remediation/security-remediation-orchestration.types.ts
- candidate-verifier/src/head-verification.spec.ts
- candidate-verifier/src/maven-build-adapter.ts
- candidate-verifier/src/security-remediation-http.spec.ts
- candidate-verifier/src/security-remediation-orchestrator.service.ts
- candidate-verifier/src/security-remediation-orchestrator.spec.ts
- backend/src/security-remediation/maven-remediation-scope.ts
- backend/src/security-remediation/maven-remediation-scope.spec.ts
- backend/src/security-remediation/fixtures/v17/logback.json
- backend/src/security-remediation/fixtures/v17/audit-evidence.json
- candidate-verifier/src/security-artifact-validator.ts
- candidate-verifier/test-fixtures/run-security-v17-proof.ts
- n8n-workflows/WF6-V1_7-OFFLINE-AUDIT.md
