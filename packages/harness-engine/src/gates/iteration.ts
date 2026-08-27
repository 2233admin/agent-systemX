import type { EvidenceRef, GateResult, RecoveryAction, Violation } from '../core/result.ts';
import { isRfc3339Timestamp } from '../core/result.ts';
import type { PlanStatus } from '../domain/workflow.ts';

export type IterationPhase = 'phase-2-execute' | 'phase-3-close' | 'phase-4-pr-delivery';

export interface PhaseTransition {
  readonly phase: IterationPhase;
  readonly nextPhase?: IterationPhase;
  readonly planId: string;
  readonly taskId: string;
  readonly nextStatus: PlanStatus;
}

export interface ResidualClosure {
  readonly owner: string;
  readonly decision: string;
  readonly target: string;
  readonly closureEvidence: EvidenceRef | readonly EvidenceRef[];
}

export interface IterationGateInput {
  readonly phase: IterationPhase | string;
  readonly planId?: string;
  readonly taskId?: string;
  readonly workerDone?: boolean;
  readonly reviewComplete?: boolean;
  readonly qaComplete?: boolean;
  /** 保留字段仅用于兼容输入；只有结构化 residualClosure 才能通过 close gate。 */
  readonly residualsClosed?: boolean;
  readonly residualClosure?: ResidualClosure;
  readonly residuals?: ResidualClosure;
  readonly executionLeaseReleased?: boolean;
  readonly integrationMergeLeaseReleased?: boolean;
  readonly mergeReady?: boolean;
  readonly evidence?: readonly EvidenceRef[];
}

const phases: readonly IterationPhase[] = ['phase-2-execute', 'phase-3-close', 'phase-4-pr-delivery'];

function violation(code: string, message: string): Violation {
  return { code, message };
}

function failure(kind: 'fail' | 'blocked' | 'unknown', violations: readonly Violation[]): GateResult<PhaseTransition> {
  const recovery: readonly RecoveryAction[] = violations.map(({ code, message }) => ({
    code: `recover.${code}`,
    description: message ?? '重新提供完整迭代证据',
  }));
  return { kind, violations, recovery };
}

function missingBoolean(value: boolean | undefined): boolean {
  return value !== true;
}

function validEvidence(value: unknown): value is EvidenceRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.source === 'string'
    && candidate.source.trim().length > 0
    && typeof candidate.observedAt === 'string'
    && isRfc3339Timestamp(candidate.observedAt);
}

function evidenceViolations(evidence: readonly EvidenceRef[] | undefined): Violation[] {
  if (evidence === undefined || evidence.length === 0) {
    return [violation('iteration.evidence.missing', 'At least one evidence reference is required')];
  }
  return evidence.every(validEvidence)
    ? []
    : [violation('iteration.evidence.invalid', 'Evidence references must contain source and RFC 3339 observedAt')];
}

function residualClosureViolations(input: IterationGateInput): Violation[] {
  const closure = input.residualClosure ?? input.residuals;
  if (closure === undefined) {
    return [violation('iteration.residuals.evidence.missing', 'Structured residual closure evidence is required')];
  }
  const violations: Violation[] = [];
  if (typeof closure.owner !== 'string' || closure.owner.trim().length === 0) {
    violations.push(violation('iteration.residuals.owner.missing', 'Residual closure owner is required'));
  }
  if (typeof closure.decision !== 'string' || closure.decision.trim().length === 0) {
    violations.push(violation('iteration.residuals.decision.missing', 'Residual closure decision is required'));
  }
  if (typeof closure.target !== 'string' || closure.target.trim().length === 0) {
    violations.push(violation('iteration.residuals.target.missing', 'Residual closure target is required'));
  }
  const evidence = Array.isArray(closure.closureEvidence) ? closure.closureEvidence : [closure.closureEvidence];
  if (evidence.length === 0 || !evidence.every(validEvidence)) {
    violations.push(violation('iteration.residuals.evidence.invalid', 'Residual closure evidence must contain source and RFC 3339 observedAt'));
  }
  return violations;
}

function failureKind(violations: readonly Violation[]): 'blocked' | 'unknown' {
  return violations.some(({ code }) => code.startsWith('iteration.evidence.') || code.startsWith('iteration.residuals.evidence.'))
    ? 'unknown'
    : 'blocked';
}

export function evaluateIterationGate(input: IterationGateInput): GateResult<PhaseTransition> {
  if (!phases.includes(input.phase as IterationPhase)) {
    return failure('fail', [violation('iteration.phase.unknown', 'Iteration phase is not recognized')]);
  }
  const phase = input.phase as IterationPhase;
  const planId = typeof input.planId === 'string' ? input.planId.trim() : '';
  const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
  const violations: Violation[] = [
    ...evidenceViolations(input.evidence),
  ];
  if (planId.length === 0) violations.push(violation('iteration.plan-id.missing', 'planId is required'));
  if (taskId.length === 0) violations.push(violation('iteration.task-id.missing', 'taskId is required'));

  if (phase === 'phase-2-execute') {
    if (missingBoolean(input.workerDone)) violations.push(violation('iteration.worker-done.missing', 'worker_done delivery evidence is required'));
    if (violations.length > 0) return failure(failureKind(violations), violations);
    return {
      kind: 'pass',
      value: { phase, nextPhase: 'phase-3-close', planId, taskId, nextStatus: 'InReview' },
      evidence: input.evidence as readonly EvidenceRef[],
    };
  }

  if (missingBoolean(input.workerDone)) violations.push(violation('iteration.worker-done.missing', 'worker_done delivery evidence is required'));
  if (missingBoolean(input.reviewComplete)) violations.push(violation('iteration.review.incomplete', 'Required review is incomplete'));
  if (missingBoolean(input.qaComplete)) violations.push(violation('iteration.qa.incomplete', 'Required QA is incomplete'));
  violations.push(...residualClosureViolations(input));
  if (missingBoolean(input.executionLeaseReleased)) violations.push(violation('iteration.execution-lease.active', 'Execution lease is not released'));
  if (missingBoolean(input.integrationMergeLeaseReleased)) {
    violations.push(violation('iteration.integration-lease.active', 'Integration merge lease is not released'));
  }

  if (phase === 'phase-3-close') {
    if (violations.length > 0) return failure(failureKind(violations), violations);
    return {
      kind: 'pass',
      value: { phase, nextPhase: 'phase-4-pr-delivery', planId, taskId, nextStatus: 'InReview' },
      evidence: input.evidence as readonly EvidenceRef[],
    };
  }

  if (input.mergeReady !== true) violations.push(violation('iteration.merge-not-ready', 'PR review has not established merge-ready'));
  if (violations.length > 0) return failure(failureKind(violations), violations);
  return {
    kind: 'pass',
    value: { phase, planId, taskId, nextStatus: 'Done' },
    evidence: input.evidence as readonly EvidenceRef[],
  };
}
