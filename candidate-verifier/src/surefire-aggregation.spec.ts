import * as assert from 'node:assert/strict';
import { aggregateSurefireText } from './surefire-aggregation';

// Same proven-live bug as R22-A's Shared Library fix (BuildRunner.groovy):
// summing every "Tests run:" line, never just the last one.
const fourClasses = [
  'Tests run: 10, Failures: 0, Errors: 0, Skipped: 0',
  'Tests run: 5, Failures: 0, Errors: 0, Skipped: 0',
  'Tests run: 4, Failures: 0, Errors: 0, Skipped: 0',
  'Tests run: 3, Failures: 0, Errors: 0, Skipped: 0',
].join('\n');

{
  const aggregate = aggregateSurefireText(fourClasses);
  assert.equal(aggregate.total, 22, 'sums all 4 classes (22), not just the last line (3) -- the exact PR-25 build #3 bug');
  assert.equal(aggregate.matchCount, 4);
  assert.equal(aggregate.failures, 0);
}

{
  const withFailures = [
    'Tests run: 10, Failures: 1, Errors: 0, Skipped: 0',
    'Tests run: 5, Failures: 0, Errors: 1, Skipped: 2',
  ].join('\n');
  const aggregate = aggregateSurefireText(withFailures);
  assert.equal(aggregate.total, 15);
  assert.equal(aggregate.failures, 1);
  assert.equal(aggregate.errors, 1);
  assert.equal(aggregate.skipped, 2);
}

{
  const aggregate = aggregateSurefireText('');
  assert.equal(aggregate.matchCount, 0, 'no surefire output at all yields matchCount 0, never a fabricated total');
}

console.log('surefire-aggregation: PASS');
