"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_AUTOMATIC_ATTEMPTS = void 0;
exports.assertSecurityRemediationDispatchEnabled = assertSecurityRemediationDispatchEnabled;
exports.callbackContract = callbackContract;
exports.maxAutomaticAttempts = maxAutomaticAttempts;
exports.isProjectFixVerified = isProjectFixVerified;
exports.classifySecurityRemediationFailure = classifySecurityRemediationFailure;
exports.normalizeSecurityRemediation = normalizeSecurityRemediation;
exports.assertRetryAllowed = assertRetryAllowed;
exports.assertNoSideEffect = assertNoSideEffect;
exports.automaticAttemptCount = automaticAttemptCount;
exports.reserveAttempt = reserveAttempt;
exports.assertCorrelation = assertCorrelation;
exports.isLegacyCurrentAttempt = isLegacyCurrentAttempt;
exports.assertLegacyCallback = assertLegacyCallback;
exports.completeLegacyAttempt = completeLegacyAttempt;
exports.completeAttempt = completeAttempt;
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
exports.MAX_AUTOMATIC_ATTEMPTS = 3;
function callbackContract(payload) {
    return [payload, ...(payload.findings || [])].some(f => f.attemptId !== undefined || f.attemptNumber !== undefined) ? 2 : 1;
}
function maxAutomaticAttempts() {
    const configured = process.env.SECURITY_REMEDIATION_MAX_ATTEMPTS;
    if (configured === undefined)
        return exports.MAX_AUTOMATIC_ATTEMPTS;
    if (!/^[1-3]$/.test(configured))
        throw new common_1.ServiceUnavailableException('La limite de tentatives automatiques est invalide.');
    return Number(configured);
}
function isProjectFixVerified(task) {
    return (task.manualStatus ?? task.status) === 'VERIFIED' && task.scannerStatus === 'NOT_DETECTED';
}
const temporary = new Set(['RUNTIME_OPERATION_TIMEOUT', 'WORKER_DEADLINE_EXCEEDED', 'VERIFIER_TIMEOUT',
    'WARMUP_TIMEOUT', 'WARMUP_NETWORK_FAILURE', 'DEPENDENCY_TREE_TIMEOUT']);
const rejected = new Set(['APPLICATION_TESTS_FAILED', 'APPLICATION_TESTS_NOT_EXECUTED', 'MAVEN_RESOLUTION_MISMATCH',
    'TARGET_CVE_STILL_OPEN_AFTER_PATCH', 'TARGET_CVE_NEVER_OBSERVED_IN_BASELINE', 'INVALID_CANDIDATE',
    'ANCESTRY_INVALID', 'CANDIDATE_DRIFTED', 'PR_HEAD_SHA_MISMATCH', 'GUARD_REJECTED', 'PATCH_CONFLICT',
    'BRANCH_CONTENT_CONFLICT', 'WRITE_CONFLICT', 'MAVEN_MUTATED_CANDIDATE_SOURCE']);
