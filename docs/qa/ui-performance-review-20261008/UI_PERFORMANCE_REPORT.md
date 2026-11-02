# UI Performance Review — 2026-10-08

## 1. Outcome and scope

**C — BACKEND_OPTIMIZATION_REQUIRED.** Frontend-only optimization, measured on the actually served origin `http://127.0.0.1:4200`. Business semantics, source-backed values, scanner interpretation and governance rules were preserved. Three runtime source files changed; no backend, database schema, WF2, WF6, remediation/retry/Phase 4G or Azure governance implementation changed. No pipeline, remediation, authorization, PR or deployment was triggered.

Measured projects: **devsecops-platform-testbed** and **pfe-app-test**, with exact IDs in the raw evidence. Ten flow labels per project: overview, Rapport, Jenkins, SonarQube, Docker, Security, Remediation, Incidents, Configuration, Deployment. Overview and Rapport are the same actual `rapport` tab; Security and Remediation are sections of the same actual `securite` tab. These are not invented routes.

Twenty project/flow pairs, two full-document samples each, plus sixteen warm tab-switch samples: **56 samples per release**. Request totals include only measured samples, not authentication, project discovery or preparation navigations. No simultaneous QA workload was intentionally run during the final performance samples.

Requests: **372 → 198 (46.8% fewer)**. Median improvement of full-document **API/section completion** across twenty matched project/flow medians: **21.3%**. This is not a claim that every paint or every tab improved. Largest matched improvement: **pfe-app-test / SonarQube: 1849.0 → 967.5 ms (47.7%)**.

## 2. Measurement method and limits

`measure.mjs` records navigation start (epoch), first source-backed project header at requestAnimationFrame, every API endpoint/start/duration/status/decoded payload size, duplicate URL counts, section completion (last API completion or automation feedback, whichever is later), DOM mutation after the last response, and long tasks. First header visibility is meaningful identity content, not proof all sections are ready. Full-document navigation uses a continuing browser context; this is not a completely cold browser/disk-cache benchmark. Network routing was identically enabled before/after to block mutations and observe reads. It also disables Playwright HTTP cache, so results describe this controlled environment rather than a universal browser-cache guarantee.

Warm `feedbackMs` from the original common harness measures Playwright click completion including actionability/router settlement, **not first paint**. Its timing can include arriving task data and table rendering; it is retained as an automation-completion diagnostic, not used as first-paint evidence. `tab-paint-probe.mjs` separately measures final-release capture-phase click → requestAnimationFrame with active tab and loading text, plus CDP TaskDuration, ScriptDuration, LayoutDuration and RecalcStyleDuration deltas. This probe is AFTER-only; no invented before/after paint improvement is claimed.

DOM mutation delay and long-task totals are rendering-cost proxies, not an Angular-exclusive profiler duration. CDP main-thread CPU includes JS/application work during the section load. Payload bytes are decoded response bodies, **not compressed wire transfer bytes**. Chromium evicted 60 baseline and 40 final large response bodies from inspector storage. Those capture errors are preserved and are not failed API requests. Separate authenticated streaming GETs supply their sizes; no missing size is asserted to be zero. Raw `largest` fields represent inspector-retained responses and are superseded for size attribution by `response-size-supplement.json`. Separate registry/OCI diagnostics were performed outside the final navigation sampling window. Two repetitions per full-document case do not establish statistical significance; host load and external services vary. Raw samples are preserved rather than replacing slow outliers with favorable values.

## 3. PERFORMANCE_BASELINE

See [PERFORMANCE_BASELINE.csv](PERFORMANCE_BASELINE.csv) and [before-measurements.json](before-measurements.json) for all required per-navigation fields and [network-waterfall.csv](network-waterfall.csv) for endpoint/caller/necessity classification.

Baseline: 372 measured API reads. Ordinary full-document tabs made nine requests; Jenkins and Deployment ten. Every tab triggered live Jenkins, two remediation reads and convergence, regardless of whether those features were visible. Two incident requests overlapped: a full same-project report/incident list plus a separate size=20 list. The header and report remained progressively visible, but inactive work competed with the visible feature.

