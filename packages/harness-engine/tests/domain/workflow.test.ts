import { describe, expect, test } from 'bun:test';
import {
  type CompletionEvidence,
  type PlanRow,
  type PlanStatus,
  transitionPlanStatus,
} from '../../src/domain/workflow.ts';

describe('workflow plan status transitions', () => {
  const evidence: CompletionEvidence = {
    leaseRemaining: false,
    reviewComplete: true,
    qaComplete: true,
  };

  const plan = (status: PlanStatus): PlanRow => ({
    id: 'plan-1',
    title: 'Build the thing',
    status,
    metadata: { owner: 'team-a' },
  });

  test.each([
    ['Todo', 'InProgress'],
    ['InProgress', 'InReview'],
    ['InProgress', 'Blocked'],
    ['Blocked', 'InReview'],
    ['InReview', 'Done'],
  ] as const)('allows the legal transition %s -> %s', (from, to) => {
    const next = transitionPlanStatus(plan(from), to, to === 'Done' ? evidence : undefined);

    expect(next).toEqual({ ...plan(from), status: to });
    expect(next).not.toBe(plan(from));
  });

  test.each([
    ['Todo', 'InReview'],
    ['Todo', 'Blocked'],
    ['InProgress', 'Todo'],
    ['InProgress', 'Done'],
    ['Blocked', 'Todo'],
    ['Blocked', 'Done'],
    ['InReview', 'Todo'],
    ['InReview', 'InProgress'],
    ['InReview', 'Blocked'],
  ] as const)('rejects the illegal transition %s -> %s', (from, to) => {
    expect(() => transitionPlanStatus(plan(from), to, to === 'Done' ? evidence : undefined))
      .toThrow('Invalid plan status transition');
  });

  test('Done cannot transition back to an earlier status', () => {
    expect(() => transitionPlanStatus(plan('Done'), 'InReview')).toThrow('Invalid plan status transition');
  });

  test('rejects an unknown next status', () => {
    expect(() => transitionPlanStatus(plan('InReview'), 'Unknown' as PlanStatus, evidence))
      .toThrow('Unknown plan status');
  });

  test('requires explicit completion evidence for Done', () => {
    expect(() => transitionPlanStatus(plan('InReview'), 'Done')).toThrow('Completion evidence');
  });

  test('fails closed when required completion evidence is unknown', () => {
    expect(() => transitionPlanStatus(plan('InReview'), 'Done', {
      leaseRemaining: false,
      reviewRequired: true,
      qaRequired: true,
      qaComplete: true,
    })).toThrow('review');
  });

  test('fails closed when completion evidence conflicts with a required review result', () => {
    expect(() => transitionPlanStatus(plan('InReview'), 'Done', {
      leaseRemaining: false,
      reviewRequired: true,
      reviewComplete: false,
      qaRequired: true,
      qaComplete: true,
    })).toThrow('review');
  });

  test('retains the existing lease and QA evidence checks', () => {
    expect(() => transitionPlanStatus(plan('InReview'), 'Done', {
      leaseRemaining: true,
      reviewComplete: true,
      qaComplete: true,
    })).toThrow('lease');
    expect(() => transitionPlanStatus(plan('InReview'), 'Done', {
      leaseRemaining: false,
      reviewComplete: true,
      qaComplete: false,
    })).toThrow('QA');
  });
});