const retryTerminalStatuses = new Set(['TECHNICAL_FAILURE', 'DISPATCH_FAILED', 'GROUNDING_FAILED', 'WORKSPACE_FAILURE', 'MAVEN_RESOLUTION_FAILED', 'CANDIDATE_BUILD_FAILED', 'CANDIDATE_SECURITY_VALIDATION_FAILED']);
function classifySecurityRemediationFailure(input) {
    const raw = input.reasonCode || input.reason || '';
    const code = /^[A-Z][A-Z0-9_]*(?::[A-Z][A-Z0-9_]*)?$/.test(raw) ? raw.split(':')[0] : 'UNKNOWN_FAILURE';
    const groundingCode = /^GROUNDING_FAILED:([A-Z][A-Z0-9_]*)$/.exec(raw)?.[1];
    const effective = code === 'WF6_STALE_DISPATCH_RECONCILED' ? input.underlyingReasonCode || code : groundingCode || code;
    const retryable = temporary.has(effective) && (!input.status || retryTerminalStatuses.has(input.status));
    return { retryable, category: retryable ? 'RETRYABLE_TECHNICAL' : rejected.has(effective) || rejected.has(input.status || '') ? 'NON_RETRYABLE_AUTOMATIC' : 'UNKNOWN',
        safeReasonCode: groundingCode || code, safeMessage: retryable ? 'Une erreur technique temporaire a interrompu la correction.' : 'Une vérification est requise avant toute nouvelle correction automatique.' };
}
function normalizeSecurityRemediation(value) {
    if (!value)
        return null;
    const attempts = (Array.isArray(value.attempts) ? value.attempts : []).map((a, i) => {
        const policy = classifySecurityRemediationFailure({ ...a, reason: a.reasonCode || a.reason });
        return { ...a, attemptNumber: Number(a.attemptNumber || a.attempt) || i + 1,
            startedAt: a.startedAt || a.at, finishedAt: a.finishedAt ?? (a.status === 'DISPATCHING' ? null : a.at),
            reasonCode: a.reasonCode || policy.safeReasonCode, reasonMessage: a.reasonMessage || policy.safeMessage,
            retryable: policy.retryable, ...(!a.attemptId ? { legacyAttempt: true } : {}) };
    });
    const policy = classifySecurityRemediationFailure({ ...value, reason: value.reasonCode || value.reason });
    return { ...value, attempts, retryable: policy.retryable, failureCategory: policy.category, reasonCode: value.reasonCode || policy.safeReasonCode,
        reasonMessage: value.reasonMessage || policy.safeMessage };
}
function assertRetryAllowed(task, expectedAttemptId) {
    const r = normalizeSecurityRemediation(task.securityFindingRemediation);
    if (!r || ['DISPATCHING', 'CANDIDATE_READY', 'CLOSED', 'PENDING', 'WRITE_AUTHORIZED', 'PR_CREATED', 'PR_REUSED', 'ALREADY_MERGED'].includes(r.status)) {
        throw new common_1.ConflictException('La tentative actuelle ne permet pas de nouvelle correction.');
    }
    if (expectedAttemptId && r.attemptId !== expectedAttemptId)
        throw new common_1.ConflictException('La tentative attendue n’est plus actuelle.');
    if (!retryTerminalStatuses.has(r.status))
        throw new common_1.ConflictException('État terminal non pris en charge pour le réessai.');
    const current = r.attemptId ? r.attempts.find(a => a.attemptId === r.attemptId) : null;
    if (r.attemptId && (!current || current.status !== r.status || !current.finishedAt))
        throw new common_1.ConflictException('La tentative actuelle n’est pas terminée.');
    const policy = classifySecurityRemediationFailure({ reasonCode: current?.reasonCode || r.reasonCode, status: r.status,
        underlyingReasonCode: current?.underlyingReasonCode || r.underlyingReasonCode });
    if (!policy.retryable || (current && current.retryable !== true))
        throw new common_1.ConflictException('Cet échec ne permet pas de réessai automatique.');
    assertNoSideEffect(task);
    if (automaticAttemptCount(r) >= maxAutomaticAttempts())
        throw new common_1.ConflictException('Le maximum de tentatives automatiques est atteint.');
}
function assertNoSideEffect(task) {
    const r = task.securityFindingRemediation;
    if (isProjectFixVerified(task))
        throw new common_1.ConflictException('Le projet confirme déjà la correction de cette vulnérabilité.');
    if (r && (r.prUrl || r.prNumber || r.branchName || r.unresolvedGitSideEffect || (r.attempts || []).some((a) => a.prUrl || a.prNumber || a.branchName || a.unresolvedGitSideEffect))) {
        throw new common_1.ConflictException('Un effet Git/PR persistant nécessite une vérification avant relance.');
    }
}
function automaticAttemptCount(r) {
    if (!r)
        return 0;
    return Math.max(Number(r.attemptNumber || r.attemptCount) || 0, ...(r.attempts || []).map((a) => Number(a.attemptNumber || a.attempt) || 0));
}
function reserveAttempt(task, batchId, at) {
    const r = normalizeSecurityRemediation(task.securityFindingRemediation);
    const nextNumber = automaticAttemptCount(r) + 1;
    if (nextNumber > maxAutomaticAttempts())
        throw new common_1.ConflictException('Le maximum de tentatives automatiques est atteint.');
    const attempt = { contractVersion: 2, attemptId: (0, crypto_1.randomUUID)(), attemptNumber: nextNumber,
        batchId, startedAt: at, finishedAt: null, status: 'DISPATCHING', reasonCode: null, reasonMessage: null,
        retryable: false, executionId: null, prUrl: null, branchName: null, candidateSha: null, verificationEvidence: null };
    task.securityRemediationBatchId = batchId;
    task.securityFindingRemediation = { ...r, ...attempt, attemptCount: attempt.attemptNumber, updatedAt: at,
        reason: null, candidateStatus: null, batchStatus: null, candidateIdentity: null, evaluatedSha: null, prNumber: null,
        patchEvidence: null, securityValidationEvidence: null, completionDigest: null, legacyCallbackCompletionDigest: null, failureCategory: null, underlyingReasonCode: null,
        attempts: [...(r?.attempts || []), attempt] };
    return attempt;
}
function assertCorrelation(task, identity) {
    const r = task.securityFindingRemediation;
    if (!identity.attemptId || !Number.isInteger(identity.attemptNumber) || !identity.batchId ||
        r?.attemptId !== identity.attemptId || r?.attemptNumber !== identity.attemptNumber ||
        r?.batchId !== identity.batchId || task.securityRemediationBatchId !== identity.batchId) {
        throw new common_1.ConflictException('Résultat obsolète ou identité de tentative WF6 incorrecte.');
    }
    const a = r.attempts?.find((a) => a.attemptId === identity.attemptId);
    if (!a || a.attemptNumber !== identity.attemptNumber || a.batchId !== identity.batchId)
        throw new common_1.ConflictException('Tentative WF6 introuvable.');
    return a;
}
function canonical(x) {
    if (Array.isArray(x))
        return '[' + x.map(canonical).join(',') + ']';
    if (x && typeof x === 'object')
        return '{' + Object.keys(x).filter(k => x[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
    return JSON.stringify(x);
}
function isLegacyCurrentAttempt(task) {
    const raw = task.securityFindingRemediation;
    if (!raw || !Array.isArray(raw.attempts) || !raw.attempts.length ||
        raw.attempts.some((a) => !a || typeof a !== 'object' || Array.isArray(a)))
        return false;
    const r = normalizeSecurityRemediation(raw);
    if (!r || r.attemptId != null || r.contractVersion === 2 || !r.attempts.length ||
        r.attempts.some(a => a.attemptId != null || a.contractVersion === 2) ||
        typeof r.batchId !== 'string' || !r.batchId || task.securityRemediationBatchId !== r.batchId)
        return false;
    const number = Number(r.attemptCount ?? r.attemptNumber);
    const current = r.attempts[r.attempts.length - 1];
    const recordedNumber = Number(raw.attempts[raw.attempts.length - 1].attemptNumber ?? raw.attempts[raw.attempts.length - 1].attempt);
    if (r.attempts.slice(0, -1).some(a => a.batchId === r.batchId))
        return false;
    return Number.isInteger(number) && number > 0 && Number.isInteger(recordedNumber) && recordedNumber === number && current.legacyAttempt === true &&
        current.attemptNumber === number && current.batchId === r.batchId && current.status === r.status &&
        r.attempts.filter(a => a.attemptNumber === number).length === 1;
}
function completionDigest(result) {
    return (0, crypto_1.createHash)('sha256').update(canonical(result)).digest('hex');
}
function assertTerminalResult(result) {
    if (!result.status || ['DISPATCHING', 'PENDING', 'WRITE_AUTHORIZED'].includes(result.status))
        throw new common_1.ConflictException('Résultat WF6 non terminal.');
}
function assertLegacyCallback(task, batchId, result) {
    if (!isLegacyCurrentAttempt(task) || batchId !== task.securityFindingRemediation.batchId) {
        throw new common_1.ConflictException('Le résultat legacy ne correspond pas à une tentative legacy actuelle.');
    }
    assertTerminalResult(result);
    const r = normalizeSecurityRemediation(task.securityFindingRemediation);
    const current = r.attempts[r.attempts.length - 1];
    if (r.status === 'DISPATCHING' && !r.finishedAt && !current.finishedAt)
        return;
    const digest = completionDigest(result);
    if (r.contractVersion === 1 && r.legacyCallbackCompletionDigest === digest &&
        current.contractVersion === 1 && current.legacyCallbackCompletionDigest === digest &&
        r.finishedAt && current.finishedAt)
        return;
    throw new common_1.ConflictException('Cette tentative legacy n’attend plus de résultat.');
}
function completeLegacyAttempt(task, batchId, result, at = new Date().toISOString()) {
    assertLegacyCallback(task, batchId, result);
    const r = normalizeSecurityRemediation(task.securityFindingRemediation);
    if (r.status !== 'DISPATCHING')
        return false;
    const index = r.attempts.length - 1;
    const a = r.attempts[index];
    const policy = classifySecurityRemediationFailure(result);
    const finished = { ...a, ...result, contractVersion: 1, legacyAttempt: true,
        batchId, attemptNumber: a.attemptNumber, finishedAt: at,
        retryable: policy.retryable, failureCategory: policy.category,
        reasonCode: policy.safeReasonCode, reasonMessage: policy.safeMessage,
        legacyCallbackCompletionDigest: completionDigest(result),
        unresolvedGitSideEffect: result.unresolvedGitSideEffect === true || r.unresolvedGitSideEffect === true ||
            !!(r.prUrl || r.prNumber || r.branchName || r.attempts.some(a => a.prUrl || a.prNumber || a.branchName || a.unresolvedGitSideEffect)), };
    task.securityFindingRemediation = { ...r, ...finished, attemptCount: r.attemptCount, updatedAt: at,
        attempts: r.attempts.map((entry, i) => i === index ? finished : entry) };
    return true;
}
function completeAttempt(task, identity, result, at = new Date().toISOString()) {
    const a = assertCorrelation(task, identity);
    const digest = completionDigest(result);
    if (a.finishedAt) {
        if (a.completionDigest === digest)
            return false;
        throw new common_1.ConflictException('Cette tentative est déjà terminée avec un autre résultat.');
    }
    assertTerminalResult(result);
    const policy = classifySecurityRemediationFailure(result);
    const finished = { ...a, ...result, ...identity, finishedAt: at, retryable: policy.retryable, failureCategory: policy.category,
        reasonCode: policy.safeReasonCode, reasonMessage: policy.safeMessage, completionDigest: digest };
    const r = task.securityFindingRemediation;
    task.securityFindingRemediation = { ...r, ...finished, attemptCount: a.attemptNumber, updatedAt: at,
        attempts: r.attempts.map((entry) => entry.attemptId === a.attemptId ? finished : entry) };
    return true;
}
//# sourceMappingURL=security-remediation-lifecycle.js.map
function assertSecurityRemediationDispatchEnabled() {
    const value = process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED;
    if (value === undefined || value.trim().toLowerCase() === 'true')
        return;
    throw new common_1.ServiceUnavailableException({
        statusCode: 503, error: 'Service Unavailable',
        code: 'SECURITY_REMEDIATION_TEMPORARILY_DISABLED',
        message: 'Les corrections automatiques sont temporairement suspendues.',
    });
}
