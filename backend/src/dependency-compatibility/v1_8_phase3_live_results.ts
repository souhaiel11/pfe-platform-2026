// Décrit les résultats observés des essais de qualification V1.8 et les exceptions propres à certains findings ; données d'évaluation, pas une preuve universelle de production.
export const LIVE_PROVEN_RESULTS: Record<string, { state: 'VALIDATED_RECOMMENDED' | 'VALIDATED_ALTERNATIVES' | 'NO_COMPATIBLE_CANDIDATE' | 'VALIDATION_FAILED'; detail: string }> = {
  // DIRECT: org.yaml:snakeyaml 1.29 -> 1.31. Real, live, through the real
  // orchestrator (candidate-verifier container, real builder-scanner).
  // Primary CVE-2022-25857 (Phase 2's original live proof, durationMs=134453)
  // re-run this phase with additionalCveIds to also real-check the 3 other
  // CVEs sharing this exact (package, fromVersion, toVersion) -- all 4
  // closed (durationMs=see live-snakeyaml131.log).
  'DIRECT:org.yaml:snakeyaml:1.29->1.31': {
    state: 'VALIDATED_RECOMMENDED',
    detail: 'Real orchestrator run: CANDIDATE_READY, ALL_GATES_PASSED. additionalCveClosure: CVE-2022-38749 closed, CVE-2022-38751 closed, CVE-2022-38750 closed (all real, same candidate image).',
  },
  // DIRECT: org.yaml:snakeyaml 1.29 -> 1.32. Real, live. Primary CVE-2022-38752 + additionalCveIds=[CVE-2022-41854], both closed.
  'DIRECT:org.yaml:snakeyaml:1.29->1.32': {
    state: 'VALIDATED_RECOMMENDED',
    detail: 'Real orchestrator run: CANDIDATE_READY, ALL_GATES_PASSED. additionalCveClosure: CVE-2022-41854 closed (real, same candidate image).',
  },
  // DIRECT: spring-security-core 5.6.4 -> 5.6.9 (CVE-2022-31692). Real, live.
  'DIRECT:org.springframework.security:spring-security-core:5.6.4->5.6.9': {
    state: 'VALIDATED_RECOMMENDED',
    detail: 'Real orchestrator run: CANDIDATE_READY, ALL_GATES_PASSED.',
  },
  // DIRECT: logback-classic 1.2.11 -> 1.2.13 (CVE-2023-6378). Real, live.
  'DIRECT:ch.qos.logback:logback-classic:1.2.11->1.2.13': {
    state: 'VALIDATED_RECOMMENDED',
    detail: 'Real orchestrator run: CANDIDATE_READY, ALL_GATES_PASSED.',
  },
  // DIRECT: spring-security-core 5.6.4 -> 5.7.12 (CVE-2024-22257). Real, live.
  'DIRECT:org.springframework.security:spring-security-core:5.6.4->5.7.12': {
    state: 'VALIDATED_RECOMMENDED',
    detail: 'Real orchestrator run: CANDIDATE_READY, ALL_GATES_PASSED.',
  },
  // DIRECT: spring-security-core 5.6.4 -> 5.7.14 (CVE-2024-38827). Real, live.
  'DIRECT:org.springframework.security:spring-security-core:5.6.4->5.7.14': {
    state: 'VALIDATED_RECOMMENDED',
    detail: 'Real orchestrator run: CANDIDATE_READY, ALL_GATES_PASSED.',
  },
  'OWNER:org.springframework.boot:spring-boot-starter-parent:2.7.0->2.7.18': {
    state: 'VALIDATED_RECOMMENDED',
    detail: 'Real coordinated owner build (Spring Boot parent 2.7.0->2.7.18): 6/7 real targets closed (jackson-databind CVE-2022-42003/CVE-2022-42004, tomcat-embed-core CVE-2022-42252/CVE-2022-45143/CVE-2023-41080, spring-security-config CVE-2023-34034 all ALL_GATES_PASSED); tomcat-embed-core CVE-2024-24549 genuinely NOT closed at resolved 9.0.83 (TARGET_CVE_NOT_CLOSED, real rescan) -- reported per-finding below, never uniformly applied.',
  },
};

/** Per-finding overrides for the owner build above -- CVE-2024-24549 did NOT close even though the shared owner build otherwise did; every OTHER finding sharing that owner plan key gets the shared VALIDATED_RECOMMENDED result above. */
export const OWNER_PLAN_KEY_EXCEPTIONS: Record<string, { state: 'NO_COMPATIBLE_CANDIDATE' | 'VALIDATION_FAILED'; detail: string }> = {
  'CVE-2024-24549:org.apache.tomcat.embed:tomcat-embed-core': {
    state: 'VALIDATION_FAILED',
    detail: 'Real coordinated owner build (Spring Boot parent 2.7.0->2.7.18): tomcat-embed-core resolved to 9.0.83, but the real Trivy rescan shows CVE-2024-24549 still present (TARGET_CVE_NOT_CLOSED) -- the version bump alone does not close this specific CVE, proven by real rescan, never assumed from version-number proximity.',
  },
};
