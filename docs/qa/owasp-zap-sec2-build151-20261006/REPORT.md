# OWASP_ZAP_SEC2_QUALIFICATION_REPORT

READ/TEST ONLY. No application source or original pom.xml modified. Generated qualification.xml descriptors and copied sources were confined to /tmp/sec2-qualification. Original #151 checkout remains clean.

## Authoritative baseline

Build 151; commit 393816c250f73d907eb5a2dd43b2ec2288c7abcb; digest sha256:6dc3cdba69592a91a5a1569978bcfca74d4080597a769ab368ed585ba397bcf5.
OWASP: ../healthy-artifact-2b7-20261006/build-151-reports/dependency-check-report.json. 23 CRITICAL occurrences, 19 distinct CVEs, 7 Maven coordinate groups. Ownership and full inventory preserved in dependency-qualification-matrix.json.

## Per-dependency qualification

### pkg:maven/org.yaml/snakeyaml@1.29

CURRENT_VERSION = 1.29
CVES = CVE-2022-1471
DIRECT_OR_TRANSITIVE = DIRECT
VERSION_OWNER = pom.xml dependency literal 1.29 (line 71); snakeyaml.version property also 1.29 but literal wins
CANDIDATES_CONSIDERED = 2.4 on Boot 2.7.0: YAML loader incompatible; 2.4 on Boot 2.7.18: qualified
SELECTED_COMPATIBLE_CANDIDATE = 2.4 with Boot 2.7.18 and aligned Security family
BUILD_PASS = True
TEST_PASS = True
STARTUP_PASS = True
HEALTH_PASS = True

### pkg:maven/org.springframework.boot/spring-boot@2.7.0

CURRENT_VERSION = 2.7.0
CVES = CVE-2023-20873, CVE-2026-40974
DIRECT_OR_TRANSITIVE = TRANSITIVE
VERSION_OWNER = Spring Boot parent/BOM 2.7.0
CANDIDATES_CONSIDERED = Boot 2.7.18 managed family: runtime compatible but critical findings remain; Boot 2.7.33 / Framework 5.3.49 / Security 5.7.22: unavailable from configured public repository; Boot 3.5.16 family: compilation fails without source migration
SELECTED_COMPATIBLE_CANDIDATE = None
BUILD_PASS = NOT_QUALIFIED
TEST_PASS = NOT_QUALIFIED
STARTUP_PASS = NOT_QUALIFIED
HEALTH_PASS = NOT_QUALIFIED

### pkg:maven/org.springframework/spring-core@5.3.20

CURRENT_VERSION = 5.3.20
CVES = CVE-2026-41855
DIRECT_OR_TRANSITIVE = TRANSITIVE
VERSION_OWNER = Boot BOM spring-framework.version=5.3.20 / imported Spring Framework BOM
CANDIDATES_CONSIDERED = Boot 2.7.18 managed family: runtime compatible but critical findings remain; Boot 2.7.33 / Framework 5.3.49 / Security 5.7.22: unavailable from configured public repository; Boot 3.5.16 family: compilation fails without source migration
SELECTED_COMPATIBLE_CANDIDATE = None
BUILD_PASS = NOT_QUALIFIED
TEST_PASS = NOT_QUALIFIED
STARTUP_PASS = NOT_QUALIFIED
HEALTH_PASS = NOT_QUALIFIED

### pkg:maven/org.springframework.security/spring-security-core@5.6.4

CURRENT_VERSION = 5.6.4
CVES = CVE-2022-31692, CVE-2023-34034, CVE-2026-22732
DIRECT_OR_TRANSITIVE = DIRECT
VERSION_OWNER = pom.xml direct literal 5.6.4 overrides Boot security.version=5.7.1
CANDIDATES_CONSIDERED = Boot 2.7.18 managed family: runtime compatible but critical findings remain; Boot 2.7.33 / Framework 5.3.49 / Security 5.7.22: unavailable from configured public repository; Boot 3.5.16 family: compilation fails without source migration
SELECTED_COMPATIBLE_CANDIDATE = None
BUILD_PASS = NOT_QUALIFIED
TEST_PASS = NOT_QUALIFIED
STARTUP_PASS = NOT_QUALIFIED
HEALTH_PASS = NOT_QUALIFIED

