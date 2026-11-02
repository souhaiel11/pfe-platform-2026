# WF2 integration lifecycle fixtures

This module provisions real, correlated `Project` and `Incident` domain records for isolated WF2 integration tests. `requestId`, `batchId`, and attempt state use the same `Incident.metadata.fixRequest` contract consumed by the production workflow callback.

The capability is disabled unless `INTEGRATION_FIXTURES_ENABLED=true`, and it remains unavailable whenever `NODE_ENV=production`. Both provision and cleanup routes require an authenticated administrator.

Fixtures are explicitly marked `NON_PRODUCTION` and `INTEGRATION_TEST`, with a creator identity and timestamp. Cleanup resolves the fixture by its exact incident ID, checks both the incident marker and dedicated project marker, verifies that the project contains no unrelated incident, and then removes only those two records in one transaction.

The mechanism never invokes n8n, GitHub, Jenkins, scanners, or candidate verification. It exists because WF2 may reach its ordinary success or failure callback during an integration test, and that callback correctly rejects fabricated incident IDs. WF2 receives an ordinary production-shaped correlation contract and contains no test-mode branch.
