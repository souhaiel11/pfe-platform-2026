# TRIVY_OWASP_H2_FIXTURE_PREQUALIFICATION_REPORT

Phase 4G.2, 2026-10-06. **A — DEDICATED_H2_FIXTURE_PREQUALIFIED.** The direct-dependency fixture passes the exact current V1.8 functions for both scanner identities, with real builds/tests and dual-scanner closure. The initial workspace was destroyed, and two fresh reconstructions produced identical required results. No GitHub repository, Jenkins job, production DB mutation, deployment, remediation or retry occurred. Missing Maven artifacts were downloaded only into `/tmp`, with explicit user authorization.

```text
ROOT_CAUSE_OF_V18_DIFFERENCE = DIRECT_EXPLICIT_LOCAL_EDIT versus PARENT_MANAGED_LIVE_EDIT; all five eligible live parent candidates resolve H2 below the security floor
LOCAL_H2_CURRENT_VERSION = 2.1.212
LOCAL_H2_CANDIDATE = 2.2.220
LIVE_H2_CURRENT_VERSION = 2.1.212
LIVE_H2_SCANNER_FIXED_VERSION = 2.2.220
LIVE_H2_CANDIDATES_CONSIDERED = H2 security target 2.2.220; Spring Boot owner candidates 2.7.18, 2.7.17, 2.7.16, 2.7.15, 2.7.14 (current-code reconstruction)
FIRST_DIVERGING_GATE = MAVEN_PROVENANCE / DEPENDENCY_CONTROL_PROFILE, followed by PARENT_VERSION plan selection
CANDIDATE_2_2_220_CONSIDERED = YES (native security candidate, both configurations)
CANDIDATE_2_2_220_V18_RESULT = ACCEPT for the direct fixture; BLOCK for the existing parent-managed live context
CANDIDATE_2_2_220_REJECTION_REASON = NONE for the direct fixture; live NO_COMPATIBLE_CANDIDATE because owner trials resolve 2.1.214 < 2.2.220
DEDICATED_FIXTURE_CURRENT_VERSION = 2.1.212
DEDICATED_FIXTURE_SCANNER_FIXED_VERSION = 2.2.220 (OWASP derives it through exact Trivy correlation)
DEDICATED_FIXTURE_SELECTED_CANDIDATE = 2.2.220
SCANNER_DETECTION_REAL = YES (Trivy + OWASP)
V18_DECISION = ACCEPT (VALIDATED_RECOMMENDED; both source-bound dispatch predicates ALLOW)
V18_REASON = ALL_GATES_PASSED
TRIVY_TARGET_KEY = (11111111-1111-4111-8111-111111111111, ["v1","FILE","pom.xml"])
OWASP_TARGET_KEY = (11111111-1111-4111-8111-111111111111, ["v1","FILE","pom.xml"])
TARGET_KEYS_EQUAL = YES
PATCH_BUILD_PASS = YES
TRIVY_FINDING_REMOVED = YES
OWASP_FINDING_REMOVED = YES
FIXTURE_REPRODUCIBLE = YES (initial run plus two fresh reconstructions)
CANONICAL_LOCAL_FIXTURE_PATH = candidate-verifier/test-fixtures/maven-h2-safe-retry
READY_TO_CREATE_DEDICATED_H2_REPOSITORY = YES
LIVE_CHANGED = NO
GITHUB_REPOSITORY_CREATED = NO
FINAL_VERDICT = A — DEDICATED_H2_FIXTURE_PREQUALIFIED
```

## Exact local versus live evidence

Previous local evidence: [candidate-10 qualification](qa/trivy-owasp-local-fixture-synthesis/evidence/candidate-10/qualification.json), [dispatch proof](qa/trivy-owasp-local-fixture-synthesis/production-gate-proof.json), and [dual-scanner proof](qa/trivy-owasp-local-fixture-synthesis/dual-scanner-proof.json). Current known live evidence: [source-bound V1.8 results](qa/trivy-owasp-h2-fixture-prequalification/known-live-case-v18.json), captured by the preceding read-only Phase 4G.1 audit. This phase did not query or change production tasks.

