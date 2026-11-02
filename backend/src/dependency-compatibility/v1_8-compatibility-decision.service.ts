// Recherche une décision de compatibilité dans le magasin de preuves pour le contexte demandé. Une preuve inconnue n'est pas remplacée par une validation supposée.
import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { V1_8CompatibilityDecision } from './v1_8-compatibility-decision.types';

export interface V1_8EvidenceStoreFile {
  generatedAt: string;
  entryCount: number;
  decisions: Record<string, V1_8CompatibilityDecision>;
}

/** Prépare le résultat lié à inconnu finding décision. */
function unknownFindingDecision(source: string, cve: string, pkg: string, installedVersion: string): V1_8CompatibilityDecision {
  return {
    evidenceId: '', schemaVersion: 2, repository: '', validatedCommitSha: '',
    findingSource: String(source).toUpperCase() as 'OWASP' | 'TRIVY', cve, component: pkg, installedVersion,
    validationRunId: '', validatedAt: '',
    state: 'NOT_YET_SANDBOXED',
    recommendedVersion: null, actualEditTarget: null, editType: null, fromVersion: null, toVersion: null, expectedResolvedDependency: null,
    ownerType: null, ownerCoordinate: null,
    evidenceSummary: 'This finding is not present in the V1.8 evidence store (generated from report #149\'s 251 real findings) -- never fabricated as any other state.',
    recommendationReason: 'NOT_YET_SANDBOXED',
    sandboxValidated: false, targetCveClosed: null, newHighCriticalCount: null, requiresDeveloperReview: true,
  };
}

@Injectable()
export class V1_8CompatibilityDecisionService {
  private readonly store: V1_8EvidenceStoreFile;

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(evidenceStorePath?: string) {
    const path = evidenceStorePath ?? join(__dirname, 'v1_8-evidence-store.json');
    this.store = JSON.parse(readFileSync(path, 'utf8'));
  }

  /** Recherche la décision correspondant au contexte demandé. */
  lookup(source: string, cve: string, pkg: string, installedVersion = ''): V1_8CompatibilityDecision {
    const key = `${String(source).toUpperCase()}:${cve}:${pkg}`;
    return this.store.decisions[key] ?? unknownFindingDecision(source, cve, pkg, installedVersion);
  }

  /** Renvoie la date de génération du magasin de preuves. */
  get generatedAt(): string {
    return this.store.generatedAt;
  }

  /** Renvoie le nombre d’entrées du magasin de preuves. */
  get entryCount(): number {
    return this.store.entryCount;
  }
}
