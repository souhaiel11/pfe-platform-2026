// Regroupe les annotations visuelles du workflow.
import { readFileSync, writeFileSync } from 'node:fs';


const OLD_STICKY_NAMES = [
  'Sticky - Phase 1a - Reception & correlation',
  'Sticky - Phase 1b - Reception & correlation (resolution de branche)',
  'Sticky - Phase 2 - Grounding des sources',
  'Sticky - Phase 3 - Planification',
  'Sticky - Phase 4 - Generation du patch',
  'Sticky - Phase 5 - Preflight deterministe',
  'Sticky - Phase 6 - Revue semantique',
  'Sticky - Phase 7 - Verification du candidat',
  'Sticky - Phase 8 - Ecriture Git & Pull Request',
  'Sticky - Phase 3 - Planification1',
  'Sticky - Phase 1a - Reception & correlation1',
];

// Each zone's box is the real geometric bounding box of its nodes (from the
// R86 clustering pass), padded by ~80-120px on every side so node borders
// don't touch the sticky edge. Boxes are mutually exclusive in 2D space —
// verified by the accompanying spec against the live export, not asserted
// here.
export const ZONES = [
  {
    id: 'r86-sticky-zone-1',
    name: 'Sticky - Zone 1 - Blocs 1 2 3 et chaine morte Pass-1',
    position: [-6400, -900],
    width: 14640,
    height: 1360,
    content:
      'Zone 1 — Blocs 1, 2, 3 : Reception & correlation, Grounding des sources, Planification (34 noeuds)\n' +
      "Reception du webhook, correlation, resolution de branche existante/nouvelle, grounding des sources " +
      "(+ extension sources referencees/dependances), planification du patch : 27 noeuds. Inclut aussi, " +
      "dans la meme boite geometrique (bande du haut, y negatif), les 7 noeuds de la chaine de " +
      "reconciliation Pass-1 (Bloc 8, duplicata mort) — aucune entree detectee par l'analyse, jamais " +
      "atteinte depuis le Webhook, conservee telle quelle. Les deux groupes sont visuellement adjacents " +
      "mais fonctionnellement independants.",
  },
  {
    id: 'r86-sticky-zone-2',
    name: 'Sticky - Zone 2 - Blocs 4 5 et extension cross-fichiers',
    position: [8448, 1180],
    width: 15536,
    height: 820,
    content:
      'Zone 2 — Blocs 4, 5 + extension cross-fichiers (Blocs 6/7) : Generation du patch, preflight, ' +
      'verification multi-fichiers (29 noeuds)\n' +
      'Generation du patch par fichier (9 noeuds, Bloc 4), controle mecanique deterministe ' +
      '(1 noeud, Bloc 5 : Generic Candidate Preflight), puis extension cross-fichiers : assemblage du ' +
      "manifeste candidat, revue semantique independante, compilation/tests/revue sur l'ensemble des " +
      'fichiers du candidat (19 noeuds).',
  },
  {
    id: 'r86-sticky-zone-3',
    name: 'Sticky - Zone 3 - Bloc 8 debut verification et garde ecriture',
    position: [24020, -10],
    width: 8140,
    height: 480,
    content:
      "Zone 3 — Bloc 8, debut : Verification du candidat et garde d'ecriture (15 noeuds)\n" +
      'Hash/assemblage du manifeste candidat, verification du candidat, garde d\'ecriture (Write Guard), ' +
      "garde de derive de tete distante (Remote Head Drift Guard), preparation de la creation de branche.",
  },
  {
    id: 'r86-sticky-zone-4',
    name: 'Sticky - Zone 4 - Bloc 8 boucle Pass-2 ecriture et reconciliation',
    position: [32448, 1300],
    width: 8720,
    height: 680,
    content:
      'Zone 4 — Bloc 8, boucle Pass-2 : Ecriture et reconciliation Git (16 noeuds)\n' +
      "Decision creation/modification par fichier, ecriture sur la branche, verification du hash apres " +
      'ecriture, detection de conflit distant, reconciliation si necessaire, avec re-entree de boucle.',
  },
  {
    id: 'r86-sticky-zone-5',
    name: 'Sticky - Zone 5 - Bloc 8 fin completude et pull request',
    position: [39520, 70],
    width: 5760,
    height: 480,
    content:
      'Zone 5 — Bloc 8, fin : Completude du lot et Pull Request (10 noeuds)\n' +
      'Boucle sur les fichiers du manifeste, controle de completude du lot, creation ou reutilisation de ' +
      "la Pull Request, enregistrement du resultat aupres du backend, notification par email.",
  },
  {
    id: 'r86-sticky-zone-6',
    name: 'Sticky - Zone 6 - Chemins echec transversal',
    position: [-6040, 2880],
    width: 51700,
    height: 420,
    content:
      "Zone 6 — Chemins d'echec, transversal, tous blocs (78 noeuds)\n" +
      '74 Failure Envelopes + 4 gestionnaires/agregateur (Persist Verification Failure, Persist Base ' +
      'Moved Failure, Prepare WF2 Failure Status, Persist WF2 Failure Status) convergent ici vers le ' +
      'callback backend. Chaque etape du flux nominal a son filet dans cette bande.',
  },
];

/** Regroupe les annotations visuelles du workflow. */
export function consolidateStickyZones(workflow) {
  workflow.nodes = workflow.nodes.filter(
    (n) => n.type !== 'n8n-nodes-base.stickyNote' || !OLD_STICKY_NAMES.includes(n.name),
  );
  for (const zone of ZONES) {
    workflow.nodes.push({
      parameters: { content: zone.content, height: zone.height, width: zone.width },
      id: zone.id,
      name: zone.name,
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: zone.position,
    });
  }
  return workflow;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const input = process.argv[2], output = process.argv[3] || input;
  if (!input) throw new Error('usage: node harden-wf2-r86-sticky-zone-consolidation.mjs <input.json> [output.json]');
  const root = JSON.parse(readFileSync(input, 'utf8'));
  const workflow = Array.isArray(root) ? root[0] : root;
  consolidateStickyZones(workflow);
  writeFileSync(output, JSON.stringify(root, null, 2) + '\n');
  console.log(`WF2 sticky zones consolidated (R86): 11 -> 6, ${workflow.nodes.length} nodes total.`);
}
