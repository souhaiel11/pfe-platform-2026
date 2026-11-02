# Future CHAIN4B execution contract — NOT EXECUTED

Prerequisites before CHAIN4B:
- Complete the stopped CHAIN4A-R1 live promotion with fresh quiescence and verified recovery point.
- Apply ONLY the unchanged test-plan migration, then deploy image sha256:8ee224f973389451be32820381201e8466c8f710b887aed55f6d3363fb8f1fcd, source 0957ab63280b32e4180ba47ae72bfb5a802db15a, with normal dispatch=false, harness=false and DB_SYNCHRONIZE=false.
- Configure SECURITY_REMEDIATION_E2E_OPERATOR_SECRET securely; do not put it in plan/audit/WF6 payload. No secret was configured during this stopped phase.
- Verify zero active plans/reservations/writers, unchanged WF2/WF6, source/OCI/executable hashes and healthy read APIs.
- Qualify the exact dedicated fixture, repository commit, dynamic target, Trivy/OWASP findings and safe candidate verifier/build/tests/rescan. Do not select unrelated business findings.
- Obtain explicit CHAIN4B approval; do not treat this file as approval.

1. Fresh identity, schema, workflow and writer checks; capture DB/remote blast-radius baseline.
2. Keep normal dispatch=false throughout. Enable harness only in the separately approved controlled window.
3. Create exactly one plan through the admin/operator-guarded plan endpoint for the dedicated fixture project/task, short explicit expiry. Record returned planId and exact immutable finding scope. Stop if qualification/evidence rejects it; no SQL bypass.
4. Launch the single task using an admin JWT and x-e2e-plan-id + x-e2e-operator-secret headers. No other finding/task may be selected.
5. Require attempt1 VERIFIER_TIMEOUT before worker/Git, retryable state and retained FILE reservation. Capture attemptId/attemptNumber/batchId.
6. Retry exactly once through the same scoped headers and expectedAttemptId=attempt1. Require new attemptId, number2 and distinct batchId with owner retained.
7. Submit only the separately reviewed stale-callback proof; require rejection/idempotent no state change for attempt1 and no extra dispatch.
8. Observe WF6 attempt2 normal evaluation, then OPERATOR_TEST_STOPPED before all Git writers. Require candidateEvaluationPassed=true for a successful final proof; a controlled evaluation abort is safe but is NOT a successful candidate E2E.
9. Require released reservation, nonretryable test terminal state, DETECTED unresolved finding, plan COMPLETED/consumed, no third authorized attempt.
10. Disable harness after all in-flight controlled work is conclusively settled; do not drop the fence midflight. Revoke/confirm consumed plan through supported controls.
11. Verify no branch/PR/push, unchanged unrelated DB/remote state and workflow hashes. Keep normal dispatch=false.
12. STOP for human review. No automatic normal-dispatch reopen.

Initial launch: POST /api/manual-remediation/launch-batch with projectId + exactly one findingTaskIds entry.
Retry: POST /api/manual-remediation/:taskId/retry with expectedAttemptId.
Both require existing admin JWT plus the scoped plan/operator headers. Never enable unrestricted dispatch to bypass a failed plan.
