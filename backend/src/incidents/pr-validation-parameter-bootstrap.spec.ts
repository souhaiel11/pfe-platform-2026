import * as assert from 'node:assert/strict';
import { IncidentsService, jenkinsWorkflowFullName, buildParameterBootstrapScript } from './incidents.service';

// R21-AS — the on-demand Jenkins parameter bootstrap: proves the pure helpers
// in isolation, then the full ensurePrValidationBootstrap()/
// ensurePrValidationParameter() behavior against every required case.

// --- Pure helpers -----------------------------------------------------------
assert.equal(jenkinsWorkflowFullName('/job/pfe-app-test-multibranch/job/PR-25'), 'pfe-app-test-multibranch/PR-25');
assert.throws(() => jenkinsWorkflowFullName('/job/pfe-app-test-multibranch/job/PR-25/../evil'), /Invalid Jenkins job path/);
assert.throws(() => jenkinsWorkflowFullName("/job/pfe';Jenkins.instance.doAdminMonitorsList()//job/PR-1"), /Invalid Jenkins job path/);
assert.throws(() => jenkinsWorkflowFullName(''), /Invalid Jenkins job path/);

const script = buildParameterBootstrapScript('pfe-app-test-multibranch/PR-25');
assert.ok(script.includes("getItemByFullName('pfe-app-test-multibranch/PR-25', WorkflowJob.class)"), 'script targets the exact job by full name');
assert.ok(script.includes('PFE_BOOTSTRAP_RESULT:OK'), 'script reports a success marker');
assert.ok(script.includes("findAll { it.name != 'PFE_VALIDATION_CONTEXT' }"), 'script preserves unrelated existing parameters');
assert.ok(!/\bimport\s+groovy\.lang\.GroovyShell\b/.test(script), 'script does not itself invoke a nested shell');
// A hostile job identity cannot break out of the single-quoted literal:
// jenkinsWorkflowFullName() rejects it long before buildParameterBootstrapScript
// ever sees it, but this proves the escaping is also correct in isolation.
const hostileButCharacterValid = "pfe-app-test-multibranch/PR-25'; Jenkins.instance.doSafeExit(null); //";
const escapedScript = buildParameterBootstrapScript(hostileButCharacterValid);
assert.ok(escapedScript.includes("getItemByFullName('pfe-app-test-multibranch/PR-25\\'; Jenkins.instance.doSafeExit(null); //', WorkflowJob.class)"), 'single quotes are escaped, not left to break out of the literal');

// --- Service-level behavior --------------------------------------------------
const makeHarness = () => {
  const incident: any = {
    id: '65e35d1b-212f-4153-bd63-fba6e8eebc2c', projectId: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', status: 'fix_generated',
    prUrl: 'https://github.com/souhaiel11/pfe-app-test/pull/25', metadata: { fixRequest: {
      status: 'PR_CREATED', requestId: 'f1af3192-40f0-4400-869a-3854246d7a11', batchId: '9c190dbec8d6f3d17b2b7e961e329bdc122e00ed18f88586b85bdca7a8d1c49d',
      attemptCount: 16, prNumber: 25,
    } },
  };
  const project: any = {
    id: '3aa1c9b9-e114-40e4-884b-ebc7aa32e002', githubRepo: 'souhaiel11/pfe-app-test', githubToken: null,
    jenkinsUrl: 'http://jenkins', jenkinsToken: 'user:not-printed', jenkinsJobName: 'pfe-app-test', sonarqubeKey: 'pfe-app-test',
  };
  incident.project = project;
  const incidentRepo: any = { findOne: async () => incident, update: async (_id: string, patch: any) => Object.assign(incident, patch) };
  const projectRepo: any = { findOne: async () => project };
  const repository: any = { findOne: incidentRepo.findOne, update: incidentRepo.update, manager: { transaction: async (fn: any) => fn({ getRepository: () => incidentRepo }) } };
  const service = new IncidentsService(repository, projectRepo, { emit: () => undefined } as any, { syncIncident: async () => undefined } as any);
  return { incident, project, service };
};

