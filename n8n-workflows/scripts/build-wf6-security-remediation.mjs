#!/usr/bin/env node
// V1.6. Offline only. Fixed IDs/order, no clock, no network, no import.
// Code nodes validate transport/trust boundaries; they never author a patch.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../pending-live-update/wf6-security-remediation-maven.OFFLINE-DRAFT.json', import.meta.url));
// Stable public references read from live WF6 and the established WF1 header-auth
// webhook. Credential data stays in n8n storage; never export/decrypt it here.
const githubCredential = { id: 'YBO0vWrPlyoYx4Kr', name: 'GitHub n8n' };
const inboundCredential = { id: 'c94e1a451dec86a4a7a351d4', name: 'Jenkins WF1 Callback' };
const nodes = [], connections = {};
const expr = s => '={{ ' + s + ' }}';
const ref = name => `$("${name}").first().json`;
const C = ref('Trusted Candidate');
const F = `${C}.candidateManifest.files[0]`;
const github = `"https://api.github.com/repos/" + ${C}.repository`;
const sha = value => `/^[0-9a-f]{40}$/.test(${value} || '')`;
function add(name, type, parameters, version = 1, extra = {}) {
  nodes.push({ id: `wf6-n${String(nodes.length + 1).padStart(3, '0')}`, name,
    type: `n8n-nodes-base.${type}`, typeVersion: version,
    position: [(nodes.length % 8) * 300, Math.floor(nodes.length / 8) * 200], parameters, ...extra });
  return name;
}
function link(from, to, port = 0) {
  const main = (connections[from] ||= { main: [] }).main;
  while (main.length <= port) main.push([]);
  main[port].push({ node: to, type: 'main', index: 0 });
}
function code(name, source) {
  return add(name, 'code', { mode: 'runOnceForAllItems', jsCode:
    `try {\n${source}\n} catch { return [{json: {ok: false}}]; }` }, 2, { continueOnFail: true });
}
function gate(name, condition, failure) {
  const n = add(name, 'if', { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: name, leftValue: expr(`Boolean(${condition})`), rightValue: true,
      operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} }, 2.2);
  link(n, failure, 1); return n;
}
function response(name, state, fields = '') {
  return add(name, 'respondToWebhook', { respondWith: 'json', responseBody: expr(`({state: "${state}"${fields}})`), options: {} }, 1.1);
}
const failures = new Map();
function fail(failureClass) {
  if (!failures.has(failureClass)) failures.set(failureClass,
    response(`Respond - ${failureClass}`, 'TECHNICAL_FAILURE', `, failureClass: "${failureClass}"`));
  return failures.get(failureClass);
}
const notEligible = response('Respond - Not Eligible', 'NOT_ELIGIBLE');
const drifted = response('Respond - Candidate Drifted', 'CANDIDATE_DRIFTED');
const baseMissing = response('Respond - Base SHA Unresolvable', 'BASE_SHA_UNRESOLVABLE');
const branchConflict = response('Respond - Branch Content Conflict', 'BRANCH_CONTENT_CONFLICT');
const writeConflict = response('Respond - Write Conflict', 'WRITE_CONFLICT');
function http(name, method, url, body, backend = false) {
  return add(name, 'httpRequest', {
    method, url: expr(url), sendHeaders: true,
    headerParameters: { parameters: backend
      ? [{ name: 'X-Internal-Secret', value: '={{$env.N8N_INTERNAL_SECRET}}' }]
      : [{ name: 'Accept', value: 'application/vnd.github+json' }] },
    ...(!backend ? { authentication: 'predefinedCredentialType', nodeCredentialType: 'githubApi' } : {}),
    ...(body ? { sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr(body) } : {}),
    options: { response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
      redirect: { redirect: { followRedirects: false } }, timeout: 30000 },
  }, 4.2, { continueOnFail: true, retryOnFail: false, ...(!backend ? { credentials: { githubApi: githubCredential } } : {}),
    notes: 'Full response keeps arrays in body (including empty PR lists). HTTP and transport errors are explicitly gated. No redirect or automatic retry.' });
}
function get(name, tail, previous, failure = fail('GITHUB_READ_FAILED')) {
  const n = http(name, 'GET', `${github} + ${tail}`);
  if (previous) link(previous, n);
  const ok = gate(`${name} OK?`, '$json.statusCode === 200 && !$json.error', failure);
  link(n, ok); return ok;
}
const webhook = add('Webhook - Security Remediation Request', 'webhook', {
  httpMethod: 'POST', path: 'wf6-security-remediation-evaluate', authentication: 'headerAuth', responseMode: 'responseNode', options: {},
}, 2, { credentials: { httpHeaderAuth: inboundCredential } });
const request = `({projectId: ${ref(webhook)}.body?.projectId, findingTaskId: ${ref(webhook)}.body?.findingTaskId})`;
const evaluate = http('Evaluate Security Remediation', 'POST', '$env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/evaluate"', request, true);
link(webhook, evaluate);
const evalOk = gate('Evaluation HTTP OK?', '$json.statusCode === 200 || $json.statusCode === 201', fail('EVALUATION_FAILED'));
link(evaluate, evalOk);
const technical = gate('Evaluation Not Technical Failure?', '$json.body?.status !== "TECHNICAL_FAILURE"', fail('EVALUATION_FAILED'));
link(evalOk, technical);
const eligible = gate('Candidate Ready?', '$json.body?.status === "CANDIDATE_READY"', notEligible);
link(technical, eligible);
const candidate = code('Trusted Candidate', `
const c = $json.body;
const f = c.candidateManifest?.files?.[0];
const ok = /^[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+$/.test(c.repository || '')
  && !c.repository.split('/').some(x => x === '.' || x === '..')
  && /^security\\/fix\\/[a-f0-9]{12}-[a-f0-9]{12}$/.test(c.branchName || '')
  && /^[a-f0-9]{64}$/.test(c.candidateIdentity || '')
  && ${sha('c.decision?.evaluatedSha')}
  && c.candidateManifest.files.length === 1 && f.operation === 'MODIFY'
  && typeof f.path === 'string' && /(^|\\/)pom\\.xml$/.test(f.path)
  && !f.path.startsWith('/') && !f.path.split('/').some(x => x === '..' || x === '.')
  && typeof f.content === 'string' && ${sha('f.originalBlobSha')}
  && ['commitMessage', 'prTitle', 'prBody'].every(k => typeof c[k] === 'string' && c[k].length > 0);
// No raw GitHub metadata is ever spread into this candidate.
return [{json: {...c, ok, writeContentBase64: ok ? Buffer.from(f.content, 'utf8').toString('base64') : null}}];`);
link(eligible, candidate);
const candidateOk = gate('Trusted Candidate Valid?', '$json.ok === true', fail('INVALID_CANDIDATE'));
link(candidate, candidateOk);
const base = get('Verify Base Commit Still Exists', `"/commits/" + ${C}.decision.evaluatedSha`, candidateOk, baseMissing);
const baseOk = gate('Base SHA Resolvable?', `$json.body?.sha === ${C}.decision.evaluatedSha && ${sha('$json.body?.commit?.tree?.sha')}`, baseMissing);
link(base, baseOk);

