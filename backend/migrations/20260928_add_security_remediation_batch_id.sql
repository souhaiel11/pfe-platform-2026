-- Increment 1 of multi-CVE remediation (single PR for N CVEs). Additive
-- only, mirrors 20260828-style securityFindingRemediation deployment: no
-- default, nullable, existing rows (767+ at time of writing) untouched.
--
-- securityRemediationBatchId: plain indexed correlation key so "give me
-- every ManualRemediationTask in batch X" is a cheap indexed lookup instead
-- of scanning the securityFindingRemediation jsonb column. The per-CVE
-- result itself (status/evidence/prUrl/...) continues to live entirely
-- inside the EXISTING securityFindingRemediation jsonb column (no new
-- entity, no new table) -- this migration only adds the correlation key.
BEGIN;

ALTER TABLE manual_remediation_tasks ADD COLUMN IF NOT EXISTS "securityRemediationBatchId" character varying(64);
CREATE INDEX IF NOT EXISTS idx_manual_remediation_tasks_batch_id ON manual_remediation_tasks ("securityRemediationBatchId");

COMMIT;
