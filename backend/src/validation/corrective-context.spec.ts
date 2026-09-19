import * as assert from 'node:assert/strict';
import { extractBlockingCauses, buildCorrectiveContext } from './corrective-context';

// BRIQUE 5 — pure extraction contract: never invents evidence, never mixes
// TARGET_FINDING_INVALID with NEW_BLOCKING_FINDING for the same record,
// carries line as supporting evidence only (never identity).

function main() {
  // A validation record shaped exactly like saveValidation() persists.
  const sha = 'a'.repeat(40);
  const cleanValidation = {
    checkoutSha: sha, analysisId: 'analysis-1',
    findingResults: [
      { findingId: 'a', result: 'VALID', evidence: 'a absent' },
      { findingId: 'b', result: 'VALID', evidence: 'b absent' },
    ],
    mergeAuthorization: { blockingReasons: [] },
    regression: { candidateSha: sha, blockingIntroducedFindings: [] },
  };
  assert.deepEqual(extractBlockingCauses(cleanValidation), [], 'no invalid finding, no blocking regression -> no causes');

  // CASE B-shaped: one INVALID target finding.
  const invalidValidation = {
    ...cleanValidation,
    findingResults: [
      { findingId: 'a', result: 'INVALID', evidence: 'sonar exact-sha a: issue still open' },
      { findingId: 'b', result: 'VALID', evidence: 'b absent' },
    ],
    mergeAuthorization: { blockingReasons: ['FINDING_INVALID'] },
  };
  const invalidCauses = extractBlockingCauses(invalidValidation);
  assert.equal(invalidCauses.length, 1);
  assert.equal(invalidCauses[0].type, 'TARGET_FINDING_INVALID');
  assert.equal(invalidCauses[0].findingId, 'a');
  assert.equal(invalidCauses[0].evidenceRef, 'sonar exact-sha a: issue still open');
  assert.equal(invalidCauses[0].candidateSha, sha);
  assert.equal(invalidCauses[0].scannerAnalysisId, 'analysis-1');

  // CASE A/C-shaped: a genuinely new blocking regression finding.
  const regressionValidation = {
    ...cleanValidation,
    mergeAuthorization: { blockingReasons: ['REGRESSION_CHANGES_REQUIRED'] },
    regression: {
      candidateSha: sha,
      blockingIntroducedFindings: [
        { source: 'SONARQUBE', rule: 'java:S9999', path: 'src/NewBug.java', line: 5, message: 'new issue', fingerprint: 'SONARQUBE::java:S9999::src/newbug.java' },
      ],
    },
  };
  const regressionCauses = extractBlockingCauses(regressionValidation);
  assert.equal(regressionCauses.length, 1);
  assert.equal(regressionCauses[0].type, 'NEW_BLOCKING_FINDING');
  assert.equal(regressionCauses[0].findingSource, 'SONARQUBE');
  assert.equal(regressionCauses[0].rule, 'java:S9999');
  assert.equal(regressionCauses[0].path, 'src/NewBug.java');
  assert.equal(regressionCauses[0].line, 5, 'line is carried as supporting evidence');
  assert.equal(regressionCauses[0].candidateSha, sha);
  // The fingerprint itself is never exposed as a business field here -- it
  // is purely an engine-internal identity concern, not causal-context evidence.
  assert.ok(!('fingerprint' in regressionCauses[0]));

  // Both kinds simultaneously: never conflated into a single generic cause.
  const bothValidation = {
    ...cleanValidation,
    findingResults: [{ findingId: 'a', result: 'INVALID', evidence: 'still open' }],
    mergeAuthorization: { blockingReasons: ['FINDING_INVALID', 'REGRESSION_CHANGES_REQUIRED'] },
    regression: regressionValidation.regression,
  };
  const bothCauses = extractBlockingCauses(bothValidation);
  assert.equal(bothCauses.length, 2);
  assert.deepEqual(bothCauses.map(c => c.type).sort(), ['NEW_BLOCKING_FINDING', 'TARGET_FINDING_INVALID']);

  // buildCorrectiveContext: preserves lineage-relevant fields, never invents.
  const ctx = buildCorrectiveContext({ previousAttempt: 1, validation: bothValidation });
  assert.equal(ctx.previousAttempt, 1);
  assert.equal(ctx.previousValidatedSha, sha);
  assert.equal(ctx.currentPrHeadSha, sha);
  assert.deepEqual(ctx.reasonCodes, ['FINDING_INVALID', 'REGRESSION_CHANGES_REQUIRED']);
  assert.equal(ctx.blockingCauses.length, 2);
  assert.deepEqual(ctx.originalFindingResults, [{ findingId: 'a', result: 'INVALID', evidence: 'still open' }]);

  // Malformed/absent validation never throws, never fabricates a cause.
  assert.deepEqual(extractBlockingCauses(null), []);
  assert.deepEqual(extractBlockingCauses({}), []);
  const emptyCtx = buildCorrectiveContext({ previousAttempt: 1, validation: {} });
  assert.deepEqual(emptyCtx.blockingCauses, []);
  assert.deepEqual(emptyCtx.reasonCodes, []);
  assert.deepEqual(emptyCtx.originalFindingResults, []);

  console.log('Corrective context extraction (Brique 5): PASS');

  // ══════════════════════════════════════════════════════════════════════
  // R68 — DEFAULT_VALUE_SEMANTICS_DEFECT cause extraction. Synthetic
  // evidence shape only (no rule/entity/field name from any real project) —
  // proves the generic contract, not a specific defect.
  // ══════════════════════════════════════════════════════════════════════
  const semanticEvidence = (over: any = {}) => ({
    sourceType: 'Widget', sourceField: 'mode', sourceDefault: 'Mode.STANDARD',
    candidateType: 'WidgetDto', candidateField: 'mode', candidateDefault: null,
    baselineAbsentBehavior: 'Field kept at its declared initializer: Mode.STANDARD',
    candidateAbsentBehavior: 'Field kept at the language default (no initializer), unconditionally propagated',
    mappingPath: 'WidgetService.update(Long, WidgetDto): existing.setMode(parseMode(updated.getMode()))',
    ...over,
  });
  const semanticValidation = (over: any = {}) => ({
    checkoutSha: sha,
    findingResults: [{ findingId: 'a', result: 'VALID', evidence: 'a' }, { findingId: 'b', result: 'VALID', evidence: 'b' }],
    mergeAuthorization: { blockingReasons: ['DEFAULT_VALUE_SEMANTICS_REGRESSION'] },
    regression: { candidateSha: sha, blockingIntroducedFindings: [] },
    defaultValueSemantics: { verdict: 'PROVEN_DEFECT', evaluatedSha: sha, evidence: [semanticEvidence()] },
    ...over,
  });

  // ── CASE A — PROVEN_DEFECT + matching SHA => semantic cause produced ────
  {
    const causes = extractBlockingCauses(semanticValidation());
    assert.equal(causes.length, 1);
    assert.equal(causes[0].type, 'DEFAULT_VALUE_SEMANTICS_DEFECT');
    assert.equal(causes[0].sourceType, 'Widget');
    assert.equal(causes[0].sourceField, 'mode');
    assert.equal(causes[0].sourceDefault, 'Mode.STANDARD');
    assert.equal(causes[0].candidateType, 'WidgetDto');
    assert.equal(causes[0].candidateField, 'mode');
    assert.equal(causes[0].candidateDefault, null);
    assert.match(causes[0].baselineAbsentBehavior!, /Mode\.STANDARD/);
    assert.match(causes[0].mappingPath!, /WidgetService\.update/);
    assert.ok(causes[0].behavioralInvariant && causes[0].behavioralInvariant.length > 0);
    // Generic guidance, never a hardcoded implementation line.
    assert.doesNotMatch(causes[0].behavioralInvariant!, /private\s+\w+.*=.*;/);
    assert.equal(causes[0].candidateSha, sha);
  }

  // ── CASE B — NO_DEFECT => no semantic cause ─────────────────────────────
  {
    const v = semanticValidation({ defaultValueSemantics: { verdict: 'NO_DEFECT', evaluatedSha: sha, evidence: [] } });
    assert.deepEqual(extractBlockingCauses(v).filter(c => c.type === 'DEFAULT_VALUE_SEMANTICS_DEFECT'), []);
  }

  // ── CASE C — VERIFICATION_REQUIRED => no semantic cause ─────────────────
  {
    const v = semanticValidation({ defaultValueSemantics: { verdict: 'VERIFICATION_REQUIRED', evaluatedSha: sha, evidence: [] } });
    assert.deepEqual(extractBlockingCauses(v).filter(c => c.type === 'DEFAULT_VALUE_SEMANTICS_DEFECT'), []);
  }

  // ── CASE D — PROVEN_DEFECT but evaluatedSha stale => no semantic cause,
  // fails safely rather than misattributing evidence to the wrong SHA ─────
  {
    const v = semanticValidation({ defaultValueSemantics: { verdict: 'PROVEN_DEFECT', evaluatedSha: 'f'.repeat(40), evidence: [semanticEvidence()] } });
    assert.deepEqual(extractBlockingCauses(v).filter(c => c.type === 'DEFAULT_VALUE_SEMANTICS_DEFECT'), []);
  }

  // ── CASE E — blocking reason absent => no semantic cause (mergeAuthorization
  // didn't actually block on this signal, even though the detector ran) ───
  {
    const v = semanticValidation({ mergeAuthorization: { blockingReasons: [] } });
    assert.deepEqual(extractBlockingCauses(v).filter(c => c.type === 'DEFAULT_VALUE_SEMANTICS_DEFECT'), []);
  }

  // ── CASE F — duplicate semantic evidence => deterministic dedup ─────────
  {
    const v = semanticValidation({ defaultValueSemantics: { verdict: 'PROVEN_DEFECT', evaluatedSha: sha, evidence: [semanticEvidence(), semanticEvidence()] } });
    const causes = extractBlockingCauses(v).filter(c => c.type === 'DEFAULT_VALUE_SEMANTICS_DEFECT');
    assert.equal(causes.length, 1, 'identical evidence must not produce duplicate causes');
  }
  {
    // Two DIFFERENT fields must NOT be deduped into one.
    const v = semanticValidation({ defaultValueSemantics: { verdict: 'PROVEN_DEFECT', evaluatedSha: sha, evidence: [semanticEvidence(), semanticEvidence({ sourceField: 'other', candidateField: 'other' })] } });
    const causes = extractBlockingCauses(v).filter(c => c.type === 'DEFAULT_VALUE_SEMANTICS_DEFECT');
    assert.equal(causes.length, 2, 'genuinely distinct evidence must both be kept');
  }

  // ── CASE G — existing INVALID finding cause unchanged (already proven
  // above by the pre-existing, untouched assertions; re-affirmed here in
  // combination with a semantic cause, see CASE I) ────────────────────────
  // ── CASE H — existing regression finding cause unchanged (same) ─────────

  // ── CASE I — semantic cause + scanner cause => both preserved, never
  // conflated, never one dropped in favor of the other ────────────────────
  {
    const v = semanticValidation({
      findingResults: [{ findingId: 'a', result: 'INVALID', evidence: 'still open' }],
      mergeAuthorization: { blockingReasons: ['FINDING_INVALID', 'DEFAULT_VALUE_SEMANTICS_REGRESSION'] },
    });
    const causes = extractBlockingCauses(v);
    assert.equal(causes.length, 2);
    assert.deepEqual(causes.map(c => c.type).sort(), ['DEFAULT_VALUE_SEMANTICS_DEFECT', 'TARGET_FINDING_INVALID']);
    const ctx = buildCorrectiveContext({ previousAttempt: 1, validation: v });
    assert.equal(ctx.blockingCauses.length, 2);
  }

  // ── CASE J — missing required evidence fields => no fabricated cause ────
  for (const missingField of ['sourceType', 'sourceField', 'candidateType', 'candidateField', 'baselineAbsentBehavior', 'candidateAbsentBehavior', 'mappingPath']) {
    const evidence = semanticEvidence({ [missingField]: undefined });
    const v = semanticValidation({ defaultValueSemantics: { verdict: 'PROVEN_DEFECT', evaluatedSha: sha, evidence: [evidence] } });
    const causes = extractBlockingCauses(v).filter(c => c.type === 'DEFAULT_VALUE_SEMANTICS_DEFECT');
    assert.deepEqual(causes, [], `missing ${missingField} must not fabricate a cause`);
  }

  // Malformed defaultValueSemantics never throws, never fabricates.
  assert.deepEqual(extractBlockingCauses({ checkoutSha: sha, defaultValueSemantics: null }).filter(c => c.type === 'DEFAULT_VALUE_SEMANTICS_DEFECT'), []);
  assert.deepEqual(extractBlockingCauses({ checkoutSha: sha, defaultValueSemantics: {} }).filter(c => c.type === 'DEFAULT_VALUE_SEMANTICS_DEFECT'), []);

  console.log('Corrective context extraction (R68 default-value-semantics cause): PASS');
}

main();
