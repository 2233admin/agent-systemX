import { describe, expect, test } from 'bun:test';

import {
  canStealLease,
  claimLease,
  releaseLease,
  validateLease,
  type ExecutionLease,
  type IntegrationMergeLease,
} from '../../src/domain/lease.ts';

const executionClaim = {
  kind: 'execution' as const,
  workflowId: 'workflow-1',
  planId: 'plan-1',
  holderId: 'worker-1',
  worktreePath: 'D:/worktrees/plan-1',
  claimedAt: '2026-08-27T12:00:00.000Z',
};

const integrationClaim = {
  kind: 'integration-merge' as const,
  workflowId: 'workflow-1',
  integrationBranch: 'integration/workflow-1',
  holderId: 'integrator-1',
  claimedAt: '2026-08-27T12:00:00.000Z',
};

describe('lease state transitions', () => {
  test('claims an execution lease with fencing token one', () => {
    const result = claimLease(undefined, executionClaim);

    expect(result.kind).toBe('claimed');
    if (result.kind !== 'claimed') return;
    expect(result.lease).toEqual({ ...executionClaim, fencingToken: 1 });
    expect(validateLease(result.lease)).toBe(true);
  });

  test('resumes an active lease for the same holder without changing its token', () => {
    const first = claimLease(undefined, executionClaim);
    if (first.kind !== 'claimed') throw new Error('initial claim failed');

    const resumed = claimLease(first.lease, { ...executionClaim, claimedAt: '2026-08-27T12:01:00.000Z' });

    expect(resumed).toEqual({ kind: 'resumed', lease: first.lease });
  });

  test('rejects a second holder unless stale proof is explicit', () => {
    const first = claimLease(undefined, executionClaim);
    if (first.kind !== 'claimed') throw new Error('initial claim failed');

    const rejected = claimLease(first.lease, { ...executionClaim, holderId: 'worker-2' });
    expect(rejected.kind).toBe('blocked');
    expect(canStealLease(first.lease)).toBe(false);
    expect(canStealLease(first.lease, { reason: 'worker-1 lease is stale' })).toBe(true);
  });

  test('increments the fencing token when a stale lease is stolen', () => {
    const first = claimLease(undefined, executionClaim);
    if (first.kind !== 'claimed') throw new Error('initial claim failed');

    const stolen = claimLease(
      first.lease,
      { ...executionClaim, holderId: 'worker-2', claimedAt: '2026-08-27T12:02:00.000Z' },
      { reason: 'lease heartbeat is stale' },
    );

    expect(stolen).toEqual({
      kind: 'claimed',
      lease: { ...executionClaim, holderId: 'worker-2', fencingToken: 2, claimedAt: '2026-08-27T12:02:00.000Z' },
    });
  });

  test('preserves the fencing counter across release and rejects a mismatched token', () => {
    const first = claimLease(undefined, executionClaim);
    if (first.kind !== 'claimed') throw new Error('initial claim failed');

    const mismatch = releaseLease(first.lease, 'worker-1', 99);
    expect(mismatch.kind).toBe('blocked');

    const released = releaseLease(first.lease, 'worker-1', 1);
    expect(released).toEqual({ kind: 'released', fencingToken: 1 });

    const next = claimLease(released, { ...executionClaim, holderId: 'worker-2' });
    expect(next.kind).toBe('claimed');
    if (next.kind !== 'claimed') return;
    expect(next.lease.fencingToken).toBe(2);
  });

  test('keeps integration merge leases exclusive', () => {
    const first = claimLease(undefined, integrationClaim);
    if (first.kind !== 'claimed') throw new Error('initial claim failed');

    const rejected = claimLease(first.lease, { ...integrationClaim, holderId: 'integrator-2' });
    expect(rejected.kind).toBe('blocked');

    const resumed = claimLease(first.lease, integrationClaim);
    expect(resumed.kind).toBe('resumed');
  });

  test('validates both lease variants and fails closed for malformed values', () => {
    const execution: ExecutionLease = { ...executionClaim, fencingToken: 1 };
    const integration: IntegrationMergeLease = { ...integrationClaim, fencingToken: 1 };
    expect(validateLease(execution)).toBe(true);
    expect(validateLease(integration)).toBe(true);
    expect(validateLease({ ...execution, fencingToken: 0 })).toBe(false);
    expect(validateLease({ ...execution, holderId: '' })).toBe(false);
    expect(validateLease({ kind: 'execution' })).toBe(false);
  });

  test('fails closed when the current lease state is malformed', () => {
    const result = claimLease(
      { kind: 'execution', workflowId: 'workflow-1' } as never,
      executionClaim,
    );
    expect(result.kind).toBe('blocked');
  });
  test('rejects an invalid optional fencing counter in a lease wrapper', () => {
    const first = claimLease(undefined, executionClaim);
    if (first.kind !== 'claimed') throw new Error('initial claim failed');

    const result = claimLease({
      lease: first.lease,
      fencingToken: 'invalid',
    } as never, executionClaim);
    expect(result.kind).toBe('blocked');
  });

  test('rejects sensitive or unknown lease fields and does not spread them', () => {
    const contaminated = { ...executionClaim, fencingToken: 1, prompt: 'secret' };
    expect(validateLease(contaminated)).toBe(false);
    const result = claimLease(undefined, contaminated as never);
    expect(result.kind).toBe('blocked');
  });
  test('fails closed when releasing through a malformed lease wrapper', () => {
    const first = claimLease(undefined, executionClaim);
    if (first.kind !== 'claimed') throw new Error('initial claim failed');

    const invalidCounter = releaseLease({
      lease: first.lease,
      fencingToken: 'invalid',
    } as never, 'worker-1', 1);
    expect(invalidCounter.kind).toBe('blocked');

    const unknownField = releaseLease({
      lease: first.lease,
      fencingToken: 1,
      prompt: 'secret',
    } as never, 'worker-1', 1);
    expect(unknownField.kind).toBe('blocked');
  });
});
