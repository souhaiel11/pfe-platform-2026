// Prépare les relances après échec dans WF2.
import { readFileSync, writeFileSync } from 'node:fs';

// R88 — longer backoff on the Opus 5 (patch-generation) LLM call only, to
// cover a sustained overload window (HTTP 529) rather than a single blip.
// R87 (waitBetweenTries 1000 -> 5000 on all 4 LLM nodes) was never deployed,
// so this starts from the live 1000ms value. Only "de Patch - HTTP Request"
// is touched: it is the ONLY one of the 4 LLM call nodes whose request body
// sets model:'claude-opus-5' (verified against the live jsCode that builds
// each request -- 'Generate Remediation Plan' uses claude-sonnet-5,
// 'Independent Semantic Review' and 'Independent Cross-File Semantic Review'
// both inherit claude-haiku-4-5-20251001 from a template built once in
// 'Generic Candidate Preflight'). maxTries stays 3 (unchanged).

export const OPUS_HTTP_NODE = 'de Patch - HTTP Request';

/** Applique Opus relance Backoff. */
export function applyOpusRetryBackoff(workflow) {
  const n = workflow.nodes.find((x) => x.name === OPUS_HTTP_NODE);
  if (!n) throw new Error(`missing node ${OPUS_HTTP_NODE}`);
  n.retryOnFail = true;
  n.maxTries = 3;
  n.waitBetweenTries = 20000;
  return workflow;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const input = process.argv[2], output = process.argv[3] || input;
  if (!input) throw new Error('usage: node harden-wf2-r88-opus-retry-backoff.mjs <input.json> [output.json]');
  const root = JSON.parse(readFileSync(input, 'utf8'));
  const workflow = Array.isArray(root) ? root[0] : root;
  applyOpusRetryBackoff(workflow);
  writeFileSync(output, JSON.stringify(root, null, 2) + '\n');
  console.log(`WF2 Opus retry backoff (R88): waitBetweenTries -> 20000ms on ${OPUS_HTTP_NODE}.`);
}
