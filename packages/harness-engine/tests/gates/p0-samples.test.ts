import { describe, expect, test } from 'bun:test';
import { validatePlanCompletion, validateOwnershipInventory } from '../../src/gates/completion.ts';
import type { PlanCompletionInput } from '../../src/gates/completion.ts';

const evidence = (locator: string) => ({ source: 'fixture', observedAt: '2026-08-28T00:00:00.000Z', locator });

const validCompletion: PlanCompletionInput = {
  workflowId: 'workflow-1',
  planId: 'plan-1',
  planRevision: 2,
  baseSha: '1111111111111111',
  headSha: '2222222222222222',
  workerDone: true,
  tasksRecovered: true,
  reviewPackage: {
    planId: 'plan-1',
    taskId: 'task-1',
    baseSha: '1111111111111111',
    headSha: '2222222222222222',
    path: 'review/package.json',
    createdAt: '2026-08-28T00:00:00.000Z',
  },
  qc: {
    planId: 'plan-1',
    taskId: 'task-1',
    reviewerId: 'reviewer-1',
    reviewRange: '1111111111111111..2222222222222222',
    baseSha: '1111111111111111',
    headSha: '2222222222222222',
    seats: 3,
    executionMode: 'sdd',
    reviewerIds: ['reviewer-1', 'reviewer-2', 'reviewer-3'],
    passed: true,
    evidence: [evidence('qc')],
  },
  qa: {
    planId: 'plan-1',
    baseSha: '1111111111111111',
    headSha: '2222222222222222',
    passed: true,
    evidence: [evidence('qa')],
  },
  residualClosures: [{
    residualId: 'residual-1',
    owner: 'owner-1',
    decision: 'closed',
    target: 'none',
    closureEvidence: [evidence('residual')],
  }],
  integrationMergeLeaseReleased: true,
  delivery: {
    planId: 'plan-1',
    headSha: '2222222222222222',
    evidence: [evidence('delivery')],
  },
};

describe('Stage 2 PlanCompletion gate', () => {
  test('passes only when all completion evidence aligns', () => {
    const result = validatePlanCompletion(validCompletion);
    expect(result.kind).toBe('pass');
    if (result.kind === 'pass') expect(result.value.executionLeaseReleased).toBe(true);
  });

  test('fails closed for missing task, review, QC, QA, residual, lease, and delivery facts', () => {
    const result = validatePlanCompletion({
      ...validCompletion,
      workerDone: false,
      tasksRecovered: false,
      reviewPackage: undefined,
      qc: undefined,
      qa: undefined,
      residualClosures: [{ ...validCompletion.residualClosures[0], closureEvidence: [] }],
      executionLease: { kind: 'execution' },
      integrationMergeLeaseReleased: false,
      delivery: undefined,
    });
    expect(result.kind).toBe('fail');
    if (result.kind === 'fail') {
      const codes = result.violations.map((item) => item.code);
      expect(codes).toEqual(expect.arrayContaining([
        'completion.tasks.incomplete',
        'completion.review-package.invalid',
        'completion.qc.mismatch',
        'completion.qa.mismatch',
        'completion.residual.unclosed',
        'completion.execution-lease.remaining',
        'completion.integration-lease.remaining',
        'completion.delivery.missing',
      ]));
    }
  });

  test('rejects stale head and review range drift', () => {
    const result = validatePlanCompletion({
      ...validCompletion,
      headSha: '3333333333333333',
    });
    expect(result.kind).toBe('fail');
    if (result.kind === 'fail') expect(result.violations.map((item) => item.code)).toContain('completion.review-package.invalid');
  });

  test('returns a gate result for malformed QC evidence instead of throwing', () => {
    const result = validatePlanCompletion({ ...validCompletion, qc: {} });
    expect(result.kind).toBe('fail');
    if (result.kind === 'fail') expect(result.violations.map((item) => item.code)).toContain('completion.qc.mismatch');
  });
});

describe('Stage 2 ownership inventory gate', () => {
  const expected = {
    workflowId: 'workflow-1', planId: 'plan-1', branch: 'feature/plan-1', worktreePath: 'D:/worktrees/plan-1',
    ownedPaths: ['packages/harness-engine/src'], holderId: 'worker-1',
  } as const;
  const lease = {
    kind: 'execution' as const, workflowId: 'workflow-1', planId: 'plan-1', holderId: 'worker-1',
    worktreePath: 'D:/worktrees/plan-1', fencingToken: 1, claimedAt: '2026-08-28T00:00:00.000Z',
  };
  test('accepts aligned branch, worktree, lease, and owned paths', () => {
    const result = validateOwnershipInventory({ expected, observed: expected, executionLease: lease });
    expect(result.kind).toBe('pass');
  });
  test('blocks branch, worktree, and owned-path conflicts', () => {
    const result = validateOwnershipInventory({
      expected,
      observed: { ...expected, branch: 'feature/other', worktreePath: 'D:/worktrees/other' },
      executionLease: lease,
      conflictingOwnedPaths: ['packages/harness-engine/src/domain'],
    });
    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') expect(result.violations.map((item) => item.code)).toEqual(expect.arrayContaining([
      'worktree.branch.mismatch', 'worktree.path.mismatch', 'worktree.owned-path.overlap',
    ]));
  });
});
