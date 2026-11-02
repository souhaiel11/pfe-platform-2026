# Phase 4F.4 — local fixture synthesis

No fixture qualifies for the normal mandatory Trivy + OWASP ingestion path. No GitHub repository, project, Jenkins build, live task or attempt was created. Backend/harness/migration/WF6/retry policy were not edited. All Maven/cache/scanner work happened in disposable /tmp directories. Files here are source-only audit evidence, not an approved deployment fixture.

## Exact 12 previously compatible findings

The completed 759-finding inventory was reused; broad live discovery was not repeated. `exact-12.json` preserves the actual inventory rows and production gate results. Original targetFile was not captured/proven by that inventory; it is null and must not be invented. Each new minimal experiment resolves its direct target as pom.xml + exact dependency coordinate.

| Scanner | CVE | Package/coordinate | Current | Candidate | Ecosystem | Original gate |
|---|---|---|---|---|---|---|
| TRIVY | CVE-2024-38827 | org.springframework.security:spring-security-core | 5.6.4 | 5.7.14 | Maven | ALLOW |
| OWASP | CVE-2022-42003 | com.fasterxml.jackson.core:jackson-databind | 2.13.3 | 2.13.5 | Maven | ALLOW |
| OWASP | CVE-2022-31692 | org.springframework.security:spring-security-core | 5.6.4 | 5.6.9 | Maven | ALLOW |
| OWASP | CVE-2022-42252 | org.apache.tomcat.embed:tomcat-embed-core | 9.0.63 | 9.0.83 | Maven | ALLOW |
| OWASP | CVE-2022-42004 | com.fasterxml.jackson.core:jackson-databind | 2.13.3 | 2.13.5 | Maven | ALLOW |
| OWASP | CVE-2022-38752 | org.yaml:snakeyaml | 1.29 | 1.32 | Maven | ALLOW |
| TRIVY | CVE-2022-38750 | org.yaml:snakeyaml | 1.29 | 1.31 | Maven | ALLOW |
| OWASP | CVE-2022-38750 | org.yaml:snakeyaml | 1.29 | 1.31 | Maven | ALLOW |
| OWASP | CVE-2022-41854 | org.yaml:snakeyaml | 1.29 | 1.32 | Maven | ALLOW |
| OWASP | CVE-2023-41080 | org.apache.tomcat.embed:tomcat-embed-core | 9.0.63 | 9.0.83 | Maven | ALLOW |
| TRIVY | CVE-2022-41854 | org.yaml:snakeyaml | 1.29 | 1.32 | Maven | ALLOW |
| OWASP | CVE-2022-45143 | org.apache.tomcat.embed:tomcat-embed-core | 9.0.63 | 9.0.83 | Maven | ALLOW |

## Six distinct proven-compatible pairs, all tested first

| Package | Current → candidate | CVEs | Actual Trivy direct-target findings | Result |
|---|---|---|---|---|
| org.springframework.security:spring-security-core | 5.6.4 → 5.7.14 | CVE-2024-38827 | 3 | Collision; rejected without suppressions |
| com.fasterxml.jackson.core:jackson-databind | 2.13.3 → 2.13.5 | CVE-2022-42003, CVE-2022-42004 | 12 | Collision; rejected without suppressions |
| org.springframework.security:spring-security-core | 5.6.4 → 5.6.9 | CVE-2022-31692 | 3 | Collision; rejected without suppressions |
| org.apache.tomcat.embed:tomcat-embed-core | 9.0.63 → 9.0.83 | CVE-2022-42252, CVE-2022-45143, CVE-2023-41080 | 41 | Collision; rejected without suppressions |
| org.yaml:snakeyaml | 1.29 → 1.32 | CVE-2022-38752, CVE-2022-41854 | 7 | Collision; rejected without suppressions |
| org.yaml:snakeyaml | 1.29 → 1.31 | CVE-2022-38750 | 7 | Collision; rejected without suppressions |

## Broadened real assets

Logback 1.2.11→1.2.13: production scope rejects EFFECTIVE_MODEL_NOT_CORROBORATED. Spring Security Config 5.7.1→5.7.11: NO_COMMON_SAME_MAJOR_FIXED_TARGET. Another Security Core candidate remains a direct-target collision. Full derivation evidence is in qualification.json.

H2 2.1.212→2.2.220 / CVE-2022-45868 is the strongest local candidate: actual baseline and patch Maven clean package with one real JDBC test pass; actual Trivy image-archive scan changes from one finding to zero; production direct provenance, fixed-version provider, remediation scope, patch writer, candidate gates and compatibility decision produce VALIDATED_RECOMMENDED / ALL_GATES_PASSED. The exact production dispatch predicate also returns ALLOW for local, freshly derived evidence bound to each temporary Git commit. This evidence is not persisted into the business evidence store and cannot authorize a future repository/commit without fresh validation.

