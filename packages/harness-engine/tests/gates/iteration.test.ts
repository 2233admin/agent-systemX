import { describe, expect, test } from 'bun:test';

import { evaluateIterationGate, type IterationGateInput } from '../../src/gates/iteration.ts';

const complete: IterationGateInput = {
  phase: 'phase-3-close',
  planId: 'plan-1',
  taskId: 'task-1',
  workerDone: true,
  reviewComplete: true,
  qaComplete: true,
  residualsClosed: true,
  executionLeaseReleased: true,
  integrationMergeLeaseReleased: true,
};

describe('iteration gates', () => {
  test('worker_done is delivery evidence and stops at InReview', () => {
    const result = evaluateIterationGate({
      phase: 'phase-2-execute',
      planId: 'plan-1',
      taskId: 'task-1',
      workerDone: true,
    });
    expect(result.kind).toBe('pass');
    if (result.kind !== 'pass') return;
    expect(result.value.nextStatus).toBe('InReview');
    expect(result.value.nextPhase).toBe('phase-3-close');
  });

  test('does not infer Done from worker_done', () => {
    const result = evaluateIterationGate({
      phase: 'phase-2-execute',
      planId: 'plan-1',
      taskId: 'task-1',
      workerDone: true,
      reviewComplete: true,
      qaComplete: true,
      residualsClosed: true,
      executionLeaseReleased: true,
    });
    expect(result.kind).toBe('pass');
    if (result.kind === 'pass') expect(result.value.nextStatus).not.toBe('Done');
  });

  test('blocks an incomplete close', () => {
    const result = evaluateIterationGate({ ...complete, qaComplete: false });
    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') return;
    expect(result.violations.map(({ code }) => code)).toContain('iteration.qa.incomplete');
  });

  test('requires close evidence before phase 4 PR delivery', () => {
    const result = evaluateIterationGate({
      phase: 'phase-4-pr-delivery',
      planId: 'plan-1',
      taskId: 'task-1',
      workerDone: true,
      reviewComplete: true,
      qaComplete: true,
      residualsClosed: true,
      executionLeaseReleased: true,
      integrationMergeLeaseReleased: true,
      mergeReady: false,
    });
    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') return;
    expect(result.violations.map(({ code }) => code)).toContain('iteration.merge-not-ready');
  });

  test('rejects unknown phases', () => {
    const result = evaluateIterationGate({ ...complete, phase: 'phase-9' as never });
    expect(result.kind).toBe('fail');
  });
});
