// Seul endroit qui liste les adaptateurs de preuve sémantique que la plateforme reconnaît.

import { SemanticEvidenceAdapter } from '../semantic-evidence-core';
import { JUnitSemanticEvidenceAdapter } from './junit-semantic-evidence-adapter';
import { StructuredJsonSemanticEvidenceAdapter } from './structured-json-semantic-evidence-adapter';

const ADAPTERS: SemanticEvidenceAdapter[] = [
  new JUnitSemanticEvidenceAdapter(),
  new StructuredJsonSemanticEvidenceAdapter(),
];

// Renvoie l'adaptateur approuvé par la plateforme pour un format de rapport donné,
// ou `undefined` pour un format non supporté/non reconnu — jamais une supposition.
export function resolveSemanticEvidenceAdapter(reportFormat: string | undefined | null): SemanticEvidenceAdapter | undefined {
  return ADAPTERS.find(a => a.supports(String(reportFormat || '')));
}
