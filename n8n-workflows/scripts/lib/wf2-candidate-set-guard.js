// Embedded verbatim in Prepare Candidate Manifest; execution-local inputs only.
const validatedPlan = $('Validate Generic Remediation Plan').all().map(item => item.json);
const expected = validatedPlan[0]?.plannedFiles || [];
const canonicalPath = value => {
  const raw = String(value || '').replace(/\\/g, '/');
  const parts = raw.split('/');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || /[\0-\x1f]/.test(raw) || parts.includes('.') || parts.includes('..')) return null;
  return parts.filter(Boolean).join('/');
};
const expectedPaths = expected.map(file => canonicalPath(file.path));
const actualPaths = items.map(file => canonicalPath(file.targetFile || file.target_file_path || file.file_path));
const expectedSet = new Set(expectedPaths);
const actualSet = new Set(actualPaths);
const missingPaths = expectedPaths.filter(path => !actualSet.has(path));
const unexpectedPaths = actualPaths.filter(path => !expectedSet.has(path));
const failCandidateSet = code => {
  // Only counts and bounded path lists; never include candidate/source/error objects.
  const bounded = paths => [...new Set(paths)].slice(0, 12).map(path => String(path || '<invalid-path>').slice(0, 240));
  throw new Error(code + ':' + JSON.stringify({plannedCount: expected.length, generatedCount: items.length,
    missingPaths: bounded(missingPaths), unexpectedPaths: bounded(unexpectedPaths)}));
};
if (!expected.length || expectedPaths.includes(null) || actualPaths.includes(null) ||
    items.length !== expected.length || expectedSet.size !== expected.length || actualSet.size !== items.length ||
    missingPaths.length || unexpectedPaths.length) failCandidateSet('CANDIDATE_SET_INCOMPLETE');
for (let index = 0; index < items.length; index++) {
  const item = items[index];
  const planned = expected.find(file => canonicalPath(file.path) === actualPaths[index]);
  const aliases = [item.targetFile, item.target_file_path, item.file_path].filter(value => value != null);
  if (aliases.some(value => canonicalPath(value) !== actualPaths[index]) ||
      !['CREATE', 'MODIFY'].includes(planned.operation) || item.fileOperation !== planned.operation)
    failCandidateSet('CANDIDATE_SET_INCOMPLETE');
  if (item.genericPreflightPassed !== true || !String(item.patchedCode || '').trim() ||
      !/^[a-f0-9]{64}$/.test(String(item.contentSha256 || '')))
    failCandidateSet('CANDIDATE_SET_PREFLIGHT_FAILED');
  if (item.candidateBaseSha !== candidateBaseSha || item.branchExists !== branchExists)
    failCandidateSet('CANDIDATE_SET_BASE_MISMATCH');
}
