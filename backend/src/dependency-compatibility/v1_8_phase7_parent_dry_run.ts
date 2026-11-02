// Vérifie à blanc les plans touchant une version de parent Maven et leur admissibilité.
import { readFileSync } from 'fs';
import { join } from 'path';
import { writeParentVersionPatch, ParentVersionPatchRequest } from '../security-remediation/maven-parent-patch-writer';
import { V1_8CompatibilityDecision } from './v1_8-compatibility-decision.types';

const storePath = join(__dirname, 'v1_8-evidence-store.json');
const store: { decisions: Record<string, V1_8CompatibilityDecision> } = JSON.parse(readFileSync(storePath, 'utf8'));

type Classification = 'SUPPORTED' | 'UNSUPPORTED' | 'INVALID_PLAN' | 'STALE_EVIDENCE';

/** Récupère Real POM XML. */
async function fetchRealPomXml(repository: string, commitSha: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${repository}/${commitSha}/pom.xml`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  return res.text();
}

/** Exécute les étapes principales de ce programme. */
async function main() {
  const parentFindings = Object.entries(store.decisions)
    .filter(([, e]) => e.state === 'VALIDATED_RECOMMENDED' && e.editType === 'PARENT_VERSION')
    .map(([key, e]) => ({ key, e }));

  console.log('══════════════════════════════════════════════════');
  console.log('V1.8 Phase 7 — PARENT_VERSION writer dry run (offline, no dispatch)');
  console.log('══════════════════════════════════════════════════');
  console.log('PARENT_FINDINGS:', parentFindings.length);

  /** Prépare le résultat lié à plan clé. */
  const planKey = (e: V1_8CompatibilityDecision) => [e.repository, e.actualEditTarget, e.fromVersion, e.toVersion].join('|');
  const uniquePlans = new Map<string, V1_8CompatibilityDecision>();
  for (const { e } of parentFindings) if (!uniquePlans.has(planKey(e))) uniquePlans.set(planKey(e), e);
  console.log('UNIQUE_PARENT_PLANS:', uniquePlans.size);
  for (const [k, e] of uniquePlans) console.log(`  - ${k} (recommendedVersion example: ${e.recommendedVersion})`);
  console.log();

  // Fetch the real pom.xml ONCE per unique (repository, validatedCommitSha) pair.
  const pomCache = new Map<string, string>();
  /** Prépare le POM correspondant au scénario demandé. */
  async function pomFor(repository: string, commitSha: string): Promise<string> {
    const k = `${repository}@${commitSha}`;
    if (!pomCache.has(k)) pomCache.set(k, await fetchRealPomXml(repository, commitSha));
    return pomCache.get(k)!;
  }

  /** Renvoie courant HEAD pour le traitement ou l’affichage. */
  async function currentHead(repository: string): Promise<string> {
    const res = await fetch(`https://api.github.com/repos/${repository}/commits/main`);
    const body: any = await res.json();
    return String(body.sha || '').toLowerCase();
  }
  const headByRepo = new Map<string, string>();

  const results: { key: string; classification: Classification; detail: string }[] = [];
  for (const { key, e } of parentFindings) {
    if (!e.repository || !e.validatedCommitSha || !e.actualEditTarget || !e.fromVersion || !e.toVersion) {
      results.push({ key, classification: 'INVALID_PLAN', detail: 'Missing repository/validatedCommitSha/actualEditTarget/fromVersion/toVersion on the evidence entry.' });
      continue;
    }
    if (!headByRepo.has(e.repository)) headByRepo.set(e.repository, await currentHead(e.repository));
    const head = headByRepo.get(e.repository)!;
    if (head !== e.validatedCommitSha.toLowerCase()) {
      results.push({ key, classification: 'STALE_EVIDENCE', detail: `repo HEAD "${head}" != validatedCommitSha "${e.validatedCommitSha}".` });
      continue;
    }
    let pom: string;
    try {
      pom = await pomFor(e.repository, e.validatedCommitSha);
    } catch (err: any) {
      results.push({ key, classification: 'UNSUPPORTED', detail: `Could not fetch real pom.xml: ${err.message}` });
      continue;
    }
    const request: ParentVersionPatchRequest = {
      findingIdentity: key, evaluatedSha: e.validatedCommitSha, ecosystem: 'MAVEN', editType: 'PARENT_VERSION',
      actualEditTarget: e.actualEditTarget, fromVersion: e.fromVersion, toVersion: e.toVersion,
      controllingFile: 'pom.xml', sourceContent: pom,
    };
    const result: any = writeParentVersionPatch(request);
    if (result.ok === true) {
      results.push({ key, classification: 'SUPPORTED', detail: `writer produced a candidate: ${e.fromVersion} -> ${e.toVersion} on ${e.actualEditTarget}.` });
    } else {
      const staleReasons = new Set(['PARENT_VERSION_MISMATCH', 'PARENT_GROUP_MISMATCH', 'PARENT_ARTIFACT_MISMATCH', 'PARENT_BLOCK_NOT_FOUND']);
      results.push({ key, classification: staleReasons.has(result.reason) ? 'STALE_EVIDENCE' : 'UNSUPPORTED', detail: `${result.reason}: ${result.detail}` });
    }
  }

  console.log('PER-FINDING CLASSIFICATION:');
  for (const r of results) console.log(`  - ${r.key} -> ${r.classification} (${r.detail})`);
  console.log();
  const counts = { SUPPORTED: 0, UNSUPPORTED: 0, INVALID_PLAN: 0, STALE_EVIDENCE: 0 } as Record<Classification, number>;
  for (const r of results) counts[r.classification]++;
  console.log('SUPPORTED:', counts.SUPPORTED);
  console.log('UNSUPPORTED:', counts.UNSUPPORTED);
  console.log('INVALID_PLAN:', counts.INVALID_PLAN);
  console.log('STALE_EVIDENCE:', counts.STALE_EVIDENCE);

  if (results.length !== 11) throw new Error(`Expected exactly 11 PARENT_VERSION VALIDATED_RECOMMENDED findings, got ${results.length}`);
  console.log('\nv1_8_phase7_parent_dry_run.ts: DONE, LIVE_DISPATCH=NO, PR_CREATED=NO');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
