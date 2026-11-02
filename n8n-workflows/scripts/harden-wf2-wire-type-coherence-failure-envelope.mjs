// Prépare le résultat lié à wire type Coherence échec Envelope.
import { readFileSync, writeFileSync } from 'node:fs';

/** Prépare le résultat lié à wire type Coherence échec Envelope. */

export function wireTypeCoherenceFailureEnvelope(workflow) {
  const FE = 'Failure Envelope - Validate Cross-File Type Coherence';
  const TARGET = 'Prepare WF2 Failure Status';

  if (!workflow.nodes.some(n => n.name === FE)) {
    throw new Error(`missing node ${FE}`);
  }
  if (!workflow.nodes.some(n => n.name === TARGET)) {
    throw new Error(`missing node ${TARGET}`);
  }

  const already = workflow.connections[FE];
  const correct = already
    && already.main?.length === 1
    && already.main[0]?.length === 1
    && already.main[0][0]?.node === TARGET
    && already.main[0][0]?.type === 'main'
    && already.main[0][0]?.index === 0;
  if (!correct) {
    workflow.connections[FE] = { main: [[{ node: TARGET, type: 'main', index: 0 }]] };
  }

  const sticky = workflow.nodes.find(n => n.name === 'Sticky - Phase 6 - Revue semantique');
  if (!sticky) throw new Error('missing sticky Sticky - Phase 6 - Revue semantique');
  const correctedContent =
    "## Chemins d'echec\n" +
    'Les 74 Failure Envelopes, les 2 gestionnaires d\'echec dedies (Persist Verification/Base Moved Failure) ' +
    'et l\'agregateur convergent tous vers le callback backend (Prepare/Persist WF2 Failure Status). ' +
    '4 noeuds historiquement non cables (Collect File Updates et consorts) regroupes ici aussi, ' +
    'jamais atteints en execution. Bande basse, hors du flux nominal.';
  sticky.parameters.content = correctedContent;

  return workflow;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const input = process.argv[2], output = process.argv[3] || input;
  if (!input) throw new Error('usage: node harden-wf2-wire-type-coherence-failure-envelope.mjs <input.json> [output.json]');
  const root = JSON.parse(readFileSync(input, 'utf8'));
  const workflow = Array.isArray(root) ? root[0] : root;
  wireTypeCoherenceFailureEnvelope(workflow);
  writeFileSync(output, JSON.stringify(root, null, 2) + '\n');
  console.log(`WF2 type-coherence failure envelope wired; ${workflow.nodes.length} nodes.`);
}