The original inspector could not retain the largest response bodies. Separate streaming characterization of the unchanged backend endpoints confirms: incidents **15,516,430 bytes**, reports **12,102,637 bytes**, overlapping size=20 incidents **11,432,334 bytes**. Saved Jenkins analyses are **864,407 bytes** and remediation tasks **852,634 bytes**; they were the largest bodies the inspector retained, not the largest actual responses. `response-size-supplement.json` supplies corrected per-sample largest-response attribution without erasing raw capture errors. Slow pfe-app-test governance median was approximately **11 seconds**. The evidence distinguishes latency, payload and frontend rendering rather than attributing everything to Angular.

## 4. Network waterfall and necessity

`network-waterfall.csv/json` contains **ENDPOINT, COUNT, DURATION_MS_MEDIAN/MAX, PAYLOAD_SIZE_BYTES_MAX, CALLER_COMPONENT, NECESSARY and REASON**, separately before/after. Raw request lists preserve the query strings and start times needed to reconstruct waterfalls.

| Read | Caller | Necessary |
|---|---|---|
| GET projects/:id | ProjectDetail | Yes: identity/configuration; one per full-document navigation |
| GET incidents?projectId | ProjectDetail | Yes: shared report/header proof and report history |
| GET incidents?projectId&size=20 | ProjectDetail | No when full list already loaded; overlapping read eliminated |
| GET reports?projectId | ProjectDetail | Yes: real Report score/build correlation; no thin existing contract |
| GET projects/:id/jenkins-status | ProjectDetail | Only active Jenkins tab |
| GET jenkins/analyses?projectId | JenkinsfileOptimizer | Active Jenkins tab; saved analysis is distinct from live build |
| GET manual-remediation + summary | ProjectDetail | Active security/remediation tab |
| GET incidents/project/:id/cycles | ProjectDetail | Active security/convergence section |
| GET azure-deploy/ready/:id | ProjectDetail | Overview, security, configuration or deployment |
| GET azure-deploy/governance/:id | DeploymentGovernance | Deployment entry/re-entry; mandatory fresh result |

**40 overlapping incident reads removed** across forty matched full-document navigations. These are logical duplicate reads with different query strings; exact duplicate URLs were not the principal problem. **148 inactive-feature reads removed** in those same forty samples. Warm re-entry now adds necessary fresh feature reads, so net reduction across all samples is smaller than the full-document reduction. Re-clicking an already-active tab does not refetch.

No repeated project metadata request within one measured navigation was identified. No 404/retry loop, failing API response or new polling was introduced. Existing action-dependent polling bounds and policies remain intact. Calls for independent features already ran in parallel after metadata; they were not serialized or reordered into a new business flow.

## 5. Lazy loading and progressive UX

- Shared incident/report proof remains loaded for the actual source-backed header and selected report. No artificial score or summary is substituted.
- Live Jenkins starts only on Jenkins entry; existing history and new loading state remain independent from the project header.
- Manual tasks/summary and convergence start only on security entry.
- Readiness starts only for tabs that display it; old readiness proof is cleared while revalidating.
- Incident rows reuse the existing full, newest-first incident response with `slice(0,20)`. All report history is retained, including incidents without AI in the incident window. No server-side history limit was silently imposed.
- Scanner summaries can render while task evidence loads. First-load task-dependent tables wait for that evidence instead of rendering once without tasks and again with tasks. Existing rows stay mounted during normal polling/refresh when tasks are already known.
- Returning to a feature revalidates its data. There is no cross-project or global result cache.

Project-scope cancellation and reset remain in place for all reads. Read errors still produce errors, not clean empty results. Existing scanner missing/error states and numeric null handling are unchanged.

## 6. Response size

Inspectable decoded-byte **lower bounds**, excluding evicted bodies, across identical measured samples: **49,263,690 → 23,737,876**. These lower bounds are incomplete and must not be presented as complete wire-volume measurements. Actual large-response sizes are provided in `payload-characterization.json`; omitted bodies are not zero-byte responses. The reduction in request count comes from avoiding unnecessary reads, not removing evidence from required responses.

Existing incidents size filter is used elsewhere; here an extra limited read was unnecessary because the full report history is already needed. Reports have a backend cap of 100 but return raw evidence needed for historical score correlation. Remediation tasks and saved Jenkins analyses do not expose a suitable thin/paginated contract for replacing current UI needs without feature/contract changes. Their large responses are documented rather than truncated arbitrarily. The remaining incident+report reads deliver **27,619,067 decoded bytes** on every full-document pfe-app-test navigation, including Configuration. This is a concrete **P1 read-contract limitation**. No suitable existing thin contract supplies all the exact header/build correlation facts while preserving report history. A minimal backend read projection/latest-summary contract, followed by on-demand history retrieval, is required to remove this cost safely. It is reported, not implemented in this phase. No backend redesign or new endpoint was introduced.