// Snapshot default name + exact tip. Later snapshots may advance the tip but
// must retain the original default name and evaluatedSha ancestry. Direction
// is evaluatedSha...defaultBranchTipSha, so only ahead/identical are valid.
function resolveBase(prefix, previous, repeat = false) {
  const metadata = get(`${prefix} Repository Metadata`, '""', previous, fail('DEFAULT_BRANCH_UNRESOLVABLE'));
  const extract = code(`${prefix} Trusted Default Branch`, `
const name = $json.body?.default_branch;
const ok = typeof name === 'string' && name.length > 0 && name.length <= 255
  && !/[\\s\\x00-\\x1f\\x7f~^:?*\\[\\\\]/.test(name) && !name.includes('..')
  ${repeat ? `&& name === ${ref('Initial Trusted Default Branch')}.repositoryDefaultBranch` : ''};
return [{json: {ok, repositoryDefaultBranch: ok ? name : null}}];`);
  link(metadata, extract);
  const valid = gate(`${prefix} Default Branch Valid?`, '$json.ok === true', fail(repeat ? 'DEFAULT_BRANCH_DRIFTED' : 'DEFAULT_BRANCH_UNRESOLVABLE'));
  link(extract, valid);
  const branch = ref(`${prefix} Trusted Default Branch`);
  const head = get(`${prefix} Default Branch Head`, `"/git/ref/heads/" + encodeURIComponent(${branch}.repositoryDefaultBranch)`, valid, fail('DEFAULT_BRANCH_UNRESOLVABLE'));
  const headValid = gate(`${prefix} Head Valid?`, `$json.body?.ref === "refs/heads/" + ${branch}.repositoryDefaultBranch && $json.body?.object?.type === "commit" && ${sha('$json.body?.object?.sha')}`, fail('DEFAULT_BRANCH_UNRESOLVABLE'));
  link(head, headValid);
  const headRef = ref(`${prefix} Default Branch Head`);
  const compare = get(`${prefix} Compare Ancestry`, `"/compare/" + ${C}.decision.evaluatedSha + "..." + ${headRef}.body.object.sha`, headValid, fail('ANCESTRY_UNRESOLVABLE'));
  const evidence = code(`${prefix} Ancestry Evidence`, `
const b = $json.body;
const evaluatedSha = ${C}.decision.evaluatedSha;
const repositoryDefaultBranchHeadSha = ${headRef}.body.object.sha;
const valid = ['ahead', 'identical'].includes(b?.status)
  && b.base_commit?.sha === evaluatedSha && b.merge_base_commit?.sha === evaluatedSha
  && (b.status !== 'identical' || evaluatedSha === repositoryDefaultBranchHeadSha);
return [{json: {ok: valid, repositoryDefaultBranch: ${branch}.repositoryDefaultBranch,
 repositoryDefaultBranchHeadSha, PR_BASE_BRANCH: ${branch}.repositoryDefaultBranch,
 PR_BASE_HEAD_SHA: repositoryDefaultBranchHeadSha, EVALUATED_SHA: evaluatedSha,
 ANCESTRY_COMPARE_DIRECTION: 'evaluatedSha...defaultBranchTipSha',
 ANCESTRY_STATUS: ['ahead', 'identical', 'behind', 'diverged'].includes(b?.status) ? b.status : 'unknown',
 ANCESTRY_VALID: valid ? 'YES' : 'NO'}}];`);
  link(compare, evidence);
  const ancestryOk = gate(`${prefix} Ancestry Valid?`, '$json.ok === true', fail('ANCESTRY_INVALID'));
  link(evidence, ancestryOk); return ancestryOk;
}
function revalidate(label, previous) {
  const n = http(`Revalidate Before Write (${label})`, 'POST', '$env.BACKEND_INTERNAL_URL + "/api/internal/security-remediation/revalidate"',
    `({...${request}, expectedCandidateIdentity: ${C}.candidateIdentity})`, true);
  if (previous) link(previous, n);
  const ok = gate(`Revalidation HTTP OK? (${label})`, '($json.statusCode === 200 || $json.statusCode === 201) && !$json.error', fail('REVALIDATION_FAILED'));
  link(n, ok);
  const tech = gate(`Revalidation Not Technical? (${label})`, '$json.body?.status !== "TECHNICAL_FAILURE"', fail('REVALIDATION_FAILED'));
  link(ok, tech);
  const valid = code(`Fresh Candidate Matches (${label})`, `
const c = ${C}, fresh = $json.body;
const a = c.candidateManifest.files[0], b = fresh?.candidateManifest?.files?.[0];
const ok = fresh?.status === 'WRITE_AUTHORIZED' && fresh.repository === c.repository
 && fresh.branchName === c.branchName && fresh.candidateIdentity === c.candidateIdentity
 && fresh.decision?.evaluatedSha === c.decision.evaluatedSha
 && fresh.candidateManifest?.files?.length === 1
 && ['path','operation','content','originalBlobSha'].every(k => b?.[k] === a[k]);
return [{json: {ok}}];`);
  link(tech, valid);
  const allowed = gate(`Write Authorized? (${label})`, '$json.ok === true', drifted);
  link(valid, allowed); return allowed;
}

