import { describe, expect, test } from 'bun:test';

import {
  calculateReviewTally,
  evaluatePrReview,
  evaluatePushCadence,
  type PrReviewInput,
  type PushCadenceInput,
  type RequiredReview,
} from '../../src/gates/pr-review.ts';

const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
const evidence = [{ source: 'test.pr', observedAt: '2026-08-27T12:00:00.000Z' }] as const;
const residualClosure = {
  owner: 'owner-1',
  decision: 'accepted',
  target: 'v1.1',
  closureEvidence: evidence,
} as const;
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
  requiredChecks: [{ name: 'ci', status: 'passed', headSha }],
  requiredReviews: [{ reviewerId: 'qc-1', status: 'approved', headSha }],
  unresolvedReviews: 0,
  residualsClosed: true,
  residualClosure,
  mergeable: true,
  evidence,
};
const cadence: PushCadenceInput = {
  currentHeadSha: headSha,
  ciRunning: false,
  changesPending: true,
  evidence,
};

describe('PR review and push cadence gates', () => {
  test('returns merge-ready with bound evidence and deterministic tally', () => {
    const result = evaluatePrReview(review);
    expect(result.kind).toBe('pass');
    if (result.kind !== 'pass') return;
    expect(result.value).toEqual({
      planId: 'plan-1',
      taskId: 'task-1',
      baseSha,
      headSha,
      mergeReady: true,
      tally: { total: 1, approved: 1, changesRequested: 0, pending: 0, unresolved: 0, score: 100, verdict: 'approve' },
      score: 100,
      verdict: 'approve',
    });
    expect(result.evidence).toEqual(evidence);
  });

  test('blocks unresolved review and failed required check', () => {
    const result = evaluatePrReview({
      ...review,
      requiredChecks: [{ name: 'ci', status: 'failed', headSha }],
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

  test('requires every check and review to bind a concrete current head', () => {
    const check = evaluatePrReview({ ...review, requiredChecks: [{ name: 'ci', status: 'passed', headSha: '' }] });
    expect(check.kind).toBe('fail');
    if (check.kind === 'fail') expect(check.violations.map(({ code }) => code)).toContain('pr.check.head-sha.missing');

    const staleReview = evaluatePrReview({ ...review, requiredReviews: [{ reviewerId: 'qc-1', status: 'approved', headSha: 'c'.repeat(40) }] });
    expect(staleReview.kind).toBe('fail');
    if (staleReview.kind === 'fail') expect(staleReview.violations.map(({ code }) => code)).toContain('pr.review.stale');
  });

  test('requires evidence references before push or merge-ready', () => {
    const push = evaluatePushCadence({ ...cadence, evidence: undefined });
    expect(push.kind).toBe('unknown');
    const pr = evaluatePrReview({ ...review, evidence: undefined });

    expect(pr.kind).toBe('unknown');
  });
  test('rejects malformed optional evidence locators', () => {
    const result = evaluatePushCadence({ ...cadence, evidence: [{ ...evidence[0], locator: 42 } as never] });
    expect(result.kind).toBe('unknown');
  });

  test('blocks push while CI or AI review runs on current head', () => {

    const ci = evaluatePushCadence({ ...cadence, ciRunning: true });
    expect(ci.kind).toBe('blocked');
    const ai = evaluatePushCadence({ ...cadence, aiReviewRunning: true });
    expect(ai.kind).toBe('blocked');
  });
  test('boolean residual closure alone cannot establish merge readiness', () => {
    const result = evaluatePrReview({ ...review, residualClosure: undefined, residualsClosed: true });
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') expect(result.violations.map(({ code }) => code)).toContain('pr.residuals.evidence.missing');
  });

  test('allows push when current head is idle', () => {
    const result = evaluatePushCadence(cadence);
    expect(result.kind).toBe('pass');
    if (result.kind === 'pass') expect(result.value.push).toBe(true);
  });

  test('rejects conflicting unresolved review aliases', () => {
    const result = evaluatePrReview({ ...review, unresolvedReviews: 0, unresolvedReviewCount: 1 });
    expect(result.kind).toBe('fail');
    if (result.kind === 'fail') expect(result.violations.map(({ code }) => code)).toContain('pr.review.unresolved.conflict');
  });

  test('recomputes tally, score, and verdict without side effects', () => {
    const reviews: readonly RequiredReview[] = [
      { reviewerId: 'a', status: 'approved', headSha },
      { reviewerId: 'b', status: 'changes_requested', headSha },
      { reviewerId: 'c', status: 'commented', headSha },
    ];
    expect(calculateReviewTally(reviews, 1)).toEqual({
      total: 3,
      approved: 1,
      changesRequested: 1,
      pending: 1,
      unresolved: 1,
      score: 33.33,
      verdict: 'block',
    });
  });
});
