// Collecte les versions corrigées candidates à partir de preuves de sécurité et conserve leur origine pour assurer la traçabilité.
import {
  CorrelationQualification, buildTrivyFixedVersionIndex, parseFixedVersionCandidates, qualifyOwaspFixedVersionCorrelation,
} from '../manual-remediation/owasp-trivy-fixed-version-correlation';

export type SecurityEvidenceType = 'NATIVE_SCAN_VALUE' | 'STRUCTURED_FIXED_VERSION' | 'TRIVY_CORRELATED_EXACT' | 'TRIVY_CORRELATED_MULTI';

export interface SecurityCandidate {
  version: string;
  source: 'OWASP' | 'TRIVY';
  cve: string;
  evidenceType: SecurityEvidenceType;
  /** The raw, un-split scanner string this candidate was derived from -- never fabricated, always traceable. */
  rawEvidence?: string;
}

export interface SecurityCandidateKey {
  cve: string;
  pkg: string;
  installedVersion: string;
}

export interface SecurityFixedVersionProvider {
  /** Rassemble les candidats issus des sources disponibles. */
  collect(key: SecurityCandidateKey): SecurityCandidate[];
}

/**
 * OWASP's own native fixedVersion is unconditionally null in this platform's
 * real data (see fixed-version-normalizer.ts's own grounding comment) --
 * this provider exists for completeness/interface symmetry, and honestly
 * returns nothing rather than being silently absent from the provider list.
 */
export class OwaspNativeFixedVersionProvider implements SecurityFixedVersionProvider {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly nativeFixedVersion: string | null | undefined) {}
  /** Rassemble les candidats issus des sources disponibles. */
  collect(key: SecurityCandidateKey): SecurityCandidate[] {
    const raw = String(this.nativeFixedVersion ?? '').trim();
    if (!raw) return [];
    return parseFixedVersionCandidates(raw).map(version => ({
      version, source: 'OWASP', cve: key.cve, evidenceType: 'NATIVE_SCAN_VALUE', rawEvidence: raw,
    }));
  }
}

export class TrivyNativeFixedVersionProvider implements SecurityFixedVersionProvider {
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private readonly nativeFixedVersion: string | null | undefined) {}
  /** Rassemble les candidats issus des sources disponibles. */
  collect(key: SecurityCandidateKey): SecurityCandidate[] {
    const raw = String(this.nativeFixedVersion ?? '').trim();
    if (!raw) return [];
    return parseFixedVersionCandidates(raw).map(version => ({
      version, source: 'TRIVY', cve: key.cve, evidenceType: 'STRUCTURED_FIXED_VERSION', rawEvidence: raw,
    }));
  }
}

export class TrivyCorrelationCandidateProvider implements SecurityFixedVersionProvider {
  private readonly index: Map<string, CorrelationQualification>;
  /** Initialise les dépendances et l’état de ce composant. */
  constructor(trivyCves: any[]) {
    this.index = buildTrivyFixedVersionIndex(trivyCves);
  }

  /** Rassemble les candidats issus des sources disponibles. */
  collect(key: SecurityCandidateKey): SecurityCandidate[] {
    const qualification = qualifyOwaspFixedVersionCorrelation(key, this.index);
    switch (qualification.kind) {
      case 'SINGLE_EXACT':
        return [{ version: qualification.fixedVersion, source: 'TRIVY', cve: key.cve, evidenceType: 'TRIVY_CORRELATED_EXACT', rawEvidence: qualification.raw }];
      case 'UNSUPPORTED_FORMAT':
        return parseFixedVersionCandidates(qualification.raw).map(version => ({
          version, source: 'TRIVY', cve: key.cve, evidenceType: 'TRIVY_CORRELATED_MULTI', rawEvidence: qualification.raw,
        }));
      case 'AMBIGUOUS': {
        // Multiple DISTINCT raw Trivy rows disagreed on the fixed-version
        // string for the same key -- flatten each (some may themselves be
        // comma-joined), de-duplicate, keep every one as its own candidate.
        const versions = new Set<string>();
        for (const raw of qualification.distinctValues) for (const v of parseFixedVersionCandidates(raw)) versions.add(v);
        return [...versions].map(version => ({
          version, source: 'TRIVY', cve: key.cve, evidenceType: 'TRIVY_CORRELATED_MULTI' as const, rawEvidence: qualification.distinctValues.join(' | '),
        }));
      }
      case 'NO_TARGET':
      case 'NO_MATCH':
      default:
        return [];
    }
  }
}

/** Rassemble sécurité candidats. */
export function collectSecurityCandidates(key: SecurityCandidateKey, providers: SecurityFixedVersionProvider[]): SecurityCandidate[] {
  const seen = new Set<string>();
  const out: SecurityCandidate[] = [];
  for (const provider of providers) {
    for (const candidate of provider.collect(key)) {
      const dedupeKey = `${candidate.source}:${candidate.version}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push(candidate);
    }
  }
  return out;
}