// V1.6 lifecycle and immutable-proof builders follow.

const headMismatch = response('Respond - PR Head SHA Mismatch', 'PR_HEAD_SHA_MISMATCH');
// This function is used by historical and post-write proof paths; same exact
// tree/blob policy, immutable head commit lookup, no version-only shortcuts.
function immutableProof(prefix, snapshotOk, S) {
 const name = n => prefix ? prefix + ' ' + n : n;
const commit = get(name('Authorized Branch Commit'), `"/git/commits/" + ${S}`, snapshotOk, branchConflict);
const commitOk = gate(name('Authorized Branch Commit Valid?'), `$json.body?.sha === ${S} && ${sha('$json.body?.tree?.sha')}`, branchConflict);
link(commit, commitOk);
const baseTree = get(name('Evaluated Base Tree'), `"/git/trees/" + ${ref('Verify Base Commit Still Exists')}.body.commit.tree.sha + "?recursive=1"`, commitOk, branchConflict);
const branchTree = get(name('Authorized Branch Tree'), `"/git/trees/" + ${ref(name('Authorized Branch Commit'))}.body.tree.sha + "?recursive=1"`, baseTree, branchConflict);
const treeCheck = code(name('Exact Authorized Tree'), `
const base = ${ref(name('Evaluated Base Tree'))}.body, branch = $json.body, f = ${F};
function entries(t) {
 if (!t || t.truncated !== false || !Array.isArray(t.tree) || t.tree.length === 0) return null;
 const leaves = t.tree.filter(e => e.type !== 'tree');
 if (new Set(t.tree.map(e => e.path)).size !== t.tree.length) return null;
 if (leaves.some(e => typeof e.path !== 'string' || !/^[0-9a-f]{40}$/.test(e.sha || '') || !['blob','commit'].includes(e.type))) return null;
 return leaves.sort((a,b) => a.path.localeCompare(b.path));
}
const a = entries(base), b = entries(branch);
const original = a?.find(e => e.path === f.path), target = b?.find(e => e.path === f.path);
const ok = base?.sha === ${ref('Verify Base Commit Still Exists')}.body.commit.tree.sha
 && branch?.sha === ${ref(name('Authorized Branch Commit'))}.body.tree.sha
 && a && b && a.length === b.length && original?.sha === f.originalBlobSha
 && target?.type === 'blob' && ['100644','100755'].includes(target.mode)
 && a.every((e,i) => e.path === b[i].path && e.type === b[i].type && e.mode === b[i].mode
   && (e.path === f.path || e.sha === b[i].sha));
return [{json: {ok: Boolean(ok), candidateBlobSha: ok ? target.sha : null}}];`);
link(branchTree, treeCheck);
const treeOk = gate(name('Exact Authorized Tree?'), '$json.ok === true', branchConflict);
link(treeCheck, treeOk);
const blob = get(name('Authorized Candidate Blob'), `"/git/blobs/" + ${ref(name('Exact Authorized Tree'))}.candidateBlobSha`, treeOk, branchConflict);
const bytes = code(name('Exact Authorized Bytes'), `
const b = $json.body, expected = Buffer.from(${F}.content, 'utf8');
const raw = typeof b?.content === 'string' ? b.content.replace(/[\\r\\n]/g, '') : '';
const decoded = Buffer.from(raw, 'base64');
const ok = b?.sha === ${ref(name('Exact Authorized Tree'))}.candidateBlobSha && b.encoding === 'base64'
 && raw === decoded.toString('base64') && decoded.equals(expected) && b.size === expected.length;
return [{json: {ok}}];`);
link(blob, bytes);
const bytesOk = gate(name('Exact Authorized Bytes?'), '$json.ok === true', branchConflict);
link(bytes, bytesOk);

 const sealed = code(name('Authorized Head'), `return [{json: {AUTHORIZED_HEAD_SHA: ${S}}}];`);
 link(bytesOk, sealed);
 return sealed;
}