| Field | Previous local H2 ACCEPT | Existing live H2 BLOCK |
| --- | --- | --- |
| Current dependency | `com.h2database:h2:2.1.212` | Same coordinate/version |
| Scanner fixed version | Trivy `2.2.220`; OWASP exact correlation also identifies it | Same `2.2.220`; OWASP stored `TRIVY_CORRELATED` evidence |
| Security candidates | Native Trivy provider produces one `2.2.220` candidate | Same security target; it is not discarded by version policy |
| Actual edit candidates | Direct H2 `2.1.212 -> 2.2.220` | Spring Boot parent `2.7.0 -> 2.7.18/.17/.16/.15/.14` in the reconstructed bounded discovery |
| Maven provenance | `DIRECT_EXPLICIT`, literal H2 `<version>` in the sole POM; no parent/BOM | Coarse `BOM_MANAGED`, refined to `PARENT`; H2 has no local version; parent is `org.springframework.boot:spring-boot-starter-parent:2.7.0` |
| Control profile | `versionControl=DIRECT_EXPLICIT`; `declarationPom=pom.xml`; `javaVersion=null`; `springBootVersion=null` | `versionControl=PARENT`; owner/version `spring-boot-starter-parent/2.7.0`; Java 11; Spring Boot 2.7.0 |
| Remediation plan | `DEPENDENCY_VERSION`, edit coordinate H2, target `2.2.220`, no owner discovery | `PARENT_VERSION`, edit coordinate Spring Boot parent, target owner requires discovery; H2 `2.2.220` is the security floor |
| Repository binding | `LOCAL_DISPOSABLE_FIXTURE`, local commit `7234ec4995996ce130ba4848c472c93310d9f4de` | `souhaiel11/pfe-app-test`, trusted stored scan SHA `7ae0f954f99628b69ce9b42f42c1e2acc8568d99` |
| Source manifest | SHA-256 `522a82df990724c8c868a1b46d887063a9976a637ef67e62202b60b2bea5b18b`; direct H2 version | SHA-256 `ca4d5bc28596ded5fc06cd0e47586678e26d4aca5a497bf5a2fe0f11aa6f6d43`; parent-managed H2 |
| Dependency-tree evidence | One project dependency, H2 `2.1.212:compile`; patched tree resolves `2.2.220` | Original H2 `2.1.212:runtime` within the application graph; each reconstructed owner trial resolves `2.1.214:runtime` |
| Effective model | Direct declaration corroborates H2; no inherited owner | Original effective model has `h2.version=2.1.212`; owner candidate effective management resolves H2 `2.1.214` |
| Candidate-verifier inputs | Exact local SHA; direct provenance; POM/source content; H2 target `2.2.220`; one-file patch; real JDBC test and archive scans | Stored source SHA; parent profile and `PARENT_VERSION` plan; owner dependency-tree trials precede full candidate validation; no successful H2 candidate build/rescan is retained in the live decision |
| Normalization inputs | Real Trivy `VulnerabilityID/PkgName/InstalledVersion/FixedVersion`; OWASP Maven purl `pkg:maven/com.h2database/h2@2.1.212` | Stored canonical component/current/fix; OWASP high-confidence Maven identity and exact CVE/package/current-version correlation |
| Candidate gates | Artifact available, resolution/build/tests PASS, target CVE closed, zero new HIGH/CRITICAL, same-major automation eligible | Owner discovery succeeds, but actual resolved dependency remains below the security target; full sandbox is not reached for these five trials |
| Compatibility decision | `VALIDATED_RECOMMENDED`, recommended `2.2.220` | `NO_COMPATIBLE_CANDIDATE`, recommendation null, sandboxValidated false, developer review required |
| Dispatch predicate | Previous local Trivy proof `ALLOW / ALL_GATES_PASSED`; current fresh audit independently proves both scanner sources ALLOW | Both exact live source bindings pass stale checks, then return `BLOCK / NO_COMPATIBLE_CANDIDATE` |

The previous proof and current live case use the **same H2 current/fixed versions**. The first divergence is ownership, not scanner version normalization or a universal ban on H2 `2.2.220`. Their repository/SHA bindings are different and each is meaningful only in its own context. Transferring either proof to a different context is rejected by the stale guard.

The stored live POM fixture was independently compared with `git show 7ae0f954f99628b69ce9b42f42c1e2acc8568d99:pom.xml` in the existing local application checkout: byte-for-byte equality, SHA-256 `ca4d5bc...6d43`. No remote checkout was created. The original live evidence stores only the count of five owner trials, not individual trial logs. The table below is therefore an explicit replay of current production code against retained repository metadata and the exact source POM, with fresh actual Maven trials; it does not invent historical run IDs or claim access to lost historical logs.

## Deterministic live rejection trace

