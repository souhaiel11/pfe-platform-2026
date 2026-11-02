// Teste le reclassement en « action humaine » des constats refusés par le planificateur de WF2.
import * as assert from 'node:assert/strict';
import { isManualReviewFailure, reclassifyFindingsAsManual, WF2_MANUAL_REVIEW_CODE } from './wf2-manual-review';

// Le code dédié ou le drapeau de WF2 déclenchent le reclassement, jamais une panne générique.
assert.equal(isManualReviewFailure({ failureCode: WF2_MANUAL_REVIEW_CODE }), true);
assert.equal(isManualReviewFailure({ manualReviewRequired: true, failureCode: 'WF2_EXECUTION_ERROR' }), true);
assert.equal(isManualReviewFailure({ failureCode: 'WF2_EXECUTION_ERROR' }), false);
assert.equal(isManualReviewFailure({}), false);

// Toutes les copies du constat du lot sont reclassées ; les autres constats et scanners sont intacts.
const f = (id: string) => ({ id, rule: 'java:S2068', remediationType: 'AUTO_FIX_ELIGIBLE' });
const metadata = {
  title: 'x',
  enrichedData: {
    sonar: { total: 2, issues: [f('a'), f('b')] },
    stages: { sonar: { findings: [f('a'), f('b')] }, trivy: { findings: [] } },
    trivy: { findingCount: 0 },
  },
};
const out = reclassifyFindingsAsManual(metadata, ['a']);
for (const list of [out.enrichedData.sonar.issues, out.enrichedData.stages.sonar.findings]) {
  assert.equal(list[0].remediationType, 'DEVELOPER_ACTION_REQUIRED');
  assert.equal(list[0].remediationReason, WF2_MANUAL_REVIEW_CODE);
  assert.equal(list[1].remediationType, 'AUTO_FIX_ELIGIBLE');
}
assert.deepEqual(out.enrichedData.stages.trivy, { findings: [] });
assert.deepEqual(out.enrichedData.trivy, { findingCount: 0 });
assert.equal(metadata.enrichedData.sonar.issues[0].remediationType, 'AUTO_FIX_ELIGIBLE', 'entrée non mutée');

// Sans ids ou sans données enrichies : aucun changement.
const bare = { title: 'x' };
assert.equal(reclassifyFindingsAsManual(bare, []), bare);
assert.deepEqual(reclassifyFindingsAsManual(bare, ['a']), { title: 'x' });
console.log('wf2-manual-review: OK');
