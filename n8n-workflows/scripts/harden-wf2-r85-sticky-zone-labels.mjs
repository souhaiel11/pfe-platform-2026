import { readFileSync, writeFileSync } from 'node:fs';

// R85 — the 6 content-bearing sticky notes on the WF2 canvas (3 "Zones", 2
// "Boucles", 1 "Chemins d'echec") were labelled with an old 8-phase numbering
// that no longer matches this document's 8-block structure, and the canvas's
// own geometric zones don't align 1:1 with the document's logical blocks
// (confirmed: blocks 4, 5 and 8 are each split across 2-3 zone bounding
// boxes). This script rewrites each sticky's displayed text (content only —
// no functional node, no connection, no position) to name the exact block
// numbers it covers, with verified node counts, and softens two claims about
// node liveness that should state what the analysis observed rather than
// assert a permanent verdict.

const STICKIES = {
  'Sticky - Phase 1a - Reception & correlation': {
    content:
      'Zone 1 — Blocs 1, 2, 3 : Reception & correlation, Grounding des sources, Planification\n' +
      "Reception du webhook, correlation, resolution de branche existante/nouvelle, grounding des sources " +
      "(+ extension sources referencees/dependances), planification du patch. 26 noeuds nominaux + 7 noeuds " +
      "de la chaine de reconciliation Pass-1 (Bloc 8, cluster 2) — aucune entree detectee par l'analyse, " +
      "conservee — visuellement presents ici sans lui appartenir. 33 noeuds dans cette zone (Webhook, " +
      "l'entree, est juste a l'exterieur de la boite). Bande haute (flux nominal).",
    height: 1080,
  },
  'Sticky - Phase 4 - Generation du patch': {
    content:
      'Boucle A — Bloc 4 (+ 1 noeud du Bloc 5) : Generation du patch par fichier\n' +
      'Traitement par lot : Seed New Planned File -> Route Planned File Operation -> Merge Effective File ' +
      "Results, avec re-entree de boucle (1 arete de retour, contenue ici). 9 noeuds du Bloc 4 + Generic " +
      "Candidate Preflight (Bloc 5). 10 noeuds. Bande mediane.",
  },
  'Sticky - Phase 5 - Preflight deterministe': {
    content:
      "Boucle B — Bloc 8, partie boucle : Reconciliation d'ecriture Git (Pass 2)\n" +
      "Verification du hash apres ecriture, detection de conflit distant, reconciliation, avec re-entree " +
      "de boucle (1 arete de retour, contenue ici). 17 noeuds. Bande mediane.",
  },
  'Sticky - Phase 6 - Revue semantique': {
    content:
      "Chemins d'echec — transversal, tous blocs (hors numerotation 1-8)\n" +
      '74 Failure Envelopes + 4 gestionnaires/agregateur (Persist Verification Failure, Persist Base Moved ' +
      'Failure, Prepare/Persist WF2 Failure Status) convergent ici vers le callback backend. 78 noeuds. ' +
      "Les noeuds Collect File Updates et consorts (4, aucune entree detectee par l'analyse, conserves) ne " +
      "sont PAS dans cette zone — ils sont hors de toute zone visuelle, bien plus bas. Bande basse, hors " +
      "du flux nominal.",
    height: 1200,
  },
  'Sticky - Phase 7 - Verification du candidat': {
    content:
      'Zone 2 — Blocs 6, 7 (+ extension cross-fichiers) : Revue semantique, verification du candidat\n' +
      'Hash/verification du candidat, revue semantique independante, verification cross-fichiers ' +
      '(compilation/tests). 29 noeuds nominaux + 5 noeuds d\'autres blocs entremeles ici (4 du Bloc 8 : ' +
      'creation de branche manquante ; 1 du Bloc 4 : Prepare Candidate Manifest). 34 noeuds. Bande haute ' +
      '(flux nominal).',
    height: 820,
  },
  'Sticky - Phase 8b - Ecriture Git & Pull Request (suite)': {
    content:
      'Zone 3 — Bloc 8, fin : Ecriture Git & Pull Request\n' +
      "Ecrit sur la branche, verifie/reconcilie l'ecriture, cree ou met a jour la PR. 9 noeuds. Bande " +
      'haute (flux nominal).',
  },
  'Sticky - Phase 1b - Reception & correlation (resolution de branche)': {
    content: '↳ suite Zone 2 (Blocs 6, 7) — voir le sticky principal',
  },
  'Sticky - Phase 2 - Grounding des sources': {
    content: '↳ suite Zone 1 (Blocs 1, 2, 3) — voir le sticky principal',
  },
  'Sticky - Phase 3 - Planification': {
    content: '↳ suite Zone 1 (Blocs 1, 2, 3) — voir le sticky principal',
  },
  'Sticky - Phase 8 - Ecriture Git & Pull Request': {
    content: '↳ suite Zone 1 (Blocs 1, 2, 3) — voir le sticky principal',
  },
  'Sticky - Phase 9 - Grounding & verification multi-fichiers (extension)': {
    content: '↳ suite Zone 2 (Blocs 6, 7) — voir le sticky principal',
  },
};

export function relabelStickyZones(workflow) {
  for (const [name, patch] of Object.entries(STICKIES)) {
    const n = workflow.nodes.find(x => x.name === name);
    if (!n) throw new Error(`missing sticky ${name}`);
    n.parameters.content = patch.content;
    if (patch.height) n.parameters.height = patch.height;
  }
  return workflow;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const input = process.argv[2], output = process.argv[3] || input;
  if (!input) throw new Error('usage: node harden-wf2-r85-sticky-zone-labels.mjs <input.json> [output.json]');
  const root = JSON.parse(readFileSync(input, 'utf8'));
  const workflow = Array.isArray(root) ? root[0] : root;
  relabelStickyZones(workflow);
  writeFileSync(output, JSON.stringify(root, null, 2) + '\n');
  console.log(`WF2 sticky zone labels rewritten (R85); ${workflow.nodes.length} nodes.`);
}
