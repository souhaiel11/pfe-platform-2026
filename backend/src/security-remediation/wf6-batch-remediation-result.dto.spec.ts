// Increment 1 — batch callback DTO. No real batch execution exists yet
// (WF6's own n8n graph is not deployed this increment — see the design
// cadrage), so unlike wf6-remediation-result.dto.spec.ts this cannot
// replay a REAL captured payload; the payload below is honestly synthetic,
// shaped exactly like SecurityRemediationBatchCandidateResult's own real
// fields (security-remediation-batch-orchestration.types.ts) plus the
// same GitHub-side fields (branchName/prUrl/prNumber) the singular DTO's
// own real execution 2060 payload carries.
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Wf6BatchRemediationResultDto } from './wf6-batch-remediation-result.dto';

const SYNTHETIC_BATCH_PAYLOAD = {
  projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002',
  batchId: 'sec-batch-a1b2c3d4e5f6',
  status: 'CANDIDATE_READY',
  reason: 'DETERMINISTIC_BATCH_CANDIDATE_READY',
  candidateIdentity: '71531d5009b160fbe4d9e41dfe65efc203b676312003ae01c0b8d9596f851d9a',
  evaluatedSha: '7ae0f954f99628b69ce9b42f42c1e2acc8568d99',
  branchName: 'security/fix/batch-a1b2c3d4e5f6',
  prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/40',
  prNumber: 40,
  executionId: '2100',
  findings: [
    {
      findingTaskId: 'c8fb2207-c8de-40af-acd4-1d2f96896715', cveId: 'CVE-2023-6378', status: 'CLOSED', reason: 'TARGET_CVE_CLOSED',
      patchEvidence: { provenanceKind: 'DIRECT_EXPLICIT', oldVersion: '1.2.11', targetVersion: '1.2.13', controllingFile: 'pom.xml', controllingElement: '<version>1.2.11</version>', controllingProperty: null },
      securityValidationEvidence: { status: 'TARGET_CVE_CLOSED', targetCve: 'CVE-2023-6378', mode: 'TRIVY_IMAGE_ARCHIVE', evaluatedSha: '7ae0f954f99628b69ce9b42f42c1e2acc8568d99', candidateContentSha256: 'f'.repeat(64), artifactDigest: 'a'.repeat(64), reportDigest: 'b'.repeat(64), scannerVersion: 'Version: 0.72.0', targetCveMatchCount: 0, buildPassed: true, tests: 'SKIPPED' },
    },
    {
      findingTaskId: '9d1e2f30-1234-4abc-9def-0123456789ab', cveId: 'CVE-2020-36518', status: 'CLOSED', reason: 'TARGET_CVE_CLOSED',
      patchEvidence: { provenanceKind: 'DIRECT_EXPLICIT', oldVersion: '2.13.3', targetVersion: '2.13.5', controllingFile: 'pom.xml', controllingElement: '<version>2.13.3</version>', controllingProperty: null },
    },
  ],
  // Fields deliberately NOT kept -- redundant with a kept field or with the
  // PR itself, same rationale as the singular DTO's own excluded list.
  decisions: [{ findingIdentity: 'x' }], candidateManifest: { files: [{ path: 'pom.xml', content: '<project>...</project>' }] },
  repository: 'souhaiel11/pfe-app-test', commitMessage: 'fix(security): remediate 2 CVEs',
};

const KEPT_TOP_LEVEL = ['projectId', 'batchId', 'status', 'reason', 'candidateIdentity', 'evaluatedSha', 'branchName', 'prUrl', 'prNumber', 'executionId', 'findings'];
const EXCLUDED_TOP_LEVEL = ['decisions', 'candidateManifest', 'repository', 'commitMessage'];

async function main() {
  const instance = plainToInstance(Wf6BatchRemediationResultDto, SYNTHETIC_BATCH_PAYLOAD, { excludeExtraneousValues: false });
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: false });
  assert.equal(errors.length, 0, `the synthetic batch payload must validate cleanly: ${JSON.stringify(errors)}`);

  for (const field of KEPT_TOP_LEVEL) assert.notEqual((instance as any)[field], undefined, `"${field}" must survive -- it is a declared, kept field`);
  for (const field of EXCLUDED_TOP_LEVEL) assert.equal((instance as any)[field], undefined, `"${field}" is deliberately excluded, must be stripped by whitelist`);

  const allKeys = Object.keys(SYNTHETIC_BATCH_PAYLOAD);
  const accounted = new Set([...KEPT_TOP_LEVEL, ...EXCLUDED_TOP_LEVEL]);
  assert.deepEqual(allKeys.filter(k => !accounted.has(k)), [], 'every top-level field must be either kept or explicitly excluded');

  assert.equal((instance as any).findings.length, 2, 'both per-CVE entries survive');
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(plain((instance as any).findings[0].securityValidationEvidence), SYNTHETIC_BATCH_PAYLOAD.findings[0].securityValidationEvidence, 'nested per-CVE evidence survives intact');
  assert.deepEqual(plain((instance as any).findings[1].patchEvidence), SYNTHETIC_BATCH_PAYLOAD.findings[1].patchEvidence);
  assert.equal((instance as any).findings[1].securityValidationEvidence, undefined, 'a finding without evidence (e.g. a non-CLOSED one) is simply absent, not a validation error');

  console.log('wf6-batch-remediation-result.dto) synthetic batch payload: every kept field survives whitelist intact, per-CVE array preserved, deliberately excluded fields stripped: PASS');

  // Minimal/failure-shaped payload — a PATCH_CONFLICT batch has no
  // candidateIdentity/branchName/prUrl at all, only per-CVE conflict detail.
  {
    const minimal = plainToInstance(Wf6BatchRemediationResultDto, {
      projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', batchId: 'sec-batch-conflict', status: 'PATCH_CONFLICT', reason: '1 conflicting CVE(s): CVE-2023-6378',
      findings: [
        { findingTaskId: 'c8fb2207-c8de-40af-acd4-1d2f96896715', cveId: 'CVE-2023-6378', status: 'PATCH_CONFLICT', reason: 'OLD_VERSION_MISMATCH: ...' },
        { findingTaskId: '9d1e2f30-1234-4abc-9def-0123456789ab', cveId: 'CVE-2020-36518', status: 'PENDING', reason: 'BATCH_ABORTED_BY_SIBLING_CONFLICT' },
      ],
    }, { excludeExtraneousValues: false });
    const minimalErrors = await validate(minimal, { whitelist: true });
    assert.equal(minimalErrors.length, 0, `a minimal conflict-shaped payload must still validate: ${JSON.stringify(minimalErrors)}`);
  }
  console.log('wf6-batch-remediation-result.dto) minimal PATCH_CONFLICT-shaped payload (no candidate/PR fields at all) -> accepted: PASS');

  // Malformed identity -> real validation failure, fail closed.
  {
    const bad = plainToInstance(Wf6BatchRemediationResultDto, { projectId: 'not-a-uuid', batchId: 'b', status: 'CANDIDATE_READY', findings: [{ findingTaskId: 'not-a-uuid', cveId: 'CVE-1', status: 'CLOSED' }] }, { excludeExtraneousValues: false });
    const badErrors = await validate(bad, { whitelist: true });
    assert.ok(badErrors.length > 0, 'non-UUID projectId/findingTaskId must be rejected');
  }
  console.log('wf6-batch-remediation-result.dto) non-UUID identity (top-level or nested) -> real validation failure: PASS');

  console.log('wf6-batch-remediation-result.dto.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