The path is `normalizeOwaspFinding` / native Trivy fields → security candidate providers → `resolveDependencyControlProfile` → `buildRemediationPlans` → generator `decideOwnerPlan` → `classifyOwnerVersions` → `runOwnerDiscoveryTrial` → `compareMavenVersions(resolvedH2, 2.2.220)` → `NO_COMPATIBLE_CANDIDATE`. The deployed `V1_8CompatibilityDecisionService.lookup` reads that immutable stored decision; `canDispatchSecurityRemediationV1_8` checks exact context binding and then rejects its state. The HTTP dispatch path does not run Maven or invent a replacement H2 candidate.

Production owner discovery keeps a ceiling-first bounded list of five automation-eligible owner versions. [The retained metadata](../backend/src/dependency-compatibility/fixtures/spring-boot-starter-parent.maven-metadata-central.xml) supplies the version list. [Fresh replay evidence](qa/trivy-owasp-h2-fixture-prequalification/live-owner-trace.json) retains every plan, trial and complete resulting dependency tree. All five trials ran offline against copied caches before dependency downloads were authorized.

| Candidate / role | Source | Gate accepted | Gate rejected / exact result |
| --- | --- | --- | --- |
| H2 `2.2.220`, security target | Native Trivy structured FixedVersion; OWASP exact Trivy correlation | Provider and same-major H2 safety policy | No rejection at collection; parent ownership prevents substituting a direct edit for the live plan |
| Parent `2.7.18` | Retained Maven repository metadata | `SAFE_SAME_LINE`; Maven trial `RESOLVED` | Resolves H2 `2.1.214`; comparator returns -1 against `2.2.220`; below security floor |
| Parent `2.7.17` | Same metadata | `SAFE_SAME_LINE`; Maven trial `RESOLVED` | Same H2 `2.1.214 < 2.2.220` |
| Parent `2.7.16` | Same metadata | `SAFE_SAME_LINE`; Maven trial `RESOLVED` | Same H2 `2.1.214 < 2.2.220` |
| Parent `2.7.15` | Same metadata | `SAFE_SAME_LINE`; Maven trial `RESOLVED` | Same H2 `2.1.214 < 2.2.220` |
| Parent `2.7.14` | Same metadata | `SAFE_SAME_LINE`; Maven trial `RESOLVED` | Same H2 `2.1.214 < 2.2.220` |

`2.2.220` is not a Spring Boot parent candidate. Current V1.8 accepts it as a direct H2 candidate when the manifest actually controls H2 directly and all validation facts pass. It cannot authorize the existing parent-managed tasks just because an independent direct-dependency fixture succeeds. No owner override or V1.8 change was introduced.

## New fixture and exact production validation

Canonical source: [maven-h2-safe-retry](../candidate-verifier/test-fixtures/maven-h2-safe-retry/README.md). The POM and Java sources are the same bytes as the previously scanner-proven minimal source, reconstructed and revalidated here. One project/runtime dependency is H2 `2.1.212`, explicitly versioned. The compiler and Surefire use plugin-owned JUnit test tooling. A real JDBC test connects to H2, executes `SELECT 42`, and checks the result. There is one POM, no application parent/BOM, no suppression, and no copied acceptance decision.

The new [audit runner](qa/trivy-owasp-h2-fixture-prequalification/audit-scripts/qualify.cjs) invokes current source modules directly. It derives evidence from actual operation results instead of executing the previous fixture helper or loading its qualification as an acceptance result:

1. Maven clean/package with tests, runtime dependency materialization, dependency:tree and effective-pom.
2. Real Trivy image-archive and OWASP scans; full reports remain unfiltered.
3. Current OWASP Maven normalization, scanner-specific fingerprints, native/correlated security providers, provenance, control profile and remediation plans.
4. Real `MavenDependencyGetExistenceChecker` proves the selected H2 artifact exists.
5. Current production `writeSecurityPatch` produces the one-file edit. `CandidateMaterializer` enforces allowed path `pom.xml`, operation and written-content digest.
6. Actual patched build/tests and both rescans; current scope derivation, dependency-graph closure and security-closure functions verify the patch.
7. `gateCandidate` consumes facts computed from those outputs. `buildDependencyCompatibilityDecision` selects `2.2.220` as the validated recommendation.
8. Fresh local, source-specific audit evidence is passed through the current `V1_8CompatibilityDecisionService.lookup` and exact `canDispatchSecurityRemediationV1_8`. Both sources return ALLOW.

