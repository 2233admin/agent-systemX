import type { EvidenceRef, GateResult, RecoveryAction, Violation } from '../core/result.ts';
import { validateEvidenceRef } from '../core/result.ts';
import type { ExecutionLease } from '../domain/lease.ts';
import type { ReviewPackage } from '../domain/review.ts';
import { validateReviewPackage } from '../domain/review.ts';
import { validateWorktreeAlignment, type WorktreeAlignmentInput } from './worktree.ts';
import type { QcIdentity } from './sdd.ts';

export interface QcEvidence extends QcIdentity {
  readonly executionMode: 'sdd' | 'inline';
  readonly reviewerIds: readonly string[];
  readonly passed: boolean;
  readonly evidence: readonly EvidenceRef[];
}

export interface QaEvidence {
  readonly planId: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly passed: boolean;
  readonly evidence: readonly EvidenceRef[];
}

export interface DeliveryEvidence {
  readonly planId: string;
  readonly headSha: string;
  readonly evidence: readonly EvidenceRef[];
}

export interface ResidualClosure {
  readonly residualId: string;
  readonly owner: string;
  readonly decision: string;
  readonly target: string;
  readonly closureEvidence: readonly EvidenceRef[];
}

export interface PlanCompletionInput {
  readonly workflowId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly workerDone: boolean;
  readonly tasksRecovered: boolean;
  readonly reviewPackage: ReviewPackage;
  readonly qc: QcEvidence;
  readonly qa: QaEvidence;
  readonly residualClosures: readonly ResidualClosure[];
  readonly executionLease?: ExecutionLease;
  readonly integrationMergeLeaseReleased: boolean;
  readonly delivery: DeliveryEvidence;
}

export interface PlanCompletion extends PlanCompletionInput {
  readonly executionLeaseReleased: true;
}

function violation(code: string, message: string): Violation {
  return { code, message };
}

function recovery(code: string, description: string): RecoveryAction {
  return { code, description };
}

function fail(violations: readonly Violation[]): GateResult<PlanCompletion> {
  return {
    kind: 'fail',
    violations,
    recovery: violations.map((item) => recovery(`recover.${item.code}`, item.message ?? '补齐完成证据后重试')),
  };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function concrete(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16,64}$/i.test(value.trim());
}

function evidenceList(value: unknown): value is readonly EvidenceRef[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  try {
    value.forEach((item) => validateEvidenceRef(item));
    return true;
  } catch {
    return false;
  }
}

function residualValid(value: unknown): value is ResidualClosure {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 5
    && nonEmpty(item.residualId)
    && nonEmpty(item.owner)
    && nonEmpty(item.decision)
    && nonEmpty(item.target)
    && evidenceList(item.closureEvidence);
}

function qcValid(input: PlanCompletionInput, violations: Violation[]): boolean {
  const qc = input.qc;
  if (!qc || qc.planId !== input.planId || qc.taskId.length === 0 || qc.baseSha !== input.baseSha || qc.headSha !== input.headSha
    || qc.reviewRange !== `${input.baseSha}..${input.headSha}` || qc.passed !== true || !evidenceList(qc.evidence)) {
    violations.push(violation('completion.qc.mismatch', 'QC evidence must pass and match plan, task, and BASE..HEAD'));
    return false;
  }
  const expectedSeats = qc.executionMode === 'sdd' ? 3 : qc.executionMode === 'inline' ? 1 : 0;
  if (expectedSeats === 0 || qc.seats !== expectedSeats || qc.reviewerIds.length !== expectedSeats
    || qc.reviewerIds.some((id) => !nonEmpty(id))) {
    violations.push(violation('completion.qc.seats.invalid', 'QC seats and reviewer identities must match execution mode'));
    return false;
  }
  return true;
}

export function validateOwnershipInventory(input: WorktreeAlignmentInput): GateResult<WorktreeAlignmentInput['observed']> {
  return validateWorktreeAlignment(input);
}

export function validatePlanCompletion(input: unknown): GateResult<PlanCompletion> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail([violation('completion.input.invalid', 'Plan completion input must be an object')]);
  }
  const candidate = input as PlanCompletionInput;
  const violations: Violation[] = [];
  if (!nonEmpty(candidate.workflowId) || !nonEmpty(candidate.planId) || !Number.isSafeInteger(candidate.planRevision) || candidate.planRevision < 0) {
    violations.push(violation('completion.identity.missing', 'Workflow, plan, and plan revision are required'));
  }
  if (!concrete(candidate.baseSha) || !concrete(candidate.headSha)) {
    violations.push(violation('completion.diff-basis.missing', 'Concrete BASE and HEAD are required'));
  }
  if (candidate.workerDone !== true || candidate.tasksRecovered !== true) {
    violations.push(violation('completion.tasks.incomplete', 'Worker completion and task recovery are required'));
  }
  if (!validateReviewPackage(candidate.reviewPackage)
    || candidate.reviewPackage.planId !== candidate.planId
    || candidate.reviewPackage.baseSha !== candidate.baseSha
    || candidate.reviewPackage.headSha !== candidate.headSha) {
    violations.push(violation('completion.review-package.invalid', 'Review package must bind the concrete BASE..HEAD and plan'));
  }
  if (!qcValid(candidate, violations)) {
    // 具体的 QC violation 已在 qcValid 中登记。
  }
  const qa = candidate.qa;
  if (!qa || qa.planId !== candidate.planId || qa.baseSha !== candidate.baseSha || qa.headSha !== candidate.headSha
    || qa.passed !== true || !evidenceList(qa.evidence)) {
    violations.push(violation('completion.qa.mismatch', 'QA evidence must pass and match the same diff basis'));
  }
  if (!Array.isArray(candidate.residualClosures) || candidate.residualClosures.some((item) => !residualValid(item))) {
    violations.push(violation('completion.residual.unclosed', 'Every residual must have owner, decision, target, and closure evidence'));
  }
  if (candidate.executionLease !== undefined) {
    violations.push(violation('completion.execution-lease.remaining', 'Execution lease must be released before Done'));
  }
  if (candidate.integrationMergeLeaseReleased !== true) {
    violations.push(violation('completion.integration-lease.remaining', 'Integration merge lease must be released before Done'));
  }
  const delivery = candidate.delivery;
  if (!delivery || delivery.planId !== candidate.planId || delivery.headSha !== candidate.headSha || !evidenceList(delivery.evidence)) {
    violations.push(violation('completion.delivery.missing', 'Delivery evidence must match the current HEAD'));
  }
  if (violations.length > 0) return fail(violations);
  return {
    kind: 'pass',
    value: { ...candidate, executionLeaseReleased: true },
    evidence: [...candidate.qc.evidence, ...candidate.qa.evidence, ...candidate.delivery.evidence],
  };
}
