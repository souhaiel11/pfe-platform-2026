# WF6 V1.7 Controlled Promotion Log — 2026-09-29

## Step 1 — Precheck (all PASS)
- Active workflow id: `RdYyfjVpOm2LxS95` — confirmed via `n8n list:workflow --active true`
- Candidate SHA256: `fd5e2cf788aad1d1a69af68ac9ce8a8d160e2198757b1f31e4706ec3811d4232` — matches expected
- Rollback backup exists: `n8n-workflows/backups/wf6-security-remediation-maven-RdYyfjVpOm2LxS95.LIVE-BACKUP-20260929T174903Z.json`
- Rollback SHA256: `052906b878db1b3bea661ff189eef3a61635b6a89a3acf80962c75ac528b4280` — matches expected
- n8n container: Up, healthy
- backend container: Up, `/api/docs` reachable on internal port 3001 (not 3000 as CLAUDE.md's stale doc states)
- candidate-verifier container: Up, `/health` → `{"status":"ok"}`
- builder-scanner container: Up, healthy

## Step 2 — Recorded current (pre-promotion) live version state
- Workflow id: `RdYyfjVpOm2LxS95`
- versionId (pre-promotion): `f6537c32-493c-4591-b2f0-0e1db9f51f82`
- activeVersionId (pre-promotion): `f6537c32-493c-4591-b2f0-0e1db9f51f82`
- active: `true`
- webhook production path: `wf6-security-remediation-evaluate`
- webhook responseMode (pre-promotion): `responseNode`

Rollback target if needed: `n8n publish:workflow --id=RdYyfjVpOm2LxS95 --versionId=f6537c32-493c-4591-b2f0-0e1db9f51f82` (or re-import the LIVE-BACKUP file + `update:workflow --active=true` as a fallback).

## Step 3 — Promotion attempt (ABORTED, rolled back)
- Imported `wf6-security-remediation-maven-RdYyfjVpOm2LxS95.V1.7-CALLBACK-COMPLETENESS.json` (id RdYyfjVpOm2LxS95, in place). n8n confirmed: "Deactivating workflow... Remember to activate later."
- Attempted reactivation via `n8n update:workflow --id=RdYyfjVpOm2LxS95 --active=true` (deprecated) — succeeded at the DB level but the CLI itself warned: "Changes will not take effect if n8n is running. Please restart n8n."
- Verified directly: production webhook returned **HTTP 404** (unreachable) despite the DB showing `active:true`.
- Retried with the recommended replacement, `n8n publish:workflow --id=RdYyfjVpOm2LxS95` — same warning, webhook still 404. Confirmed this is a structural limitation of n8n 2.14.2 in "regular" execution mode (single process, no hot-reload of webhook registrations) — not specific to this candidate or to which CLI command was used.
- Restored the DB pointer to the pre-promotion version: `n8n publish:workflow --id=RdYyfjVpOm2LxS95 --versionId=f6537c32-493c-4591-b2f0-0e1db9f51f82`. Webhook still 404 post-rollback-at-DB-level (same restart requirement).
- **Stopped and asked the user** whether to restart the n8n container (affects all active workflows: WF1-WF5, Chat, not just WF6) rather than deciding unilaterally, since that exceeds "promote ONLY WF6" scope.
- User chose: restart n8n now, but **stay on the OLD (pre-promotion) version**. The V1.7 candidate was NOT activated this session.

## Post-restart verification
- `docker restart n8n` → healthy within seconds.
- Webhook reachability re-tested: unauthenticated POST now returns **HTTP 403 Forbidden** (correct auth rejection — proves the route exists and is live again), not 404.
- Exported the now-active workflow fresh from n8n: `versionId f6537c32-...` (matches pre-promotion exactly), 151 nodes, `responseMode: responseNode`, 28 respondToWebhook, 2 Record Batch Result callbacks — byte-for-byte identical (nodes/connections/settings) to the original `LIVE-BACKUP-20260929T174903Z.json`.
- backend, candidate-verifier, builder-scanner: never restarted, remained healthy throughout (confirmed "Up 4 hours" unchanged) — blast radius contained to n8n only.
- The V1.7-CALLBACK-COMPLETENESS candidate remains staged, fully validated, unpromoted, in `pending-live-update/` for a future attempt (ideally one that plans for the n8n restart requirement up front).

## V1.7 CONTROLLED LIVE PROMOTION — SUCCESS (2026-09-29, ~18:11-18:19 UTC)

### Precheck (all PASS)
- n8n healthy; live version = f6537c32-... (old, validated) confirmed
- Candidate SHA256 fd5e2cf7... matches; rollback backup SHA256 052906b8... matches
- No running WF6 executions (last: id 2064, success, stopped 08:06:28)

### New fresh backup before this promotion
- n8n-workflows/backups/wf6-security-remediation-maven-RdYyfjVpOm2LxS95.LIVE-BACKUP-20260929T181148Z.json
- SHA256: 3f6565e3fddbfc5dec25e8d22e9c8ea8e79aae61536c89fd6174524265527990
- versionId f6537c32-493c-4591-b2f0-0e1db9f51f82 (same content as prior backup, different export timestamp/metadata only)

### DB promotion
- Imported V1.7-CALLBACK-COMPLETENESS.json, published. New versionId: dd5d14cd-d898-4ea7-9c5e-4263e63bdc60
- Verified pre-restart: active=true, 177 nodes, responseMode=onReceived, 0 respondToWebhook, 28 noOp, 28 Record Batch Result — all correct

### n8n restart (ONLY n8n touched)
- All other containers confirmed "Up 4 hours" unchanged before AND after
- n8n healthy within ~9s
- All 7 workflows (WF1-5, Chat, WF6) confirmed active post-restart

### Webhook smoke test
- Unauthenticated POST -> HTTP 403 Forbidden (not 404) -> PASS, near-instant

### Real controlled dispatch (finding 306e8b84-90fe-4344-8fd6-5c38fcabcf40, CVE-2022-25857/org.yaml:snakeyaml, project pfe-app-test)
- POST /api/manual-remediation/launch-batch -> {"batchId":"sec-batch-215851539abb7f37","status":"DISPATCHING"} in <1s, NO false 409
- n8n execution 2065 started 18:13:59.434, ran asynchronously, finished 18:19:04.432 (status=success, ~305s)
- Task securityFindingRemediation: DISPATCHING -> CLOSED (TARGET_CVE_CLOSED), attempts=[DISPATCHING, CLOSED] (exactly 2, no duplicates)
- Real PR created: https://github.com/souhaiel11/pfe-app-test/pull/40 (branch security/fix/41a0eac4ecb4-022ff90775f4)
- Exactly 1 execution, 1 task, 1 batchId — no duplication

### Post-run health
- All 4 services healthy; only n8n restarted; no orphan podman container/image/workspace
