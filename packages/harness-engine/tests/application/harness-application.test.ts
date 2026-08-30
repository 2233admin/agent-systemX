import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileHarnessApplication } from '../../src/application/harness-application.ts';
import type { FileInput } from '../../src/application/identity.ts';

const temporaryDirectories: string[] = [];
const observedAt = '2026-08-28T10:00:00.000Z';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fileInput(workflowId = 'workflow-1'): Promise<FileInput> {
  const artifactRoot = await mkdtemp(join(tmpdir(), 'harness-application-'));
  temporaryDirectories.push(artifactRoot);
  return {
    artifactRoot,
    workflowId,
    planId: 'plan-1',
    taskId: 'task-1',
    actorId: 'worker-1',
    inputDigest: 'sha256:assignment-only',
  };
}

async function storedArtifact(root: string, workflowId = 'workflow-1'): Promise<string> {
  return readFile(join(root, 'workflows', `${workflowId}.json`), 'utf8');
}

describe('HarnessApplication guarded write path', () => {
  test('creates, mutates, reads, statuses, and validates only through the application facade', async () => {
    const input = await fileInput();
    const app = createFileHarnessApplication(input);

    const created = await app.createWorkflow({ expectedRevision: 0, plan: { id: 'plan-1', title: 'Stage 1', metadata: { owner: 'team-a' } } });
    expect(created).toMatchObject({ revision: 1, workflowId: 'workflow-1', plans: [{ id: 'plan-1', status: 'Todo' }] });

    const registeredPlan = await app.registerPlan({ expectedRevision: 1, plan: { id: 'plan-2', title: 'Review', status: 'Todo', metadata: {} } });
    expect(registeredPlan.revision).toBe(2);

    const registeredAssignment = await app.registerAssignment({
      expectedRevision: 2,
      planId: 'plan-1',
      assignmentDigest: 'sha256:public-assignment',
      executeAs: 'worker',
      branch: 'feature/stage-1',
      worktreePath: '/tmp/stage-1',
    });
    expect(registeredAssignment.plans[0]?.metadata).toMatchObject({ assignmentDigest: 'sha256:public-assignment', executeAs: 'worker' });

    await app.transitionPlan({ expectedRevision: 3, planId: 'plan-1', nextStatus: 'InProgress' });
    const leased = await app.claimExecutionLease({
      expectedRevision: 4,
      planId: 'plan-1',
      holderId: 'worker-1',
      worktreePath: '/tmp/stage-1',
      claimedAt: observedAt,
    });
    expect(leased.plans[0]?.executionLease).toMatchObject({ holderId: 'worker-1', fencingToken: 1 });

    const released = await app.releaseExecutionLease({ expectedRevision: 5, planId: 'plan-1', holderId: 'worker-1', fencingToken: 1 });
    expect(released.plans[0]?.executionLease).toBeUndefined();

    await app.transitionPlan({ expectedRevision: 6, planId: 'plan-1', nextStatus: 'InReview' });
    await app.appendCompletionEvidence({
      expectedRevision: 7,
      planId: 'plan-1',
      evidence: {
        completionKind: 'plan-completion',
        leaseRemaining: false,
        executionLeaseReleased: true,
        reviewComplete: true,
        qaComplete: true,
      },
    });
    const done = await app.transitionPlan({
      expectedRevision: 8,
      planId: 'plan-1',
      nextStatus: 'Done',
      completionEvidence: {
        completionKind: 'plan-completion',
        leaseRemaining: false,
        executionLeaseReleased: true,
        reviewComplete: true,
        qaComplete: true,
      },
    });
    expect(done.plans[0]?.status).toBe('Done');

    const status = await app.status({ workflowId: 'workflow-1' });
    expect(status).toEqual({ workflowId: 'workflow-1', revision: 9, plans: [
      { id: 'plan-1', status: 'Done', lease: 'none' },
      { id: 'plan-2', status: 'Todo', lease: 'none' },
    ], integrationMergeLease: 'none' });

    const validation = await app.validate({
      assignment: `## Assignment\nExecute as: worker\nDelegation: local\nTask category: implementation\nWorking branch: feature/stage-1\nExecution mode: sdd\n`,
      planId: 'plan-1',
      taskId: 'task-1',
      worktree: '/tmp/stage-1',
      branchProtection: { defaultBranch: 'main', protectedBranches: ['main'] },
      hostCapability: { status: 'supported', hostId: 'omp', hostVersion: '1.0.0', evidence: { source: 'fixture', observedAt, hostId: 'omp', hostVersion: '1.0.0' } },
      leaseState: { kind: 'execution', workflowId: 'workflow-1', planId: 'plan-1', holderId: 'worker-1', worktreePath: '/tmp/stage-1', fencingToken: 1, claimedAt: observedAt },
    });
    expect(validation.result.kind).toBe('pass');

    const raw = await storedArtifact(input.artifactRoot);
    expect(raw).not.toContain('Task 7');
    expect(raw).not.toContain('prompt');
    expect(raw).not.toContain('transcript');
  });

  test('fails closed for invalid transitions, duplicate lease claim, worker_done Done, and incomplete Done snapshots', async () => {
    const input = await fileInput();
    const app = createFileHarnessApplication(input);
    await app.createWorkflow({ expectedRevision: 0, plan: { id: 'plan-1', title: 'Stage 1', metadata: {} } });

    await expect(app.transitionPlan({ expectedRevision: 1, planId: 'plan-1', nextStatus: 'Done', completionEvidence: { leaseRemaining: false, reviewComplete: true, qaComplete: true } }))
      .rejects.toHaveProperty('code', 'plan.transition.invalid');

    await app.transitionPlan({ expectedRevision: 1, planId: 'plan-1', nextStatus: 'InProgress' });
    await app.claimExecutionLease({ expectedRevision: 2, planId: 'plan-1', holderId: 'worker-1', worktreePath: '/tmp/stage-1', claimedAt: observedAt });
    await expect(app.claimExecutionLease({ expectedRevision: 3, planId: 'plan-1', holderId: 'worker-1', worktreePath: '/tmp/stage-1', claimedAt: observedAt }))
      .rejects.toHaveProperty('code', 'lease.duplicate-claim');

    await app.releaseExecutionLease({ expectedRevision: 3, planId: 'plan-1', holderId: 'worker-1', fencingToken: 1 });
    await app.transitionPlan({ expectedRevision: 4, planId: 'plan-1', nextStatus: 'InReview' });
    await expect(app.transitionPlan({ expectedRevision: 5, planId: 'plan-1', nextStatus: 'Done', completionEvidence: { completionKind: 'worker_done', leaseRemaining: false, reviewComplete: true, qaComplete: true } }))
      .rejects.toHaveProperty('code', 'plan.done.worker-done-insufficient');
    await expect(app.transitionPlan({ expectedRevision: 5, planId: 'plan-1', nextStatus: 'Done', completionEvidence: { completionKind: 'plan-completion', leaseRemaining: false, reviewComplete: true, qaComplete: false } }))
      .rejects.toHaveProperty('code', 'plan.done.qa-missing');
    await expect(app.transitionPlan({ expectedRevision: 5, planId: 'plan-1', nextStatus: 'InProgress' }))
      .rejects.toHaveProperty('code', 'plan.transition.invalid');
  });
});
