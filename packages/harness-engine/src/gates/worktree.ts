import type { GateResult, RecoveryAction, Violation } from '../core/result.ts';
import { validateLease, type ExecutionLease, type IntegrationMergeLease } from '../domain/lease.ts';

export interface WorktreeIdentity {
  readonly workflowId: string;
  readonly planId: string;
  readonly branch: string;
  readonly worktreePath: string;
  readonly ownedPaths: readonly string[];
  readonly holderId: string;
  readonly integrationBranch?: string;
}

export interface WorktreeAlignment {
  readonly workflowId: string;
  readonly planId: string;
  readonly branch: string;
  readonly worktreePath: string;
  readonly ownedPaths: readonly string[];
  readonly holderId: string;
  readonly integrationBranch?: string;
}

export interface WorktreeAlignmentInput {
  readonly expected: WorktreeIdentity;
  readonly observed: WorktreeAlignment;
  readonly executionLease: ExecutionLease;
  readonly integrationMergeLease?: IntegrationMergeLease;
  readonly conflictingOwnedPaths?: readonly string[];
}

function violation(code: string, message: string): Violation {
  return { code, message };
}

function recovery(code: string, description: string): RecoveryAction {
  return { code, description };
}

function failure(
  kind: 'fail' | 'blocked' | 'unknown',
  violations: readonly Violation[],
): GateResult<WorktreeAlignment> {
  return {
    kind,
    violations,
    recovery: [recovery('worktree.reobserve', '重新读取 workflow、lease 和 worktree 事实后再重试')],
  };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validPaths(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(nonEmpty);
}

function samePathSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path) => right.includes(path));
}

function pathOverlaps(left: string, right: string): boolean {
  const a = left.replaceAll('\\', '/').replace(/\/+$/, '');
  const b = right.replaceAll('\\', '/').replace(/\/+$/, '');
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function hasOverlap(paths: readonly string[], conflicting: readonly string[]): boolean {
  return paths.some((path) => conflicting.some((other) => pathOverlaps(path, other)));
}

function identityShape(identity: unknown): identity is WorktreeIdentity {
  if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) return false;
  const candidate = identity as Record<string, unknown>;
  return typeof candidate.workflowId === 'string'
    && typeof candidate.planId === 'string'
    && typeof candidate.branch === 'string'
    && typeof candidate.worktreePath === 'string'
    && validPaths(candidate.ownedPaths)
    && typeof candidate.holderId === 'string'
    && (candidate.integrationBranch === undefined || typeof candidate.integrationBranch === 'string');
}

function validateIdentity(identity: unknown): identity is WorktreeIdentity {
  return identityShape(identity)
    && nonEmpty(identity.workflowId)
    && nonEmpty(identity.planId)
    && nonEmpty(identity.branch)
    && nonEmpty(identity.holderId);
}

function validateObservedIdentity(identity: unknown): identity is WorktreeAlignment {
  return identityShape(identity);
}
export function validateWorktreeAlignment(input: WorktreeAlignmentInput): GateResult<WorktreeAlignment> {
  if (typeof input !== 'object' || input === null || !validateIdentity(input.expected) || !validateObservedIdentity(input.observed)) {
    return failure('unknown', [violation('worktree.input.invalid', 'Worktree alignment input is missing or malformed')]);
  }

  const expected = input.expected;
  const observed = input.observed;
  const violations: Violation[] = [];
  if (!nonEmpty(observed.worktreePath)) violations.push(violation('worktree.missing', 'Observed worktree path is missing'));
  if (!nonEmpty(observed.branch) || observed.branch !== expected.branch) {
    violations.push(violation('worktree.branch.mismatch', 'Observed branch does not match the expected branch'));
  }
  if (observed.workflowId !== expected.workflowId) {
    violations.push(violation('worktree.workflow.mismatch', 'Observed workflow identity does not match'));
  }
  if (observed.planId !== expected.planId) {
    violations.push(violation('worktree.plan.mismatch', 'Observed plan identity does not match'));
  }
  if (observed.worktreePath !== expected.worktreePath) {
    violations.push(violation('worktree.path.mismatch', 'Observed worktree path does not match'));
  }
  if (!samePathSet(observed.ownedPaths, expected.ownedPaths)) {
    violations.push(violation('worktree.owned-paths.mismatch', 'Observed owned paths do not match'));
  }
  if (observed.holderId !== expected.holderId) {
    violations.push(violation('lease.holder.mismatch', 'Observed lease holder does not match'));
  }
  if (!validateLease(input.executionLease) || input.executionLease.kind !== 'execution') {
    violations.push(violation('lease.invalid', 'Execution lease is missing or malformed'));
  } else {
    const lease = input.executionLease;
    if (lease.workflowId !== expected.workflowId || lease.planId !== expected.planId) {
      violations.push(violation('lease.identity.mismatch', 'Execution lease identity does not match'));
    }
    if (lease.worktreePath !== expected.worktreePath) {
      violations.push(violation('lease.path.mismatch', 'Execution lease worktree path does not match'));
    }
    if (lease.holderId !== expected.holderId) {
      violations.push(violation('lease.holder.mismatch', 'Execution lease holder does not match'));
    }
  }

  if (expected.integrationBranch !== undefined) {
    if (observed.integrationBranch !== expected.integrationBranch) {
      violations.push(violation('integration.branch.mismatch', 'Observed integration branch does not match'));
    }
    const integrationLease = input.integrationMergeLease;
    if (integrationLease === undefined) {
      violations.push(violation('integration.lease.missing', 'Integration merge lease is required'));
    } else if (!validateLease(integrationLease) || integrationLease.kind !== 'integration-merge') {
      violations.push(violation('integration.lease.invalid', 'Integration merge lease is malformed'));
    } else {
      if (integrationLease.workflowId !== expected.workflowId
        || integrationLease.integrationBranch !== expected.integrationBranch) {
        violations.push(violation('integration.lease.mismatch', 'Integration merge lease does not match'));
      }
      if (integrationLease.holderId !== expected.holderId) {
        violations.push(violation('lease.holder.mismatch', 'Integration lease holder does not match'));
      }
    }
  } else if (observed.integrationBranch !== undefined || input.integrationMergeLease !== undefined) {
    violations.push(violation('integration.anchor.unexpected', 'Integration lease or branch is not expected for this worktree'));
  }

  if (input.conflictingOwnedPaths !== undefined) {
    if (!validPaths(input.conflictingOwnedPaths)) {
      violations.push(violation('worktree.owned-path.overlap', 'Conflicting owned paths are malformed'));
    } else if (hasOverlap(expected.ownedPaths, input.conflictingOwnedPaths)) {
      violations.push(violation('worktree.owned-path.overlap', 'Owned paths overlap another lease'));
    }
  }

  if (violations.length > 0) {
    const isOverlap = violations.some(({ code }) => code === 'worktree.owned-path.overlap');
    return failure(isOverlap ? 'blocked' : 'fail', violations);
  }
  return {
    kind: 'pass',
    value: observed,
    evidence: [
      { source: 'worktree.alignment', observedAt: input.executionLease.claimedAt },
    ],
  };
}
