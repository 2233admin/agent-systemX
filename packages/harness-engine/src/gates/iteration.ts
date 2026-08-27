import type { GateResult, RecoveryAction, Violation } from '../core/result.ts';
import type { PlanStatus } from '../domain/workflow.ts';

export type IterationPhase = 'phase-2-execute' | 'phase-3-close' | 'phase-4-pr-delivery';

export interface PhaseTransition {
  readonly phase: IterationPhase;
  readonly nextPhase: IterationPhase;
  readonly planId: string;
  readonly taskId: string;
  readonly nextStatus: PlanStatus;
}

export interface IterationGateInput {
  readonly phase: IterationPhase | string;
  readonly planId?: string;
  readonly taskId?: string;
  readonly workerDone?: boolean;
  readonly reviewComplete?: boolean;
  readonly qaComplete?: boolean;
  readonly residualsClosed?: boolean;
  readonly executionLeaseReleased?: boolean;
  readonly integrationMergeLeaseReleased?: boolean;
  readonly mergeReady?: boolean;
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

export function evaluateIterationGate(input: IterationGateInput): GateResult<PhaseTransition> {
  if (!phases.includes(input.phase as IterationPhase)) {
    return failure('fail', [violation('iteration.phase.unknown', 'Iteration phase is not recognized')]);
  }
  const phase = input.phase as IterationPhase;
  const planId = typeof input.planId === 'string' ? input.planId.trim() : '';
  const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
  const violations: Violation[] = [];
  if (planId.length === 0) violations.push(violation('iteration.plan-id.missing', 'planId is required'));
  if (taskId.length === 0) violations.push(violation('iteration.task-id.missing', 'taskId is required'));

  if (phase === 'phase-2-execute') {
    if (missingBoolean(input.workerDone)) violations.push(violation('iteration.worker-done.missing', 'worker_done delivery evidence is required'));
    if (violations.length > 0) return failure('blocked', violations);
    return {
      kind: 'pass',
      value: { phase, nextPhase: 'phase-3-close', planId, taskId, nextStatus: 'InReview' },
      evidence: [],
    };
  }

  if (missingBoolean(input.workerDone)) violations.push(violation('iteration.worker-done.missing', 'worker_done delivery evidence is required'));
  if (missingBoolean(input.reviewComplete)) violations.push(violation('iteration.review.incomplete', 'Required review is incomplete'));
  if (missingBoolean(input.qaComplete)) violations.push(violation('iteration.qa.incomplete', 'Required QA is incomplete'));
  if (missingBoolean(input.residualsClosed)) violations.push(violation('iteration.residuals.incomplete', 'Residuals are not closed or explicitly accepted'));
  if (missingBoolean(input.executionLeaseReleased)) violations.push(violation('iteration.execution-lease.active', 'Execution lease is not released'));
  if (missingBoolean(input.integrationMergeLeaseReleased)) {
    violations.push(violation('iteration.integration-lease.active', 'Integration merge lease is not released'));
  }

  if (phase === 'phase-3-close') {
    if (violations.length > 0) return failure('blocked', violations);
    return {
      kind: 'pass',
      value: { phase, nextPhase: 'phase-4-pr-delivery', planId, taskId, nextStatus: 'Done' },
      evidence: [],
    };
  }

  if (input.mergeReady !== true) violations.push(violation('iteration.merge-not-ready', 'PR review has not established merge-ready'));
  if (violations.length > 0) return failure('blocked', violations);
  return {
    kind: 'pass',
    value: { phase, nextPhase: 'phase-4-pr-delivery', planId, taskId, nextStatus: 'Done' },
    evidence: [],
  };
}