// Parse only safe PR identity fields. Ref/repository/base/URL/number/lifecycle
// and a full immutable head SHA are required even for closed historical PRs.
function prParser(prefix, previous, listExpression, expectedHead = null, expectedNumber = null) {
 const n = code(`${prefix} Trusted PR State`, `
const list = ${listExpression}, c = ${C};
const base = ${ref('Initial Trusted Default Branch')}.repositoryDefaultBranch;
const ok = Array.isArray(list) && list.length <= 1 && list.every(p =>
 p && p.head?.ref === c.branchName && p.head?.repo?.full_name === c.repository
 && p.base?.ref === base && p.base?.repo?.full_name === c.repository
 && Number.isSafeInteger(p.number) && p.number > 0
 && p.html_url === 'https://github.com/' + c.repository + '/pull/' + p.number
 && ['open','closed'].includes(p.state)
 && (p.merged_at === null || (p.state === 'closed' && typeof p.merged_at === 'string' && Number.isFinite(Date.parse(p.merged_at))))
 ${expectedNumber ? `&& p.number === ${expectedNumber}` : ''});
const headMatches = ok && list.every(p => ${sha('p.head?.sha')}${expectedHead ? ` && p.head.sha === ${expectedHead}` : ''});
const p = ok && headMatches ? list[0] : null;
return [{json: {ok, headMatches, state: !ok || !headMatches ? 'INVALID' : !p ? 'NONE' : p.merged_at ? 'MERGED' : p.state === 'open' ? 'OPEN' : 'CLOSED',
 pullRequestUrl: p?.html_url, pullRequestNumber: p?.number, headSha: p?.head.sha}}];`);
 link(previous, n);
 const valid = gate(`${prefix} PR Shape Valid?`, '$json.ok === true', fail('PR_LOOKUP_INVALID'));
 link(n, valid);
 const head = gate(`${prefix} PR Head Valid?`, '$json.headMatches === true', headMismatch);
 link(valid, head);
 return { state: n, valid: head };
}
function lifecycle(prefix, previous, state) {
 const p = ref(state);
 const merged = gate(`${prefix} PR Merged?`, `${p}.state === 'MERGED'`, `${prefix} PR Open?`);
 if (previous) link(previous, merged);
 link(merged, response(`Respond - ${prefix} Already Merged`, 'ALREADY_MERGED'));
 const open = gate(`${prefix} PR Open?`, `${p}.state === 'OPEN'`, response(`Respond - ${prefix} Closed Not Merged`, 'CLOSED_NOT_MERGED'));
 link(open, response(`Respond - ${prefix} PR Reused`, 'PR_REUSED', `, pullRequestUrl: ${p}.pullRequestUrl, branchName: ${C}.branchName`));
}
const prQuery = `"/pulls?state=all&per_page=100&head=" + encodeURIComponent(${C}.repository.split('/')[0] + ':' + ${C}.branchName)`;
const initialBase = resolveBase('Initial', baseOk);
const early = get('Early Historical PR Lookup', prQuery, initialBase, fail('PR_LOOKUP_FAILED'));
const historical = prParser('Historical', early, '$json.body');
const noHistory = gate('No Historical PR?', '$json.state === "NONE"', 'Historical Authorized Branch Commit');
link(historical.valid, noHistory);
// A deleted historical branch is irrelevant: prove the immutable PR head itself.
const historicalProof = immutableProof('Historical', null, `${ref(historical.state)}.headSha`);
// immutableProof's initial GET is attached to the false historical lookup edge.
const historicalRecheck = get('Recheck Historical PR', `"/pulls/" + ${ref(historical.state)}.pullRequestNumber`, historicalProof, fail('PR_LOOKUP_FAILED'));
const historicalFinal = prParser('Historical Recheck', historicalRecheck, '[$json.body]', `${ref(historicalProof)}.AUTHORIZED_HEAD_SHA`, `${ref(historical.state)}.pullRequestNumber`);
lifecycle('Historical', historicalFinal.valid, historicalFinal.state);
const branchRead = http('Get Branch Ref', 'GET', `${github} + "/git/ref/heads/" + encodeURIComponent(${C}.branchName)`);
link(noHistory, branchRead);
const branchReadOk = gate('Branch Lookup Resolved?', '($json.statusCode === 200 || $json.statusCode === 404) && !$json.error', fail('BRANCH_LOOKUP_FAILED'));
link(branchRead, branchReadOk);
const branchExists = gate('Branch Exists?', '$json.statusCode === 200', 'Revalidate Before Write (New Branch)');
link(branchReadOk, branchExists);
const branchExact = gate('Existing Branch Ref Valid?', `$json.body?.ref === "refs/heads/" + ${C}.branchName && $json.body?.object?.type === "commit" && ${sha('$json.body?.object?.sha')}`, branchConflict);
link(branchExists, branchExact);
const newAuth = revalidate('New Branch');
const createBranch = http('Create Missing Branch', 'POST', `${github} + "/git/refs"`, `({ref: "refs/heads/" + ${C}.branchName, sha: ${C}.decision.evaluatedSha})`);
link(newAuth, createBranch);
const created = gate('Branch Created Exactly?', `$json.statusCode === 201 && $json.body?.ref === "refs/heads/" + ${C}.branchName && $json.body?.object?.sha === ${C}.decision.evaluatedSha`, fail('BRANCH_CREATE_FAILED'));
link(createBranch, created);
// Concurrent 422 is deliberately a clean failure, no blind retry/reconciliation.
const writeFile = http('Write File To Branch', 'PUT', `${github} + "/contents/" + ${F}.path.split('/').map(encodeURIComponent).join('/')`,
  `({message: ${C}.commitMessage, content: ${C}.writeContentBase64, sha: ${F}.originalBlobSha, branch: ${C}.branchName})`);