## 7. Frontend rendering

CVE task lookup was repeatedly linear in the task array. A computed map keyed by exact task ID **and scanner source** now provides indexed lookups and invalidates when task data changes. First-match behavior is preserved; unknown IDs/sources remain unmatched. No eligibility or security decision is cached.

CVE rows now track exact scanner/CVE/package identity, matching the existing row identity semantics, so task refresh does not recreate unchanged row DOM. Filters, selection, details and lifecycle rules remain authoritative. No speculative OnPush conversion, virtual scrolling, chart redesign or template-level business memoization was introduced.

Final actual warm initial-feedback probe: **median 13.2 ms, max 60.1 ms** over sixteen tab entries. Complete heavy security data may still take longer than the initial visible loading state. Warm security completion can be slower than the eager baseline, which had already paid for task loading while a different tab was open. That tradeoff is explicit in the full before/after table below; it is not hidden by reporting only cold improvements.

## 8. External source latency

Existing production read-only controller resolver methods were timed in isolation, without authorizing/deploying or patching running code:

| Read-only path | Measured ms |
|---|---:|
| Full governance diagnostic GET | 11933.8 |
| Agent /resolve-digest (session + ACR tag/digest lookup) | 4611.7 |
| Agent /inspect-artifact (session + OCI metadata inspection) | 5752.8 |

These are separate samples, so their subtraction is **not** an exact exclusive backend-processing time. They prove that substantial latency exists in the external agent/registry verification chain. Agent HTTPServer is serial; avoid concurrent presentation-time governance checks across many projects. Session checks, digest revalidation and OCI provenance remain required and uncached. No image layers were built/pushed/deployed by this review.

Jenkins endpoint calls the actual Jenkins last-build and history APIs sequentially, with existing 5-second bounds; its API wall time includes backend and external work. No independent direct-Jenkins split was measured, so no invented external-only number is assigned. Sonar/Trivy/OWASP/ZAP views use persisted pipeline evidence during these flows; there is no live rescan latency to attribute. Saved Jenkins analysis is PostgreSQL data, not a fresh GitHub/agent analysis. No live GitHub analysis or PR action was invoked.

## 9. Backend/database investigation

Read-only EXPLAIN ANALYZE on representative pfe-app-test reads:

- Incident filter/order: **0.298 ms**, 145 matching rows.
- Non-archived reports filter/order/limit: **0.148 ms**, 30 matching rows.

Evidence: `database-query-plans.jsonl`. Isolated streaming GETs completed the large incident and report responses in **354.2 ms** and **225.6 ms**, respectively. Browser-observed API durations also include delivery/handling under the full navigation workload and are not exclusive backend compute time. The remaining backend-contract issue is payload volume, not a proven slow SQL plan.

These times cover SQL execution, not network transfer, TOAST/JSON serialization, TypeORM hydration, enrichment or browser rendering. Small sequential scans are not evidence of a high-impact missing index. No schema change was justified.

Source tracing: incident findAll uses one relation-bearing read plus a **bulk** task lookup with IN(projectIds), not a query per finding. Reports use a bounded relation-bearing read; convergence uses one incident read plus in-memory cycle construction. Exact per-request SQL query counts were not instrumented in production and are not claimed. Redundant API reads were removed before considering database changes. Large JSON/enrichment remains a possible backend-contract improvement, not a proven slow SQL-index problem.

## 10. Cache policy

| Data | Classification | Applied policy |
|---|---|---|
| Static labels/assets | STATIC/LOW_CHANGE | Existing hashed assets; no business values cached here |
| Project metadata | SAFE_SHORT_CACHE in principle | No new cache; project-scoped fetch on navigation |
| Report history/analysis | LOW_CHANGE historical evidence | Existing component state only; never relabelled as live evidence |
| Current remediation task/attempt | MUST_REVALIDATE | Fetch on security entry; existing polling/actions retained |
| Jenkins live status | MUST_REVALIDATE | Fetch on Jenkins entry |
| Readiness/governance | MUST_REVALIDATE | Entry/re-entry fetch; stale readiness cleared; action checks unchanged |
| Authorization | NEVER REUSE | Existing component/action lifecycle unchanged; no authorization requested |

