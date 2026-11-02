-- Ajoute les autorisations et tentatives de déploiement dans PostgreSQL.
BEGIN;

DO $$
BEGIN
  CREATE TYPE deployment_authorizations_mode_enum AS ENUM (
    'NORMAL',
    'CONDITIONAL_EXCEPTION',
    'CRITICAL_OVERRIDE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE deployment_authorizations_status_enum AS ENUM (
    'CREATED',
    'CONSUMED',
    'EXPIRED',
    'REVOKED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Phase 2B.2.2A — alignment fix. DeploymentAttempt.dispatchStatus is a
-- TypeORM `type: 'enum'` column (deployment-attempt.entity.ts), exactly
-- like deployment_authorizations.status/authorizationMode above -- it was
-- wrongly created as varchar(16) below. Named by the SAME <table>_<column>_enum
-- convention as every other enum in this file, so it cannot collide with
-- deployment_authorizations_mode_enum/deployment_authorizations_status_enum
-- (different table AND different column) or manual_remediation_tasks_*_enum
-- (different table entirely).
DO $$
BEGIN
  CREATE TYPE deployment_attempts_dispatch_status_enum AS ENUM (
    'DISPATCHING',
    'DEPLOYED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS deployment_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL,
  "incidentId" uuid,
  "mainBuildNumber" integer NOT NULL,
  "commitSha" varchar(40) NOT NULL,
  "artifactDigest" varchar(71) NOT NULL,
  "artifactTag" varchar(128) NOT NULL,
  registry varchar NOT NULL,
  repository varchar NOT NULL,
  "environmentIdentityHash" varchar(64) NOT NULL,
  "decisionAtAuthorization" text NOT NULL,
  "securityValidationApplicability" text NOT NULL,
  "riskSnapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "failedControls" jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  "requestedByUserId" varchar NOT NULL,
  "requestedByRole" varchar NOT NULL,
  "authorizationMode" deployment_authorizations_mode_enum NOT NULL,
  reason text,
  acknowledgements jsonb,
  "authorizationIdentityHash" varchar(64) NOT NULL,
  status deployment_authorizations_status_enum NOT NULL DEFAULT 'CREATED',
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "consumedAt" timestamp,
  "expiresAt" timestamp,
  CONSTRAINT deployment_authorizations_project_fk
    FOREIGN KEY ("projectId") REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT deployment_authorizations_incident_fk
    FOREIGN KEY ("incidentId") REFERENCES incidents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "IDX_deployment_authorization_project_status"
  ON deployment_authorizations ("projectId", status);

CREATE TABLE IF NOT EXISTS deployment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "authorizationId" uuid NOT NULL,
  "requestId" varchar NOT NULL,
  "projectId" uuid NOT NULL,
  "incidentId" uuid,
  "mainBuildNumber" integer NOT NULL,
  "actorUserId" varchar NOT NULL,
  "actorRole" varchar NOT NULL,
  "commitSha" varchar(40) NOT NULL,
  "artifactDigest" varchar(71) NOT NULL,
  registry varchar NOT NULL,
  repository varchar NOT NULL,
  "environmentIdentityHash" varchar(64) NOT NULL,
  "governanceDecision" text NOT NULL,
  "authorizationMode" text NOT NULL,
  reason text,
  "riskSnapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "dispatchStatus" deployment_attempts_dispatch_status_enum NOT NULL DEFAULT 'DISPATCHING',
  "dispatchResult" jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "completedAt" timestamp,
  CONSTRAINT deployment_attempts_authorization_fk
    FOREIGN KEY ("authorizationId") REFERENCES deployment_authorizations(id) ON DELETE RESTRICT,
  CONSTRAINT deployment_attempts_project_fk
    FOREIGN KEY ("projectId") REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT deployment_attempts_incident_fk
    FOREIGN KEY ("incidentId") REFERENCES incidents(id) ON DELETE SET NULL,
  -- One attempt per authorization: §15/§17 of Phase 2B.2 -- an
  -- authorization is consumed at most once, so at most one attempt row
  -- can ever legitimately reference it.
  CONSTRAINT deployment_attempts_authorization_uq UNIQUE ("authorizationId")
);

CREATE INDEX IF NOT EXISTS "IDX_deployment_attempt_project"
  ON deployment_attempts ("projectId");
CREATE INDEX IF NOT EXISTS "IDX_deployment_attempt_authorization"
  ON deployment_attempts ("authorizationId");
CREATE INDEX IF NOT EXISTS "IDX_deployment_attempt_request"
  ON deployment_attempts ("requestId");

COMMIT;

-- Down migration (project convention has not required one so far -- no
-- existing backend/migrations/*.sql file ships a rollback script; provided
-- here anyway since both new tables are purely additive and safe to drop
-- without touching any other table's data).
--
-- BEGIN;
-- DROP TABLE IF EXISTS deployment_attempts;
-- DROP TABLE IF EXISTS deployment_authorizations;
-- DROP TYPE IF EXISTS deployment_attempts_dispatch_status_enum;
-- DROP TYPE IF EXISTS deployment_authorizations_status_enum;
-- DROP TYPE IF EXISTS deployment_authorizations_mode_enum;
-- COMMIT;
