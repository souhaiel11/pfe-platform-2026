-- Retire les réservations exclusives de cible dans PostgreSQL.
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM remediation_target_reservations WHERE state='ACTIVE') THEN
   RAISE EXCEPTION 'Active remediation target ownership prevents rollback';
 END IF;
END $$;
DROP TABLE remediation_target_reservations;
COMMIT;