No stale global caches, authorization reuse or governance caching were added.

## 11. Regression and release evidence

All **30 frontend spec files PASS**, French copy check PASS, production build PASS. Four focused regression tests cover active-tab-only reads, same-tab no-op, re-entry freshness, complete incident-history reuse/20-row window, clearing readiness while pending, and exact task-map identity/invalidation. Existing truth, callback, retry UI, deployment, navigation and cross-project tests pass unchanged.

Served release index SHA-256: `dcfbffdf02fd201ccc053b75faaaf3ff93b0d70b52a94efa0133cbfb80475e1f`. Full asset manifest: `frontend-release.json`. Only static frontend files were published to the existing nginx-served directory, retaining old chunks for open sessions. Backend/verifier/scanner identities and workflow definitions are compared before/after. The workspace already contained unrelated changes; no global reset or commit was made.

Runtime regression: `interaction-review.json` covers five real-project SPA transitions and representative source-backed Sonar/Jenkins/Trivy/OWASP/remediation/incident/governance values. `console-audit.json` covers major routes and resource/console errors. `tab-paint-probe.json` provides final tab feedback and CPU evidence. Browser mutations were blocked; no write action was exercised.

## 12. Measured before/after

Primary table: two full-document samples per project/flow; numbers are medians. Completion includes required API responses, not merely header visibility. Initial header timing is separately retained in `before-after.csv` and raw JSON. Negative improvements are retained.

| Project | Flow | BEFORE_MS | AFTER_MS | IMPROVEMENT_PERCENT | REQUESTS_BEFORE | REQUESTS_AFTER |
|---|---|---:|---:|---:|---:|---:|
| devsecops-platform-testbed | overview | 419.1 | 487.5 | -16.3% | 9.0 | 4.0 |
| devsecops-platform-testbed | Rapport | 407.0 | 491.5 | -20.8% | 9.0 | 4.0 |
| devsecops-platform-testbed | Jenkins | 399.5 | 383.0 | 4.1% | 10.0 | 5.0 |
| devsecops-platform-testbed | SonarQube | 548.0 | 420.5 | 23.3% | 9.0 | 3.0 |
| devsecops-platform-testbed | Docker | 331.5 | 383.0 | -15.5% | 9.0 | 3.0 |
| devsecops-platform-testbed | Security | 469.0 | 447.5 | 4.6% | 9.0 | 7.0 |
| devsecops-platform-testbed | Remediation | 631.0 | 419.5 | 33.5% | 9.0 | 7.0 |
| devsecops-platform-testbed | Incidents | 392.5 | 362.5 | 7.6% | 9.0 | 3.0 |
| devsecops-platform-testbed | Configuration | 381.0 | 386.0 | -1.3% | 9.0 | 4.0 |
| devsecops-platform-testbed | Deployment | 371.5 | 472.5 | -27.2% | 10.0 | 5.0 |
| pfe-app-test | overview | 1389.5 | 1121.5 | 19.3% | 9.0 | 4.0 |
| pfe-app-test | Rapport | 1411.0 | 968.0 | 31.4% | 9.0 | 4.0 |
| pfe-app-test | Jenkins | 1490.0 | 1083.0 | 27.3% | 10.0 | 5.0 |
| pfe-app-test | SonarQube | 1849.0 | 967.5 | 47.7% | 9.0 | 3.0 |
| pfe-app-test | Docker | 1501.5 | 980.5 | 34.7% | 9.0 | 3.0 |
| pfe-app-test | Security | 2403.5 | 1794.5 | 25.3% | 9.0 | 7.0 |
| pfe-app-test | Remediation | 2519.5 | 1720.0 | 31.7% | 9.0 | 7.0 |
| pfe-app-test | Incidents | 1439.0 | 974.5 | 32.3% | 9.0 | 3.0 |
| pfe-app-test | Configuration | 1564.5 | 968.0 | 38.1% | 9.0 | 4.0 |
| pfe-app-test | Deployment | 12135.5 | 11887.5 | 2.0% | 10.0 | 5.0 |

Warm tab diagnostics (one sample each; includes Playwright action/settlement overhead, not first-paint timing):