However OWASP 12.2.2 also detects the same H2 CVE. Production ingestion keeps scanner-source identities distinct, yielding two current findings on pom.xml/com.h2database:h2. dual-scanner-proof.json proves this using production normalizer, fingerprint, provenance and fixed-version correlation. This fails the mandatory isolation rule.

Spring Security Crypto 5.7.1: one Trivy CVE, twelve OWASP findings on the same coordinate. Log4j API 2.17.2: one Trivy CVE and two OWASP findings on the same coordinate. Rejected without suppression. Tomcat Websocket 9.0.63: 42 Trivy findings overall, including 41 on its shared Tomcat Core dependency. Spring Context 5.3.20: 11 findings; original fixed version requires a major upgrade. Spring Core 5.3.20: two direct findings, major-only original candidate. Hibernate 5.6.9.Final: original real finding has no fixed version; baseline experiment additionally could not resolve two uncached dependencies in offline Maven mode, so no successful scanner result or V1.8 decision is claimed. See all-experiment-results.json and production-gate-proof.json for exact findings/policy outputs.

## Scanner and build method

Trivy 0.72.0 and the real builder vulnerability/Java databases were copied read-only to /tmp. Actual Maven-resolved runtime JARs were packaged into a Docker-format image archive and scanned with the production image scanner and flags. No OS layer is included: this minimizes scanner noise but is not a claim that an eventual Jenkins/Docker base image has been scanned. `trivy fs` ignores these JARs by default and was not accepted as detection evidence. No ignore entry, suppression or filtered finding set was used.

OWASP uses the actual production Maven plugin 12.2.2 with a read-only copy of Jenkins's database into /tmp, autoUpdate=false, production analyzer flags, and no suppressions. Normal Maven Central dependency resolution writes only to the disposable Maven cache. Both scanners are mandatory under the existing shared pipeline; disabling either to qualify H2 is not authorized.

H2 uses exactly one project/runtime direct dependency. JUnit is a compiler/Surefire plugin test dependency, not a runtime/project dependency. No skipped tests, fabricated scanner outputs or mocked V1.8 results are used. Production patch writer output is deterministic. Two fresh reconstructions produce identical manifests, one Trivy + one OWASP finding, ACCEPT-compatible local evidence and passing baseline/patched tests. Patched H2 also has zero OWASP findings. Scanner evidence files include CVE/package/version provenance.

## Final report

REAL_COMPATIBLE_PAIRS_TESTED = 6/6
SELECTED_PACKAGE = NONE_QUALIFIED (H2 is a rejected local proof)
SELECTED_CURRENT_VERSION = N/A
SELECTED_CVE = N/A
SELECTED_CANDIDATE_VERSION = N/A
SCANNER_DETECTION_REAL = YES
V18_DECISION = ACCEPT for local H2 only; no fully isolated selected fixture
V18_REASON = ALL_GATES_PASSED for H2
EXPECTED_TARGET_FILE = pom.xml (H2 proof)
EXPECTED_DEPENDENCY_COORDINATE = com.h2database:h2 (H2 proof)
TOTAL_ACTIVE_REMEDIATION_FINDINGS = 2 (normal dual-scanner H2 ingestion)
SELECTED_TARGET_COLLISION_COUNT = 1 (H2 proof; no selected fixture)
UNIQUE_MUTATION_TARGET = NO
MAVEN_BASELINE_BUILD_PASS = YES (H2)
LOCAL_PATCH_VALID = YES (H2)
TARGET_CVE_REMOVED_AFTER_LOCAL_PATCH = YES (Trivy and OWASP H2)
POST_PATCH_TARGET_COLLISION = NO (zero findings, H2)
FIXTURE_REPRODUCIBLE = YES (H2, two reconstructions; reproducible rejection overall)
CANONICAL_FIXTURE_PATH = NONE_QUALIFIED; evidence/candidate-10 is explicitly rejected
HARNESS_CHANGED = NO
WF6_CHANGED = NO
LIVE_CHANGED = NO
READY_TO_CREATE_DEDICATED_FIXTURE_REPOSITORY = NO
FINAL_VERDICT = B — ALL_KNOWN_COMPATIBLE_PAIRS_COLLIDE

## Future repository/project plan, unexecuted

Name: remediation-retry-e2e-fixture. Repository: souhaiel11/remediation-retry-e2e-fixture. Future dedicated Jenkins job: remediation-retry-e2e-fixture. No Azure target needed. Normal path: repository → project configuration → Jenkins → Trivy + OWASP reports → normal finding creation → fresh repository/commit-bound V1.8 validation → normal launch → harness. No direct task insertion. Creation is blocked until a real dual-scanner finding set proves one active finding per selected target. No production source identity/deduplication change or scanner disabling is proposed in this phase.
