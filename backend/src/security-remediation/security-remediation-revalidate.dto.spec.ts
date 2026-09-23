import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SecurityRemediationRevalidateDto } from './security-remediation-revalidate.dto';

async function main() {
  const validBody = {
    projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002',
    findingTaskId: 'c8fb2207-c8de-40af-acd4-1d2f96896715',
    expectedCandidateIdentity: 'a'.repeat(64),
    // forbidden fields a caller might try to smuggle in
    candidateManifest: { files: [{ path: 'pom.xml', content: 'malicious replacement content' }] },
    targetVersion: '99.99.99', package: 'com.evil:malicious', controllingFile: '../../pom.xml',
  };
  const instance = plainToInstance(SecurityRemediationRevalidateDto, validBody, { excludeExtraneousValues: false });
  const errors = await validate(instance, { whitelist: true });
  assert.equal(errors.length, 0);
  assert.deepEqual(Object.keys(instance), ['projectId', 'findingTaskId', 'expectedCandidateIdentity']);
  for (const forbidden of ['candidateManifest', 'targetVersion', 'package', 'controllingFile']) {
    assert.equal((instance as any)[forbidden], undefined, `revalidate DTO must strip caller-supplied "${forbidden}" -- candidate bytes can never be accepted as trusted input`);
  }
  console.log('security-remediation-revalidate.dto) whitelist strips candidateManifest/targetVersion/package/controllingFile -- caller cannot submit replacement bytes: PASS');

  // expectedCandidateIdentity must be a real 64-hex sha256 shape, fail closed otherwise.
  for (const bad of ['not-hex', 'a'.repeat(63), 'a'.repeat(65), '', 'A'.repeat(64) /* uppercase rejected -- canonical form only */]) {
    const badInstance = plainToInstance(SecurityRemediationRevalidateDto, { ...validBody, expectedCandidateIdentity: bad }, { excludeExtraneousValues: false });
    const badErrors = await validate(badInstance, { whitelist: true });
    assert.ok(badErrors.length > 0, `expectedCandidateIdentity=${JSON.stringify(bad)} must fail validation`);
  }
  console.log('security-remediation-revalidate.dto) malformed expectedCandidateIdentity shapes -> real validation failure: PASS');

  console.log('security-remediation-revalidate.dto.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
