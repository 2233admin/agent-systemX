import { describe, expect, test } from 'bun:test';

import { evaluateIterationGate, type IterationGateInput } from '../../src/gates/iteration.ts';

const evidence = [{ source: 'test.iteration', observedAt: '2026-08-27T12:00:00.000Z' }] as const;
const residualClosure = {
  owner: 'owner-1',
  decision: 'accepted',
  target: 'v1.1',
  closureEvidence: evidence,
} as const;
const complete: IterationGateInput = {
  phase: 'phase-3-close',
  planId: 'plan-1',
  taskId: 'task-1',
  workerDone: true,
  reviewComplete: true,
  qaComplete: true,
  residualClosure,
  executionLeaseReleased: true,
  integrationMergeLeaseReleased: true,
  evidence,
};

describe('iteration gates', () => {
  test('worker_done is delivery evidence and stops at InReview', () => {
    const result = evaluateIterationGate({
      phase: 'phase-2-execute',
      planId: 'plan-1',
      taskId: 'task-1',
      workerDone: true,
      evidence,
    });
    expect(result.kind).toBe('pass');
    if (result.kind !== 'pass') return;
    expect(result.value.nextStatus).toBe('InReview');
    expect(result.value.nextPhase).toBe('phase-3-close');
    expect(result.evidence).toEqual(evidence);
  });

  test('rejects malformed optional evidence locators', () => {
    const result = evaluateIterationGate({
      phase: 'phase-2-execute',
      planId: 'plan-1',
      taskId: 'task-1',
      workerDone: true,
      evidence: [{ ...evidence[0], locator: 42 } as never],
    });
    expect(result.kind).toBe('unknown');
  });

  test('does not infer Done from worker_done', () => {
    const result = evaluateIterationGate({
      phase: 'phase-2-execute',
      planId: 'plan-1',
      taskId: 'task-1',
      workerDone: true,
      evidence,
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

  test('boolean residual closure alone cannot pass', () => {
    const result = evaluateIterationGate({ ...complete, residualClosure: undefined, residualsClosed: true });
    expect(result.kind).toBe('unknown');
    if (result.kind !== 'unknown') return;
    expect(result.violations.map(({ code }) => code)).toContain('iteration.residuals.evidence.missing');
  });

  test('complete phase 3 close advances only to phase 4 review delivery', () => {
    const result = evaluateIterationGate(complete);
    expect(result.kind).toBe('pass');
    if (result.kind !== 'pass') return;
    expect(result.value.nextStatus).toBe('InReview');
    expect(result.value.nextPhase).toBe('phase-4-pr-delivery');
  });

  test('requires close evidence before phase 4 PR delivery', () => {
    const result = evaluateIterationGate({
      phase: 'phase-4-pr-delivery',
      planId: 'plan-1',
      taskId: 'task-1',
      workerDone: true,
      reviewComplete: true,
      qaComplete: true,
      residualClosure,
      executionLeaseReleased: true,
      integrationMergeLeaseReleased: true,
      mergeReady: false,
      evidence,
    });
    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') return;
    expect(result.violations.map(({ code }) => code)).toContain('iteration.merge-not-ready');
  });

  test('phase 4 merge-ready is terminal and produces Done', () => {
    const result = evaluateIterationGate({
      phase: 'phase-4-pr-delivery',
      planId: 'plan-1',
      taskId: 'task-1',
      workerDone: true,
      reviewComplete: true,
      qaComplete: true,
      residualClosure,
      executionLeaseReleased: true,
      integrationMergeLeaseReleased: true,
      mergeReady: true,
      evidence,
    });
    expect(result.kind).toBe('pass');
    if (result.kind !== 'pass') return;
    expect(result.value.nextStatus).toBe('Done');
    expect(result.value.nextPhase).toBeUndefined();
  });

  test('rejects unknown phases', () => {
    const result = evaluateIterationGate({ ...complete, phase: 'phase-9' as never });
    expect(result.kind).toBe('fail');
  });
});
