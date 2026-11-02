// Teste le composant « security-remediation-revalidate-batch.dto » et ses cas d’erreur.
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SecurityRemediationRevalidateBatchDto } from './security-remediation-revalidate-batch.dto';

/** Exécute les étapes principales de ce programme. */
async function main() {
  // A. Well-formed batch request -> validates cleanly, whitelist strips nothing needed.
  {
    const instance = plainToInstance(SecurityRemediationRevalidateBatchDto, {
      projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002',
      findingTaskIds: ['af1d6556-b782-4faf-b01b-4e87b119d033', 'bd9dc6f2-2202-4280-933e-4adb824dc695'],
      expectedCandidateIdentity: 'a'.repeat(64),
    });
    const errors = await validate(instance, { whitelist: true });
    assert.equal(errors.length, 0, JSON.stringify(errors));
  }
  console.log('security-remediation-revalidate-batch.dto A) well-formed batch request validates cleanly: PASS');

  // B. Whitelist strips any attempt to smuggle candidate content/paths/targetVersion.
  {
    const instance: any = plainToInstance(SecurityRemediationRevalidateBatchDto, {
      projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002',
      findingTaskIds: ['af1d6556-b782-4faf-b01b-4e87b119d033'],
      expectedCandidateIdentity: 'a'.repeat(64),
      candidateManifest: { files: [{ path: 'pom.xml', content: 'evil' }] },
      targetVersion: '99.99.99',
    });
    await validate(instance, { whitelist: true }); // whitelist mode strips non-whitelisted properties as a side effect
    assert.equal(instance.candidateManifest, undefined);
    assert.equal(instance.targetVersion, undefined);
  }
  console.log('security-remediation-revalidate-batch.dto B) whitelist strips candidateManifest/targetVersion -- caller cannot submit replacement bytes: PASS');

  // C. Empty findingTaskIds array -> rejected.
  {
    const instance = plainToInstance(SecurityRemediationRevalidateBatchDto, {
      projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', findingTaskIds: [], expectedCandidateIdentity: 'a'.repeat(64),
    });
    const errors = await validate(instance, { whitelist: true });
    assert.ok(errors.length > 0, 'empty findingTaskIds must be rejected');
  }
  console.log('security-remediation-revalidate-batch.dto C) empty findingTaskIds -> rejected: PASS');

  // D. Malformed expectedCandidateIdentity (not 64-hex) -> rejected.
  {
    const instance = plainToInstance(SecurityRemediationRevalidateBatchDto, {
      projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', findingTaskIds: ['af1d6556-b782-4faf-b01b-4e87b119d033'], expectedCandidateIdentity: 'not-a-hash',
    });
    const errors = await validate(instance, { whitelist: true });
    assert.ok(errors.length > 0, 'malformed expectedCandidateIdentity must be rejected');
  }
  console.log('security-remediation-revalidate-batch.dto D) malformed expectedCandidateIdentity -> rejected: PASS');

  // E. Non-UUID entries in findingTaskIds -> rejected.
  {
    const instance = plainToInstance(SecurityRemediationRevalidateBatchDto, {
      projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', findingTaskIds: ['not-a-uuid'], expectedCandidateIdentity: 'a'.repeat(64),
    });
    const errors = await validate(instance, { whitelist: true });
    assert.ok(errors.length > 0, 'non-UUID findingTaskIds entries must be rejected');
  }
  console.log('security-remediation-revalidate-batch.dto E) non-UUID entries in findingTaskIds -> rejected: PASS');

  console.log('security-remediation-revalidate-batch.dto.spec.ts: ALL CHECKS PASS');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
