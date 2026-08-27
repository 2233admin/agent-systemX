import { describe, expect, test } from 'bun:test';

import {
  evaluatePrReview,
  evaluatePushCadence,
  type PrReviewInput,
  type PushCadenceInput,
} from '../../src/gates/pr-review.ts';

const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
const packageBase = {
  planId: 'plan-1',
  taskId: 'task-1',
  baseSha,
  headSha,
  path: '.reviews/plan-1-task-1.md',
  createdAt: '2026-08-27T12:00:00.000Z',
} as const;
const review: PrReviewInput = {
  planId: 'plan-1',
  taskId: 'task-1',
  baseSha,
  headSha,
  currentHeadSha: headSha,
  reviewPackage: packageBase,
  requiredChecks: [{ name: 'ci', status: 'passed' }],
  requiredReviews: [{ reviewerId: 'qc-1', status: 'approved' }],
  unresolvedReviews: 0,
  residualsClosed: true,
  mergeable: true,
};
const cadence: PushCadenceInput = {
  currentHeadSha: headSha,
  ciRunning: false,
  changesPending: true,
};

describe('PR review and push cadence gates', () => {
  test('returns merge-ready with base and current head evidence', () => {
    const result = evaluatePrReview(review);
    expect(result.kind).toBe('pass');
    if (result.kind !== 'pass') return;
    expect(result.value).toEqual({ planId: 'plan-1', taskId: 'task-1', baseSha, headSha, mergeReady: true });
  });

  test('blocks unresolved review and failed required check', () => {
    const result = evaluatePrReview({
      ...review,
      requiredChecks: [{ name: 'ci', status: 'failed' }],
      unresolvedReviews: 1,
    });
    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') return;
    expect(result.violations.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'pr.check.failed',
      'pr.review.unresolved',
    ]));
  });

  test('invalidates merge-ready evidence after head changes', () => {
    const result = evaluatePrReview({ ...review, currentHeadSha: 'c'.repeat(40) });
    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') expect(result.violations.map(({ code }) => code)).toContain('pr.head-sha.stale');
  });

  test('blocks push while CI or AI review runs on current head', () => {
    const ci = evaluatePushCadence({ ...cadence, ciRunning: true });
    expect(ci.kind).toBe('blocked');
    const ai = evaluatePushCadence({ ...cadence, aiReviewRunning: true });
    expect(ai.kind).toBe('blocked');
  });

  test('allows push when current head is idle', () => {
    const result = evaluatePushCadence(cadence);
    expect(result.kind).toBe('pass');
    if (result.kind === 'pass') expect(result.value.push).toBe(true);
  });
});
