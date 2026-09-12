import * as assert from 'node:assert/strict';
import { IncidentsService } from './incidents.service';

// BRIQUE 3 CLOSEOUT — PART 1 / TEST A & B: startFix() (approveFix/retryFix)
// must freeze fixRequest.baselineSha from incident.metadata.sourceCommitSha
// -- the exact source commit Jenkins/WF1 reported for the build that
// produced this incident's findings (see wf1-incident-intake-analysis-v5-1's
// "Prepare Final Report" node, and n8n-workflows/scripts/
// wf1-source-commit-sha.spec.mjs for the WF1-side proof it is threaded
// there). Never re-derived from "latest main"; never refreshed on retry.

const SHA = 'c'.repeat(40);

const sonar = (id: string) => ({
  id, source: 'SONARQUBE', stage: 'sonar', remediationType: 'AUTO_FIX_ELIGIBLE',
  rule: 'java:S1068', file: `src/${id}.java`, line: 10, message: `Finding ${id}`,
});

function makeFixture(sourceCommitSha: string | null) {
  const incident: any = {
    id: 'incident-1', projectId: 'project-1', status: 'blocked', prUrl: null, buildNumber: 100,
    metadata: {
      ...(sourceCommitSha ? { sourceCommitSha } : {}),
      enrichedData: { sonar: { issues: [sonar('a')] } },
    },
  };
  const project = { id: 'project-1', githubRepo: 'owner/repo' };
  const transactionalRepo = {
    findOne: async (_options: any) => incident,
    update: async (_id: string, patch: any) => Object.assign(incident, patch),
  };
  const transactionalProjectRepo = { findOne: async () => project };
  const repository: any = {
    manager: { transaction: async (fn: any) => fn({ getRepository: (entity: any) => entity?.name === 'Project' ? transactionalProjectRepo : transactionalRepo }) },
    findOne: async () => incident,
    update: transactionalRepo.update,
  };
  const service = new IncidentsService(repository, transactionalProjectRepo as any, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any, {} as any);
  return { incident, service };
}

async function main() {
  const user = { id: 'developer-1', role: 'developer' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 200 })) as any;
  const savedWf2Id = process.env.N8N_WF2_ID;
  process.env.N8N_WF2_ID = 'u3eeMwTuhCsetfcS';
  try {

  // TEST A — a real, trustworthy source commit SHA is captured and frozen.
  {
    const { incident, service } = makeFixture(SHA);
    await service.approveFix(incident.id, user, { findingIds: ['a'] });
    assert.equal(incident.metadata.fixRequest.baselineSha, SHA, 'TEST A: baselineSha frozen from incident.metadata.sourceCommitSha');
  }

  // TEST B — the incoming Jenkins/WF1 event carried no trustworthy source
  // SHA at all: baselineSha must stay null, never guessed (e.g. never
  // falling back to prHeadSha, buildNumber, or any other unrelated field).
  {
    const { incident, service } = makeFixture(null);
    await service.approveFix(incident.id, user, { findingIds: ['a'] });
    assert.equal(incident.metadata.fixRequest.baselineSha, null, 'TEST B: missing source SHA -> baselineSha stays null, never guessed');
  }

  // Malformed sourceCommitSha (not a full 40-hex SHA) is treated exactly
  // like "absent" -- never partially trusted.
  {
    const { incident, service } = makeFixture('not-a-real-sha');
    await service.approveFix(incident.id, user, { findingIds: ['a'] });
    assert.equal(incident.metadata.fixRequest.baselineSha, null, 'a malformed sourceCommitSha is never trusted as a partial SHA');
  }

  // Retry never re-derives/refreshes the frozen baselineSha, even if
  // incident.metadata.sourceCommitSha were to change in the meantime.
  {
    const { incident, service } = makeFixture(SHA);
    const first = await service.approveFix(incident.id, user, { findingIds: ['a'] });
    incident.metadata.fixRequest = { ...incident.metadata.fixRequest, status: 'FIX_FAILED', retryEligible: true, attempts: [{ attempt: 1, status: 'FIX_FAILED' }] };
    incident.metadata.sourceCommitSha = 'd'.repeat(40); // hypothetical drift -- must never be picked up on retry
    await service.retryFix(incident.id, user);
    assert.equal(incident.metadata.fixRequest.baselineSha, SHA, 'retry reuses the originally frozen baselineSha, never re-derives it');
    assert.equal((first as any).duplicate, false);
  }

  console.log('Baseline SHA freeze at startFix() (Brique 3 closeout Part 1): PASS');
  } finally {
    globalThis.fetch = originalFetch;
    if (savedWf2Id === undefined) delete process.env.N8N_WF2_ID; else process.env.N8N_WF2_ID = savedWf2Id;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
