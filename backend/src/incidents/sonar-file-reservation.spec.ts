// Teste le verrou de fichier des corrections Sonar (WF2) contre un vrai PostgreSQL : DATABASE_URL doit pointer vers une base jetable.
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { extendSonarFiles, fixRequestHoldsFiles, releaseSonarFiles, reserveSonarFiles, SonarFileHolder, sonarTargetFile, sonarTargetFiles } from './sonar-file-reservation';
import { canonicalTarget, reserveTarget } from '../manual-remediation/remediation-target-reservation';

/** Schéma identique à la table de production (pg_dump -s). */
const DDL = `CREATE TABLE remediation_target_reservations (
  id uuid PRIMARY KEY, "projectId" uuid NOT NULL, "targetKey" text NOT NULL, "targetFile" character varying(512) NOT NULL,
  "ownerTaskId" uuid NOT NULL, "ownerAttemptId" uuid, "ownerBatchId" character varying, claims jsonb NOT NULL,
  state character varying(16) NOT NULL, "createdAt" timestamptz DEFAULT now() NOT NULL, "updatedAt" timestamptz DEFAULT now() NOT NULL,
  "expiresAt" timestamptz, "releasedAt" timestamptz, "releaseReason" text,
  CHECK (((state = 'ACTIVE') AND (claims <> '{}'::jsonb) AND ("releasedAt" IS NULL)) OR ((state = 'RELEASED') AND (claims = '{}'::jsonb) AND ("releasedAt" IS NOT NULL))),
  CHECK (jsonb_typeof(claims) = 'object'), CHECK ("expiresAt" IS NULL), CHECK (state IN ('ACTIVE','RELEASED')));
CREATE UNIQUE INDEX remediation_target_one_active ON remediation_target_reservations ("projectId","targetKey") WHERE state = 'ACTIVE';
CREATE TABLE manual_remediation_tasks (id uuid PRIMARY KEY, "securityFindingRemediation" jsonb);`;

const project = randomUUID();
const A = randomUUID(); const B = randomUUID(); const C = randomUUID();
const X = 'src/main/java/tn/vermeg/validation/DefautsAnalyseCode.java';
const Y = 'src/main/java/tn/vermeg/validation/SignatureHeritee.java';

/** Détenteurs simulés : l'état de chaque incident est piloté par le scénario. */
const holders: Record<string, SonarFileHolder> = {};
const describe = async (id: string) => holders[id] || { kind: 'ORPHAN' as const, needsFiles: false };

