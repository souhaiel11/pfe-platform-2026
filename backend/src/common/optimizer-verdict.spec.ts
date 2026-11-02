import * as assert from 'assert';
import { optimizerVerdict, currentOptimizerVerdict } from './optimizer-verdict';

async function main() {
  const result = { summary: 'Old findings', issues: [
    { id: 'style', severity: 'LOW' },
    { id: 'performance', severity: 'HIGH', category: 'performance' },
    { id: 'runtime', severity: 'BLOCKER', category: 'CAT-JDK' },
    { id: 'security', severity: 'HIGH', category: 'CAT-SECURITY' },
  ] };
  assert.deepStrictEqual(optimizerVerdict(result).issues.map((i: any) => i.id), ['runtime', 'security']);
  assert.deepStrictEqual(optimizerVerdict(result, { number: 42 }).issues.map((i: any) => i.id), ['security']);
  assert.strictEqual(result.issues.length, 4, 'original evidence must remain intact');
  assert.match(optimizerVerdict({ issues: [] }).summary, /Aucun problème/);
  const row = { status: 'done', result };
  const noEvidence = await currentOptimizerVerdict(row, null, 'Dockerfile');
  assert.strictEqual(noEvidence.result.validation, null);
  assert.strictEqual(noEvidence.result.issues.length, 2);
  const originalFetch = globalThis.fetch;
  const project: any = { jenkinsInternalUrl: 'http://jenkins', jenkinsJobName: 'app', githubRepo: 'owner/app' };
  let sha = 'abc';
  let dockerStatus = 'SUCCESS';
  globalThis.fetch = (async (url: any) => {
    const data = String(url).includes('lastBuild')
      ? { result: 'SUCCESS', building: false, timestamp: Date.now(), number: 42, actions: [{ lastBuiltRevision: { SHA1: 'abc' } }] }
      : String(url).includes('commits/HEAD') ? { sha }
      : String(url).includes('wfapi') ? { stages: [{ name: 'Docker Build', status: dockerStatus }] }
      : { type: 'file' };
    return { ok: true, json: async () => data } as Response;
  }) as typeof fetch;
  try {
    const saved = { ...row, createdAt: new Date(0) };
    assert.strictEqual((await currentOptimizerVerdict(saved, project, 'Jenkinsfile')).result.validation.number, 42);
    sha = 'different';
    assert.strictEqual((await currentOptimizerVerdict(saved, project, 'Jenkinsfile')).result.validation, null);
    sha = 'abc';
    dockerStatus = 'NOT_EXECUTED';
    assert.strictEqual((await currentOptimizerVerdict(saved, project, 'Dockerfile')).result.validation, null);
    dockerStatus = 'SUCCESS';
    assert.strictEqual((await currentOptimizerVerdict(saved, project, 'Dockerfile')).result.validation.number, 42);
  } finally { globalThis.fetch = originalFetch; }
  console.log('optimizer verdict: passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
