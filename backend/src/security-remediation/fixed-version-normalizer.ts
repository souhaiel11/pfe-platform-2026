// R-SEC-V1 §2 — normalizes the raw `Cve.fixedVersion` string into a
// `fixedVersions: string[]` array, additive and backward-compatible
// (fixedVersion itself is never removed or renamed).
//
// GROUNDING (do not re-derive without re-checking real data): the ONLY raw
// shapes actually observed in this platform are:
//   - TRIVY: `v.FixedVersion || null` — Trivy's own native field, passed
//     through verbatim by WF1 (n8n-workflows/active/wf1-incident-intake-
//     analysis-v5-1-...json, node "Merge All Fetched Data"). A REAL
//     persisted example (this platform's own Postgres, project pfe-app-test,
//     CVE-2023-6378 on ch.qos.logback:logback-classic) contains a
//     comma-separated MULTI-VALUE string:
//       "1.3.12, 1.4.12, 1.2.13"
//     confirming Trivy's documented behavior (multiple fixed releases
//     across maintained branches) actually occurs in this platform's data,
//     not merely in Trivy's abstract spec.
//   - OWASP: `fixedVersion: null` UNCONDITIONALLY — hardcoded in the same
//     WF1 node (owaspCves.push({..., fixedVersion:null, ...})). OWASP
//     Dependency-Check's own native report format carries no upgrade
//     suggestion at all. Confirmed against real persisted data too
//     (project pfe-app-test, CVE-2024-50379 on tomcat-embed-core-9.0.63.jar
//     — the task's own worked example — has fixedVersion: null). This is
//     NOT a bug in this normalizer: OWASP findings in this platform simply
//     never carry a fixed version today, so they can never satisfy the
//     eligibility classifier's "at least one fixed version known" rule
//     until WF1 is changed to supply one — a separate, out-of-scope change.
// No other separator (semicolon, pipe, newline) has been observed in any
// seed/fixture/persisted example in this repository; only comma-splitting
// is implemented, deliberately, rather than guessing at unobserved formats.

export function parseFixedVersions(raw: string | null | undefined): string[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  return text
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
}
