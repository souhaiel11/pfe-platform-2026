# H2 dual-scanner safe retry fixture

Phase 4G.2 prequalified this local Maven fixture with current production V1.8 functions. No remote repository or live remediation exists for this fixture.

| Field | Proven value |
| --- | --- |
| CVE | CVE-2022-45868 |
| Package | com.h2database:h2 |
| Vulnerable version | 2.1.212 |
| Trivy fixed version | 2.2.220 |
| V1.8 selected candidate | 2.2.220 |
| Edit | DEPENDENCY_VERSION / DIRECT_EXPLICIT |
| Trusted target file | pom.xml |
| Baseline scanners | One Trivy finding and one OWASP finding, same CVE/coordinate/version |
| Patched scanners | Zero Trivy and zero OWASP findings in the scanned runtime artifact |
| Application test | A real JDBC connection executes SELECT 42 and checks its result |

There is one project dependency, H2, and no parent/BOM. JUnit belongs to the build plugins, not the project runtime dependency graph. Both scanner identities remain distinct. Phase 4G derives the same `(projectId lowercase, ["v1","FILE","pom.xml"])` reservation for both. One owner may write; its sibling must be blocked throughout dispatch and retry ownership. This is a two-finding, one-writer fixture.

The initial proof and two fresh reconstructions passed Maven builds/tests, real Trivy 0.72.0 and OWASP Dependency-Check 12.2.2 scans, current normalization/providers/provenance, production patch/materialization/scope checks, and V1.8 candidate/dispatch gates. Reports are in [the Phase 4G.2 report](../../../docs/TRIVY-OWASP-H2-FIXTURE-PREQUALIFICATION-REPORT.md).

Trivy scanned a Docker-format archive containing Maven-resolved runtime JARs and the application JAR, with no OS layer. OWASP scanned normal Maven dependencies using a copied production database, autoUpdate=false and the production analyzer flags. No CVE, package, source, or scanner was suppressed. This proves the Maven fixture; a future Jenkins container/base image still requires its own normal scan.

For a future audit, copy only pom.xml and src into a disposable workspace. Run the retained `docs/qa/trivy-owasp-h2-fixture-prequalification/audit-scripts/qualify.cjs` with `H2_AUDIT_ROOT` and `H2_AUDIT_LAB` if paths differ. The laboratory requires a local settings.xml pointing to its isolated Maven cache, a `.mvn/maven.config` selecting that settings file, the Trivy binary/cache, the copied OWASP database, and scan.py. That runner performs actual builds/scans and derives fresh temporary evidence; it does not import an old ACCEPT result.

The temporary audit evidence stores are local proof artifacts. They do not change the backend's immutable production evidence store and cannot authorize another repository or commit. A future GitHub repository requires fresh normal ingestion and repository/SHA-bound validation. Repository creation, Jenkins jobs, deployment, harness activation and retries remain outside this phase.
