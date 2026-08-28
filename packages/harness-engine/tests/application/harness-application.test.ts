import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonArtifactStore } from '../../src/adapters/json/json-artifact-store.ts';
import { createWorkflowFacade } from '../../src/application/harness-application.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeStore(): Promise<JsonArtifactStore> {
  const root = await mkdtemp(join(tmpdir(), 'harness-application-'));
  temporaryDirectories.push(root);
  return new JsonArtifactStore(root);
}

const envelope = {
  workflowId: 'workflow-1',
  operationId: 'op-1',
  actorId: 'actor-1',
  expectedRevision: 0,
  idempotencyKey: 'key-1',
  inputDigest: 'digest-1',
} as const;

describe('WorkflowFacade', () => {
  test('creates and reads a workflow through the guarded application boundary', async () => {
    const facade = createWorkflowFacade(await makeStore());
    const created = await facade.createWorkflow(envelope);

    expect(created.kind).toBe('applied');
    expect(created.stage).toBe('createWorkflow');
    expect(created.value).toMatchObject({ workflowId: 'workflow-1', revision: 1, plans: [] });
    expect(created.operationId).toBe('op-1');
    expect(created.violations).toEqual([]);
    expect(created.recoveryActions).toEqual([]);

    const read = await facade.readWorkflow({
      ...envelope,
      operationId: 'op-2',
      expectedRevision: 1,
      idempotencyKey: 'key-2',
      inputDigest: 'digest-2',
    });
    expect(read.kind).toBe('applied');
    expect(read.stage).toBe('readWorkflow');
    expect(read.value).toEqual(created.value);
  });

  test('registers a plan with CAS and rejects a stale revision', async () => {
    const facade = createWorkflowFacade(await makeStore());
    await facade.createWorkflow(envelope);
    const registered = await facade.registerPlan({
      ...envelope,
      operationId: 'op-2',
      expectedRevision: 1,
      idempotencyKey: 'key-2',
      inputDigest: 'digest-2',
      planId: 'plan-1',
      title: 'Plan title',
      baseSha: 'base-sha',
    });
    expect(registered.kind).toBe('applied');
    expect(registered.value).toMatchObject({ revision: 2, plans: [{ id: 'plan-1', status: 'Todo' }] });

    const stale = await facade.registerPlan({
      ...envelope,
      operationId: 'op-3',
      expectedRevision: 1,
      idempotencyKey: 'key-3',
      inputDigest: 'digest-3',
      planId: 'plan-2',
      title: 'Stale plan',
      baseSha: 'base-sha',
    });
    expect(stale.kind).toBe('blocked');
    expect(stale.violations.map((violation) => violation.code)).toContain('artifact.revision.conflict');
  });

  test('is idempotent and reports explicit status and validation stages', async () => {
    const facade = createWorkflowFacade(await makeStore());
    const first = await facade.createWorkflow(envelope);
    const repeat = await facade.createWorkflow(envelope);
    expect(repeat).toEqual(first);

    const status = await facade.status({
      ...envelope,
      operationId: 'op-status',
      expectedRevision: 1,
      idempotencyKey: 'key-status',
      inputDigest: 'digest-status',
    });
    expect(status.kind).toBe('applied');
    expect(status.stage).toBe('status');

    const validation = await facade.validate({
      operationId: 'op-validate',
      actorId: 'actor-1',
      expectedRevision: 0,
      idempotencyKey: 'key-validate',
      inputDigest: 'digest-validate',
      assignment: { assignment: '## Assignment\nExecute as: worker\nDelegation: local\nTask category: implementation\nWorking branch: feature/x\nExecution mode: inline' },
    });
    expect(validation.kind).toBe('applied');
    expect(validation.stage).toBe('validate');
  });
});
