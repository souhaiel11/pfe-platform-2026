-- Ajoute les URL Jenkins interne et publique dans PostgreSQL.
BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS "jenkinsInternalUrl" character varying;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS "jenkinsPublicUrl" character varying;

COMMIT;
