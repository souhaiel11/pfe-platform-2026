import * as assert from 'node:assert/strict';
import { deriveFindingsAndHealth } from './finding-pipeline-separation';

// Fixtures are the REAL persisted metadata.validation payloads observed this
// session (R21-AY/R21-AZ), trimmed to the fields deriveFindingsAndHealth
// reads. Build #2: docker/build FAILED, both S4684 findings still VALID.
// Build #3: build/docker SUCCESS, but Sonar Quality Gate ERROR, findings
// still VALID. These are the two real-world proofs that finding verdicts
// and pipeline health are already independent in production data -- this
// module just makes that independence an explicit, typed contract.
const build2Payload = {
  analysisId: '23b330da-e3a9-4469-a8a3-cb4bdbe9873c',
  checkoutSha: 'ea6230b79b99f0c5fcb3c7da3f838bb3efbe81be',
  sonarStatus: 'OK',
  technicalFailure: null,
  requiredStagesStatus: 'FAILED',
  buildStageStatus: { build: 'FAILED', tests: 'UNKNOWN', sonar: 'SUCCESS', docker: 'FAILED', trivy: 'COMPLETED', owasp: 'COMPLETED', zap: 'NOT_RUN' },
  findingResults: [
    { result: 'VALID', findingId: 'b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', evidence: 'Sonar Community exact-SHA validation 23b330da... at ea6230b7...: approved finding absent' },
    { result: 'VALID', findingId: 'f11d4686-a7ba-4c0c-abbb-a12998c57220', evidence: 'Sonar Community exact-SHA validation 23b330da... at ea6230b7...: approved finding absent' },
  ],
};

const build3Payload = {
  analysisId: '8a4c16d3-5ebd-4d13-a699-df1264f8f958',
  checkoutSha: '8a315b0dd508eb9843bb3037fe2827f02f6faa78',
  sonarStatus: 'ERROR',
  technicalFailure: null,
  requiredStagesStatus: 'PASSED',
  buildStageStatus: { build: 'SUCCESS', tests: 'SUCCESS', sonar: 'SUCCESS', docker: 'SUCCESS', trivy: 'COMPLETED', owasp: 'COMPLETED', zap: 'NOT_RUN' },
  findingResults: [
    { result: 'VALID', findingId: 'b8db9c11-ddf9-4a23-9bf3-1d2ff15a59ef', evidence: 'Sonar Community exact-SHA validation 8a4c16d3... at 8a315b0d...: approved finding absent' },
    { result: 'VALID', findingId: 'f11d4686-a7ba-4c0c-abbb-a12998c57220', evidence: 'Sonar Community exact-SHA validation 8a4c16d3... at 8a315b0d...: approved finding absent' },
  ],
};

// --- Test 7 (Phase 9): a VALID finding survives PipelineHealth FAIL ---
{
  const { findings, pipelineHealth } = deriveFindingsAndHealth(build2Payload);
  assert.equal(pipelineHealth.build, 'FAILED', 'build #2: pipeline health reports the real build failure');
  assert.equal(pipelineHealth.requiredStagesStatus, 'FAILED', 'build #2: pipeline health reports overall stage failure');
  assert.equal(findings.length, 2, 'build #2: both approved findings present');
  assert.ok(findings.every(f => f.verdict === 'VALID'), 'Test 7 - both findings remain VALID despite pipelineHealth.build=FAILED');
}

// --- Test 8 (Phase 9): pipeline PASS alone cannot create finding VALID ---
// (i.e. the derivation never substitutes pipeline health for a missing
// finding result -- absence of findingResults must yield zero findings, not
// a fabricated VALID because the pipeline succeeded)
{
  const allGreenNoFindings = { ...build3Payload, findingResults: [] };
  const { findings, pipelineHealth } = deriveFindingsAndHealth(allGreenNoFindings);
  assert.equal(pipelineHealth.build, 'SUCCESS', 'sanity: pipeline is healthy in this fixture');
  assert.equal(findings.length, 0, 'Test 8 - a healthy pipeline with zero scanner-produced results yields zero findings, never a fabricated VALID');
}

// --- Independence in the other direction: Sonar QG ERROR (build #3) does not flip findings to INVALID/INCONCLUSIVE ---
{
  const { findings, pipelineHealth } = deriveFindingsAndHealth(build3Payload);
  assert.equal(pipelineHealth.sonarQualityGate, 'ERROR', 'build #3: pipeline health reports the real Quality Gate ERROR');
  assert.ok(findings.every(f => f.verdict === 'VALID'), 'build #3: findings remain VALID despite pipelineHealth.sonarQualityGate=ERROR');
  assert.equal(findings[0].validatedSha, '8a315b0dd508eb9843bb3037fe2827f02f6faa78', 'finding carries the exact validated SHA');
  assert.equal(findings[0].analysisId, '8a4c16d3-5ebd-4d13-a699-df1264f8f958', 'finding carries the exact Sonar analysisId');
}

// --- Malformed/absent input never throws, never fabricates ---
{
  const { findings, pipelineHealth } = deriveFindingsAndHealth(undefined);
  assert.deepEqual(findings, [], 'undefined input yields empty findings, never throws');
  assert.equal(pipelineHealth.build, 'UNKNOWN', 'undefined input yields UNKNOWN health fields, never a fabricated status');
}
{
  const { findings } = deriveFindingsAndHealth({ findingResults: [{ findingId: 'x', result: 'garbage' }] });
  assert.equal(findings[0].verdict, 'INCONCLUSIVE', 'an unrecognized raw result degrades to INCONCLUSIVE, never VALID/INVALID by default');
}

console.log('Finding/PipelineHealth separation: PASS');
