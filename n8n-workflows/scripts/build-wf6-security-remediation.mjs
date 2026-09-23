#!/usr/bin/env node
// V1.5.1. Offline only. Fixed IDs/order, no clock, no network, no import.
// Code nodes validate transport/trust boundaries; they never author a patch.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../pending-live-update/wf6-security-remediation-maven.OFFLINE-DRAFT.json', import.meta.url));
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
      : [{ name: 'Authorization', value: '={{"Bearer " + $env.GITHUB_TOKEN}}' }, { name: 'Accept', value: 'application/vnd.github+json' }] },
    ...(body ? { sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr(body) } : {}),
    options: { response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
      redirect: { redirect: { followRedirects: false } }, timeout: 30000 },
  }, 4.2, { continueOnFail: true, retryOnFail: false,
    notes: 'Full response keeps arrays in body (including empty PR lists). HTTP and transport errors are explicitly gated. No redirect or automatic retry.' });
}
function get(name, tail, previous, failure = fail('GITHUB_READ_FAILED')) {
  const n = http(name, 'GET', `${github} + ${tail}`);
  link(previous, n);
  const ok = gate(`${name} OK?`, '$json.statusCode === 200 && !$json.error', failure);
  link(n, ok); return ok;
}
const webhook = add('Webhook - Security Remediation Request', 'webhook', {
  httpMethod: 'POST', path: 'wf6-security-remediation-evaluate', responseMode: 'responseNode', options: {},
}, 2);
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
const initialBase = resolveBase('Initial', baseOk);
const branchRead = http('Get Branch Ref', 'GET', `${github} + "/git/ref/heads/" + encodeURIComponent(${C}.branchName)`);
link(initialBase, branchRead);
const branchReadOk = gate('Branch Lookup Resolved?', '($json.statusCode === 200 || $json.statusCode === 404) && !$json.error', fail('BRANCH_LOOKUP_FAILED'));
link(branchRead, branchReadOk);
const branchExists = gate('Branch Exists?', '$json.statusCode === 200', 'Revalidate Before Write (New Branch)');
link(branchReadOk, branchExists);
const branchExact = gate('Existing Branch Ref Valid?', `$json.body?.ref === "refs/heads/" + ${C}.branchName && $json.body?.object?.type === "commit" && ${sha('$json.body?.object?.sha')}`, branchConflict);
link(branchExists, branchExact);
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

