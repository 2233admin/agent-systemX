import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonArtifactStore } from '../../src/adapters/json/json-artifact-store.ts';
import { createWorkflowFacade } from '../../src/application/harness-application.ts';
import type { PlanCompletionInput } from '../../src/gates/completion.ts';
import type { ArtifactStore } from '../../src/ports/artifacts.ts';

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

  test('blocks a stale completion planRevision before writing', async () => {
    const snapshot = {
      schemaVersion: 1 as const,
      revision: 2,
      workflowId: 'workflow-1',
      plans: [{ id: 'plan-1', title: 'Plan', status: 'InReview' as const, metadata: {} }],
      updatedAt: '2026-08-28T00:00:00.000Z',
    };
    const store: ArtifactStore = {
      readWorkflow: async () => snapshot,
      writeWorkflowConditional: async () => {
        throw new Error('must not write');
      },
    };
    const completion: PlanCompletionInput = {
      workflowId: 'workflow-1',
      planId: 'plan-1',
      planRevision: 1,
      baseSha: '1111111111111111',
      headSha: '2222222222222222',
      workerDone: true,
      tasksRecovered: true,
      reviewPackage: { planId: 'plan-1', taskId: 'task-1', baseSha: '1111111111111111', headSha: '2222222222222222', path: 'review.json', createdAt: '2026-08-28T00:00:00.000Z' },
      qc: { planId: 'plan-1', taskId: 'task-1', reviewerId: 'reviewer-1', reviewRange: '1111111111111111..2222222222222222', baseSha: '1111111111111111', headSha: '2222222222222222', seats: 1, executionMode: 'inline', reviewerIds: ['reviewer-1'], passed: true, evidence: [{ source: 'fixture', observedAt: '2026-08-28T00:00:00.000Z' }] },
      qa: { planId: 'plan-1', baseSha: '1111111111111111', headSha: '2222222222222222', passed: true, evidence: [{ source: 'fixture', observedAt: '2026-08-28T00:00:00.000Z' }] },
      residualClosures: [],
      integrationMergeLeaseReleased: true,
      delivery: { planId: 'plan-1', headSha: '2222222222222222', evidence: [{ source: 'fixture', observedAt: '2026-08-28T00:00:00.000Z' }] },
    };
    const result = await createWorkflowFacade(store).completePlan({
      ...envelope,
      planId: 'plan-1',
      expectedRevision: 2,
      operationId: 'op-stale-completion',
      idempotencyKey: 'key-stale-completion',
      inputDigest: 'digest-stale-completion',
      completion,
    });
    expect(result.kind).toBe('blocked');
    expect(result.violations.map((item) => item.code)).toContain('completion.plan-revision.stale');

    const mismatch = await createWorkflowFacade(store).completePlan({
      ...envelope,
      workflowId: 'workflow-other',
      planId: 'plan-other',
      expectedRevision: 2,
      operationId: 'op-identity-mismatch',
      idempotencyKey: 'key-identity-mismatch',
      inputDigest: 'digest-identity-mismatch',
      completion: { ...completion, planRevision: 2 },
    });
    expect(mismatch.kind).toBe('rejected');
    expect(mismatch.violations.map((item) => item.code)).toEqual(expect.arrayContaining([
      'completion.workflow-id.mismatch',
      'completion.plan-id.mismatch',
    ]));
  });
  test('rejects incomplete completion evidence before conditional write', async () => {
    let writeCalls = 0;
    const store: ArtifactStore = {
      readWorkflow: async () => ({
        schemaVersion: 1,
        revision: 2,
        workflowId: 'workflow-1',
        plans: [{ id: 'plan-1', title: 'Plan', status: 'InReview', metadata: {} }],
        updatedAt: '2026-08-28T00:00:00.000Z',
      }),
      writeWorkflowConditional: async () => {
        writeCalls += 1;
        throw new Error('must not write');
      },
    };
    const facade = createWorkflowFacade(store);

    const missing = await facade.completePlan({
      ...envelope,
      planId: 'plan-1',
      expectedRevision: 2,
      operationId: 'op-missing-completion',
      idempotencyKey: 'key-missing-completion',
      inputDigest: 'digest-missing-completion',
      completion: { workflowId: 'workflow-1', planId: 'plan-1', planRevision: 2 } as unknown as PlanCompletionInput,
    });
    expect(missing.kind).toBe('rejected');
    expect(missing.violations.map((item) => item.code)).toContain('completion.tasks.incomplete');

    const forged = await facade.completePlan({
      ...envelope,
      planId: 'plan-1',
      expectedRevision: 2,
      operationId: 'op-forged-completion',
      idempotencyKey: 'key-forged-completion',
      inputDigest: 'digest-forged-completion',
      completion: { workflowId: 'workflow-1', planId: 'plan-1', planRevision: 2, workerDone: true, tasksRecovered: true } as unknown as PlanCompletionInput,
    });
    expect(forged.kind).toBe('rejected');
    expect(forged.violations.map((item) => item.code)).toContain('completion.review-package.invalid');
    expect(writeCalls).toBe(0);
  });
});

