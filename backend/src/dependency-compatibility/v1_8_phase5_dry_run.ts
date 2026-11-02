// Exécute un scénario de qualification à blanc du gate V1.8, sans constituer un endpoint métier.
import { readFileSync } from 'fs';
import { join } from 'path';
import { canDispatchSecurityRemediationV1_8, LIVE_WRITER_SUPPORTED_EDIT_TYPES } from './v1_8-security-remediation-gate';
import { V1_8CompatibilityDecision } from './v1_8-compatibility-decision.types';

const storePath = join(__dirname, 'v1_8-evidence-store.json');
const store: { decisions: Record<string, V1_8CompatibilityDecision> } = JSON.parse(readFileSync(storePath, 'utf8'));

const rows = Object.entries(store.decisions).map(([key, evidence]) => {
  const [source, cve, ...pkgParts] = key.split(':');
  const pkg = pkgParts.join(':');
  const context = {
    repository: evidence.repository, commitSha: evidence.validatedCommitSha, source: evidence.findingSource,
    cve: evidence.cve, component: evidence.component, installedVersion: evidence.installedVersion,
    statusPermitsDispatch: true,
  };
  const result = canDispatchSecurityRemediationV1_8(context, evidence);
  return { source: source as 'OWASP' | 'TRIVY', cve, pkg, state: evidence.state, editType: evidence.editType, decision: result.decision, reason: result.reason };
});

const allow = rows.filter(r => r.decision === 'ALLOW');
const block = rows.filter(r => r.decision === 'BLOCK');
const blockReasonCounts = new Map<string, number>();
for (const r of block) {
  // Collapse the (field-specific) V1_8_EVIDENCE_STALE detail text to its
  // reason CODE for the counts table -- never expected in this dry run
  // (exact-match contexts by construction) but counted honestly if it
  // ever appears rather than silently merged into another bucket.
  const code = r.reason.startsWith('V1_8_EVIDENCE_STALE') ? 'V1_8_EVIDENCE_STALE' : r.reason;
  blockReasonCounts.set(code, (blockReasonCounts.get(code) ?? 0) + 1);
}

const validatedRecommended = rows.filter(r => r.state === 'VALIDATED_RECOMMENDED' || r.state === 'VALIDATED_ALTERNATIVES');
const liveExecutorSupported = validatedRecommended.filter(r => r.editType && LIVE_WRITER_SUPPORTED_EDIT_TYPES.has(r.editType));
const liveDispatchable = validatedRecommended.filter(r => r.decision === 'ALLOW');

console.log('══════════════════════════════════════════════════');
console.log('V1.8 Phase 5 — 251-FINDING DRY RUN (canDispatchSecurityRemediationV1_8, exact-match contexts, NO dispatch)');
console.log('══════════════════════════════════════════════════');
console.log('TOTAL:', rows.length);
console.log('ALLOW:', allow.length);
console.log('BLOCK:', block.length);
console.log();
console.log('BLOCK_REASONS:');
for (const [reason, count] of [...blockReasonCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(` - ${reason}: ${count}`);
console.log();
console.log('VALIDATED_RECOMMENDED (incl. ALTERNATIVES):', validatedRecommended.length);
console.log('LIVE_EXECUTOR_SUPPORTED (editType is writer-supported):', liveExecutorSupported.length);
console.log('LIVE_DISPATCHABLE (actually ALLOW from the gate):', liveDispatchable.length);
console.log();
console.log('VALIDATED_RECOMMENDED but NOT live-dispatchable (edit type unsupported by the real writer today):');
for (const r of validatedRecommended.filter(r => r.decision === 'BLOCK')) console.log(`  - ${r.source} ${r.cve} ${r.pkg} editType=${r.editType} reason=${r.reason}`);
console.log();
console.log('ALLOW rows:');
for (const r of allow) console.log(`  - ${r.source} ${r.cve} ${r.pkg}`);

const explained = new Set(['VALIDATED_RECOMMENDED', 'SECURITY_TARGET_UNKNOWN', 'PROJECT_CONTEXT_INSUFFICIENT', 'MAJOR_UPGRADE_REQUIRES_REVIEW', 'NO_COMPATIBLE_CANDIDATE', 'VALIDATION_FAILED', 'NOT_YET_SANDBOXED', 'SANDBOX_NOT_VALIDATED', 'TARGET_CVE_NOT_CLOSED', 'NEW_HIGH_CRITICAL_REGRESSION', 'RECOMMENDED_VERSION_MISSING', 'EDIT_TARGET_UNKNOWN', 'EDIT_TYPE_UNKNOWN', 'DEVELOPER_REVIEW_REQUIRED', 'UNSUPPORTED_EDIT_TYPE', 'TASK_STATUS_DOES_NOT_PERMIT_DISPATCH', 'MISSING_EVIDENCE', 'ALL_GATES_PASSED', 'VALIDATED_ALTERNATIVES']);
const unexplained = rows.filter(r => !explained.has(r.reason) && !r.reason.startsWith('V1_8_EVIDENCE_STALE'));
console.log();
console.log('UNEXPLAINED_DECISIONS:', unexplained.length);
for (const r of unexplained) console.log('  -', r.source, r.cve, r.pkg, r.decision, r.reason);
if (rows.length !== 251) throw new Error(`Expected exactly 251 findings, got ${rows.length}`);
if (unexplained.length !== 0) throw new Error('Every finding must receive an explained decision.');

console.log('\nv1_8_phase5_dry_run.ts: DONE, 251_DRY_RUN_COMPLETE=YES');
