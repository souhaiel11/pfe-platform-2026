BEGIN;

DO $$
BEGIN
  CREATE TYPE manual_remediation_tasks_status_enum AS ENUM (
    'TODO',
    'DONE_BY_USER',
    'VERIFIED',
    'REOPENED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE manual_remediation_tasks_scanner_status_enum AS ENUM (
    'DETECTED',
    'STILL_DETECTED',
    'NOT_DETECTED',
    'UNAVAILABLE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS manual_remediation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL,
  "incidentId" uuid,
  "findingId" varchar,
  "findingFingerprint" varchar(64) NOT NULL,
  source varchar NOT NULL,
  "ruleOrCve" varchar,
  title text NOT NULL,
  severity varchar,
  "remediationType" varchar,
  "findingSnapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  status manual_remediation_tasks_status_enum NOT NULL DEFAULT 'TODO',
  "scannerStatus" manual_remediation_tasks_scanner_status_enum NOT NULL DEFAULT 'DETECTED',
  "completedByUserId" varchar,
  "completedByDisplayName" varchar,
  "completedAt" timestamp,
  "completionNote" varchar(500),
  "lastSeenBuild" integer,
  "verifiedBuild" integer,
  "verifiedAt" timestamp,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT manual_remediation_tasks_project_fk
    FOREIGN KEY ("projectId") REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT manual_remediation_tasks_incident_fk
    FOREIGN KEY ("incidentId") REFERENCES incidents(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS manual_remediation_tasks_project_fingerprint_uq
  ON manual_remediation_tasks ("projectId", "findingFingerprint");

CREATE INDEX IF NOT EXISTS manual_remediation_tasks_project_status_idx
  ON manual_remediation_tasks ("projectId", status);

CREATE INDEX IF NOT EXISTS manual_remediation_tasks_incident_idx
  ON manual_remediation_tasks ("incidentId");

COMMIT;
