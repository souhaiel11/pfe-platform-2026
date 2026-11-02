const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const runtimeRequire = createRequire('/app/package.json');
runtimeRequire('reflect-metadata');
const path = '/app/dist/manual-remediation/security-remediation-lifecycle.js';
const lifecycle = runtimeRequire(path);
const servicePath = '/app/dist/manual-remediation/manual-remediation.service.js';
const serviceSource = fs.readFileSync(servicePath, 'utf8');
for (const [, name] of serviceSource.matchAll(/security_remediation_lifecycle_1\.(\w+)/g)) {
  assert.notEqual(typeof lifecycle[name], 'undefined', `Missing lifecycle export: ${name}`);
}
const guard = lifecycle.assertSecurityRemediationDispatchEnabled;
const targets = runtimeRequire('/app/dist/manual-remediation/remediation-target-reservation.js');
const target = targets.productionTarget({projectId:'cd0efa6d-ac13-4dd8-a117-4933527d9c86',findingSnapshot:{component:'org.example:library'}});
assert.equal(target.targetKey, JSON.stringify(['v1','FILE','pom.xml']));
assert.equal(target.targetType, 'FILE');
assert.equal(target.trustedTargetPath, 'pom.xml');
assert.throws(() => targets.productionTarget({projectId:target.projectId,findingSnapshot:{component:'invalid'}}));
const previous = process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED;
async function main() {
  try {
    for (const value of [undefined, 'true', ' TRUE ']) {
      if (value === undefined) delete process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED;
      else process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED = value;
      assert.doesNotThrow(guard);
    }
    for (const value of ['false', '', 'invalid']) {
      process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED = value;
      assert.throws(guard, error => error.getStatus() === 503 && error.getResponse().code === 'SECURITY_REMEDIATION_TEMPORARILY_DISABLED');
    }
    const { ManualRemediationService } = runtimeRequire(servicePath);
    process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED = 'true';
    let reachedTransaction = false;
    const context = { repo: { manager: { transaction: async callback => {
      reachedTransaction = true;
      return callback({ getRepository: () => ({ findOne: async () => null }) });
    } } } };
    await assert.rejects(ManualRemediationService.prototype.launchBatchRemediation.call(context,
      '00000000-0000-4000-8000-000000000000', [], { role: 'developer' }), error => error.getStatus() === 404);
    assert.equal(reachedTransaction, true, 'Launch must pass the dispatch guard');
    console.log('PASS: runtime export contract, enabled/disabled guard, deployed launch method; no DB/network writes');
  } finally {
    if (previous === undefined) delete process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED;
    else process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED = previous;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
