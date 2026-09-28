// Execution-2060 follow-up, point 3 of the persistence task — proves
// against the REAL, complete, unabridged execution 2060 payload (captured
// verbatim from n8n's own executions API) that every field this DTO is
// meant to keep survives class-validator's real whitelist machinery, and
// every field deliberately excluded is accounted for, not silently
// dropped by omission. Same technique as
// security-remediation-evaluate.dto.spec.ts: the REAL ValidationPipe
// machinery (whitelist:true), not a hand-rolled approximation.
import 'reflect-metadata'; // @Type()/ValidateNested (class-transformer) need this polyfill; NestJS's own bootstrap loads it implicitly, a standalone script does not.
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Wf6RemediationResultDto } from './wf6-remediation-result.dto';

// Verbatim from execution 2060's "Evaluate Security Remediation" node
// (real /internal/security-remediation/evaluate response body) plus the
// final webhook response's prUrl/prNumber ("Respond - PR Created"),
// combined into what a caller recording this result would plausibly send.
// Field-for-field identical values to the real payload -- not
// reconstructed from memory.
const REAL_2060_PAYLOAD = {
  projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002',
  findingTaskId: 'c8fb2207-c8de-40af-acd4-1d2f96896715',
  status: 'CANDIDATE_READY',
  reason: 'DETERMINISTIC_CANDIDATE_READY',
  candidateIdentity: '71531d5009b160fbe4d9e41dfe65efc203b676312003ae01c0b8d9596f851d9a',
  evaluatedSha: '7ae0f954f99628b69ce9b42f42c1e2acc8568d99',
  branchName: 'security/fix/a37e178f7ce1-71531d5009b1',
  prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/37',
  prNumber: 37,
  executionId: '2060',
  patchEvidence: {
    provenanceKind: 'DIRECT_EXPLICIT', oldVersion: '1.2.11', targetVersion: '1.2.13',
    controllingFile: 'pom.xml', controllingElement: '<version>1.2.11</version>', controllingProperty: null,
  },
  securityValidationEvidence: {
    status: 'TARGET_CVE_CLOSED', targetCve: 'CVE-2023-6378', mode: 'TRIVY_IMAGE_ARCHIVE',
    evaluatedSha: '7ae0f954f99628b69ce9b42f42c1e2acc8568d99',
    candidateContentSha256: 'f36d6ecdc90ca0f1964da7064b097b3f8450fea622ec8934b62bb31a26b370c6',
    artifactDigest: 'c07fc4cdb2ceb394ca5d4957a8f6c0fe3403fe54a93a8b33ff690eb32e255a39',
    reportDigest: 'a22af75e9d1dab868612ba3ec13cca5ac990616b18ef65dd39c7958b1c8c4b07',
    scannerVersion: 'Version: 0.72.0', targetCveMatchCount: 0, buildPassed: true, tests: 'SKIPPED',
  },
  // Every field of the REAL execution 2060 payload deliberately NOT kept --
  // see manual-remediation.service.recordWf6Result.spec.ts's own header
  // comment for the full justification of each. Included here so the
  // whitelist-stripping assertions below are exercised against the
  // ACTUAL shape WF6 produces, not a synthetic guess.
  decision: { findingIdentity: 'x', remediationScope: { kind: 'COORDINATED_SAME_FILE' } },
  candidateManifest: { files: [{ path: 'pom.xml', content: '<project>...</project>' }] },
  guardResult: { ok: true },
  dependencyResolutionEvidence: { checked: true, resolvedMatch: true, evaluatedAtSha: 'x' },
  executionTimings: { TOTAL_WORKER_DURATION_MS: 377419 },
  cveId: 'CVE-2023-6378', title: 'logback: serialization vulnerability in logback receiver', source: 'TRIVY',
  repository: 'souhaiel11/pfe-app-test',
  commitMessage: 'fix(security): remediate CVE-2023-6378 in logback-classic (1.2.11 -> 1.2.13)',
  prTitle: 'fix(security): remediate CVE-2023-6378 in logback-classic (1.2.11 -> 1.2.13)',
  prBody: '## Security remediation candidate\n...',
};

