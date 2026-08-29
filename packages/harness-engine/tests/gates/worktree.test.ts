import { describe, expect, test } from 'bun:test';

import { validateWorktreeAlignment, type WorktreeAlignmentInput } from '../../src/gates/worktree.ts';
import type { ExecutionLease, IntegrationMergeLease } from '../../src/domain/lease.ts';
import { transitionPlanStatus, type PlanRow } from '../../src/domain/workflow.ts';

const executionLease: ExecutionLease = {
  kind: 'execution',
  workflowId: 'workflow-1',
  planId: 'plan-1',
  holderId: 'worker-1',
  worktreePath: 'D:/worktrees/plan-1',
  fencingToken: 3,
  claimedAt: '2026-08-27T12:00:00.000Z',
};

const integrationLease: IntegrationMergeLease = {
  kind: 'integration-merge',
  workflowId: 'workflow-1',
  integrationBranch: 'integration/workflow-1',
  holderId: 'worker-1',
  fencingToken: 4,
  claimedAt: '2026-08-27T12:00:00.000Z',
};

const alignedInput: WorktreeAlignmentInput = {
  expected: {
    workflowId: 'workflow-1',
    planId: 'plan-1',
    branch: 'feature/plan-1',
    worktreePath: 'D:/worktrees/plan-1',
    ownedPaths: ['packages/harness-engine/src/domain/lease.ts'],
    holderId: 'worker-1',
    integrationBranch: 'integration/workflow-1',
  },
  observed: {
    workflowId: 'workflow-1',
    planId: 'plan-1',
    branch: 'feature/plan-1',
    worktreePath: 'D:/worktrees/plan-1',
    ownedPaths: ['packages/harness-engine/src/domain/lease.ts'],
    holderId: 'worker-1',
    integrationBranch: 'integration/workflow-1',
  },
  executionLease,
  integrationMergeLease: integrationLease,
};

describe('worktree alignment gate', () => {
  test('passes when plan, branch, path, owned paths, holder, and integration branch align', () => {
    const result = validateWorktreeAlignment(alignedInput);

    expect(result.kind).toBe('pass');
    if (result.kind !== 'pass') return;
    expect(result.value).toEqual(alignedInput.observed);
  });

  test('fails closed when the worktree is missing', () => {
    const result = validateWorktreeAlignment({
      ...alignedInput,
      observed: { ...alignedInput.observed, worktreePath: '' },
    });

    expect(result.kind).toBe('fail');
    if (result.kind === 'pass') return;
    expect(result.violations.map(({ code }) => code)).toContain('worktree.missing');
  });

  test('rejects a branch mismatch', () => {
    const result = validateWorktreeAlignment({
      ...alignedInput,
      observed: { ...alignedInput.observed, branch: 'feature/other' },
    });

    expect(result.kind).toBe('fail');
    if (result.kind === 'pass') return;
    expect(result.violations.map(({ code }) => code)).toContain('worktree.branch.mismatch');
  });

  test('rejects owned-path overlap with another lease', () => {
    const result = validateWorktreeAlignment({
      ...alignedInput,
      conflictingOwnedPaths: ['packages/harness-engine/src/domain/lease.ts'],
    });

    expect(result.kind).toBe('blocked');
    if (result.kind === 'pass') return;
    expect(result.violations.map(({ code }) => code)).toContain('worktree.owned-path.overlap');
  });

  test('rejects a lease holder mismatch and integration branch mismatch', () => {
    const result = validateWorktreeAlignment({
      ...alignedInput,
      observed: { ...alignedInput.observed, holderId: 'worker-2', integrationBranch: 'integration/other' },
    });

    expect(result.kind).toBe('fail');
    if (result.kind === 'pass') return;
    expect(result.violations.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'lease.holder.mismatch',
      'integration.branch.mismatch',
    ]));
  });

  test('rejects a plan identity mismatch', () => {
    const result = validateWorktreeAlignment({
      ...alignedInput,
      observed: { ...alignedInput.observed, planId: 'plan-2' },
    });

    expect(result.kind).toBe('fail');
    if (result.kind === 'pass') return;
    expect(result.violations.map(({ code }) => code)).toContain('worktree.plan.mismatch');
  });

  test('rejects a Done row that still carries an execution lease', () => {
    const plan: PlanRow = {
      id: 'plan-1',
      title: 'Build the thing',
      status: 'InReview',
      metadata: {},
      executionLease,
    };

    expect(() => transitionPlanStatus(plan, 'Done', {
      leaseRemaining: false,
      reviewComplete: true,
      qaComplete: true,
    })).toThrow('lease');
  });
});
