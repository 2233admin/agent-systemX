import { describe, expect, test } from 'bun:test';
import {
  type CompletionEvidence,
  type PlanRow,
  type PlanStatus,
  transitionPlanStatus,
} from '../../src/domain/workflow.ts';

describe('workflow plan status transitions', () => {
  const statuses: PlanStatus[] = ['Todo', 'InProgress', 'InReview', 'Blocked', 'Done'];
  const evidence: CompletionEvidence = {
    leaseRemaining: false,
    reviewComplete: true,
    qaComplete: true,
  };

  test.each(statuses)('can transition from %s to every status', (from) => {
    const plan: PlanRow = {
      id: 'plan-1',
      title: 'Build the thing',
      status: from,
      metadata: { owner: 'team-a' },
    };

    for (const to of statuses) {
      const next = transitionPlanStatus(plan, to, to === 'Done' ? evidence : undefined);
      expect(next).toEqual({ ...plan, status: to });
      expect(next).not.toBe(plan);
    }
  });

  test('requires explicit completion evidence for Done', () => {
    const plan: PlanRow = {
      id: 'plan-1',
      title: 'Build the thing',
      status: 'InReview',
      metadata: {},
    };

    expect(() => transitionPlanStatus(plan, 'Done')).toThrow('Completion evidence');
    expect(() => transitionPlanStatus(plan, 'Done', {
      leaseRemaining: true,
      reviewComplete: true,
      qaComplete: true,
    })).toThrow('lease');
    expect(() => transitionPlanStatus(plan, 'Done', {
      leaseRemaining: false,
      reviewComplete: false,
      qaComplete: true,
    })).toThrow('review');
    expect(() => transitionPlanStatus(plan, 'Done', {
      leaseRemaining: false,
      reviewComplete: true,
      qaComplete: false,
    })).toThrow('QA');
  });
});
