"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTargetFile = normalizeTargetFile;
exports.canonicalTarget = canonicalTarget;
exports.productionTarget = productionTarget;
exports.reserveTarget = reserveTarget;
exports.bindTargetAttempt = bindTargetAttempt;
exports.releaseTargetClaim = releaseTargetClaim;
exports.safeTerminalTargetRelease = safeTerminalTargetRelease;
exports.settleTargetClaim = settleTargetClaim;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
function normalizeTargetFile(value) {
    if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value) ||
        value.split('/').some(s => s === '.' || s === '..' || s.toLowerCase() === '.git')) {
        throw new common_1.ConflictException('REMEDIATION_TARGET_PATH_INVALID');
    }
    return value;
}
function canonicalTarget(projectId, targetFile, component) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId))
        throw new common_1.ConflictException('REMEDIATION_TARGET_PROJECT_INVALID');
    const file = normalizeTargetFile(targetFile);
    return { targetType: 'FILE', trustedTargetPath: file, projectId: projectId.toLowerCase(), targetFile: file, dependencyCoordinate: component || '',
        lockGranularity: 'FILE', targetKey: JSON.stringify(['v1', 'FILE', file]) };
}
async function reserveTarget(tx, key, taskIds) {
    const claims = Object.fromEntries(taskIds.map(id => [id, { attemptId: null, batchId: null, status: 'RESERVED' }]));
    await tx.query(`INSERT INTO remediation_target_reservations
    (id,"projectId","targetKey","targetFile","ownerTaskId",claims,state)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,'ACTIVE')
    ON CONFLICT ("projectId","targetKey") WHERE state = 'ACTIVE' DO NOTHING`, [(0, crypto_1.randomUUID)(), key.projectId, key.targetKey, key.targetFile, taskIds[0], JSON.stringify(claims)]);
    const [reservation] = await tx.query(`SELECT * FROM remediation_target_reservations
    WHERE "projectId"=$1 AND "targetKey"=$2 AND state='ACTIVE' FOR UPDATE`, [key.projectId, key.targetKey]);
    if (!reservation || taskIds.some(id => !Object.prototype.hasOwnProperty.call(reservation.claims, id)) ||
        Object.entries(reservation.claims).some(([id, claim]) => !taskIds.includes(id) && claim.status !== 'WAITING_RETRY')) {
        throw new common_1.ConflictException({ code: 'REMEDIATION_TARGET_ALREADY_IN_PROGRESS', status: 'TARGET_BUSY',
            message: 'Correction déjà en cours sur le même fichier de dépendances.', targetKey: key.targetKey });
    }
    return reservation.id;
}
async function bindTargetAttempt(tx, reservationId, task) {
    const r = task.securityFindingRemediation;
    await tx.query(`UPDATE remediation_target_reservations SET
    claims=jsonb_set(claims,ARRAY[$2::text],$3::jsonb),"ownerTaskId"=$2::uuid,"ownerAttemptId"=$4,"ownerBatchId"=$5,"updatedAt"=now()
    WHERE id=$1 AND state='ACTIVE' AND claims ? $2`, [reservationId, task.id, JSON.stringify({ attemptId: r.attemptId, batchId: r.batchId, status: 'DISPATCHING' }), r.attemptId, r.batchId]);
}
async function releaseTargetClaim(tx, task, reason) {
    await tx.query(`UPDATE remediation_target_reservations SET claims=claims - $1,
    state=CASE WHEN claims - $1 = '{}'::jsonb THEN 'RELEASED' ELSE 'ACTIVE' END,
    "releasedAt"=CASE WHEN claims - $1 = '{}'::jsonb THEN now() ELSE NULL END,
    "ownerTaskId"=COALESCE((SELECT key::uuid FROM jsonb_each(claims - $1) ORDER BY key LIMIT 1),"ownerTaskId"),
    "ownerAttemptId"=CASE WHEN claims - $1 = '{}'::jsonb THEN "ownerAttemptId" ELSE
      (SELECT NULLIF(value->>'attemptId','')::uuid FROM jsonb_each(claims - $1) ORDER BY key LIMIT 1) END,
    "ownerBatchId"=CASE WHEN claims - $1 = '{}'::jsonb THEN "ownerBatchId" ELSE
      (SELECT value->>'batchId' FROM jsonb_each(claims - $1) ORDER BY key LIMIT 1) END,
    "releaseReason"=$2,"updatedAt"=now()
    WHERE "projectId"=$3 AND state='ACTIVE' AND claims ? $1`, [task.id, reason, task.projectId]);
}
const preGitFinalFailures = new Set(['APPLICATION_TESTS_FAILED', 'APPLICATION_TESTS_NOT_EXECUTED',
    'MAVEN_RESOLUTION_MISMATCH', 'TARGET_CVE_STILL_OPEN_AFTER_PATCH', 'TARGET_CVE_NEVER_OBSERVED_IN_BASELINE',
    'INVALID_CANDIDATE', 'MAVEN_MUTATED_CANDIDATE_SOURCE']);
function safeTerminalTargetRelease(r) {
    return r.status === 'OPERATOR_TEST_STOPPED' || preGitFinalFailures.has(String(r.reasonCode || '').split(':')[0]);
}
async function settleTargetClaim(tx, task) {
    const r = task.securityFindingRemediation;
    if (!r)
        return;
    const effects = r.unresolvedGitSideEffect || r.prUrl || r.prNumber || r.branchName ||
        (r.attempts || []).some((a) => a.unresolvedGitSideEffect || a.prUrl || a.prNumber || a.branchName);
    if (effects || r.retryable || ['DISPATCHING', 'CANDIDATE_READY', 'CLOSED', 'PROJECT_VERIFIED'].includes(r.status) || !r.finishedAt || !safeTerminalTargetRelease(r)) {
        const status = effects || (!r.retryable && !safeTerminalTargetRelease(r)) ? 'QUARANTINED' : r.retryable ? 'WAITING_RETRY' : r.status;
        await tx.query(`UPDATE remediation_target_reservations SET
      claims=jsonb_set(claims,ARRAY[$1::text,'status'],to_jsonb($2::text)),"updatedAt"=now()
      WHERE "projectId"=$3 AND state='ACTIVE' AND claims ? $1`, [task.id, status, task.projectId]);
        return;
    }
    await releaseTargetClaim(tx, task, r.status);
}
//# sourceMappingURL=remediation-target-reservation.js.map
/** Adapter used by the deployed launch service; retains the canonical FILE target contract. */
function productionTarget(task) {
    const component = task?.findingSnapshot?.component;
    if (!/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(String(component || ''))) {
        throw new common_1.ConflictException('REMEDIATION_TARGET_COORDINATE_INVALID');
    }
    return canonicalTarget(task.projectId, 'pom.xml', component);
}
