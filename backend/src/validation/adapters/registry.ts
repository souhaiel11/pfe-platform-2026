// R80 §9 — the ONLY place that lists which adapters this platform trusts.
// incidents.service.ts (core policy wiring) selects an adapter purely by
// `reportFormat` string — it never imports a concrete adapter class itself
// and never branches on project name, language, or framework.

import { SemanticEvidenceAdapter } from '../semantic-evidence-core';
import { JUnitSemanticEvidenceAdapter } from './junit-semantic-evidence-adapter';
import { StructuredJsonSemanticEvidenceAdapter } from './structured-json-semantic-evidence-adapter';

const ADAPTERS: SemanticEvidenceAdapter[] = [
  new JUnitSemanticEvidenceAdapter(),
  new StructuredJsonSemanticEvidenceAdapter(),
];

/** Returns the platform-approved adapter for a report format, or undefined for an unsupported/unrecognized one — never a best-effort guess. */
export function resolveSemanticEvidenceAdapter(reportFormat: string | undefined | null): SemanticEvidenceAdapter | undefined {
  return ADAPTERS.find(a => a.supports(String(reportFormat || '')));
}
