import type { GateResult, RecoveryAction, Violation } from '../core/result.ts';
import { isRfc3339Timestamp } from '../core/result.ts';
import { isPlanStatus, type PlanStatus } from '../domain/workflow.ts';
import {
  parseAssignmentBranchForms,
  parseAssignmentExecutionMode,
  parseAssignmentFields,
} from '../domain/assignment.ts';

export interface BranchProtection {
  readonly defaultBranch?: string;
  readonly protectedBranches?: readonly string[];
  readonly protected?: boolean;
  readonly allowDirectOn?: boolean;
  readonly [key: string]: unknown;
}

export interface HostCapability {
  readonly kind?: 'known' | 'unknown';
  readonly value?: unknown;
  readonly evidence?: unknown;
  readonly known?: boolean;
  readonly [key: string]: unknown;
}

export interface DispatchLeaseState {
  readonly held?: boolean;
  readonly active?: boolean;
  readonly holder?: string;
  readonly planId?: string;
  readonly taskId?: string;
  readonly worktreePath?: string;
  readonly worktree?: string;
  readonly [key: string]: unknown;
}

export interface DispatchInput {
  readonly assignment?: string;
  readonly assignmentText?: string;
  readonly planId?: string;
  readonly taskId?: string;
  readonly planStatus?: PlanStatus | string;
  readonly status?: PlanStatus | string;
  readonly branchProtection?: BranchProtection | boolean;
  readonly hostCapability?: HostCapability | string | undefined;
  readonly leaseState?: unknown;
  readonly worktree?: string;
  readonly worktreePath?: string;
  readonly currentExecutor?: string;
  readonly executorId?: string;
  readonly writable?: boolean;
  readonly observedAt?: string;
  readonly [key: string]: unknown;
}

export interface DispatchDecision {
  readonly planId: string;
  readonly taskId: string;
  readonly executeAs: string;
  readonly branch: string;
  readonly worktree: string;
  readonly qcSeats: 1 | 3;
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
): GateResult<DispatchDecision> {
  return {
    kind,
    violations,
    recovery: violations.map((item) => recovery(`recover.${item.code}`, item.message ?? 'provide valid dispatch input')),
  };
}

function isHostUnknown(capability: unknown): boolean {
  if (capability === undefined || capability === null || capability === 'unknown') return true;
  if (typeof capability !== 'object') return false;
  const record = capability as Record<string, unknown>;
  return record.kind === 'unknown' || record.status === 'unknown' || record.known === false;
}

function hasKnownHostCapability(capability: unknown): boolean {
  if (typeof capability !== 'object' || capability === null) return false;
  const record = capability as Record<string, unknown>;
  if (record.kind !== 'known') return false;
  const hasValue = record.value !== undefined;
  const hasEvidence = typeof record.evidence === 'object' && record.evidence !== null;
  return hasValue || hasEvidence;
}


function isPlainLease(value: unknown): value is DispatchLeaseState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function protectedBranches(protection: BranchProtection | boolean | undefined): readonly string[] {
  if (typeof protection === 'object' && protection !== null && protection.protectedBranches !== undefined) {
    return protection.protectedBranches;
  }
  return ['main', 'master'];
}

function defaultBranch(protection: BranchProtection | boolean | undefined): string {
  if (typeof protection === 'object' && protection !== null && typeof protection.defaultBranch === 'string') {
    return protection.defaultBranch.trim();
  }
  return 'main';
}

function isProtectedBranch(branch: string, protection: BranchProtection | boolean | undefined): boolean {
  const normalized = branch.trim().toLowerCase();
  const configured = protectedBranches(protection).some((candidate) => candidate.trim().toLowerCase() === normalized);
  return configured || normalized === 'main' || normalized === 'master' || normalized === defaultBranch(protection).toLowerCase();
}

