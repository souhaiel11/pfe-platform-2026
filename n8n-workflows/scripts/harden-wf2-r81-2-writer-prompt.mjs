import fs from 'node:fs';

// R81.2 — sources from a FRESH live snapshot of u3eeMwTuhCsetfcS (fetched
// via the n8n API immediately before this script ran, versionId
// 02b659eb-5f8e-4e64-8abe-18de1facb49a, 186 nodes, active=true), not a
// stale repo copy, so this transform is guaranteed to apply to what is
// actually running today.
//
// R81.2 §3 TRUST-BINDING AUDIT CORRECTION: an earlier draft of this change
// (R81.1) also modified "Accumulate Candidate File" to thread pre-edit
// source text through as a NEW field. That turned out to be unnecessary —
// verified directly against a real historical execution (id 2038):
// "Prepare Candidate Manifest" ALREADY includes `sourceContent:it.sourceContent`
// on every file, unconditionally, sourced from the writer node's own decoded
// pre-edit fetch (before the LLM ever runs, so the LLM cannot influence it).
// That field already reaches candidateManifest.files[] today, with ZERO n8n
// change. So R81.2 touches ONLY the writer prompt — the backend's own
// generated-comment-guard.ts was updated instead, to read the EXISTING
// `sourceContent` field name rather than invent a parallel one.
const sourcePath = '/tmp/claude-1000/-home-souhaiel-pfe-2026-platform/01c0d742-940d-4342-ae7c-03d4b38f435f/scratchpad/wf2_presnapshot_r81_1.json';
const outputPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.R81_2-WRITER-PROMPT.json', import.meta.url);

export function hardenWriterPromptTodoFixmeInstruction(workflow) {
  const node = name => {
    const found = workflow.nodes.find(candidate => candidate.name === name);
    if (!found) throw new Error('R81_2_NODE_NOT_FOUND:' + name);
    return found;
  };

  // "Prepare - Code Patch Body" — append the already-reviewed generic
  // writer-prompt instruction. Additive to the `system` string only (same
  // style as the four existing `llmRequestBody.system += "..."` lines
  // already in this node) — no change to the request schema, model, token
  // limits, or any other prompt content.
  const writer = node('Prepare - Code Patch Body');
  const before = writer.parameters.jsCode;
  const anchor = "llmRequestBody.system+=\" PLAN CONTRACT IS AUTHORITATIVE. When the validated remediation plan explicitly specifies a field type, API type, or boundary representation, that explicit contract overrides generic generation preferences. A generic preference for a DTO-owned closed-domain type MUST NOT replace an explicit String contract. When the plan requires String with explicit validation or conversion semantics, generate String and preserve those semantics. When the plan explicitly requires an independent DTO enum, generate that enum and every corresponding type-safe mapping. Never mix representations across sibling candidate files.\";";
  if (!before.includes(anchor)) throw new Error('R81_2_WRITER_ANCHOR_NOT_FOUND');
  const additionalSentence =
    "llmRequestBody.system+=\" Never spell TODO or FIXME literally inside comment or Javadoc text, even to describe a domain identifier that happens to contain that word (for example an enum member literally named TODO): describe it by reference instead (e.g. 'the enum's members', 'the default value defined by X'). This restriction applies only to comment/Javadoc prose you write or modify -- never to code identifiers, enum members, string literals, or other values required by application behavior, and you must never rename or avoid using a legitimate domain identifier to satisfy it.\";";
  const after = before.replace(anchor, anchor + additionalSentence);
  if (after === before) throw new Error('R81_2_WRITER_NOT_MODIFIED');
  writer.parameters.jsCode = after;

  return { touchedNodeNames: [writer.name] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const workflow = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const before = JSON.stringify(workflow);
  const beforeNodeCount = workflow.nodes.length;
  const beforeIds = workflow.nodes.map(n => n.id).sort();

  const { touchedNodeNames } = hardenWriterPromptTodoFixmeInstruction(workflow);

  const afterNodeCount = workflow.nodes.length;
  const afterIds = workflow.nodes.map(n => n.id).sort();
  if (afterNodeCount !== beforeNodeCount) throw new Error('R81_2_NODE_COUNT_CHANGED');
  if (JSON.stringify(afterIds) !== JSON.stringify(beforeIds)) throw new Error('R81_2_NODE_IDS_CHANGED');

  // Prove EXACTLY the one intended node differs from the source snapshot --
  // nothing else in the 186-node graph was touched.
  const original = JSON.parse(before);
  const actuallyChanged = workflow.nodes.filter(n => {
    const originalNode = original.nodes.find(o => o.id === n.id);
    return JSON.stringify(originalNode) !== JSON.stringify(n);
  }).map(n => n.name);
  if (actuallyChanged.length !== 1 || actuallyChanged[0] !== 'Prepare - Code Patch Body') {
    throw new Error('R81_2_UNEXPECTED_NODE_CHANGES:' + JSON.stringify(actuallyChanged));
  }

  fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2) + '\n');
  console.log('R81.2 hardening applied (writer prompt only -- Accumulate Candidate File left untouched, see file header).');
  console.log('touchedNodeNames:', touchedNodeNames);
  console.log('actuallyChangedNodes:', actuallyChanged);
  console.log('nodeCount:', afterNodeCount);
  console.log('nodeIdsUnique:', new Set(afterIds).size === afterIds.length);
  console.log('written to:', outputPath.pathname);
}
