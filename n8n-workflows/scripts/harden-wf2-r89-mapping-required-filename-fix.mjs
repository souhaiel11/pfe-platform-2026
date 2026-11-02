// Corrige le traitement des champs obligatoires du mapping.
import { readFileSync, writeFileSync } from 'node:fs';


const OLD_LINE =
  "const mappingRequired=/\\b(dto|entity|mapping|accessor|getter|setter)\\b/i.test(JSON.stringify(plans));";
const NEW_LINE =
  "const mappingText=plans.map(p=>[p.rootCause,p.remediationIntent,...(p.requiredChanges||[])].join(' ')).join(' ');const mappingRequired=/\\b(dto|entity|mapping|accessor|getter|setter)\\b/i.test(mappingText);";

/** Corrige le traitement des champs obligatoires du mapping. */
export function fixMappingRequired(workflow) {
  const node = workflow.nodes.find((n) => n.name === 'Prepare - Code Patch Body');
  if (!node) throw new Error('missing node Prepare - Code Patch Body');
  const code = node.parameters.jsCode;
  const occurrences = code.split(OLD_LINE).length - 1;
  if (occurrences !== 1) throw new Error(`expected exactly 1 occurrence of OLD_LINE, found ${occurrences}`);
  node.parameters.jsCode = code.replace(OLD_LINE, NEW_LINE);
  return workflow;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const input = process.argv[2], output = process.argv[3] || input;
  if (!input) throw new Error('usage: node harden-wf2-r89-mapping-required-filename-fix.mjs <input.json> [output.json]');
  const root = JSON.parse(readFileSync(input, 'utf8'));
  const workflow = Array.isArray(root) ? root[0] : root;
  fixMappingRequired(workflow);
  writeFileSync(output, JSON.stringify(root, null, 2) + '\n');
  console.log('WF2 mappingRequired filename fix (R89): applied to Prepare - Code Patch Body.');
}
