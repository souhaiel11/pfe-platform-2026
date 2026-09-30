// V1.8 Phase 4 ticket — read-only lookup service over the immutable
// evidence store (v1_8-evidence-store.json, generated once by
// v1_8_phase4_generate_evidence_store.ts). Loaded once at module load
// (require cache), never recomputed per request, never shells out to
// mvn/git/docker -- see that generator's own header comment for why.
//
// This service NEVER writes to Postgres/ManualRemediationTask and is never
// consulted by WF6 dispatch (manual-remediation.service.ts's
// launchBatchRemediation()) or by the existing checkbox-eligibility gate
// (cve-selection-eligibility.ts) -- it is purely additive read access, one
// new field alongside data those paths already return unchanged.
import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { V1_8CompatibilityDecision } from './v1_8-compatibility-decision.types';

export interface V1_8EvidenceStoreFile {
  generatedAt: string;
  entryCount: number;
  decisions: Record<string, V1_8CompatibilityDecision>;
}

/** No binding to fabricate for a finding the evidence store has never seen -- `evidenceId`/`validationRunId` are the empty string (never a real-looking id) and repository/commit echo back whatever the caller asked about, never a guessed "matching" value, so the Phase 3 stale-guard (v1_8-security-remediation-gate.ts) still has SOMETHING to compare against and will correctly find nothing conclusive. */
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

  constructor(evidenceStorePath?: string) {
    const path = evidenceStorePath ?? join(__dirname, 'v1_8-evidence-store.json');
    this.store = JSON.parse(readFileSync(path, 'utf8'));
  }

  /** source is normalized upper-case, matching how ManualRemediationTask.source/ruleOrCve are already persisted (manual-remediation.entity.ts). */
  lookup(source: string, cve: string, pkg: string, installedVersion = ''): V1_8CompatibilityDecision {
    const key = `${String(source).toUpperCase()}:${cve}:${pkg}`;
    return this.store.decisions[key] ?? unknownFindingDecision(source, cve, pkg, installedVersion);
  }

  get generatedAt(): string {
    return this.store.generatedAt;
  }

  get entryCount(): number {
    return this.store.entryCount;
  }
}
