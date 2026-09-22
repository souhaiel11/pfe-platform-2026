import * as assert from 'node:assert/strict';
import { parseFixedVersions } from './fixed-version-normalizer';

// Single value — the shape observed for every Trivy-sourced fixedVersion in
// this platform's seed data (backend/src/seed/seed-data.ts).
{
  assert.deepEqual(parseFixedVersions('9.0.99'), ['9.0.99'], 'single value stays a single-element array');
}

// REAL, PERSISTED multi-value example (not invented): this platform's own
// Postgres, project pfe-app-test, CVE-2023-6378 on
// ch.qos.logback:logback-classic actually stores this exact string.
{
  assert.deepEqual(
    parseFixedVersions('1.3.12, 1.4.12, 1.2.13'),
    ['1.3.12', '1.4.12', '1.2.13'],
    'REAL persisted Trivy multi-value fixedVersion (CVE-2023-6378, logback-classic) splits and trims correctly',
  );
}

// No leading space after comma (defensive — real data has ", " but must not
// depend on that exact spacing).
{
  assert.deepEqual(parseFixedVersions('1.2.13,1.3.12'), ['1.2.13', '1.3.12'], 'splits correctly with no space after comma too');
}

// null / undefined / empty -> empty array, never a fabricated entry.
{
  assert.deepEqual(parseFixedVersions(null), [], 'null -> []');
  assert.deepEqual(parseFixedVersions(undefined), [], 'undefined -> []');
  assert.deepEqual(parseFixedVersions(''), [], 'empty string -> []');
  assert.deepEqual(parseFixedVersions('   '), [], 'whitespace-only -> []');
}

// Trailing/stray commas never produce an empty-string entry.
{
  assert.deepEqual(parseFixedVersions('1.2.13,'), ['1.2.13'], 'trailing comma does not produce an empty element');
  assert.deepEqual(parseFixedVersions(',1.2.13'), ['1.2.13'], 'leading comma does not produce an empty element');
}

console.log('fixed-version-normalizer: PASS (single value, REAL persisted multi-value fixture, edge cases)');
