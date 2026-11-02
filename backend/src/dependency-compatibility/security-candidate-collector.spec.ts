// Teste le composant « security-candidate-collector » et ses cas d’erreur.
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeOwaspFinding } from '../common/owasp-finding-normalizer';
import { TrivyCorrelationCandidateProvider, collectSecurityCandidates } from './security-candidate-collector';

const FIXTURES = join(__dirname, '../common/fixtures');
const owaspFixture = JSON.parse(readFileSync(join(FIXTURES, 'owasp-149-dependencies.json'), 'utf8'));
const trivyFixture = JSON.parse(readFileSync(join(FIXTURES, 'trivy-149-cves.json'), 'utf8'));
const owaspFindings = owaspFixture.dependencies.flatMap((d: any) => d.vulnerabilities.map((v: any) => normalizeOwaspFinding(d, v)));

const trivyProvider = new TrivyCorrelationCandidateProvider(trivyFixture.cves);

// CASE 3 — MULTIPLE_CANDIDATES: real case, CVE-2024-22259/spring-web@5.3.20,
// Trivy's own FixedVersion is a comma-joined multi-value string. Must yield
// MULTIPLE distinct SecurityCandidate entries, never one chosen arbitrarily.
{
  const finding = owaspFindings.find((f: any) => f.id === 'CVE-2024-22259' && f.pkg === 'org.springframework:spring-web');
  assert.ok(finding, 'real report #149 must contain this exact multi-candidate case');
  const candidates = collectSecurityCandidates({ cve: finding.id, pkg: finding.pkg, installedVersion: finding.installedVersion }, [trivyProvider]);
  assert.ok(candidates.length > 1, `expected multiple candidates, got ${candidates.length}`);
  const versions = candidates.map(c => c.version);
  assert.equal(new Set(versions).size, versions.length, 'no duplicate versions');
  for (const c of candidates) {
    assert.equal(c.source, 'TRIVY');
    assert.equal(c.evidenceType, 'TRIVY_CORRELATED_MULTI');
    assert.ok(c.rawEvidence, 'every candidate must carry traceable raw evidence');
  }
  console.log('CASE 3 (MULTIPLE_CANDIDATES, CVE-2024-22259/spring-web):', versions.join(', '));
}
console.log('CASE 3 (MULTIPLE_CANDIDATES) -> multiple distinct candidates, never collapsed: PASS');

// CASE 4 — NO_TRIVY_MATCH: pick a real OWASP finding with zero Trivy
// correlation. Must yield zero candidates (SECURITY_TARGET_UNKNOWN
// territory), never an invented target.
{
  let found: any = null;
  for (const f of owaspFindings) {
    const candidates = collectSecurityCandidates({ cve: f.id, pkg: f.pkg, installedVersion: f.installedVersion }, [trivyProvider]);
    if (candidates.length === 0) { found = f; break; }
  }
  assert.ok(found, 'real report #149 must contain at least one NO_TRIVY_MATCH finding');
  const candidates = collectSecurityCandidates({ cve: found.id, pkg: found.pkg, installedVersion: found.installedVersion }, [trivyProvider]);
  assert.equal(candidates.length, 0);
  console.log('CASE 4 (NO_TRIVY_MATCH sample):', found.id, found.pkg);
}
console.log('CASE 4 (NO_TRIVY_MATCH) -> zero candidates, never invented: PASS');

// Full report #149 sanity: reproduce the already-validated 13/44/89 split at
// the candidate-count level (>=1 candidate == the 13+44 that have SOME
// Trivy evidence; 0 candidates == the 89 with none).
{
  let withCandidates = 0, withoutCandidates = 0;
  for (const f of owaspFindings) {
    const n = collectSecurityCandidates({ cve: f.id, pkg: f.pkg, installedVersion: f.installedVersion }, [trivyProvider]).length;
    if (n > 0) withCandidates++; else withoutCandidates++;
  }
  assert.equal(owaspFindings.length, 146);
  assert.equal(withCandidates, 57, '13 SINGLE_EXACT + 44 MULTIPLE_CANDIDATES = 57 findings with at least one candidate');
  assert.equal(withoutCandidates, 89);
}
console.log('report #149 full 146-finding sweep: 57 with candidates (13+44), 89 without: PASS');

console.log('security-candidate-collector.spec.ts: ALL CHECKS PASS');