### pkg:maven/org.springframework.security/spring-security-web@5.7.1

CURRENT_VERSION = 5.7.1
CVES = CVE-2022-31692, CVE-2023-34034, CVE-2026-22732
DIRECT_OR_TRANSITIVE = TRANSITIVE
VERSION_OWNER = Boot BOM spring-security.version=5.7.1 / imported Spring Security BOM
CANDIDATES_CONSIDERED = Boot 2.7.18 managed family: runtime compatible but critical findings remain; Boot 2.7.33 / Framework 5.3.49 / Security 5.7.22: unavailable from configured public repository; Boot 3.5.16 family: compilation fails without source migration
SELECTED_COMPATIBLE_CANDIDATE = None
BUILD_PASS = NOT_QUALIFIED
TEST_PASS = NOT_QUALIFIED
STARTUP_PASS = NOT_QUALIFIED
HEALTH_PASS = NOT_QUALIFIED

### pkg:maven/org.springframework/spring-web@5.3.20

CURRENT_VERSION = 5.3.20
CVES = CVE-2016-1000027, CVE-2026-41855
DIRECT_OR_TRANSITIVE = TRANSITIVE
VERSION_OWNER = Boot BOM spring-framework.version=5.3.20 / imported Spring Framework BOM
CANDIDATES_CONSIDERED = Boot 2.7.18 managed family: runtime compatible but critical findings remain; Boot 2.7.33 / Framework 5.3.49 / Security 5.7.22: unavailable from configured public repository; Boot 3.5.16 family: compilation fails without source migration
SELECTED_COMPATIBLE_CANDIDATE = None
BUILD_PASS = NOT_QUALIFIED
TEST_PASS = NOT_QUALIFIED
STARTUP_PASS = NOT_QUALIFIED
HEALTH_PASS = NOT_QUALIFIED

### pkg:maven/org.apache.tomcat.embed/tomcat-embed-core@9.0.63

CURRENT_VERSION = 9.0.63
CVES = CVE-2024-50379, CVE-2024-52316, CVE-2024-56337, CVE-2025-24813, CVE-2025-31651, CVE-2026-41293, CVE-2026-43512, CVE-2025-55754, CVE-2025-66614, CVE-2026-43515, CVE-2026-55276
DIRECT_OR_TRANSITIVE = TRANSITIVE
VERSION_OWNER = Boot BOM tomcat.version=9.0.63
CANDIDATES_CONSIDERED = 9.0.119
SELECTED_COMPATIBLE_CANDIDATE = 9.0.119 whole Tomcat family
BUILD_PASS = True
TEST_PASS = True
STARTUP_PASS = True
HEALTH_PASS = True

## Compatibility and security evidence

SnakeYAML 2.4 on original Boot 2.7.0 passed existing tests and property-based startup but failed the explicit Spring YAML-loader probe with NoSuchMethodError: Representer.<init>(). Reject that standalone change. Boot 2.7.18 + SnakeYAML 2.4 + aligned Security 5.7.11 passed YAML loading, all 18 tests, Java 11 startup and HTTP 8080 /api/auth/health body OK. Candidate Dependency-Check 12.2.2 identified SnakeYAML 2.4 with HIGH package confidence and no CVE-2022-1471 or other SnakeYAML findings. See snakeyaml-cve-removal.json.

Tomcat 9.0.119 whole-family override passed build, all 18 tests, Java 11 startup and health; the combined candidate rescan reports no Tomcat critical findings. The combined Boot/SnakeYAML/Tomcat candidate also passed all 18 tests, startup and health. Runtime jars were mounted into the exact #151 Java 11 base image; these are candidate runtime tests, not published images.

