// Lignes affichées en tête des tableaux Trivy / OWASP, dans l'ordre du scénario de démonstration.
// Chaque montée de version ne modifie que sa propre bibliothèque (arbre Maven vérifié), condition
// pour que WF6 la corrige automatiquement. Vider la liste rend l'ordre « Corrigeables d'abord » habituel.
export const DEMO_SCENARIO_PINS: Record<string, ReadonlyArray<{ component: string; cve: string }>> = {
  TRIVY: [
    { component: 'com.h2database:h2', cve: 'CVE-2022-45868' },
    { component: 'com.google.code.gson:gson', cve: 'CVE-2022-25647' },
    { component: 'commons-io:commons-io', cve: 'CVE-2024-47554' },
    { component: 'org.jsoup:jsoup', cve: 'CVE-2022-36033' },
  ],
  OWASP: [
    { component: 'commons-collections:commons-collections', cve: 'CVE-2015-6420' },
    { component: 'commons-fileupload:commons-fileupload', cve: 'CVE-2016-1000031' },
    { component: 'org.apache.commons:commons-lang3', cve: 'CVE-2025-48924' },
    { component: 'org.bouncycastle:bcprov-jdk18on', cve: 'CVE-2023-33202' },
  ],
};
