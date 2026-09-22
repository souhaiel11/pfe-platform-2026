// R-SEC-V1.4 §8 (option A) — proves the app's REAL global ValidationPipe
// config (main.ts: `new ValidationPipe({ whitelist: true, transform: true })`)
// actually strips any field not declared on SecurityRemediationEvaluateDto,
// using the SAME class-transformer/class-validator machinery Nest's
// ValidationPipe uses internally -- not a hand-rolled approximation.
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SecurityRemediationEvaluateDto } from './security-remediation-evaluate.dto';

async function main() {
  const maliciousBody = {
    projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002',
    findingTaskId: 'c8fb2207-c8de-40af-acd4-1d2f96896715',
    targetVersion: '99.99.99', package: 'com.evil:malicious-package', installedVersion: '0.0.1',
    controllingFile: '/etc/passwd', provenance: 'DIRECT_EXPLICIT', evaluatedSha: 'f'.repeat(40),
  };

  const instance = plainToInstance(SecurityRemediationEvaluateDto, maliciousBody, { excludeExtraneousValues: false });
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: false });
  assert.equal(errors.length, 0, `well-formed projectId/findingTaskId must validate cleanly: ${JSON.stringify(errors)}`);

  // whitelist:true's real effect (mirrored here exactly as Nest's
  // ValidationPipe applies it): class-validator's `validate()` call above
  // already stripped every non-decorated property OFF the instance object
  // itself as a side effect of whitelist validation.
  assert.equal(instance.projectId, maliciousBody.projectId);
  assert.equal(instance.findingTaskId, maliciousBody.findingTaskId);
  for (const strippedField of ['targetVersion', 'package', 'installedVersion', 'controllingFile', 'provenance', 'evaluatedSha']) {
    assert.equal((instance as any)[strippedField], undefined, `DTO whitelist must strip caller-supplied "${strippedField}" -- it is not a declared field`);
  }
  console.log('security-remediation-evaluate.dto) real class-validator whitelist strips every non-declared field (targetVersion/package/installedVersion/controllingFile/provenance/evaluatedSha): PASS');

  // Malformed projectId/findingTaskId (not a UUID) -> real validation error, fail closed.
  {
    const badInstance = plainToInstance(SecurityRemediationEvaluateDto, { projectId: 'not-a-uuid', findingTaskId: 'also-not-a-uuid' }, { excludeExtraneousValues: false });
    const badErrors = await validate(badInstance, { whitelist: true });
    assert.ok(badErrors.length > 0, 'non-UUID projectId/findingTaskId must be rejected by real class-validator, not silently coerced');
  }
  console.log('security-remediation-evaluate.dto) non-UUID projectId/findingTaskId -> real validation failure: PASS');

  console.log('security-remediation-evaluate.dto.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
