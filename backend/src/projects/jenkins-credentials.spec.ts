import * as assert from 'node:assert/strict';
import { of, throwError } from 'rxjs';
import { ProjectsService } from './projects.service';

const project: any = {
  id: 'project-1', jenkinsInternalUrl: 'http://jenkins:8080', jenkinsUrl: null,
  jenkinsToken: 'stale:invalid-token', jenkinsJobName: 'pfe-app-test',
};
const repo: any = {
  findOne: async () => project,
  update: async (_id: string, patch: any) => Object.assign(project, patch),
};
const incidentRepo: any = { find: async () => [] };

async function main() {
  const http: { get: (url: string, opts: any) => any } = { get: () => throwError(() => new Error('unset')) };
  const service = new ProjectsService(repo as any, incidentRepo as any, http as any);
  const debugLogs: string[] = [];
  const warnLogs: string[] = [];
  (service as any).logger = {
    debug: (message: string) => debugLogs.push(message),
    warn: (message: string) => warnLogs.push(message),
  };

  // 1) Valid credential — Jenkins whoAmI confirms real authentication.
  http.get = (url: string, opts: any) => {
    assert.equal(url, 'http://jenkins:8080/whoAmI/api/json');
    assert.equal(opts.timeout, 8000);
    assert.equal(opts.headers.Authorization, `Basic ${Buffer.from('platform-build:good-token').toString('base64')}`);
    return of({ data: { authenticated: true, name: 'platform-build' } });
  };
  const ok = await service.updateJenkinsCredentials('project-1', { username: 'platform-build', token: 'good-token' });
  assert.equal(ok.success, true);
  assert.equal(ok.jenkinsUsername, 'platform-build');
  assert.equal((ok as any).token, undefined, 'token must never be echoed back');
  assert.equal(project.jenkinsToken, 'platform-build:good-token', 'valid credential is persisted');
  assert.deepEqual(debugLogs, ['jenkins-credentials validation-success projectId=project-1']);

  // 2) Jenkins reachable but reports authenticated:false (e.g. wrong token,
  //    Jenkins still answers 200 — must NOT be treated as success).
  project.jenkinsToken = 'platform-build:good-token';
  http.get = () => of({ data: { authenticated: false, name: 'anonymous' } });
  await assert.rejects(
    () => service.updateJenkinsCredentials('project-1', { username: 'platform-build', token: 'wrong-token' }),
    /invalides/,
  );
  assert.equal(project.jenkinsToken, 'platform-build:good-token', 'rejected credential must not overwrite the stored one');

  // 3) Network/auth failure (e.g. HTTP 401/500) — same fail-closed outcome.
  http.get = () => throwError(() => Object.assign(new Error('raw-remote-error-must-not-be-logged'), {
    code: 'ECONNREFUSED',
    response: {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8', authorization: 'must-not-be-logged' },
      data: '<title>remote-title-must-not-be-logged</title>',
    },
  }));
  await assert.rejects(
    () => service.updateJenkinsCredentials('project-1', { username: 'platform-build', token: 'wrong-token' }),
    /invalides/,
  );
  assert.equal(project.jenkinsToken, 'platform-build:good-token', 'stored credential preserved on transport failure');
  assert.equal(warnLogs[warnLogs.length - 1], 'jenkins-credentials validation-failed projectId=project-1 httpStatus=401 transportCode=ECONNREFUSED contentType=text/html');
  const allLogs = [...debugLogs, ...warnLogs].join('\n');
  for (const forbidden of [
    'good-token', 'wrong-token', 'platform-build', 'http://jenkins:8080',
    'usernameLength', 'usernameHasWhitespace', 'tokenLength', 'tokenHasWhitespace',
    'returnedName', 'responseTitle', 'raw-remote-error', 'remote-title', 'authorization',
  ]) assert.ok(!allLogs.includes(forbidden), `logs must not include ${forbidden}`);

  // 4) No internal URL configured — rejected before ever contacting Jenkins.
  const noUrlProject = { id: 'project-2', jenkinsInternalUrl: null, jenkinsUrl: null };
  const noUrlRepo: any = { findOne: async () => noUrlProject, update: async () => undefined };
  const service2 = new ProjectsService(noUrlRepo as any, incidentRepo as any, { get: () => throwError(() => new Error('must not be called')) } as any);
  await assert.rejects(() => service2.updateJenkinsCredentials('project-2', { username: 'x', token: 'y' }), /URL Jenkins interne/);

  console.log('jenkins credentials contract: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
