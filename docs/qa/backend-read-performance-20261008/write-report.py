import pathlib,json,hashlib,re,difflib
p=pathlib.Path(__file__).resolve().parent;root=p.parents[2];s=json.loads((p/'performance-summary.json').read_text());rows=json.loads((p/'before-after.json').read_text());artifact=json.loads((p/'backend-deployment.json').read_text());frontend=json.loads((p/'frontend-release.json').read_text())
inventory=[]
for name in ['consumer-search.txt','automation-consumer-search.txt']:
 file=p/name
 for line in file.read_text().splitlines():
  match=re.match(r'([^:]+):(\d+):(.*)',line)
  if match:inventory.append({'file':match[1],'line':int(match[2]),'references':sorted(set(re.findall(r'getIncidents|getDecisions|getProjectReports|/api/incidents|/api/reports|/incidents\?|/reports\?',match[3])))})
 file.unlink()
(p/'consumer-inventory.json').write_text(json.dumps(inventory,indent=2))
protected=len(json.loads((p/'qualified-artifact.json').read_text())['unchangedExistingJs'])
large=[r for r in rows if r['project']=='pfe-app-test']
table='\n'.join(f"| {r['flow']} | {r['beforeBytes']/1e6:.3f} | {r['afterBytes']/1e6:.3f} | {r['payloadReductionPercent']:.2f}% | {r['beforeMs']:.0f} / {r['afterMs']:.0f} | {r['requestsBefore']} / {r['requestsAfter']} |"for r in large)
text=f'''# Backend read-performance closure — 8 October 2026

## Result and measurement scope

**A — BACKEND_READ_PERFORMANCE_OPTIMIZED.** The largest project's shared incident/report reads decreased from **27,619,067 to 642,106 bytes (97.68%)**. The largest complete measured cold navigation, Security/Remediation, decreased from **28,652,608 to 1,675,647 bytes (94.15%)**. Full detailed evidence remains available. The frontend changes are limited to consuming the new read contracts, fetching selected detail, history pagination, and their necessary loading/error guards.

Measurements use the actual origin `http://127.0.0.1:4200`, two real projects (`pfe-app-test`, `devsecops-platform-testbed`), two cold navigations per flow/project and one warm sequence: **56 samples per release**. Overview and Rapport share the existing `rapport` tab; Remediation is within Security. The same flow aliases are retained for comparison rather than claiming separate routes.

Bytes are **decoded HTTP response body bytes**, not compressed wire traffic or resident memory. Browser response bodies and Resource Timing `decodedBodySize` supplied all bytes; neither final dataset has an unknown body size. Separate authenticated HTTP measurements establish the exact original field breakdown. Header visibility is a first-content proxy; data completion is the last observed API response. These are local observational measurements, not an Angular profiler benchmark. No timing target is inferred from payload savings.

Evidence: `before-measurements.json`, `after-measurements.json`, `before-after.csv`, `performance-summary.json`, `source-measure-before.json` and the preserved `measure.mjs`.

## Exact source of the original payload

| Endpoint | Caller / count per cold navigation | Rows | Response bytes | Dominant top-level value bytes |
|---|---|---:|---:|---|
| `GET /api/incidents?projectId=…` | ProjectDetail.loadReports / 1 | 145 | 15,516,430 | metadata 13,730,305; aiAnalysis 1,531,527; project relation 183,280 |
| `GET /api/reports?projectId=…` | ProjectDetail.loadJudgeStatus / 1 | 30 | 12,102,637 | rawData 12,054,194; project relation 37,920 |

The incident list contained 104 analyzed incidents. `metadata.enrichedData` alone accounts for 12,516,210 value bytes; `report.rawData.enrichedData` accounts for 11,591,784. Other heavy fields include nested validation history, developer guides, scanner bodies and duplicated AI raw data. Field values exclude JSON key/framing overhead; nested measurements overlap their parent and must not be added twice.

**ROOT_CAUSE:** normal project navigation hydrated complete incident/report histories, nested evidence, and repeated project relations while initially displaying one selected analysis and metadata/history summaries.

The selected incident's complete response is legitimately 620,529 bytes. Its scanner evidence is still needed by existing project tabs; this optimization retains it rather than making scanner data inaccessible.

## Actual UI fields and compatible contracts

`FIELD_USAGE_MATRIX.csv` documents list/detail requirements and measured size impact. Incident tables need identity, title, status, source and dates. History needs only the original analysis build/build_number/decision fields. The selected analysis requires full metadata/analysis. Report metadata needs identity, creation time, score/risk, Judge decision/confidence and the original nested build number for the existing correlation rule.

Added JWT-protected, **read-only** endpoints:

- `GET /api/project-reads/incidents?projectId=<uuid>&page=1&pageSize=20`
- Same endpoint with `analysisOnly=true` for analyzed history.
- `GET /api/project-reads/reports?projectId=<uuid>&page=1&pageSize=100` for the existing bounded score/Judge/build correlation window.

Both return `{{items,total,page,pageSize,hasNext}}`. Page size defaults to 20 and is capped at 100. Invalid project IDs and pagination are rejected with 400. Project and analyzed/non-archived filters run in parameterized SQL. Lists use explicit columns, no joins, and stable descending creation-time/ID ordering. Report build identity is extracted with a JSONB path; the full rawData column is not transferred to Node. Incident history previews retain only original fields, and malformed analysis remains unparseable rather than becoming an invented success.

Count and page run in one **REPEATABLE READ, READ ONLY** transaction. `total` is an authoritative count of the selected collection, never the page length. An out-of-range empty page retains its nonzero total. A successful empty collection returns total=0. Database/HTTP failures propagate as errors. No schema/index changes, migrations or writes were introduced.

**Compatibility:** existing `/incidents`, `/incidents/:id`, `/reports`, `/reports/:id` and their guards/response contracts are unchanged. Existing dashboard, global incidents, analysis, backend and automation consumers keep their original APIs. `consumer-inventory.json` records source locations. No hidden consumer must adopt this new opt-in contract. Full report content remains accessible through its original detail API.

## Frontend integration and on-demand detail

Initial project navigation now requests:

| Read | Rows | Bytes on largest project |
|---|---:|---:|
| Incident table summaries | 20 | 6,854 |
| Analyzed history summaries | 20 of 104 | 6,891 |
| Report metadata | 30 | 7,832 |
| Selected full incident | 1 | 620,529 |
| **Total** | **70 summary entries + 1 full detail** | **642,106** |

The original incident table's 20-row window remains intact. The history badge uses backend total=104. Expanding history shows the loaded summaries; loading the next page appends 20 summaries without prefetching details. Selecting an uncached history item fetches `/incidents/:id`. Reselecting a loaded item in the same project does not refetch it. This component-local detail cache is cleared on project change and report refresh; it never caches authorization or deployment governance.

Existing project-scope cancellation is preserved. A selection generation check prevents an older detail response from replacing a newer selection. Cross-project detail identity is checked before display. History pages, totals and cached details reset with the project. Failed lists/details never display an empty success or zero. Independent incident loading has its own loading/error guards. No writes were added.

Evidence: `FRONTEND_READ_INTEGRATION.patch`, `project-read-contract.spec.mjs`, `browser-contract-review.json`, `browser-error-review.json`.

## Served before/after

Largest project, median of two cold samples per flow:

| Flow | Before MB | After MB | Reduction | Completion before / after ms | Requests before / after |
|---|---:|---:|---:|---:|---:|
{table}

All request body sizes were captured. All **278** final observed API requests returned HTTP 200 and the measurement browser reported no uncaught exceptions. Across the full 56-sample dataset, reads increased **198 → 278**: each cold navigation replaces two full histories with three bounded summary reads and one selected-detail read. This is an explicit tradeoff for **97.68% less shared-history payload**, not a claim of request-count reduction. Warm feature revalidation policy remains unchanged.

The median cold completion improvement across the 20 project/flow pairs is **{s['medianColdCompletionImprovementPercent']:.2f}%**; see all per-flow values in `before-after.csv`. External-tool/governance latency remains variable, especially warm Deployment. No stale governance cache was introduced to conceal that latency. No claim is made that every timing sample improved.

Read-query EXPLAIN ANALYZE measurements across all five real projects are recorded in `isolated-read-qualification.json`: incident projections 0.066–0.100 ms; report projections 0.041–22.275 ms. Report JSONB extraction still reads/decompresses stored evidence internally. These small measured collections do not justify adding an index. Existing legacy relation/manual-task enrichment is avoided entirely by the new list path. Payload reduction, rather than query tuning, resolves this measured blocker.

## Qualification, release and protected systems

- **131 backend test files PASS.** Two initial sandbox failures (local HTTP listen and external repository access) passed with the necessary permissions. Both original failure and rerun logs are retained; no assertions were weakened.
- **31 frontend test files PASS**, including new pagination/detail/error/project-reset coverage and existing navigation/security/deployment/retry tests. French QA PASS.
- **Production frontend build PASS**, in an isolated output directory before publication. The pre-existing 25.97 KB component stylesheet budget warning remains; it was not introduced by this read change.
- Real database qualification covers all **five projects**, authoritative totals, all page traversal, beyond-last-page counts and SQL filtering. Served API checks cover all five projects, 401/400 behavior and unchanged full incident/report response hashes.
- Browser validation: **40 project/tab views**, detail selection and reuse, summary pagination without detail prefetch, incident detail route, same-component project switching, and **three browser-local 503 cases** proving honest list/history/detail errors. These are read-only browser tests; non-GET writes were blocked.
- Backend/DB `/healthz` PASS; the served frontend index matches the final qualified artifact. The initial diagnostic `/api/health` probe was an incorrect URL, corrected to the existing `/healthz`; no health contract changed.

The workspace already contained unrelated uncommitted backend changes. The release therefore compiled the **actual running source tree** `f84bdefac8b1a0c8f500b505ec48aba2cafc214e`, adding only this read module and AppModule registration. Comparison with the actual running executable proves **{protected} existing JavaScript files byte-identical**; the only existing changed JavaScript file is `app.module.js`. The image layers extend the exact original image, preserving all other runtime files and all environment values.

- Base image: `sha256:3835d850600755188f93342f612899d64b4f653c992b062d19bbd8166018c742`.
- Qualified/running backend image: `{artifact['image']}`.
- Additive runtime patch SHA-256: `{artifact['patchSha256']}`. Base revision/tree labels identify the original release; the patch label identifies this additional read contract.
- Final frontend index SHA-256: `{frontend['indexSha256']}`.

Only the backend component and the minimal qualified frontend integration were updated. Candidate verifier and builder/scanner images are unchanged. No Azure application deployment was executed.

All row fingerprints match before/after for 5 projects, 777 tasks, 249 incidents, 63 reports, 2 existing reservations and 2 existing plans. All **24 workflow definitions** match. Active reservations/plans/remediation writers remain zero; normal dispatch and harness remain false. Evidence: `safety-comparison.json`, `qualified-artifact.json`, `backend-deployment.json`, `runtime-api-audit.json`, `final-runtime-check.json`.

## Limits and freeze decision

The 620.5 KB selected analysis remains intentionally complete. Legacy full-list APIs are preserved for compatibility and can still return large bodies when explicitly called by other consumers; their removal or broader global-page migration is outside this project-navigation contract change. The existing first-100 report correlation scope is preserved, with full older data still accessible through paginated metadata and original detail APIs. No new business filters or summaries were invented. External integration latency and the pre-existing stylesheet warning are not fixed by this payload reduction.

The measured project-navigation payload blocker is resolved. Freeze this performance work; do not extend it into a database, frontend or remediation redesign.

## Mandatory results

```text
ROOT_CAUSE = Complete histories and nested evidence hydrated during normal navigation
ENDPOINTS_OPTIMIZED = GET /api/project-reads/incidents; GET /api/project-reads/reports (additive opt-in contracts)
LARGEST_PROJECT_PAYLOAD_BEFORE = 27,619,067 bytes (shared incident/report portion)
LARGEST_PROJECT_PAYLOAD_AFTER = 642,106 bytes (same portion, including full selected detail)
PAYLOAD_REDUCTION_PERCENT = 97.68%
INCIDENT_PAYLOAD_BEFORE = 15,516,430 bytes
INCIDENT_PAYLOAD_AFTER = 634,274 bytes (two summary pages + one full selected detail)
REPORT_PAYLOAD_BEFORE = 12,102,637 bytes
REPORT_PAYLOAD_AFTER = 7,832 bytes
ROWS_BEFORE = 175 full entity entries per cold navigation
ROWS_AFTER = 70 summary entries + 1 full detail per cold navigation; underlying rows unchanged
PAGINATION_IMPLEMENTED = YES
LIST_DETAIL_SEPARATED = YES
SUMMARY_ENDPOINT_OR_QUERY = YES
DETAIL_DATA_STILL_AVAILABLE = YES
DATA_TRUTH_REGRESSION = NO
CROSS_PROJECT_LEAK = NO
BACKEND_TESTS = PASS (131 files)
FRONTEND_TESTS = PASS (31 files)
FRONTEND_BUILD = PASS
SERVED_RUNTIME_VALIDATION = PASS (56 performance samples, 40 project/tab views, 5 real projects)
P0_REMAINING = 0 (in-scope read-contract optimization)
P1_REMAINING = 0 (in-scope payload blocker)
FRONTEND_BEHAVIOR_CHANGED = NO, except minimal read-contract integration, history paging and necessary loading/error guards
WF2_CHANGED = NO
WF6_CHANGED = NO
REMEDIATION_LOGIC_CHANGED = NO
RETRY_CHANGED = NO
PHASE4G_CHANGED = NO
AZURE_GOVERNANCE_CHANGED = NO
SECURITY_REMEDIATION_DISPATCH_ENABLED = false
SECURITY_REMEDIATION_E2E_TEST_HARNESS_ENABLED = false
AZURE_APPLICATION_DEPLOYMENT_EXECUTED = NO
SAFE_TO_FREEZE_PERFORMANCE_WORK = YES
FINAL_VERDICT = A — BACKEND_READ_PERFORMANCE_OPTIMIZED
```
'''
(p/'BACKEND_READ_PERFORMANCE_REPORT.md').write_text(text)
patch=[]
for f in ['backend/src/project-reads/project-reads.module.ts','backend/src/project-reads/project-reads.spec.ts','frontend/scripts/project-read-contract.spec.mjs']:
 new=root/f;patch.extend(difflib.unified_diff([],new.read_text().splitlines(True),fromfile='/dev/null',tofile=f))
(p/'ADDED_SOURCE.patch').write_text(''.join(patch))
print(str(p/'BACKEND_READ_PERFORMANCE_REPORT.md'))
