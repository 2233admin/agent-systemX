import type { GateResult, RecoveryAction, Violation } from '../core/result.ts';
import { isRfc3339Timestamp } from '../core/result.ts';
import { isPlanStatus, type PlanStatus } from '../domain/workflow.ts';
import { validateLease, type ExecutionLease } from '../domain/lease.ts';
import { validateCapabilityResult, type CapabilityResult } from '../ports/host.ts';
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
}

export type DispatchLeaseState = ExecutionLease;

export interface DispatchInput {
  readonly assignment?: string;
  readonly assignmentText?: string;
  readonly planId?: string;
  readonly taskId?: string;
  readonly planStatus?: PlanStatus | string;
  readonly status?: PlanStatus | string;
  readonly branchProtection?: BranchProtection | boolean;
  readonly hostCapability?: CapabilityResult;
  readonly leaseState?: unknown;
  readonly worktree?: string;
  readonly worktreePath?: string;
  readonly currentExecutor?: string;
  readonly executorId?: string;
  readonly writable?: boolean;
  readonly observedAt?: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validBranchProtection(value: unknown): value is BranchProtection | boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return true;
  if (!isRecord(value) || Object.keys(value).some((key) => !['defaultBranch', 'protectedBranches', 'protected', 'allowDirectOn'].includes(key))) {
    return false;
  }
  if (value.defaultBranch !== undefined && (typeof value.defaultBranch !== 'string' || value.defaultBranch.trim().length === 0)) return false;
  if (value.protectedBranches !== undefined) {
    if (!Array.isArray(value.protectedBranches)) return false;
    for (let index = 0; index < value.protectedBranches.length; index += 1) {
      if (!(index in value.protectedBranches) || typeof value.protectedBranches[index] !== 'string' || value.protectedBranches[index].trim().length === 0) return false;
    }
  }
  return (value.protected === undefined || typeof value.protected === 'boolean')
    && (value.allowDirectOn === undefined || typeof value.allowDirectOn === 'boolean');
}

function protectedBranches(protection: BranchProtection | boolean | undefined): readonly string[] {
  if (isRecord(protection) && protection.protectedBranches !== undefined) return protection.protectedBranches as readonly string[];
  return ['main', 'master'];
}

function defaultBranch(protection: BranchProtection | boolean | undefined): string {
  if (isRecord(protection) && typeof protection.defaultBranch === 'string') return protection.defaultBranch.trim();
  return 'main';
}

function isProtectedBranch(branch: string, protection: BranchProtection | boolean | undefined): boolean {
  const normalized = branch.trim().toLowerCase();
  const configured = protectedBranches(protection).some((candidate) => candidate.trim().toLowerCase() === normalized);
  return configured || normalized === 'main' || normalized === 'master' || normalized === defaultBranch(protection).toLowerCase();
}

/** 只做 Assignment、身份和能力的纯校验；不会创建 worktree、调用 Orca 或修改租约。 */
export function validateDispatch(input: unknown): GateResult<DispatchDecision> {
  if (!isRecord(input)) return failure('fail', [violation('dispatch.input.invalid', 'Dispatch input must be an object')]);
  const data = input as DispatchInput;
  const assignment = typeof data.assignment === 'string' ? data.assignment : data.assignmentText;
  const fields = typeof assignment === 'string' ? parseAssignmentFields(assignment) : {};
  const branchForms = typeof assignment === 'string'
    ? parseAssignmentBranchForms(assignment)
    : { forms: [] as const };
  const violations: Violation[] = [];

  if (!validBranchProtection(data.branchProtection)) {
    violations.push(violation('branch.protection.invalid', 'Branch protection must use a valid object or boolean'));
  }
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
  if (branch !== undefined && validBranchProtection(data.branchProtection)
    && isProtectedBranch(branch, data.branchProtection) && directOnReason === undefined) {
    violations.push(violation('branch.protected-default', 'Protected main/master requires an explicit direct-on reason'));
  }

  const currentExecutor = data.currentExecutor !== undefined ? data.currentExecutor : data.executorId;
  if (fields.executeAs !== undefined && typeof currentExecutor === 'string' && fields.executeAs === currentExecutor) {
    violations.push(violation('dispatch.anti-recursion', 'The current executor cannot dispatch to itself'));
  }

  const planStatus = data.planStatus !== undefined ? data.planStatus : data.status;
  if (planStatus !== undefined && !isPlanStatus(planStatus)) {
    violations.push(violation('plan.status.unknown', 'Plan status is not recognized'));
  }

  const planId = typeof data.planId === 'string' ? data.planId.trim() : '';
  const taskId = typeof data.taskId === 'string' ? data.taskId.trim() : '';
  const worktree = typeof data.worktree === 'string' ? data.worktree.trim() : typeof data.worktreePath === 'string' ? data.worktreePath.trim() : '';
  if (planId.length === 0) violations.push(violation('dispatch.plan-id.missing', 'planId is required'));
  if (taskId.length === 0) violations.push(violation('dispatch.task-id.missing', 'taskId is required'));
  if (worktree.length === 0) violations.push(violation('dispatch.worktree.missing', 'worktree is required'));

  const lease = data.leaseState;
  if (lease === undefined) {
    violations.push(violation('lease.missing', 'A canonical execution lease is required'));
  } else if (!validateLease(lease) || lease.kind !== 'execution') {
    violations.push(violation('lease.invalid', 'Execution lease must use the canonical lease shape'));
  } else if (lease.planId !== planId || lease.worktreePath !== worktree) {
    violations.push(violation('lease.misaligned', 'Execution lease must align with plan and worktree'));
  }

  if (data.observedAt !== undefined && !isRfc3339Timestamp(data.observedAt)) {
    violations.push(violation('evidence.observed-at.invalid', 'Dispatch evidence observedAt must be RFC 3339'));
  }

  if (violations.length > 0) {
    const onlyLeaseAlignment = violations.every((item) => item.code === 'lease.misaligned');
    return failure(onlyLeaseAlignment ? 'blocked' : 'fail', violations);
  }

  let capability: CapabilityResult;
  try {
    capability = validateCapabilityResult(data.hostCapability);
  } catch {
    return failure('unknown', [violation('host.capability.unknown', 'Host capability is not known')]);
  }
  if (capability.status !== 'supported') {
    return failure('unknown', [violation('host.capability.unknown', 'Host capability is not supported')]);
  }

  const { hostId: _hostId, hostVersion: _hostVersion, ...capabilityEvidence } = capability.evidence;
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
    evidence: [
      capabilityEvidence,
      ...(data.observedAt === undefined ? [] : [{ source: 'harness-engine.dispatch', observedAt: data.observedAt }]),
    ],
  };
}