async function main() {
  // Normalisation des chemins et règle « tient encore ses fichiers ».
  assert.equal(sonarTargetFile('projet-validation-vermeg:src/A.java'), 'src/A.java');
  assert.equal(sonarTargetFile('./src/A.java'), 'src/A.java');
  assert.equal(sonarTargetFile('../etc/passwd'), null);
  assert.equal(sonarTargetFile(''), null);
  assert.deepEqual(sonarTargetFiles([Y, X, X, null, 'src/x/../y.java']), [X, Y]);
  assert.equal(fixRequestHoldsFiles({ workflow: 'WF2', status: 'DISPATCHED' }), true);
  assert.equal(fixRequestHoldsFiles({ workflow: 'WF2', status: 'PR_CREATED', prNumber: 3, prUrl: 'u' }), true);
  assert.equal(fixRequestHoldsFiles({ workflow: 'WF2', status: 'FIX_FAILED' }), false);
  assert.equal(fixRequestHoldsFiles({ workflow: 'WF2', status: 'FIX_FAILED', failedNode: 'Create Pull Request1' }), true);
  assert.equal(fixRequestHoldsFiles({ workflow: 'WF2', status: 'REJECTED', prNumber: 3 }), true);
  assert.equal(fixRequestHoldsFiles({ workflow: 'WF2', status: 'VALIDATED', prNumber: 3, fileLock: { releasedAt: 'x' } }), false);
  assert.equal(fixRequestHoldsFiles({ workflow: 'WF5', status: 'DISPATCHED' }), false);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(DDL);
  const tx: any = { query: async (sql: string, params?: any[]) => (await client.query(sql, params)).rows };
  const inTx = async <T>(fn: () => Promise<T>): Promise<T> => {
    await client.query('BEGIN');
    try { const r = await fn(); await client.query('COMMIT'); return r; } catch (e) { await client.query('ROLLBACK'); throw e; }
  };
  const activeHolders = async (file: string) => {
    const r = await client.query(`SELECT claims FROM remediation_target_reservations WHERE "projectId"=$1 AND "targetFile"=$2 AND state='ACTIVE'`, [project, file]);
    return r.rows.length ? Object.keys(r.rows[0].claims).sort() : [];
  };

  // 1. A réserve X : premier arrivé.
  holders[A] = { kind: 'INCIDENT', needsFiles: true, title: 'Build #2' };
  assert.deepEqual(await inTx(() => reserveSonarFiles(tx, { projectId: project, incidentId: A, batchId: 'ba', files: [X] }, describe)), [X]);
  assert.deepEqual(await activeHolders(X), [A]);

  // 2. B veut X pendant que A tourne encore (pas de PR) : refus « en cours », rien n'est réservé pour B.
  holders[B] = { kind: 'INCIDENT', needsFiles: true, title: 'Build #1' };
  await assert.rejects(() => inTx(() => reserveSonarFiles(tx, { projectId: project, incidentId: B, batchId: 'bb', files: [X, Y] }, describe)),
    (e: any) => e.response?.code === 'SONAR_FILE_ALREADY_IN_PROGRESS' && /déjà en cours/.test(e.response.message) && /Build #2/.test(e.response.message));
  assert.deepEqual(await activeHolders(Y), [], 'un refus ne laisse aucune réservation partielle');

  // 3. A a ouvert sa PR #24 : refus explicite « merge requis », avec le numéro de PR.
  holders[A] = { kind: 'INCIDENT', needsFiles: true, title: 'Build #2', prNumber: 24, prUrl: 'https://github.com/o/r/pull/24' };
  await assert.rejects(() => inTx(() => reserveSonarFiles(tx, { projectId: project, incidentId: B, batchId: 'bb', files: [X] }, describe)),
    (e: any) => e.response?.code === 'SONAR_FILE_PR_PENDING_MERGE' && /#24/.test(e.response.message) && /Merge effectué/.test(e.response.message)
      && e.response.files[0] === X);

  // 4. Un autre fichier reste libre : B corrige Y en parallèle.
  assert.deepEqual(await inTx(() => reserveSonarFiles(tx, { projectId: project, incidentId: B, batchId: 'bb', files: [Y] }, describe)), [Y]);

  // 5. Le détenteur se réserve à nouveau ses propres fichiers sans conflit (retry du même lot).
  await inTx(() => reserveSonarFiles(tx, { projectId: project, incidentId: A, batchId: 'ba', files: [X] }, describe));
  assert.deepEqual(await activeHolders(X), [A]);

  // 6. La PR de A modifie aussi Y (tenu par B) : extension sans refus, Y signalé comme contesté.
  const ext = await inTx(() => extendSonarFiles(tx, { projectId: project, incidentId: A, batchId: 'ba', files: [X, Y] }));
  assert.deepEqual(ext, { files: [X], contested: [Y] });

  // 7. « Merge effectué » sur A : X est libéré, la ligne passe RELEASED, B peut alors corriger X.
  await inTx(() => releaseSonarFiles(tx, project, A, 'PR_MERGED:test'));
  assert.deepEqual(await activeHolders(X), []);
  const released = await client.query(`SELECT state, "releaseReason" FROM remediation_target_reservations WHERE "projectId"=$1 AND "targetFile"=$2`, [project, X]);
  assert.deepEqual(released.rows.map(r => [r.state, r.releaseReason]), [['RELEASED', 'PR_MERGED:test']]);
  holders[A] = { kind: 'INCIDENT', needsFiles: false };
  assert.deepEqual(await inTx(() => reserveSonarFiles(tx, { projectId: project, incidentId: B, batchId: 'bb2', files: [X, Y] }, describe)), [X, Y]);
  assert.deepEqual(await activeHolders(X), [B]);

  // 8. Un détenteur terminé sans PR (échec, refus) ne bloque pas : sa réservation est libérée au passage.
  holders[B] = { kind: 'INCIDENT', needsFiles: false };
  holders[C] = { kind: 'INCIDENT', needsFiles: true, title: 'Build #3' };
  assert.deepEqual(await inTx(() => reserveSonarFiles(tx, { projectId: project, incidentId: C, batchId: 'bc', files: [X] }, describe)), [X]);
  assert.deepEqual(await activeHolders(X), [C]);
  assert.deepEqual(await activeHolders(Y), [], 'toutes les réservations du détenteur inactif sont libérées');

  // 9. Cohabitation avec WF6 : une tâche de sécurité tenant pom.xml bloque Sonar, et inversement.
  const task = randomUUID();
  await inTx(async () => reserveTarget(tx, canonicalTarget(project, 'pom.xml', 'commons-io:commons-io'), [task]));
  holders[task] = { kind: 'SECURITY_TASK', needsFiles: true };
  await assert.rejects(() => inTx(() => reserveSonarFiles(tx, { projectId: project, incidentId: C, batchId: 'bc', files: ['pom.xml'] }, describe)),
    (e: any) => e.response?.code === 'SONAR_FILE_ALREADY_IN_PROGRESS');
  await inTx(() => reserveSonarFiles(tx, { projectId: project, incidentId: C, batchId: 'bc', files: [Y] }, describe));
  const other = randomUUID();
  await assert.rejects(() => inTx(async () => reserveTarget(tx, { ...canonicalTarget(project, Y, 'a:b') }, [other])),
    (e: any) => e.response?.code === 'REMEDIATION_TARGET_ALREADY_IN_PROGRESS', 'WF6 ne prend pas un fichier tenu par Sonar');

  // 10. Course : deux approbations simultanées sur le même fichier, une seule gagne.
  const D = randomUUID(); const E = randomUUID(); const Z = 'src/main/java/tn/vermeg/validation/Json.java';
  holders[D] = { kind: 'INCIDENT', needsFiles: true, title: 'D' }; holders[E] = { kind: 'INCIDENT', needsFiles: true, title: 'E' };
  const second = new Client({ connectionString: process.env.DATABASE_URL }); await second.connect();
  const tx2: any = { query: async (sql: string, params?: any[]) => (await second.query(sql, params)).rows };
  await client.query('BEGIN'); await second.query('BEGIN');
  await reserveSonarFiles(tx, { projectId: project, incidentId: D, batchId: 'bd', files: [Z] }, describe);
  const racing = reserveSonarFiles(tx2, { projectId: project, incidentId: E, batchId: 'be', files: [Z] }, describe)
    .then(() => 'ok', (e: any) => e.response?.code || String(e));
  await new Promise(r => setTimeout(r, 300));
  await client.query('COMMIT');
  const outcome = await racing;
  await second.query(outcome === 'ok' ? 'COMMIT' : 'ROLLBACK');
  assert.equal(outcome, 'SONAR_FILE_ALREADY_IN_PROGRESS');
  assert.deepEqual(await activeHolders(Z), [D]);
  await second.end();

  // Aucune ligne ne viole les contraintes du schéma de production (sinon les requêtes auraient échoué).
  await client.end();
  console.log('sonar-file-reservation: tous les scénarios passent');
}

main().catch(error => { console.error(error); process.exit(1); });
