-- Ajoute l’identifiant de lot des corrections dans PostgreSQL.
BEGIN;

ALTER TABLE manual_remediation_tasks ADD COLUMN IF NOT EXISTS "securityRemediationBatchId" character varying(64);
CREATE INDEX IF NOT EXISTS idx_manual_remediation_tasks_batch_id ON manual_remediation_tasks ("securityRemediationBatchId");

COMMIT;