/** 只做 Assignment、身份和能力的纯校验；不会创建 worktree、调用 Orca 或修改租约。 */
export function validateDispatch(input: DispatchInput): GateResult<DispatchDecision> {
  const assignment = typeof input.assignment === 'string' ? input.assignment : input.assignmentText;
  const fields = typeof assignment === 'string' ? parseAssignmentFields(assignment) : {};
  const branchForms = typeof assignment === 'string'
    ? parseAssignmentBranchForms(assignment)
    : { forms: [] as const };
  const violations: Violation[] = [];

  if (fields.executeAs === undefined) violations.push(violation('assignment.field.missing-execute-as', 'Execute as is required'));
  if (fields.delegation === undefined) violations.push(violation('assignment.field.missing-delegation', 'Delegation is required'));
  if (fields.taskCategory === undefined) violations.push(violation('assignment.field.missing-task-category', 'Task category is required'));

  const executionMode = typeof assignment === 'string' ? parseAssignmentExecutionMode(assignment) : undefined;
  if (executionMode !== 'sdd' && executionMode !== 'inline') {
    violations.push(violation('assignment.execution-mode.unknown', 'Execution mode must be sdd or inline'));
  }

  const branchTargets = branchForms.forms.filter((form) => form.kind !== 'direct-on');
  if (branchTargets.length === 0) {
    violations.push(violation('branch.missing', 'Writable dispatch requires one branch form'));
  } else if (branchTargets.length > 1) {
    violations.push(violation('branch.multiple-forms', 'Writable dispatch accepts exactly one branch form'));
  }

  const branch = branchForms.workingBranch ?? branchForms.branchPolicy;
  const directOnReason = branchForms.directOnReason?.trim();
  if (branch !== undefined && isProtectedBranch(branch, input.branchProtection) && directOnReason === undefined) {
    violations.push(violation('branch.protected-default', 'Protected main/master requires an explicit direct-on reason'));
  }

  const currentExecutor = input.currentExecutor ?? input.executorId;
  if (fields.executeAs !== undefined && currentExecutor !== undefined && fields.executeAs === currentExecutor) {
    violations.push(violation('dispatch.anti-recursion', 'The current executor cannot dispatch to itself'));
  }

  const planStatus = input.planStatus ?? input.status;
  if (planStatus !== undefined && !isPlanStatus(planStatus)) {
    violations.push(violation('plan.status.unknown', 'Plan status is not recognized'));
  }

  const planId = typeof input.planId === 'string' ? input.planId.trim() : '';
  const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
  const worktree = typeof input.worktree === 'string' ? input.worktree.trim() : typeof input.worktreePath === 'string' ? input.worktreePath.trim() : '';
  if (planId.length === 0) violations.push(violation('dispatch.plan-id.missing', 'planId is required'));
  if (taskId.length === 0) violations.push(violation('dispatch.task-id.missing', 'taskId is required'));
  if (worktree.length === 0) violations.push(violation('dispatch.worktree.missing', 'worktree is required'));

  const lease = input.leaseState;
  if (lease === undefined) {
    violations.push(violation('lease.missing', 'A held execution lease is required'));
  } else if (!isPlainLease(lease)) {
    violations.push(violation('lease.invalid', 'Execution lease must be a plain object'));
  } else if (Object.keys(lease).length === 0) {
    violations.push(violation('lease.missing', 'A held execution lease is required'));
  } else if (lease.held !== true && lease.active !== true) {
    violations.push(violation('lease.not-held', 'Execution lease must be explicitly held'));
  } else {
    const leaseWorktree = lease.worktreePath ?? lease.worktree;
    if (lease.planId !== planId || lease.taskId !== taskId || leaseWorktree !== worktree) {
      violations.push(violation('lease.misaligned', 'Execution lease must align with plan, task, and worktree'));
    }
  }

  if (input.observedAt !== undefined && !isRfc3339Timestamp(input.observedAt)) {
    violations.push(violation('evidence.observed-at.invalid', 'Dispatch evidence observedAt must be RFC 3339'));
  }

  if (violations.length > 0) {
    const onlyLeaseAlignment = violations.every((item) => item.code === 'lease.misaligned');
    return failure(onlyLeaseAlignment ? 'blocked' : 'fail', violations);
  }
  if (isHostUnknown(input.hostCapability) || !hasKnownHostCapability(input.hostCapability)) {
    return failure('unknown', [violation('host.capability.unknown', 'Host capability is not known')]);
  }

  return {
    kind: 'pass',
    value: {
      planId,
      taskId,
      executeAs: fields.executeAs as string,
      branch: branch as string,
      worktree,
      qcSeats: executionMode === 'sdd' ? 3 : 1,
    },
    evidence: input.observedAt === undefined
      ? []
      : [{ source: 'harness-engine.dispatch', observedAt: input.observedAt }],
  };
}