// Re-read after authorization/write, inspect IMMUTABLE commit/tree/blob objects.
// Exact whole-tree equality (except the one authorized path) prevents unrelated
// branch changes being smuggled into a PR. Truncated trees fail closed.
const freshAuth = revalidate('PR', written);
link(reuseAuth, 'Revalidate Before Write (PR)');
const snapshot = get('Authorized Branch Snapshot', `"/git/ref/heads/" + encodeURIComponent(${C}.branchName)`, freshAuth, branchConflict);
const snapshotOk = gate('Authorized Branch Snapshot Valid?', `$json.body?.ref === "refs/heads/" + ${C}.branchName && $json.body?.object?.type === "commit" && ${sha('$json.body?.object?.sha')}`, branchConflict);
link(snapshot, snapshotOk);
const S = `${ref('Authorized Branch Snapshot')}.body.object.sha`;
const commit = get('Authorized Branch Commit', `"/git/commits/" + ${S}`, snapshotOk, branchConflict);
const commitOk = gate('Authorized Branch Commit Valid?', `$json.body?.sha === ${S} && ${sha('$json.body?.tree?.sha')}`, branchConflict);
link(commit, commitOk);
const baseTree = get('Evaluated Base Tree', `"/git/trees/" + ${ref('Verify Base Commit Still Exists')}.body.commit.tree.sha + "?recursive=1"`, commitOk, branchConflict);
const branchTree = get('Authorized Branch Tree', `"/git/trees/" + ${ref('Authorized Branch Commit')}.body.tree.sha + "?recursive=1"`, baseTree, branchConflict);
const treeCheck = code('Exact Authorized Tree', `
const base = ${ref('Evaluated Base Tree')}.body, branch = $json.body, f = ${F};
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
 && branch?.sha === ${ref('Authorized Branch Commit')}.body.tree.sha
 && a && b && a.length === b.length && original?.sha === f.originalBlobSha
 && target?.type === 'blob' && ['100644','100755'].includes(target.mode)
 && a.every((e,i) => e.path === b[i].path && e.type === b[i].type && e.mode === b[i].mode
   && (e.path === f.path || e.sha === b[i].sha));
return [{json: {ok: Boolean(ok), candidateBlobSha: ok ? target.sha : null}}];`);
link(branchTree, treeCheck);
const treeOk = gate('Exact Authorized Tree?', '$json.ok === true', branchConflict);
link(treeCheck, treeOk);
const blob = get('Authorized Candidate Blob', `"/git/blobs/" + ${ref('Exact Authorized Tree')}.candidateBlobSha`, treeOk, branchConflict);
const bytes = code('Exact Authorized Bytes', `
const b = $json.body, expected = Buffer.from(${F}.content, 'utf8');
const raw = typeof b?.content === 'string' ? b.content.replace(/[\\r\\n]/g, '') : '';
const decoded = Buffer.from(raw, 'base64');
const ok = b?.sha === ${ref('Exact Authorized Tree')}.candidateBlobSha && b.encoding === 'base64'
 && raw === decoded.toString('base64') && decoded.equals(expected) && b.size === expected.length;
return [{json: {ok}}];`);
link(blob, bytes);
const bytesOk = gate('Exact Authorized Bytes?', '$json.ok === true', branchConflict);
link(bytes, bytesOk);
const search = get('Search Existing PR For Branch', `"/pulls?state=all&per_page=100&head=" + encodeURIComponent(${C}.repository.split('/')[0] + ':' + ${C}.branchName)`, bytesOk, fail('PR_LOOKUP_FAILED'));
const prState = code('Trusted Existing PR State', `
const list = $json.body, c = ${C};
const base = ${ref('Initial Trusted Default Branch')}.repositoryDefaultBranch;
const valid = Array.isArray(list) && list.length <= 1 && list.every(p =>
 p.head?.ref === c.branchName && p.head?.repo?.full_name === c.repository
 && p.base?.ref === base && p.base?.repo?.full_name === c.repository
 && /^https:\\/\\/github\\.com\\/[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+\\/pull\\/[0-9]+$/.test(p.html_url || '')
 && p.html_url.startsWith('https://github.com/' + c.repository + '/pull/')
 && ['open','closed'].includes(p.state));
const p = valid ? list[0] : null;
return [{json: {ok: valid, state: !valid ? 'INVALID' : !p ? 'NONE' : p.merged_at ? 'MERGED' : p.state === 'open' ? 'OPEN' : 'CLOSED', pullRequestUrl: p?.html_url}}];`);
link(search, prState);
const prValid = gate('PR Lookup Valid?', '$json.ok === true', fail('PR_LOOKUP_INVALID'));
link(prState, prValid);
const existing = gate('No Existing PR?', '$json.state === "NONE"', 'Existing PR Merged?');
link(prValid, existing);
const merged = gate('Existing PR Merged?', '$json.state === "MERGED"', 'Existing PR Open?');
link(merged, response('Respond - Already Merged', 'ALREADY_MERGED'));
const open = gate('Existing PR Open?', '$json.state === "OPEN"', response('Respond - Closed Not Merged', 'CLOSED_NOT_MERGED'));
link(open, response('Respond - PR Reused', 'PR_REUSED', `, pullRequestUrl: ${ref(prState)}.pullRequestUrl, branchName: ${C}.branchName`));
const finalBase = resolveBase('Final', existing, true);
const finalRef = get('Final Security Branch Ref', `"/git/ref/heads/" + encodeURIComponent(${C}.branchName)`, finalBase, branchConflict);
const unchanged = gate('Authorized Branch Unchanged?', `$json.body?.ref === "refs/heads/" + ${C}.branchName && $json.body?.object?.sha === ${S}`, branchConflict);
link(finalRef, unchanged);
const createPr = http('Create Pull Request', 'POST', `${github} + "/pulls"`,
  `({title: ${C}.prTitle, body: ${C}.prBody, head: ${C}.branchName, base: ${ref('Final Ancestry Evidence')}.repositoryDefaultBranch})`);
link(unchanged, createPr);
const prCreated = gate('PR Created?', `$json.statusCode === 201 && $json.body?.head?.ref === ${C}.branchName && $json.body?.base?.ref === ${ref('Final Ancestry Evidence')}.repositoryDefaultBranch && typeof $json.body?.html_url === 'string' && $json.body.html_url.startsWith('https://github.com/' + ${C}.repository + '/pull/') && /^[0-9]+$/.test($json.body.html_url.split('/pull/')[1] || '')`, fail('PR_CREATE_FAILED'));
link(createPr, prCreated);
link(prCreated, response('Respond - PR Created', 'PR_CREATED', `, pullRequestUrl: $json.body.html_url, branchName: ${C}.branchName`));
const workflow = { name: 'WF6 — Security Remediation (Maven, V1.5.1 offline draft)', active: false, nodes, connections,
 settings: { executionOrder: 'v1' }, meta: { instanceId: 'wf6SecurityRemediationMavenV1' },
 versionMetadata: { note: 'Offline only. Concurrent create conflict fails cleanly. Transport write failure never assumes success. PR base evidence is refreshed in this execution; GitHub PR creation offers no atomic ref lock.' } };
writeFileSync(output, JSON.stringify([workflow], null, 2) + '\n');
console.log(`WF6_ARTIFACT = ${output}\nWF6_NODE_COUNT = ${nodes.length}\nWF6_ACTIVE = NO`);
