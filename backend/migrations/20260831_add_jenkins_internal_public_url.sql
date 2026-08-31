-- Split the overloaded projects.jenkinsUrl (used for both backend
-- server-to-server calls and browser-facing links) into two explicit,
-- nullable fields. Legacy jenkinsUrl is kept as a fallback, not removed.
-- Additive only — no data migration of the stale/ephemeral value.
BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS "jenkinsInternalUrl" character varying;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS "jenkinsPublicUrl" character varying;

COMMIT;
