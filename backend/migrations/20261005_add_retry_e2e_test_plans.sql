-- Ajoute les plans de test de relance dans PostgreSQL.
BEGIN;
CREATE TABLE IF NOT EXISTS security_remediation_retry_e2e_plans (
  id uuid PRIMARY KEY,
  "projectId" uuid NOT NULL,
  "taskId" uuid NOT NULL UNIQUE,
  state varchar(16) NOT NULL CHECK (state IN ('ACTIVE','COMPLETED','REVOKED','EXPIRED')),
  plan jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retry_e2e_plan_scope CHECK (plan->>'projectId' IS NOT NULL AND plan->>'taskId' IS NOT NULL AND plan->>'projectId' = "projectId"::text AND plan->>'taskId' = "taskId"::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS security_remediation_retry_e2e_one_active
  ON security_remediation_retry_e2e_plans (state) WHERE state = 'ACTIVE';
COMMIT;
