import fs from 'node:fs';
import assert from 'node:assert/strict';

// R81.2 — OFFLINE ONLY. No network call anywhere in this file.

const workflowPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R81_2-WRITER-PROMPT.json', import.meta.url);
const fixturePath = new URL('./fixtures/wf2-r81-2-execution-2038-source-content.json', import.meta.url);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const node = (name) => {
  const found = workflow.nodes.find(n => n.name === name);
  if (!found) throw new Error('NODE_NOT_FOUND:' + name);
  return found;
};

// ---- 1. writer prompt contract: additive, generic, no rule/project hardcoding ----
{
  const writerCode = node('Prepare - Code Patch Body').parameters.jsCode;
  assert.match(writerCode, /Never spell TODO or FIXME literally inside comment or Javadoc text/, 'the new instruction sentence is present');
  assert.match(writerCode, /never to code identifiers, enum members, string literals, or other values required by application behavior/, 'the exemption clause is present verbatim');
  assert.doesNotMatch(writerCode, /java:S1135/i, 'the writer prompt never hardcodes the Sonar rule ID');
  assert.doesNotMatch(writerCode, /TaskStatus/i, 'the writer prompt never hardcodes the domain enum name');
  assert.doesNotMatch(writerCode, /pfe-app-test/i, 'the writer prompt never hardcodes the project name');
  // The four pre-existing system-prompt sentences (unrelated to R81.2) must
  // still be present, byte-for-byte -- this is an ADDITIVE change only.
  assert.match(writerCode, /PLAN CONTRACT IS AUTHORITATIVE/, 'pre-existing prompt content is preserved unmodified');
  assert.match(writerCode, /Relationship source grounding is mandatory/, 'pre-existing prompt content is preserved unmodified');
  // It already declared this rule before R81.2 too, at the top-level
  // globalForbidden array and an earlier prose sentence -- R81.2 closes the
  // "domain identifier that happens to spell the marker" gap that ORIGINAL
  // wording didn't cover, it doesn't introduce the concept from nothing.
  assert.match(writerCode, /Do not add TODO\/FIXME/, 'the pre-existing baseline TODO\/FIXME prohibition is still present');
}
console.log('wf2-r81-2-writer-prompt: writer prompt contract: PASS');

// ---- 2. scope: exactly the one intended node differs, control flow (connections/settings) untouched ----
{
  assert.equal(workflow.nodes.length, 186, 'node count unchanged');
  assert.equal(new Set(workflow.nodes.map(n => n.id)).size, 186, 'node ids remain unique');
  const webhook = workflow.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
  assert.equal(webhook.parameters.path, 'wf2-r22e-test', 'webhook route unchanged');
  assert.equal(webhook.parameters.httpMethod, 'POST', 'webhook method unchanged');
}
console.log('wf2-r81-2-writer-prompt: scope/safety invariants: PASS');

// ---- 3. R81.2 §3 trust-binding audit: sourceContent ALREADY reaches candidateManifest.files[]
// today, with ZERO n8n data-threading change -- proven against a REAL historical
// execution (id 2038, attempt 13 of this incident's own batch), not a synthetic fixture. ----
{
  assert.equal(fixture.executionId, 2038);
  assert.ok(fixture.files.length >= 2, 'real batch had at least 2 files');
  for (const file of fixture.files) {
    assert.equal(file.operation, 'MODIFY', 'this real batch\'s files were MODIFY operations');
    assert.ok(file.sourceContentLength > 0, `sourceContent for ${file.path} is a real, non-empty string in production data`);
    assert.ok(file.sourceContentSample.length > 0, 'sourceContent sample is real Java source, not a placeholder');
  }
}
console.log('wf2-r81-2-writer-prompt: sourceContent-already-present trust-binding audit: PASS (real execution 2038)');
