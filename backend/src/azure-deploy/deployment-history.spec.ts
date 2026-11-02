// Teste les lignes d'historique de déploiement (liens application / portail filtrés).
import * as assert from 'node:assert/strict';
import { deploymentHistoryEntry } from './deployment-history';

const ok = deploymentHistoryEntry({ id: 'a', dispatchStatus: 'DEPLOYED', mainBuildNumber: 4, artifactDigest: 'sha256:x',
  dispatchResult: { agentResponse: { appUrl: 'http://20.1.2.3:8080', portalUrl: 'https://portal.azure.com/#@t/resource/x/overview', state: 'Running' } } });
assert.equal(ok.appUrl, 'http://20.1.2.3:8080/');
assert.equal(ok.portalUrl, 'https://portal.azure.com/#@t/resource/x/overview');
const failed = deploymentHistoryEntry({ id: 'b', dispatchStatus: 'FAILED', dispatchResult: { failureCode: 'AGENT_HEALTH_FAILED', agentResponse: { appUrl: 'http://20.1.2.3:8080' } } });
assert.equal(failed.appUrl, null, 'no app link for a failed deployment');
assert.equal(failed.failureCode, 'AGENT_HEALTH_FAILED');
const evil = deploymentHistoryEntry({ id: 'c', dispatchStatus: 'DEPLOYED', dispatchResult: { agentResponse: { appUrl: 'javascript:alert(1)', portalUrl: 'https://evil.example/' } } });
assert.equal(evil.appUrl, null); assert.equal(evil.portalUrl, null);
assert.equal(deploymentHistoryEntry({ id: 'd', dispatchStatus: 'DISPATCHING', dispatchResult: null }).appUrl, null);
console.log('deployment-history.spec.ts: ALL CHECKS PASS');
