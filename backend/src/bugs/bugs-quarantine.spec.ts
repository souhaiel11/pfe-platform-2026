import * as assert from 'node:assert/strict';
import { GoneException } from '@nestjs/common';
import { BugStatus } from './bug.entity';
import { BugsController } from './bugs.controller';
import { BugsService, LEGACY_REMEDIATION_DISABLED } from './bugs.service';

const existingBug: any = {
  id: 'bug-1',
  projectId: 'project-1',
  title: 'Historical finding',
  status: BugStatus.OPEN,
};

let saveCalls = 0;
let createCalls = 0;
let updatedEvents = 0;
let createdEvents = 0;
const repo: any = {
  find: async () => [existingBug],
  findOne: async ({ where }: any) => where.id === existingBug.id ? existingBug : null,
  create: (dto: any) => { createCalls++; return { id: 'bug-created', ...dto }; },
  save: async (bug: any) => { saveCalls++; return bug; },
  remove: async () => undefined,
};
const gateway: any = {
  emitBugUpdated: () => { updatedEvents++; },
  emitBugCreated: () => { createdEvents++; },
};

const service = new BugsService(repo, gateway);
const controller = new BugsController(service);

async function expectGone(action: () => Promise<unknown>) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof GoneException);
    assert.equal(error.getStatus(), 410);
    assert.equal(error.message, LEGACY_REMEDIATION_DISABLED);
    return true;
  });
}

async function main() {
  const originalSetTimeout = globalThis.setTimeout;
  let scheduledTimers = 0;
  (globalThis as any).setTimeout = (..._args: any[]) => { scheduledTimers++; return 0; };

  // Controller contract: these are the handlers behind the three HTTP routes.
  try {
    await expectGone(() => controller.triggerFix(existingBug.id));
    await expectGone(() => controller.updateStatus(existingBug.id, { status: BugStatus.RESOLVED }));
    await expectGone(() => controller.updateFromN8n(existingBug.id, {
      status: BugStatus.PR_CREATED,
      prUrl: 'https://github.com/example/repo/pull/99',
      prNumber: 99,
      fixConfidence: 99,
    }));

    // Service-level protection prevents bypassing the controller.
    await expectGone(() => service.triggerAiFix(existingBug.id));
    await expectGone(() => service.updateStatus(existingBug.id, BugStatus.RESOLVED));
    await expectGone(() => service.updateFromN8n(existingBug.id, { status: BugStatus.PR_CREATED }));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.equal(scheduledTimers, 0, 'legacy remediation must not schedule a fake fallback');
  assert.equal(saveCalls, 0, 'legacy mutations must not persist status or fake PR evidence');
  assert.equal(updatedEvents, 0, 'legacy mutations must not emit misleading updates');

  const all = await controller.findAll();
  assert.equal(all.length, 1, 'GET /bugs remains operational');
  assert.equal((await controller.findOne(existingBug.id)).id, existingBug.id, 'GET /bugs/:id remains operational');

  const created = await service.create({ title: 'Scanner-ingested bug' });
  assert.equal(created.id, 'bug-created', 'internal bugsService.create remains operational');
  assert.equal(createCalls, 1);
  assert.equal(saveCalls, 1);
  assert.equal(createdEvents, 1);

  // No HTTP/model dependency remains in BugsService, and no timer is scheduled.
  const source = BugsService.toString();
  assert.doesNotMatch(source, /setTimeout|simulateAiFix|N8N_BUG_FIX_WEBHOOK/);
  assert.doesNotMatch(source, /github\.com\/example|Math\.random/);

  console.log('Bugs legacy remediation quarantine: PASS.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
