# CHAIN-4B-R1 provisioning proposal — awaiting operator approval

Proposed dedicated repository: `souhaiel11/remediation-retry-e2e-fixture`.
Proposed default branch: `main`.
Proposed dedicated platform project name: `remediation-retry-e2e-fixture`.
Reuse only if inspection confirms the repository/project is dedicated to this purpose; otherwise stop for review rather than modify unrelated assets.

Baseline data: direct Maven dependency `com.h2database:h2:2.1.212`; expected candidate `2.2.220`; expected vulnerability `CVE-2022-45868`, subject to fresh real scanner reproduction. Preserve the vulnerable baseline SHA remotely. Include a pinned minimal POM and a database smoke test, plus packaging/Dockerfile only as required by the actual verifier. Do not add unrelated application dependencies.

Prior local evidence is available in `docs/qa/trivy-owasp-h2-fixture-prequalification/`; it is supporting evidence, not qualification of this new repository or live identity. Fresh baseline build/tests and both scanner paths must pass before live project registration.

Requested operator authorization covers baseline repository creation/push, registration of exactly one dedicated project, normal supported ingestion of the selected real scanner finding, and normal supported creation of exactly one remediation task. Inspect ingestion cardinality before writing; stop if the supported path cannot meet the one-finding/one-task limit. Never insert fabricated finding rows with SQL.

Qualify the exact baseline and candidate in an isolated workspace using production generic resolution/materialization/verifier paths. Candidate edits stay local: no candidate branch, push, or PR. Verify normal business eligibility and the pre-Git barrier. Produce an immutable data manifest only after exact live IDs, trusted dynamic target and reservation key are known.

Throughout: dispatch=false; harness=false; no attempts, batches, reservations, E2E plans, WF6 executions or remediation Git writes. Preserve backend source `0957ab63280b32e4180ba47ae72bfb5a802db15a` and WF6 version `0470ab42-713a-4097-a9a7-72c8f00bacde`. Capture fresh safety and unrelated-business-state baselines before any approved live write and compare afterward. Stop on failed qualification or scope violation. Do not execute CHAIN-4B.

Read-only preflight confirmed the running backend source label matches the required SHA and both environment flags are `false`. No live writes were performed to prepare this proposal. Remaining live-state assertions require fresh verification during provisioning; they are not claimed here.

Approval pending. No final fixture manifest or qualification verdict exists yet.
