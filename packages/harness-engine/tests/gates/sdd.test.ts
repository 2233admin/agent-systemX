import { describe, expect, test } from 'bun:test';

import { isConcreteRevision, validateReviewPackage } from '../../src/domain/review.ts';
import { validateSddGate, type SddGateInput } from '../../src/gates/sdd.ts';

const packageBase = {
  planId: 'plan-1',
  taskId: 'task-1',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  path: '.reviews/plan-1-task-1.md',
  createdAt: '2026-08-27T12:00:00.000Z',
} as const;

const baseInput: SddGateInput = {
  planId: 'plan-1',
  taskId: 'task-1',
  baseSha: packageBase.baseSha,
  headSha: packageBase.headSha,
  currentHeadSha: packageBase.headSha,
  reviewRange: `${packageBase.baseSha}..${packageBase.headSha}`,
  reviewPackage: packageBase,
  qc: {
    planId: 'plan-1',
    taskId: 'task-1',
    reviewerId: 'qc-1',
    reviewRange: `${packageBase.baseSha}..${packageBase.headSha}`,
    baseSha: packageBase.baseSha,
    headSha: packageBase.headSha,
    seats: 3,
  },
  executionMode: 'sdd',
};

function codes(result: { readonly kind: string; readonly violations?: readonly { code: string }[] }): readonly string[] {
  return result.violations?.map(({ code }) => code) ?? [];
}

describe('SDD/QC review gate', () => {
  test('accepts a package and QC evidence bound to the same BASE..HEAD', () => {
    const result = validateSddGate(baseInput);
    expect(result.kind).toBe('pass');
    if (result.kind !== 'pass') return;
    expect(result.value).toEqual({
      planId: 'plan-1',
      taskId: 'task-1',
      baseSha: packageBase.baseSha,
      headSha: packageBase.headSha,
      reviewRange: `${packageBase.baseSha}..${packageBase.headSha}`,
      qcSeats: 3,
    });
  });

  test('rejects missing BASE SHA and guessed HEAD~1 basis', () => {
    const missing = validateSddGate({ ...baseInput, baseSha: '' });
    expect(missing.kind).toBe('fail');
    expect(codes(missing)).toContain('sdd.base-sha.missing');

    const guessed = validateSddGate({ ...baseInput, reviewRange: 'HEAD~1..HEAD' });
    expect(guessed.kind).toBe('fail');
    expect(codes(guessed)).toContain('sdd.review-range.invalid');
  });

  test('rejects stale head and missing review package', () => {

    const stale = validateSddGate({ ...baseInput, currentHeadSha: 'c'.repeat(40) });
    expect(stale.kind).toBe('blocked');
    expect(codes(stale)).toContain('sdd.head-sha.stale');

    const missing = validateSddGate({ ...baseInput, reviewPackage: undefined });
    expect(missing.kind).toBe('fail');
    expect(codes(missing)).toContain('sdd.review-package.missing');
  });
  test('accepts only commit-like hexadecimal revisions', () => {
    expect(isConcreteRevision(baseInput.baseSha)).toBe(true);
    expect(isConcreteRevision('main')).toBe(false);
    expect(isConcreteRevision('HEAD~1')).toBe(false);
    expect(validateReviewPackage({ ...packageBase, baseSha: 'main' })).toBe(false);
  });

  test('rejects review package, plan, range, and QC identity mismatches', () => {
    const result = validateSddGate({
      ...baseInput,
      planId: 'other-plan',
      reviewPackage: { ...packageBase, taskId: 'other-task' },
      reviewRange: `${'c'.repeat(40)}..${packageBase.headSha}`,
      qc: { ...baseInput.qc!, planId: 'plan-1', reviewerId: 'task-1' },
    });
    expect(result.kind).toBe('fail');
    expect(codes(result)).toEqual(expect.arrayContaining([
      'sdd.review-package.plan-id.mismatch',
      'sdd.review-package.task-id.mismatch',
      'sdd.review-range.mismatch',
      'sdd.qc.plan-id.mismatch',
      'sdd.qc.identity.mismatch',
    ]));
  });

  test('maps SDD to three seats and inline to one seat', () => {
    const inline = validateSddGate({
      ...baseInput,
      executionMode: 'inline',
      qc: { ...baseInput.qc!, seats: 1 },
    });
    expect(inline.kind).toBe('pass');
    if (inline.kind === 'pass') expect(inline.value.qcSeats).toBe(1);

    const wrong = validateSddGate({ ...baseInput, qc: { ...baseInput.qc!, seats: 1 } });
    expect(wrong.kind).toBe('fail');
    expect(codes(wrong)).toContain('sdd.qc.seats.mismatch');
  });
});
