import { describe, expect, test } from 'bun:test';

import { validateDispatch } from '../../src/gates/dispatch.ts';

const baseAssignment = `
## Assignment
Execute as: worker
Delegation: local
Task category: implementation
Working branch: feature/dispatch
Execution mode: sdd
`;

const baseInput = {
  assignment: baseAssignment,
  planId: 'plan-1',
  taskId: 'task-1',
  planStatus: 'Todo' as const,
  branchProtection: { defaultBranch: 'main', protectedBranches: ['main', 'master'] },
  hostCapability: {
    status: 'supported' as const,
    hostId: 'host-1',
    hostVersion: '2026.08',
    evidence: { source: 'dispatch-host', observedAt: '2026-08-27T12:00:00.000Z', hostId: 'host-1', hostVersion: '2026.08' },
  },
  leaseState: {
    kind: 'execution' as const,
    workflowId: 'workflow-1',
    planId: 'plan-1',
    holderId: 'worker-1',
    worktreePath: 'D:/worktrees/dispatch',
    fencingToken: 1,
    claimedAt: '2026-08-27T12:00:00.000Z',
  },
  worktree: 'D:/worktrees/dispatch',
  currentExecutor: 'coordinator',
  observedAt: '2026-08-27T12:00:00.000Z',
};

function violationCodes(result: { readonly kind: string; readonly violations?: readonly { code: string }[] }): readonly string[] {
  return result.violations?.map((violation) => violation.code) ?? [];
}


describe('dispatch gate', () => {
  test('maps a valid SDD assignment to three QC seats without dynamic task data', () => {
    const result = validateDispatch(baseInput);
    expect(result.kind).toBe('pass');
    if (result.kind !== 'pass') return;
    expect(result.value).toEqual({
      planId: 'plan-1',
      taskId: 'task-1',
      executeAs: 'worker',
      branch: 'feature/dispatch',
      worktree: 'D:/worktrees/dispatch',
      qcSeats: 3,
    });
    expect(JSON.stringify(result.value)).not.toContain('implementation');
  });

  test('maps inline execution to one QC seat', () => {
    const result = validateDispatch({
      ...baseInput,
      assignment: baseAssignment.replace('Execution mode: sdd', 'Execution mode: inline'),
    });
    expect(result.kind).toBe('pass');
    if (result.kind !== 'pass') return;
    expect(result.value.qcSeats).toBe(1);
  });

  test.each([
    ['Execute as', 'assignment.field.missing-execute-as'],
    ['Delegation', 'assignment.field.missing-delegation'],
    ['Task category', 'assignment.field.missing-task-category'],
  ])('rejects a missing/empty %s field', (field, code) => {
    const assignment = baseAssignment.replace(new RegExp(`${field}: worker|${field}: local|${field}: implementation`), `${field}:   `);
    const result = validateDispatch({ ...baseInput, assignment });
    expect(result.kind).toBe('fail');
    if (result.kind !== 'fail') return;
    expect(result.violations.map((violation) => violation.code)).toContain(code);
  });

  test('rejects duplicate branch forms', () => {
    const result = validateDispatch({
      ...baseInput,
      assignment: `${baseAssignment}Branch: feature/other\n`,
    });
    expect(result.kind).toBe('fail');
    if (result.kind !== 'fail') return;
    expect(result.violations.map((violation) => violation.code)).toContain('branch.multiple-forms');
  });

  test('rejects the default protected branch without an explicit direct-on reason', () => {
    const result = validateDispatch({
      ...baseInput,
      assignment: baseAssignment.replace('Working branch: feature/dispatch', 'Working branch: main'),
    });
    expect(result.kind).toBe('fail');
    if (result.kind !== 'fail') return;
    expect(result.violations.map((violation) => violation.code)).toContain('branch.protected-default');
  });

  test('allows a protected branch only with a direct-on reason', () => {
    const result = validateDispatch({
      ...baseInput,
      assignment: `${baseAssignment.replace('Working branch: feature/dispatch', 'Working branch: main')}Direct-on reason: release hotfix\n`,
    });
    expect(result.kind).toBe('pass');
  });

  test('rejects unknown execution modes', () => {
    const result = validateDispatch({
      ...baseInput,
      assignment: baseAssignment.replace('Execution mode: sdd', 'Execution mode: batch'),
    });
    expect(result.kind).toBe('fail');
    if (result.kind !== 'fail') return;
    expect(result.violations.map((violation) => violation.code)).toContain('assignment.execution-mode.unknown');
  });

  test('rejects recursive dispatch to the current executor', () => {
    const result = validateDispatch({ ...baseInput, currentExecutor: 'worker' });
    expect(result.kind).toBe('fail');
    if (result.kind !== 'fail') return;
    expect(result.violations.map((violation) => violation.code)).toContain('dispatch.anti-recursion');
  });

  test('keeps unknown host capability out of successful dispatch', () => {
    const result = validateDispatch({ ...baseInput, hostCapability: { kind: 'unknown' as const } });
    expect(result.kind).toBe('unknown');
    if (result.kind !== 'unknown') return;
    expect(result.violations.map((violation) => violation.code)).toContain('host.capability.unknown');
  });

  test.each([
    ['undefined lease', undefined, 'lease.missing'],
    ['empty lease', {}, 'lease.invalid'],
    ['null lease', null as never, 'lease.invalid'],
    ['array lease', [] as never, 'lease.invalid'],
    ['primitive lease', 'held' as never, 'lease.invalid'],
  ])('fails closed for %s', (_label, leaseState, expectedCode) => {
    const result = validateDispatch({ ...baseInput, leaseState });
    expect(result.kind).toBe('fail');
    expect(violationCodes(result)).toContain(expectedCode);
  });

  test('requires the canonical execution lease to align with plan and worktree', () => {
    const result = validateDispatch({
      ...baseInput,
      leaseState: {
        ...baseInput.leaseState,
        planId: 'other-plan',
        worktreePath: 'D:/other-worktree',
      },
    });
    expect(result.kind).toBe('blocked');
    expect(violationCodes(result)).toContain('lease.misaligned');
  });

  test('rejects malformed host capability objects', () => {
    const result = validateDispatch({ ...baseInput, hostCapability: { value: 'bun' } });
    expect(result.kind).toBe('unknown');
    expect(violationCodes(result)).toContain('host.capability.unknown');
  });

  test('retains host capability evidence without optional observation evidence', () => {
    const result = validateDispatch({ ...baseInput, observedAt: undefined });
    expect(result.kind).toBe('pass');
    if (result.kind !== 'pass') return;
    expect(result.evidence).toEqual([{ source: 'dispatch-host', observedAt: '2026-08-27T12:00:00.000Z' }]);
  });

  test('requires exactly one branch form for writable work', () => {
    const result = validateDispatch({
      ...baseInput,
      assignment: baseAssignment.replace('Working branch: feature/dispatch\n', ''),
    });
    expect(result.kind).toBe('fail');
    if (result.kind !== 'fail') return;
    expect(result.violations.map((violation) => violation.code)).toContain('branch.missing');
  });
});