const withParam = () => ({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: [{ name: 'PFE_VALIDATION_CONTEXT', type: 'StringParameterDefinition', defaultParameterValue: { value: '' } }] }] });
const withoutParam = (extra: any[] = []) => ({ buildable: true, _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', property: [{ _class: 'hudson.model.ParametersDefinitionProperty', parameterDefinitions: extra }] });

async function main() {
  const user = { id: 'admin-1', role: 'admin' };

  // 1) Parameter already present -> no script call at all.
  {
    const { incident, service } = makeHarness();
    let scriptCalls = 0;
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('/scriptText')) { scriptCalls++; throw new Error('must not be called'); }
      if (value.includes('/api/json')) return new Response(JSON.stringify(withParam()), { status: 200 });
      throw new Error('unexpected ' + value);
    }) as any;
    const result = await service.ensurePrValidationBootstrap(incident.id, user);
    assert.equal(result.status, 'ALREADY_PRESENT');
    assert.equal(scriptCalls, 0, 'no script call when parameter already present');
  }

  // 2) Job exists, parameter absent -> exactly one injection -> present after.
  {
    const { incident, service } = makeHarness();
    let scriptCalls = 0;
    let injected = false;
    globalThis.fetch = (async (url: any, init?: any) => {
      const value = String(url);
      if (value.includes('/scriptText')) {
        scriptCalls++;
        const body = String(init?.body || '');
        assert.ok(decodeURIComponent(body).includes("getItemByFullName('pfe-app-test-multibranch/PR-25'"), 'script targets exactly this job');
        injected = true;
        return new Response('PFE_BOOTSTRAP_RESULT:OK\n', { status: 200 });
      }
      if (value.includes('/api/json')) return new Response(JSON.stringify(injected ? withParam() : withoutParam([{ name: 'CVSS_FAIL_THRESHOLD', type: 'StringParameterDefinition', defaultParameterValue: { value: '8.0' } }])), { status: 200 });
      throw new Error('unexpected ' + value);
    }) as any;
    const result = await service.ensurePrValidationBootstrap(incident.id, user);
    assert.equal(result.status, 'INJECTED');
    assert.equal(scriptCalls, 1, 'exactly one injection call');
    assert.equal(result.parameterCount, 1, 'post-injection metadata reports the parameter as present');
  }

  // 3) Existing unrelated parameters preserved + PFE_VALIDATION_CONTEXT not
  //    duplicated -- verified against the actual script text this time.
  {
    const fullName = 'pfe-app-test-multibranch/PR-25';
    const scriptText = buildParameterBootstrapScript(fullName);
    // The script's own Groovy logic is proven by the live init script it
    // mirrors (findAll excludes PFE_VALIDATION_CONTEXT before re-adding it
    // once); here we assert the generated text carries that same contract
    // rather than e.g. blindly appending, which would duplicate on re-run.
    assert.equal((scriptText.match(/PFE_VALIDATION_CONTEXT/g) || []).length, 2, 'parameter name appears exactly twice: exclusion filter + single re-add');
  }

  // 4) Job absent / 404 -> JENKINS_JOB_NOT_FOUND, no script call.
  {
    const { incident, service } = makeHarness();
    let scriptCalls = 0;
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('/scriptText')) { scriptCalls++; throw new Error('must not be called'); }
      if (value.includes('/api/json')) return new Response('', { status: 404 });
      throw new Error('unexpected ' + value);
    }) as any;
    await assert.rejects(() => service.ensurePrValidationBootstrap(incident.id, user), (error: any) => {
      assert.equal(error.getResponse().code, 'JENKINS_JOB_NOT_FOUND');
      return true;
    });
    assert.equal(scriptCalls, 0, 'a missing job is never a reason to attempt script injection');
  }

  // 5) Wrong job type (not a concrete WorkflowJob, e.g. a folder) -> fail closed.
  {
    const { incident, service } = makeHarness();
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('/api/json')) return new Response(JSON.stringify({ buildable: false, _class: 'com.cloudbees.hudson.plugins.folder.Folder', property: [] }), { status: 200 });
      throw new Error('unexpected ' + value);
    }) as any;
    await assert.rejects(() => service.ensurePrValidationBootstrap(incident.id, user), (error: any) => {
      assert.equal(error.getResponse().code, 'JENKINS_TARGET_NOT_BUILDABLE');
      return true;
    });
  }

  // 6) Script console authentication failure -> fail closed.
  {
    const { incident, service } = makeHarness();
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('/scriptText')) return new Response('', { status: 401 });
      if (value.includes('/api/json')) return new Response(JSON.stringify(withoutParam()), { status: 200 });
      throw new Error('unexpected ' + value);
    }) as any;
    await assert.rejects(() => service.ensurePrValidationBootstrap(incident.id, user), (error: any) => {
      assert.equal(error.getResponse().code, 'JENKINS_AUTH_FAILED');
      return true;
    });
  }

  // 7) Script executes (HTTP 200) but reports rejection/no success marker -> fail closed.
  {
    const { incident, service } = makeHarness();
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('/scriptText')) return new Response('groovy.lang.MissingPropertyException: no such property\n', { status: 200 });
      if (value.includes('/api/json')) return new Response(JSON.stringify(withoutParam()), { status: 200 });
      throw new Error('unexpected ' + value);
    }) as any;
    await assert.rejects(() => service.ensurePrValidationBootstrap(incident.id, user), (error: any) => {
      assert.equal(error.getResponse().code, 'JENKINS_PARAMETER_UNAVAILABLE');
      return true;
    });
  }

  // 8) Injection reports success but the parameter is STILL absent on
  //    re-read -> fail closed (never trust the script's own claim alone).
  {
    const { incident, service } = makeHarness();
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('/scriptText')) return new Response('PFE_BOOTSTRAP_RESULT:OK\n', { status: 200 });
      if (value.includes('/api/json')) return new Response(JSON.stringify(withoutParam()), { status: 200 }); // never actually changes
      throw new Error('unexpected ' + value);
    }) as any;
    await assert.rejects(() => service.ensurePrValidationBootstrap(incident.id, user), (error: any) => {
      assert.equal(error.getResponse().code, 'JENKINS_PARAMETER_UNAVAILABLE');
      return true;
    });
  }

  // 9) Second ensure call is idempotent: zero additional script calls once present.
  {
    const { incident, service } = makeHarness();
    let scriptCalls = 0;
    let injected = false;
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('/scriptText')) { scriptCalls++; injected = true; return new Response('PFE_BOOTSTRAP_RESULT:OK\n', { status: 200 }); }
      if (value.includes('/api/json')) return new Response(JSON.stringify(injected ? withParam() : withoutParam()), { status: 200 });
      throw new Error('unexpected ' + value);
    }) as any;
    const first = await service.ensurePrValidationBootstrap(incident.id, user);
    assert.equal(first.status, 'INJECTED');
    assert.equal(scriptCalls, 1);
    const second = await service.ensurePrValidationBootstrap(incident.id, user);
    assert.equal(second.status, 'ALREADY_PRESENT');
    assert.equal(scriptCalls, 1, 'idempotent: no additional script call on the second ensure');
  }

  // 10) No mutation of prValidationRequest / no build queued by the bootstrap path.
  {
    const { incident, service } = makeHarness();
    let injected = false;
    globalThis.fetch = (async (url: any) => {
      const value = String(url);
      if (value.includes('/scriptText')) { injected = true; return new Response('PFE_BOOTSTRAP_RESULT:OK\n', { status: 200 }); }
      if (value.includes('/api/json')) return new Response(JSON.stringify(injected ? withParam() : withoutParam()), { status: 200 });
      if (value.includes('/buildWithParameters') || value.includes('crumbIssuer')) throw new Error('bootstrap must never reach crumb/build');
      throw new Error('unexpected ' + value);
    }) as any;
    const result = await service.ensurePrValidationBootstrap(incident.id, user);
    assert.equal(result.status, 'INJECTED');
    assert.equal(incident.metadata.prValidationRequest, undefined, 'ensure-parameter never writes prValidationRequest');
  }

  console.log('PR validation parameter bootstrap: PASS');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
