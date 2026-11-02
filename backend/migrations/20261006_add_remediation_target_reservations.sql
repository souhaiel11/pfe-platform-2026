-- Ajoute les réservations exclusives de cible dans PostgreSQL.
BEGIN;
CREATE TABLE remediation_target_reservations (
  id uuid PRIMARY KEY,
  "projectId" uuid NOT NULL,
  "targetKey" text NOT NULL,
  "targetFile" varchar(512) NOT NULL,
  "ownerTaskId" uuid NOT NULL,
  "ownerAttemptId" uuid,
  "ownerBatchId" varchar,
  claims jsonb NOT NULL CHECK (jsonb_typeof(claims) = 'object'),
  state varchar(16) NOT NULL CHECK (state IN ('ACTIVE','RELEASED')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz CHECK ("expiresAt" IS NULL),
  "releasedAt" timestamptz,
  "releaseReason" text,
  CHECK ((state = 'ACTIVE' AND claims <> '{}'::jsonb AND "releasedAt" IS NULL)
      OR (state = 'RELEASED' AND claims = '{}'::jsonb AND "releasedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX remediation_target_one_active
  ON remediation_target_reservations ("projectId","targetKey") WHERE state = 'ACTIVE';
CREATE INDEX remediation_target_stale ON remediation_target_reservations ("updatedAt") WHERE state = 'ACTIVE';
-- Conservatively claim already-admitted lifecycles at cutover. Never permit an
-- empty new table to admit a sibling alongside an existing remote writer.
CREATE TEMP VIEW remediation_target_cutover AS
SELECT t.*, t."securityFindingRemediation" AS r,
  COALESCE(NULLIF(t."securityFindingRemediation"->>'batchId',''), t."securityRemediationBatchId", t.id::text) AS lifecycle
FROM manual_remediation_tasks t
WHERE t.source IN ('TRIVY','OWASP') AND t."securityFindingRemediation" IS NOT NULL
AND (
  t."securityFindingRemediation"->>'status' IN ('DISPATCHING','CANDIDATE_READY','CLOSED','PR_CREATED','PR_REUSED','WRITE_AUTHORIZED','PENDING')
  OR t."securityFindingRemediation"->>'retryable' = 'true'
  OR COALESCE(t."securityFindingRemediation"->>'reasonCode',t."securityFindingRemediation"->>'reason','') ~ '^(VERIFIER_TIMEOUT|RUNTIME_OPERATION_TIMEOUT|WORKER_DEADLINE_EXCEEDED|WARMUP_TIMEOUT|WARMUP_NETWORK_FAILURE|DEPENDENCY_TREE_TIMEOUT)(:|$)'
  OR (COALESCE(t."securityFindingRemediation"->>'status','UNKNOWN') NOT IN ('OPERATOR_TEST_STOPPED','REMEDIATION_ABANDONED')
      AND split_part(COALESCE(t."securityFindingRemediation"->>'reasonCode',t."securityFindingRemediation"->>'reason','UNKNOWN'),':',1)
        NOT IN ('APPLICATION_TESTS_FAILED','APPLICATION_TESTS_NOT_EXECUTED','MAVEN_RESOLUTION_MISMATCH',
          'TARGET_CVE_STILL_OPEN_AFTER_PATCH','TARGET_CVE_NEVER_OBSERVED_IN_BASELINE','INVALID_CANDIDATE','MAVEN_MUTATED_CANDIDATE_SOURCE'))
  OR t."securityFindingRemediation"->>'unresolvedGitSideEffect' = 'true'
  OR NULLIF(t."securityFindingRemediation"->>'branchName','') IS NOT NULL
  OR NULLIF(t."securityFindingRemediation"->>'prUrl','') IS NOT NULL
  OR NULLIF(t."securityFindingRemediation"->>'prNumber','') IS NOT NULL
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(t."securityFindingRemediation"->'attempts','[]'::jsonb)) a
    WHERE a->>'unresolvedGitSideEffect'='true' OR NULLIF(a->>'branchName','') IS NOT NULL
      OR NULLIF(a->>'prUrl','') IS NOT NULL OR NULLIF(a->>'prNumber','') IS NOT NULL)
);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM remediation_target_cutover GROUP BY "projectId" HAVING count(DISTINCT lifecycle)>1) THEN
   RAISE EXCEPTION 'Existing independent co-target lifecycles require supported reconciliation before migration';
 END IF;
END $$;
INSERT INTO remediation_target_reservations
(id,"projectId","targetKey","targetFile","ownerTaskId","ownerAttemptId","ownerBatchId",claims,state)
SELECT min(id::text)::uuid,"projectId",'["v1","FILE","pom.xml"]','pom.xml',min(id::text)::uuid,
  min(NULLIF(r->>'attemptId',''))::uuid,min(lifecycle),
  jsonb_object_agg(id::text,jsonb_build_object('attemptId',r->>'attemptId','batchId',lifecycle,'status',
    CASE WHEN r->>'status'='DISPATCHING' THEN 'DISPATCHING' ELSE 'QUARANTINED' END)), 'ACTIVE'
FROM remediation_target_cutover GROUP BY "projectId";
DROP VIEW remediation_target_cutover;
COMMIT;
