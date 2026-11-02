// Vérifie avec PostgreSQL la persistance des résultats de l'agent et la distinction entre succès du transport et succès réel de déploiement.
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Project } from '../src/projects/project.entity';
import { Incident, IncidentStatus } from '../src/incidents/incident.entity';
import { Report } from '../src/reports/report.entity';
import { DeploymentArtifact } from '../src/azure-deploy/deployment-artifact.entity';
import { DeploymentAuthorization } from '../src/azure-deploy/deployment-authorization.entity';
import { DeploymentAttempt } from '../src/azure-deploy/deployment-attempt.entity';
import { AzureDeployReadinessService } from '../src/azure-deploy/azure-deploy-readiness.service';
import { DeploymentArtifactService } from '../src/azure-deploy/deployment-artifact.service';
import { DeploymentAuthorizationService } from '../src/azure-deploy/deployment-authorization.service';

process.env.AZURE_DEPLOY_AGENT_URL = 'http://mock-agent.invalid';
process.env.AZURE_DEPLOY_AGENT_SECRET = 'disposable-test-secret';
process.env.DEPLOYMENT_AUTHORIZATION_REQUIRED = 'true';
const { AzureDeployController } = require('../src/azure-deploy/azure-deploy.module');
const SHA = '393816c250f73d907eb5a2dd43b2ec2288c7abcb';
const DIGEST = 'sha256:6dc3cdba69592a91a5a1569978bcfca74d4080597a769ab368ed585ba397bcf5';
const healthy = JSON.parse(readFileSync(resolve(__dirname, '../../docs/qa/healthy-artifact-2b7-20261006/canary-deploy.json'), 'utf8')).body;
const actor = { user: { id: 'test-admin', role: 'admin' } };

