import type { GateResult, RecoveryAction, Violation } from '../core/result.ts';
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
  readonly known?: boolean;
  readonly [key: string]: unknown;
}

export interface DispatchLeaseState {
  readonly held?: boolean;
  readonly active?: boolean;
  readonly holder?: string;
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
  readonly leaseState?: DispatchLeaseState;
  readonly worktree?: string;
  readonly worktreePath?: string;
  readonly currentExecutor?: string;
  readonly executorId?: string;
  readonly writable?: boolean;
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

const DISPATCH_EVIDENCE = {
  source: 'harness-engine.dispatch',
  observedAt: '1970-01-01T00:00:00Z',
} as const;

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
  if (isHostUnknown(capability)) return false;
  if (capability === 'known') return true;
  if (typeof capability === 'object' && capability !== null) {
    const record = capability as Record<string, unknown>;
    return record.kind === 'known' || record.known === true || record.capable === true || record.value !== undefined;
  }
  return true;
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
  const normalized = branch.trim().toLocaleLowerCase();
  const configured = protectedBranches(protection).some((candidate) => candidate.trim().toLocaleLowerCase() === normalized);
  return configured || normalized === 'main' || normalized === 'master' || normalized === defaultBranch(protection).toLocaleLowerCase();
}

/**
 * 只做 Assignment、身份和能力的纯校验；不会创建 worktree、调用 Orca 或修改租约。
 */
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
  if (lease?.held === true || lease?.active === true) {
    violations.push(violation('lease.already-held', 'An active execution lease blocks dispatch'));
  }

  if (violations.length > 0) return failure('fail', violations);
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
    evidence: [DISPATCH_EVIDENCE],
  };
}