[Runtime function comparison](qa/trivy-owasp-h2-fixture-prequalification/deployed-runtime-function-comparison.json) proves identical SHA-256 hashes of `Function.toString()` between the local execution and deployed backend for the candidate gate, compatibility decision builder, evidence lookup, stale guard and dispatch predicate. Production code, policies and the production immutable evidence store were not edited.

The temporary evidence store is a **fresh local proof artifact**, derived from real findings and validation results and bound to `LOCAL_DISPOSABLE_H2_FIXTURE` plus each local Git commit. It is not an entry installed into the live backend. [A negative binding check](qa/trivy-owasp-h2-fixture-prequalification/future-repository-binding-negative.json) confirms that using it for the proposed future GitHub repository returns `BLOCK / V1_8_EVIDENCE_STALE`. Repository creation is prequalified; live launch is not authorized or qualified by copying this evidence.

## Scanner, patch and reservation proof

Trivy 0.72.0 uses a read-only copy of the existing builder vulnerability/Java databases. It scans a Docker-format archive of the Maven runtime dependency JARs plus the application JAR, with production image scanning flags, list-all-pkgs and offline database options. The empty ignore file contains no exclusion. There is no OS layer: this is the same bounded Maven artifact method as the previous proof, not a claim of validating a future Jenkins Docker base image.

OWASP Dependency-Check 12.2.2 uses a copied Jenkins database, `autoUpdate=false` and the production retireJs/nodeAudit/ossindex analyzer flags. Audit `failBuildOnCVSS=11` permits recording the intentionally vulnerable baseline; `failOnError=true` makes scanner execution errors fatal. Those reporting controls do not remove findings. There are no analysis exceptions and no scanner/CVE/package/source suppressions.

Every baseline produces exactly one Trivy and one OWASP finding for `CVE-2022-45868`, `com.h2database:h2`, installed `2.1.212`. OWASP native fixed version remains null; current production correlation with the exact same CVE/coordinate/version yields `2.2.220`. Fingerprints remain distinct by scanner source. Current Phase 4G `canonicalTarget` produces the same FILE key for the stable placeholder project UUID `11111111-1111-4111-8111-111111111111`, trusted file `pom.xml`, independently for each normalized finding.

The candidate changes only H2 `2.1.212 -> 2.2.220`, in one control/one file. Production scope is `SINGLE_CONTROL`, graph closure passes, manifest materialization and content hashes pass, and both patched scanner reports contain zero findings. There is no additional target collision. The two intentional baseline scanner identities share one reservation; no live owner or reservation was created.

## Reproducibility

After the initial qualification, its reports were retained and both original workspaces (`seed` and `seed-patch`) were destroyed. Two fresh workspaces were copied from the temporary canonical POM/src source. Each independently repeated scanner → normalization/provenance/providers → V1.8 planning → patch → build/tests → dual rescan → candidate recommendation and source-bound dispatch gates.

| Run | Current / fixed / selected | Target | Baseline Trivy / OWASP | Patched Trivy / OWASP | Tests baseline / patched | V1.8 |
| --- | --- | --- | --- | --- | --- | --- |
| Initial | 2.1.212 / 2.2.220 / 2.2.220 | pom.xml, same FILE key | 1 / 1 | 0 / 0 | 1 passed / 1 passed | ACCEPT; both ALLOW |
| Fresh reconstruction 1 | Identical | Identical | 1 / 1 | 0 / 0 | 1 passed / 1 passed | Identical |
| Fresh reconstruction 2 | Identical | Identical | 1 / 1 | 0 / 0 | 1 passed / 1 passed | Identical |

[Reproducibility evidence](qa/trivy-owasp-h2-fixture-prequalification/reproducibility.json) confirms identical required fields, validation facts, test counts, unfiltered normalized Trivy findings and manifest content hashes. Local commit IDs, report timestamps and evidence IDs legitimately differ between runs; no identity was reused to fake reproducibility. The canonical fixture was saved only after all three runs passed.

## Decision and scope

`READY_TO_CREATE_DEDICATED_H2_REPOSITORY = YES` means this local fixture has passed the requested prequalification. No repository was created. A future repository and scan commit need fresh normal ingestion and binding evidence; the existing live H2 tasks remain blocked. The separate reservation-migration historical-lifecycle conflict recorded in Phase 4G.1 is unchanged and remains a future release issue.

Only canonical test-fixture source and audit documentation/evidence were added. Existing production source/configuration/workflows and tasks remain unchanged. No Jenkins job, production database mutation, deployment, remediation, retry, remote branch or PR occurred.

STOP.
