// R23 — WF2 referenced-source DNS resilience + source-context completeness
// gate.
//
// Context: real fixRequest 591853f3-9538-4df7-9b2d-7df1f8fca1f8 (batch
// cc610d36782e1d115fb997dad92312e78ce92c0c575d698702ef288f2ec77666, java:S4684
// TaskController.java:34), execution 1997. "Fetch Referenced API Sources"
// hit a transient DNS error ("The DNS server returned an error, perhaps the
// server is offline") on 2 of 3 expanded referenced sources (Task.java,
// TaskService.java missing; TaskController.java fetched). The 1-of-3 partial
// result nonetheless reached "Prepare Generic Remediation Plan" on the
// node's success output, while the 2 failed items independently reached
// "Failure Envelope - Fetch Referenced API Sources" -> "Prepare WF2 Failure
// Status" on the node's error output, in the SAME execution. Planner then
// also hit "getaddrinfo EAI_AGAIN api.anthropic.com" on "Generate
// Remediation Plan". Net effect: two divergent failure/continuation paths
// fired from one fetch call, and partial context could reach planning.
//
// This patch:
//  (A) Adds bounded native retry (retryOnFail/maxTries/waitBetweenTries,
//      same 3/1000 shape as every other transient-network hardening in this
//      workflow — R74/R76) to the two non-mutating nodes implicated: "Fetch
//      Referenced API Sources" (GitHub read-only file GET) and "Generate
//      Remediation Plan" (Claude planner call, pure outbound POST).
//  (B) Inserts one new deterministic gate node, "Validate Source Context
//      Completeness", between "Fetch Referenced API Sources" and its two
//      former direct targets. BOTH of that node's outputs (success items
//      AND per-item error items) now fan into the gate's single input, so
//      the gate always sees the complete picture of one fetch attempt in
//      one place. It diffs the originally-requested source set (read
//      directly from "Expand Referenced API Sources"' own output, not
//      re-derived) against the successfully-fetched set:
//        - complete  -> only the successful items pass through, unchanged,
//                        to "Prepare Generic Remediation Plan" (identical to
//                        the previous wiring in the all-succeeded case).
//        - incomplete -> throws 'SOURCE_API_CONTEXT_INCOMPLETE: ...' with
//                        bounded requestedCount/fetchedCount/missing[]
//                        metadata (no content/credentials), routed via the
//                        node's own error output to the EXISTING "Failure
//                        Envelope - Fetch Referenced API Sources" node
//                        (reused, not duplicated) -> "Prepare WF2 Failure
//                        Status". Exactly one failure path, exactly once.
//  This makes partial/0-of-N source context structurally unable to reach
//  "Prepare Generic Remediation Plan": there is now exactly one edge into
//  that node from this region of the graph, and it originates only from the
//  gate's success output, which only ever fires when fetched === requested.
//
// Does not touch: source SHA freeze (Fetch's `additionalParameters.reference`
// expression, untouched), the 12-file/65536-char bounds in "Expand
// Referenced API Sources" / "Prepare Generic Remediation Plan", any
// Git-mutating node, the candidate verifier, WF1/WF3, or S4684 eligibility.
// Repo-only generator: reads the current pending-live-update canonical
// artifact and writes it back in place. Never imports/publishes to the live
// n8n instance.
import fs from 'node:fs';
import crypto from 'node:crypto';

const targetPath = new URL('../pending-live-update/wf2-git-patch-pr-u3eeMwTuhCsetfcS.PROMOTION-TARGET.json', import.meta.url);
const workflow = JSON.parse(fs.readFileSync(targetPath))[0];
const node = name => workflow.nodes.find(candidate => candidate.name === name);

// This generator reads and writes the same canonical artifact (unlike the
// R14-R22E scripts, which each transform a frozen prior draft into a new
// output path), so it must be safe to re-run against its own prior output:
// re-running it is a no-op, never a duplicate mutation.
if (node('Validate Source Context Completeness')) {
  console.log(JSON.stringify({ output: targetPath.pathname, id: workflow.id, nodes: workflow.nodes.length, alreadyApplied: true }, null, 2));
  process.exit(0);
}

// (A) Bounded retry on the two non-mutating nodes proven to have failed
// transiently in execution 1997 — same shape as every prior instance of this
// hardening (R74/R76: Get Main Branch SHA1, Independent Semantic Review, de
// Patch - HTTP Request).
for (const name of ['Fetch Referenced API Sources', 'Generate Remediation Plan']) {
  const n = node(name);
  n.retryOnFail = true;
  n.maxTries = 3;
  n.waitBetweenTries = 1000;
}

// (B) Source-context completeness gate.
const fetchNode = node('Fetch Referenced API Sources');
const gateNode = {
  id: crypto.randomUUID(),
  name: 'Validate Source Context Completeness',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [fetchNode.position[0], fetchNode.position[1] + 220],
  onError: 'continueErrorOutput',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: String.raw`const requested=$('Expand Referenced API Sources').all().map(i=>String(i.json.target_file_path||''));
const items=$input.all();const fetchedPaths=new Set();const fetched=[];
for(const item of items){const j=item.json||{};if(!j.error&&j.path){const p=String(j.path);if(!fetchedPaths.has(p)){fetchedPaths.add(p);fetched.push(item)}}}
const missing=requested.filter(p=>!fetchedPaths.has(p));
if(missing.length>0)throw new Error('SOURCE_API_CONTEXT_INCOMPLETE: '+JSON.stringify({requestedCount:requested.length,fetchedCount:fetchedPaths.size,missing}));
return fetched;`,
  },
};
workflow.nodes.push(gateNode);

workflow.connections['Fetch Referenced API Sources'] = {
  main: [
    [{ node: gateNode.name, type: 'main', index: 0 }],
    [{ node: gateNode.name, type: 'main', index: 0 }],
  ],
};
workflow.connections[gateNode.name] = {
  main: [
    [{ node: 'Prepare Generic Remediation Plan', type: 'main', index: 0 }],
    [{ node: 'Failure Envelope - Fetch Referenced API Sources', type: 'main', index: 0 }],
  ],
};

workflow.updatedAt = new Date().toISOString();
fs.writeFileSync(targetPath, JSON.stringify([workflow], null, 2) + '\n');
console.log(JSON.stringify({ output: targetPath.pathname, id: workflow.id, nodes: workflow.nodes.length, addedNode: gateNode.name }, null, 2));