| Project | Tab | Before completion ms | After completion ms | Requests before → after |
|---|---|---:|---:|---|
| devsecops-platform-testbed | Rapport | 62 | 62 | 0 → 0 |
| devsecops-platform-testbed | Jenkins | 62 | 59 | 1 → 2 |
| devsecops-platform-testbed | SonarQube | 45 | 45 | 0 → 0 |
| devsecops-platform-testbed | Docker | 45 | 45 | 0 → 0 |
| devsecops-platform-testbed | Security | 78 | 101 | 0 → 4 |
| devsecops-platform-testbed | Incidents | 47 | 50 | 0 → 0 |
| devsecops-platform-testbed | Configuration | 46 | 54 | 0 → 1 |
| devsecops-platform-testbed | Deployment | 75 | 64 | 1 → 2 |
| pfe-app-test | Rapport | 48 | 133 | 0 → 0 |
| pfe-app-test | Jenkins | 304 | 105 | 1 → 2 |
| pfe-app-test | SonarQube | 70 | 55 | 0 → 0 |
| pfe-app-test | Docker | 51 | 45 | 0 → 0 |
| pfe-app-test | Security | 432 | 810 | 0 → 4 |
| pfe-app-test | Incidents | 74 | 65 | 0 → 0 |
| pfe-app-test | Configuration | 46 | 69 | 0 → 1 |
| pfe-app-test | Deployment | 10723 | 11604 | 1 → 2 |

First meaningful full-document header median: **236.0 → 306.0 ms**. Final maximum: **561.4 ms**. Header paint may vary independently from full section completion; improvements are not inferred from request count alone.

## 13. Remaining limits and final result

External provenance verification remains approximately 10–12 seconds for one configured project; it is required security work, with immediate independent UI feedback. Large saved-analysis and task responses remain on their relevant tabs. Heavy security tables still consume measurable CPU; no claim is made that complete table rendering is under 300 ms. The existing SCSS budget warning (25.97 kB vs 20 kB warning threshold) remains; build passes. One P1 performance issue remains: the two shared historical JSON reads transfer 27.6 MB for pfe-app-test navigation. Local header feedback is fast, but the measured payload is excessive and cannot be safely fixed by truncating the frozen frontend contract. External delay remains a separate required verification cost.

```text
PAGES_MEASURED = 20 project/flow pairs ; 56 samples before + 56 after
TOTAL_REQUESTS_BEFORE = 372
TOTAL_REQUESTS_AFTER = 198
DUPLICATE_REQUESTS_FOUND = 40 overlapping incident reads ; exact URL duplication not the principal issue
DUPLICATE_REQUESTS_REMOVED = 40
INACTIVE_TAB_REQUESTS_FOUND = 148
INACTIVE_TAB_REQUESTS_REMOVED = 148
SLOW_BACKEND_ENDPOINTS = 4 after-release endpoint groups with median >500 ms ; details in performance-summary.json
SLOW_EXTERNAL_ENDPOINTS = 1 slow governance API group ; two external agent subcalls independently timed
LARGEST_MEASURED_IMPROVEMENT = 47.7% completion ; pfe-app-test / SonarQube
MEDIAN_UI_IMPROVEMENT = 21.3% full-document section completion ; matched project/flow medians
CROSS_PROJECT_DATA_LEAK = NO reproduced ; scope cancellation tests and five-project browser switching PASS
STALE_GOVERNANCE_INTRODUCED = NO
FRONTEND_TESTS = PASS ; 30 files
FRONTEND_BUILD = PASS
P0_PERFORMANCE_ISSUES = 0 known
P1_PERFORMANCE_ISSUES = 1 — oversized shared incident/report read contract
SAFE_TO_KEEP_FRONTEND_FROZEN = YES ; no further safe frontend-only reduction of the remaining contract cost
FINAL_VERDICT = C — BACKEND_OPTIMIZATION_REQUIRED
WF2_CHANGED = NO
WF6_CHANGED = NO
REMEDIATION_LOGIC_CHANGED = NO
PHASE4G_CHANGED = NO
RETRY_LOGIC_CHANGED = NO
SCANNER_SEMANTICS_CHANGED = NO
AZURE_GOVERNANCE_RULES_CHANGED = NO
AZURE_DEPLOYMENT_EXECUTED = NO
NORMAL_DISPATCH = OFF
HARNESS = OFF
```

Protected-state equality is recorded in `safety-comparison.json`. Stop this optimization phase after the measured frontend-only release. Keep the frontend frozen; the remaining P1 requires a separately scoped minimal backend read contract, not further UI data substitutions.