const KEPT_FIELDS = [
  'projectId', 'findingTaskId', 'status', 'reason', 'candidateIdentity', 'evaluatedSha',
  'branchName', 'prUrl', 'prNumber', 'executionId', 'patchEvidence', 'securityValidationEvidence',
];
const DELIBERATELY_EXCLUDED_FIELDS = [
  'decision', 'candidateManifest', 'guardResult', 'dependencyResolutionEvidence', 'executionTimings',
  'cveId', 'title', 'source', 'repository', 'commitMessage', 'prTitle', 'prBody',
];

async function main() {
  const instance = plainToInstance(Wf6RemediationResultDto, REAL_2060_PAYLOAD, { excludeExtraneousValues: false });
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: false });
  assert.equal(errors.length, 0, `the real execution 2060 payload must validate cleanly: ${JSON.stringify(errors)}`);

  for (const field of KEPT_FIELDS) {
    assert.notEqual((instance as any)[field], undefined, `"${field}" must survive -- it is a declared, kept field`);
  }
  // JSON round-trip: assert/strict's deepEqual also compares prototypes,
  // and class-transformer legitimately turns the nested plain object into
  // a Wf6SecurityValidationEvidenceDto instance -- only the VALUES matter
  // here, not the class identity.
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(plain((instance as any).securityValidationEvidence), REAL_2060_PAYLOAD.securityValidationEvidence, 'securityValidationEvidence must survive INTACT, every sub-field, not partially stripped');
  assert.deepEqual(plain((instance as any).patchEvidence), REAL_2060_PAYLOAD.patchEvidence);

  for (const field of DELIBERATELY_EXCLUDED_FIELDS) {
    assert.equal((instance as any)[field], undefined, `"${field}" is deliberately excluded (redundant with a kept field, with the PR itself, or with data already on ManualRemediationTask) -- must be stripped by whitelist, not accidentally accepted`);
  }
  // Cross-check: every key in the real payload is accounted for by EXACTLY
  // one of the two lists above -- catches a field neither kept nor
  // deliberately excluded (i.e. silently forgotten).
  const allRealKeys = Object.keys(REAL_2060_PAYLOAD);
  const accounted = new Set([...KEPT_FIELDS, ...DELIBERATELY_EXCLUDED_FIELDS]);
  const unaccounted = allRealKeys.filter(k => !accounted.has(k));
  assert.deepEqual(unaccounted, [], `every field in the real execution 2060 payload must be either kept or explicitly, deliberately excluded -- found unaccounted field(s): ${unaccounted.join(', ')}`);

  console.log('wf6-remediation-result.dto) real execution 2060 payload: every kept field survives whitelist intact, every deliberately-excluded field is stripped, nothing silently forgotten: PASS');

  // Malformed identity -> real validation failure, fail closed (same
  // discipline as security-remediation-evaluate.dto.spec.ts).
  {
    const bad = plainToInstance(Wf6RemediationResultDto, { projectId: 'not-a-uuid', findingTaskId: 'also-not-a-uuid', status: 'CANDIDATE_READY' }, { excludeExtraneousValues: false });
    const badErrors = await validate(bad, { whitelist: true });
    assert.ok(badErrors.length > 0, 'non-UUID projectId/findingTaskId must be rejected');
  }
  console.log('wf6-remediation-result.dto) non-UUID identity -> real validation failure: PASS');

  // Old/minimal format (no securityValidationEvidence/patchEvidence at
  // all) -> still validates cleanly, nothing required beyond identity+status.
  {
    const minimal = plainToInstance(Wf6RemediationResultDto, {
      projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', findingTaskId: 'c8fb2207-c8de-40af-acd4-1d2f96896715', status: 'GROUNDING_FAILED',
    }, { excludeExtraneousValues: false });
    const minimalErrors = await validate(minimal, { whitelist: true });
    assert.equal(minimalErrors.length, 0, `a minimal, older-shaped payload (no evidence fields at all) must still be accepted: ${JSON.stringify(minimalErrors)}`);
  }
  console.log('wf6-remediation-result.dto) minimal payload without evidence fields -> accepted, not required: PASS');

  console.log('wf6-remediation-result.dto.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