Combined candidate remains vulnerable: Boot CVE-2026-40974, Framework core/web CVE-2026-41855, Security core CVE-2026-22732, and Spring web CVE-2016-1000027 (five occurrences, four distinct). Its real scanner gate failed. Do not represent it as a complete safe upgrade. Full rescan also contains noncritical findings; preserve the report.

Fixed old-branch versions Boot 2.7.33, Framework 5.3.49 and Security 5.7.22 returned HTTP 404 from the configured public Maven repository. No enterprise repository entitlement/configuration was supplied; their compatibility remains NOT_RUN. Boot 3.5.16 was actually built against unchanged source and failed compilation on javax/Jakarta and Security API changes. Its tests/startup/health were NOT_RUN. A Java 17/Jakarta/Security migration or approved supported old-branch artifacts must be qualified separately before selecting a complete fix.

The rescans used a copied Jenkins Dependency-Check database with autoUpdate=false, without suppression rules. Results prove removal against that database, not universal absence of future vulnerabilities.

## Fresh ZAP

ZAP_TARGET_IDENTITY_PROVEN = YES (exact151-target-identity.json: digest, image ID, OCI commit/source).
Approved existing shared-library daemon/spider/default active-scan profile, target override only. Scanner pinned locally to zaproxy/zap-stable@sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef; report version 2.17.0.
FRESH_ZAP_REPORT_PATH = fresh-zap/zap-report.json
FRESH_ZAP_ALERT_COUNT = 0
HIGH = 0
MEDIUM = 0
LOW = 0
ZAP_40042_ON_BUILD151 = NOT_APPLICABLE_TO_BUILD151 (absent in this scan)
ZAP_10105_ON_BUILD151 = NOT_APPLICABLE_TO_BUILD151 (absent in this scan)
REAL_BUILD151_HIGH_MEDIUM_ALERTS = []

Profile log proves readiness, target access, spider completion, active scan completion and genuine report creation; no fallback. Report host is build151:8080. Target isolated locally, never app-test/Kubernetes. Health was HTTP 200 /api/auth/health body OK before and after scanning.

Coverage limitation: approved profile is unauthenticated and starts at root. Spring Security requires authentication for root and does not provide crawlable application links. Zero alerts is only this profile result, not authenticated API security clearance. Source uses JWT, not Basic authentication; no Actuator dependency is present. Legacy 40042/10105 fixes are not justified for #151. No HIGH/MEDIUM source trace exists because no such alert was produced. Do not silently add authentication/route discovery or change scanner classification.

## Decision

OWASP_DISTINCT_CRITICAL_CVES = 19
AFFECTED_DEPENDENCY_GROUPS = 7
SNAKEYAML_SELECTED_CANDIDATE = 2.4 with Boot 2.7.18 and aligned Security family
SNAKEYAML_COMPATIBLE = YES (conditional on qualified parent change)
ALL_SELECTED_CANDIDATES_BUILD_PASS = YES for partial selected candidates; complete seven-group set NOT_QUALIFIED
ALL_SELECTED_CANDIDATES_TEST_PASS = YES for partial selected candidates; complete seven-group set NOT_QUALIFIED
HEALTH_CONTRACT_PRESERVED = YES for qualified candidates
OWASP_PATCH_PLAN_READY = NO (complete remediation not qualified)
ZAP_PATCH_PLAN_READY = YES for observed findings: no patch warranted for legacy alerts; coverage limitation retained
READY_FOR_SECURITY_FIX_IMPLEMENTATION = NO
FINAL_VERDICT = B — DEPENDENCY_CANDIDATES_INCOMPATIBLE (no complete compatible set qualified; Boot 3 candidate requires source migration)

Azure Deployment Governance, Phase 4G, retry harness, WF2, WF6, agent and scanner classification unchanged. No GitHub mutation, ACR push, live deployment or source patch. Only disposable local containers/networks, copied caches and evidence artifacts were used.

Local cleanup verified: no sec2-* containers remain; isolated network removed. Original POM byte identity verified across all five lab cases. See final-invariants.json.
