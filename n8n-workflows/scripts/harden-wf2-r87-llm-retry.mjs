// Prépare les relances après échec dans WF2.
import { readFileSync, writeFileSync } from 'node:fs';

// R87 — all 4 direct Anthropic API calls already had retryOnFail=true /
// maxTries=3, but waitBetweenTries was only 1000ms. Raised to 5000ms per
// explicit request. No other field on these nodes, and no other node in the
// workflow, is touched. Content validation for each of the 4 calls already
// happens in a separate downstream node (Validate Generic Remediation Plan,
// Generic Candidate Preflight via Parse - Code Patch Output, Enforce
// Independent Review, Enforce Cross-File Review) -- verified against the
// live connections graph before writing this patch, not assumed.

export const LLM_HTTP_NODES = [
  'Generate Remediation Plan',          // claude-sonnet-5  (Bloc 3 - plan)
  'de Patch - HTTP Request',            // claude-opus-5    (Bloc 4 - patch generation)
  'Independent Semantic Review',        // claude-haiku-4-5 (Bloc 6 - single-file review)
  'Independent Cross-File Semantic Review', // claude-haiku-4-5 (extension - multi-file review)
];

/** Applique Llm relance. */
export function applyLlmRetry(workflow) {
  for (const name of LLM_HTTP_NODES) {
    const n = workflow.nodes.find((x) => x.name === name);
    if (!n) throw new Error(`missing node ${name}`);
    n.retryOnFail = true;
    n.maxTries = 3;
    n.waitBetweenTries = 5000;
  }
  return workflow;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const input = process.argv[2], output = process.argv[3] || input;
  if (!input) throw new Error('usage: node harden-wf2-r87-llm-retry.mjs <input.json> [output.json]');
  const root = JSON.parse(readFileSync(input, 'utf8'));
  const workflow = Array.isArray(root) ? root[0] : root;
  applyLlmRetry(workflow);
  writeFileSync(output, JSON.stringify(root, null, 2) + '\n');
  console.log(`WF2 LLM retry (R87): waitBetweenTries -> 5000ms on ${LLM_HTTP_NODES.length} nodes.`);
}