/** Exécute les étapes principales de ce programme. */
async function main() {
  // Fixed disposable endpoint; deliberately cannot be redirected to live DB.
  const ds = new DataSource({ type: 'postgres', host: '127.0.0.1', port: 15558,
    username: 'testuser', password: 'testpass', database: 'testdb', synchronize: false,
    entities: [Project, Incident, Report, DeploymentArtifact, DeploymentAuthorization, DeploymentAttempt] });
  await ds.initialize();
  const originalFetch = globalThis.fetch;
  try {
    const projects = ds.getRepository(Project), attempts = ds.getRepository(DeploymentAttempt);
    const auths = ds.getRepository(DeploymentAuthorization);
    const readiness = new AzureDeployReadinessService(ds.getRepository(Report), projects, ds.getRepository(Incident));
    const artifacts = new DeploymentArtifactService(ds.getRepository(DeploymentArtifact), projects, readiness);
    const service = new DeploymentAuthorizationService(auths, projects, ds.getRepository(Report), attempts, readiness, artifacts);
    const controller = new AzureDeployController(readiness, artifacts, service, projects, attempts);
    const project = await projects.save(projects.create({ name: 'phase2b8a-build151', githubRepo: 'souhaiel11/pfe-app-test',
      azureConfig: { provider: 'azure-container-instances', resourceGroup: 'rg-pfe-devsecops', registry: 'acrpfedevsecops',
        imageRepository: 'pfe-app-test', targetName: 'aci-pfe-app-test', region: 'francecentral' } }));
    await ds.getRepository(Incident).save({ projectId: project.id, title: 'build 151', status: IncidentStatus.COMPLETED,
      buildNumber: 151, metadata: { sourceCommitSha: SHA } });
    await ds.getRepository(DeploymentArtifact).save({ projectId: project.id, buildNumber: 151, commitSha: SHA,
      registry: 'acrpfedevsecops', repository: 'pfe-app-test', tag: '151', digest: DIGEST,
      source: 'MANUAL_REGISTERED', provenanceVerified: true });
    let calls = 0;
    let deploymentTransport: () => Promise<Response>;
    let snapshot: any;
    let requestId: string;
    globalThis.fetch = (async (url: any, options: any) => {
      assert.equal(new URL(String(url)).hostname, 'mock-agent.invalid');
      const input = JSON.parse(options.body);
      if (String(url).endsWith('/resolve-digest')) return Response.json({ ...input, found: true, digest: DIGEST });
      if (String(url).endsWith('/inspect-artifact')) return Response.json({ found: true, revision: SHA,
        source: 'https://github.com/souhaiel11/pfe-app-test' });
      assert.ok(String(url).endsWith('/deploy'));
      calls++;
      assert.equal(input.artifactDigest, DIGEST);
      assert.equal(input.imageTag, '151'); // caller's moving tag is ignored
      assert.equal(input.target.imageRepository, 'pfe-app-test');
      const pending = await attempts.findOneByOrFail({ requestId });
      assert.equal(pending.dispatchStatus, 'DISPATCHING');
      assert.equal((await auths.findOneByOrFail({ id: pending.authorizationId })).status, 'CONSUMED');
      snapshot = pending;
      return deploymentTransport();
    }) as typeof fetch;

    const cases: Array<{ name: string; payload?: any; http?: number; error?: Error; invalidJson?: boolean; success?: boolean; terminal?: 'FAILED' | 'DEPLOYED' }> = [
      { name: '151-healthy', payload: healthy, success: true },
      { name: '151-unhealthy', payload: { ...healthy, healthOk: false, health: 'health timeout' } },
      { name: 'health-false-exact', payload: { success: true, healthOk: false } },
      { name: 'success-false', payload: { ...healthy, success: false } },
      { name: 'both-false', payload: { success: false, healthOk: false } },
      { name: 'missing-health', payload: { success: true } },
      { name: 'missing-success', payload: { healthOk: true } },
      { name: 'invalid-booleans', payload: { success: 'true', healthOk: 1 } },
      { name: 'null', payload: null },
      { name: 'array', payload: [] },
      { name: 'invalid-json', invalidJson: true },
      { name: 'create-failure', http: 500, payload: { success: false, error: 'CONTAINER_CREATE_FAILED', steps: [] } },
      { name: 'pull-failure', payload: { ...healthy, success: false, healthOk: false, state: 'Failed' } },
      { name: 'health-failure', payload: { ...healthy, healthOk: false, health: 'unhealthy' } },
      { name: 'http400', http: 400, payload: { error: 'INVALID_TARGET' } },
      { name: 'http503', http: 503, payload: healthy },
      { name: 'http500-invalid-json', http: 500, invalidJson: true },
      { name: 'timeout', error: new DOMException('timeout', 'TimeoutError') },
      { name: 'connection-failure', error: new TypeError('fetch failed') },
      { name: 'failed-cannot-become-deployed', payload: healthy, terminal: 'FAILED' },
      { name: 'deployed-cannot-become-failed', payload: { ...healthy, healthOk: false }, terminal: 'DEPLOYED' },
    ];
    for (const test of cases) {
      requestId = `phase2b8a-${test.name}`;
      /** Simule le transport vers l’agent de déploiement. */
      deploymentTransport = async () => {
        if (test.terminal) {
          // Simulate another completion arriving while the outbound call
          // is in flight. Only fixture DB state changes, no repository mock.
          await attempts.update(snapshot.id, { dispatchStatus: test.terminal, completedAt: new Date() });
          const current = await projects.findOneByOrFail({ id: project.id });
          current.azureDeploymentState!.status = test.terminal;
          await projects.save(current);
        }
        if (test.error) throw test.error;
        return test.invalidJson ? new Response('not JSON', { status: test.http || 200 }) : Response.json(test.payload, { status: test.http || 200 });
      };
      const authorization = await controller.authorize(project.id, {
        mainBuildNumber: 151, tag: '151', mode: 'CRITICAL_OVERRIDE', reason: 'Controlled source-only regression test',
        acknowledgements: { criticalRiskAccepted: true, securityControlsMayHaveFailed: true, deploymentMayExposeKnownRisk: true },
        confirmationPhrase: 'DEPLOYER MALGRÉ LES RISQUES',
      }, actor);
      let response: any, error: any;
      try { response = await controller.deploy({ projectId: project.id, requestId, authorizationId: authorization.authorizationId, imageTag: 'latest' }, actor); }
      catch (caught) { error = caught; }
      if (test.success) {
        assert.equal(error, undefined);
        assert.equal(response.success, true);
        assert.equal(response.healthOk, true);
        assert.equal(response.artifactDigest, DIGEST);
      } else {
        assert.ok(error instanceof HttpException, `${test.name}: API must reject`);
        assert.equal(error.getStatus(), test.terminal ? 409 : test.http || 502);
        if (!test.terminal) assert.equal((error.getResponse() as any).success, false);
        assert.equal(response, undefined, 'frontend cannot receive successful next response');
      }
      const attempt = await attempts.findOneByOrFail({ authorizationId: authorization.authorizationId });
      const state = (await projects.findOneByOrFail({ id: project.id })).azureDeploymentState!;
      const expected = test.terminal || (test.success ? 'DEPLOYED' : 'FAILED');
      assert.equal(attempt.dispatchStatus, expected);
      assert.equal(state.status, expected);
      if (!test.terminal) assert.equal(state.attemptId, attempt.id);
      assert.equal(state.requestId, requestId);
      assert.ok(attempt.completedAt);
      if (test.terminal) {
        assert.equal(attempt.dispatchResult, null, 'late completion must not rewrite terminal audit result');
      } else {
        assert.equal(attempt.dispatchResult!.transportSuccess, !test.error && (!test.http || test.http < 300));
        assert.equal(attempt.dispatchResult!.deploymentSuccess, !!test.success);
        if (!test.success) assert.ok(state.failureReason);
      }
      for (const key of Object.keys(snapshot)) {
        if (!['dispatchStatus', 'dispatchResult', 'completedAt'].includes(key)) assert.deepEqual(attempt[key], snapshot[key], `immutable ${key}`);
      }
      const auth = await auths.findOneByOrFail({ id: authorization.authorizationId });
      assert.equal(auth.status, 'CONSUMED');
      assert.ok(auth.consumedAt);
      const before = calls;
      await assert.rejects(controller.deploy({ projectId: project.id, requestId, authorizationId: auth.id }, actor),
        (e: any) => e instanceof HttpException && e.getStatus() === 409);
      assert.equal(calls, before, 'consumed authorization never dispatches again');
      assert.equal(await attempts.countBy({ authorizationId: auth.id }), 1);
      assert.equal((await attempts.findOneByOrFail({ id: attempt.id })).dispatchStatus, expected);
      console.log(`PASS ${test.name}: ${expected}, consumed, immutable, no replay`);
    }
    console.log(`ACTUAL_GOVERNED_PATH_POSTGRES_PASS = YES (${cases.length} scenarios)`);
  } finally {
    globalThis.fetch = originalFetch;
    await ds.destroy();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