link(created, writeFile);
const written = gate('Write Succeeded?', `($json.statusCode === 200 || $json.statusCode === 201) && ${sha('$json.body?.content?.sha')} && ${sha('$json.body?.commit?.sha')}`, writeConflict);
link(writeFile, written);
const reuseAuth = revalidate('Reuse', branchExact);

const freshAuth = revalidate('PR', written);
link(reuseAuth, 'Revalidate Before Write (PR)');
const snapshot = get('Authorized Branch Snapshot', `"/git/ref/heads/" + encodeURIComponent(${C}.branchName)`, freshAuth, branchConflict);
const snapshotOk = gate('Authorized Branch Snapshot Valid?', `$json.body?.ref === "refs/heads/" + ${C}.branchName && $json.body?.object?.type === "commit" && ${sha('$json.body?.object?.sha')}`, branchConflict);
link(snapshot, snapshotOk);
const sealed = immutableProof('', snapshotOk, `${ref('Authorized Branch Snapshot')}.body.object.sha`);
const A = `${ref(sealed)}.AUTHORIZED_HEAD_SHA`;
// Keep the second lookup: a concurrent request may have opened the PR while
// this execution was preparing its branch. Never trust the name without SHA.
const finalSearch = get('Final PR Lookup', prQuery, sealed, fail('PR_LOOKUP_FAILED'));
const finalPR = prParser('Final', finalSearch, '$json.body', A);
const noFinalPR = gate('No Final PR?', '$json.state === "NONE"', 'Final PR Merged?');
link(finalPR.valid, noFinalPR);
lifecycle('Final', null, finalPR.state);
const finalBase = resolveBase('Final', noFinalPR, true);
const finalRef = get('Final Security Branch Ref', `"/git/ref/heads/" + encodeURIComponent(${C}.branchName)`, finalBase, branchConflict);
const unchanged = gate('Authorized Branch Unchanged?', `$json.body?.ref === "refs/heads/" + ${C}.branchName && $json.body?.object?.type === 'commit' && $json.body?.object?.sha === ${A}`, branchConflict);
link(finalRef, unchanged);
const createPr = http('Create Pull Request', 'POST', `${github} + "/pulls"`,
 `({title: ${C}.prTitle, body: ${C}.prBody, head: ${C}.branchName, base: ${ref('Final Ancestry Evidence')}.repositoryDefaultBranch})`);
link(unchanged, createPr);
const createdIdentity = code('Validate Created PR', `
const p = $json.body, c = ${C};
const safeTarget = $json.statusCode === 201 && Number.isSafeInteger(p?.number) && p.number > 0
 && p.html_url === 'https://github.com/' + c.repository + '/pull/' + p.number;
const exact = safeTarget && p.head?.ref === c.branchName && p.head?.repo?.full_name === c.repository
 && p.head?.sha === ${A} && p.base?.ref === ${ref('Final Ancestry Evidence')}.repositoryDefaultBranch
 && p.base?.repo?.full_name === c.repository && p.state === 'open' && p.merged_at === null;
return [{json: {ok: exact, safeTarget, pullRequestNumber: safeTarget ? p.number : null, pullRequestUrl: safeTarget ? p.html_url : null}}];`);
link(createPr, createdIdentity);
const safeCreated = gate('Created PR Target Identified?', '$json.safeTarget === true', fail('PR_CREATE_FAILED'));
link(createdIdentity, safeCreated);
const createdExact = gate('Created PR Head Exact?', '$json.ok === true', 'Close Drifted Created PR');
link(safeCreated, createdExact);
link(createdExact, response('Respond - PR Created', 'PR_CREATED', `, pullRequestUrl: ${ref(createdIdentity)}.pullRequestUrl, branchName: ${C}.branchName`));
// GitHub does not atomically bind PR creation to an expected head SHA. Close
// only the safely identified PR returned by THIS create call on any identity/
// SHA drift. This containment write remains downstream of PR revalidation;
// no additional candidate evaluation may block urgent cleanup.
const P = ref(createdIdentity);
const cleanup = http('Close Drifted Created PR', 'PATCH', `${github} + "/pulls/" + ${P}.pullRequestNumber`, '({state: "closed"})');
// Even an ambiguous PATCH may have succeeded: a read-only GET is the proof.
// Never repeat PATCH. Never infer closure from status alone or raw error text.
const cleanupRead = http('Verify Drifted PR Closed', 'GET', `${github} + "/pulls/" + ${P}.pullRequestNumber`);
link(cleanup, cleanupRead);
const cleanupFailed = response('Respond - PR Head Drift Cleanup Failed', 'PR_HEAD_DRIFT_CLEANUP_FAILED', `, pullRequestUrl: ${P}.pullRequestUrl, pullRequestNumber: ${P}.pullRequestNumber`);
const closed = gate('Drifted PR Closure Confirmed?', `$json.statusCode === 200 && !$json.error && $json.body?.number === ${P}.pullRequestNumber
 && $json.body?.html_url === ${P}.pullRequestUrl && $json.body?.state === 'closed' && $json.body?.merged_at === null`, cleanupFailed);
link(cleanupRead, closed);
link(closed, response('Respond - PR Head Drifted', 'PR_HEAD_DRIFTED'));
const workflow = { name: 'WF6 — Security Remediation (Maven, V1.6 offline draft)', active: false, nodes, connections,
 settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false, binaryMode: 'separate' },
 meta: { instanceId: 'wf6SecurityRemediationMavenV1' },
 versionMetadata: { note: 'Offline only. Managed inbound/header and GitHub credentials. Early immutable historical PR proof, final PR lookup, explicit authorized head SHA. PR creation has no atomic head lock: validate response and close/read-back drifted creation. Never retry an ambiguous mutation.' } };
writeFileSync(output, JSON.stringify([workflow], null, 2) + '\n');
console.log(`WF6_ARTIFACT = ${output}\nWF6_NODE_COUNT = ${nodes.length}\nWF6_ACTIVE = NO`);
