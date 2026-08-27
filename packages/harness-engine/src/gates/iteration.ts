import type { EvidenceRef, GateResult, RecoveryAction, Violation } from '../core/result.ts';
import { validateEvidenceRef, validateGateResult } from '../core/result.ts';
import type { PlanRow, PlanStatus } from '../domain/workflow.ts';
import { isPlanStatus } from '../domain/workflow.ts';
import type { ResidualClosure } from '../domain/review.ts';
import { isConcreteRevision, validateResidualClosure } from '../domain/review.ts';
import { validateLease } from '../domain/lease.ts';
import type { MergeReady } from './pr-review.ts';
import { validateMergeReady } from './pr-review.ts';
export type { ResidualClosure };


export type IterationPhase = 'phase-2-execute' | 'phase-3-close' | 'phase-4-pr-delivery';

export interface PhaseTransition {
  readonly phase: IterationPhase;
  readonly nextPhase?: IterationPhase;
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
  /** 保留字段仅用于兼容输入；只有结构化 residualClosure 才能通过 close gate。 */
  readonly residualsClosed?: boolean;
  readonly residualClosure?: ResidualClosure;
  readonly residuals?: ResidualClosure;
  readonly executionLeaseReleased?: boolean;
  readonly integrationMergeLeaseReleased?: boolean;
  /** 计划行必须逐项证明已完成，不能由布尔值推断。 */
  readonly planRows?: readonly PlanRow[];
  readonly prResult?: GateResult<MergeReady>;
  readonly currentHeadSha?: string;
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
  if (typeof candidate.source !== 'string' || candidate.source.trim().length === 0) return false;
  try {
    validateEvidenceRef(value as EvidenceRef);
    return true;
  } catch {
    return false;
  }
}

function evidenceViolations(evidence: unknown): Violation[] {
  if (evidence === undefined) return [violation('iteration.evidence.missing', 'At least one evidence reference is required')];
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return [violation('iteration.evidence.invalid', 'Evidence references must contain source and RFC 3339 observedAt')];
  }
  for (let index = 0; index < evidence.length; index += 1) {
    if (!(index in evidence) || !validEvidence(evidence[index])) {
      return [violation('iteration.evidence.invalid', 'Evidence references must contain source and RFC 3339 observedAt')];
    }
  }
  return [];
}

function planRowsViolations(rows: unknown, planId: string): Violation[] {
  if (!Array.isArray(rows) || rows.length === 0) return [violation('iteration.plan-rows.missing', 'All required plan rows must be provided')];
  for (let index = 0; index < rows.length; index += 1) {
    if (!(index in rows) || typeof rows[index] !== 'object' || rows[index] === null || Array.isArray(rows[index])) {
      return [violation('iteration.plan-rows.invalid', 'Plan rows are malformed')];
    }
  }
  const typed = rows as readonly PlanRow[];
  if (typed.some((row) => {
    const candidate = row as unknown as Record<string, unknown>;
    return Object.keys(candidate).some((key) => !['id', 'title', 'status', 'metadata', 'executionLease'].includes(key))
      || Object.keys(candidate).length < 4
      || typeof row.id !== 'string' || row.id.trim().length === 0 || !isPlanStatus(row.status)
      || typeof row.title !== 'string' || row.title.trim().length === 0
      || typeof row.metadata !== 'object' || row.metadata === null || Array.isArray(row.metadata)
      || (row.executionLease !== undefined && (!validateLease(row.executionLease) || row.executionLease.kind !== 'execution'))
      || (row.status === 'Done' && row.executionLease !== undefined);
  })) {
    return [violation('iteration.plan-rows.invalid', 'Plan rows are malformed')];
  }
  if (!typed.some((row) => row.id === planId) || typed.some((row) => row.status !== 'Done')) {
    return [violation('iteration.plan.incomplete', 'Every required plan row must be Done')];
  }
  return [];
}

function residualClosureViolations(input: IterationGateInput): Violation[] {
  const closure = input.residualClosure !== undefined ? input.residualClosure : input.residuals;
  if (closure === undefined) {
    return [violation('iteration.residuals.evidence.missing', 'Structured residual closure evidence is required')];
  }
  return validateResidualClosure(closure)
    ? []
    : [violation('iteration.residuals.invalid', 'Residual closure requires owner, decision, target, and closure evidence')];
}

function failureKind(violations: readonly Violation[]): 'blocked' | 'unknown' {
  return violations.some(({ code }) => code.startsWith('iteration.evidence.') || code.startsWith('iteration.residuals.evidence.'))
    ? 'unknown'
    : 'blocked';
}

export function evaluateIterationGate(input: unknown): GateResult<PhaseTransition> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return failure('fail', [violation('iteration.input.invalid', 'Iteration input must be an object')]);
  }
  const data = input as IterationGateInput;
  if (!phases.includes(data.phase as IterationPhase)) {
    return failure('fail', [violation('iteration.phase.unknown', 'Iteration phase is not recognized')]);
  }
  const phase = data.phase as IterationPhase;
  const planId = typeof data.planId === 'string' ? data.planId.trim() : '';
  const taskId = typeof data.taskId === 'string' ? data.taskId.trim() : '';
  const violations: Violation[] = [...evidenceViolations(data.evidence)];
  if (planId.length === 0) violations.push(violation('iteration.plan-id.missing', 'planId is required'));
  if (taskId.length === 0) violations.push(violation('iteration.task-id.missing', 'taskId is required'));

  if (phase === 'phase-2-execute') {
    if (missingBoolean(data.workerDone)) violations.push(violation('iteration.worker-done.missing', 'worker_done delivery evidence is required'));
    if (violations.length > 0) return failure(failureKind(violations), violations);
    return { kind: 'pass', value: { phase, nextPhase: 'phase-3-close', planId, taskId, nextStatus: 'InReview' }, evidence: data.evidence as readonly EvidenceRef[] };
  }

  if (missingBoolean(data.workerDone)) violations.push(violation('iteration.worker-done.missing', 'worker_done delivery evidence is required'));
  if (missingBoolean(data.reviewComplete)) violations.push(violation('iteration.review.incomplete', 'Required review is incomplete'));
  if (missingBoolean(data.qaComplete)) violations.push(violation('iteration.qa.incomplete', 'Required QA is incomplete'));
  violations.push(...residualClosureViolations(data));
  violations.push(...planRowsViolations(data.planRows, planId));
  if (missingBoolean(data.executionLeaseReleased)) violations.push(violation('iteration.execution-lease.active', 'Execution lease is not released'));
  if (missingBoolean(data.integrationMergeLeaseReleased)) violations.push(violation('iteration.integration-lease.active', 'Integration merge lease is not released'));

  if (phase === 'phase-3-close') {
    if (violations.length > 0) return failure(failureKind(violations), violations);
    return { kind: 'pass', value: { phase, nextPhase: 'phase-4-pr-delivery', planId, taskId, nextStatus: 'InReview' }, evidence: data.evidence as readonly EvidenceRef[] };
  }

  const currentHeadSha = typeof data.currentHeadSha === 'string' ? data.currentHeadSha.trim() : '';
  if (!isConcreteRevision(currentHeadSha)) violations.push(violation('iteration.current-head.missing', 'A concrete current HEAD SHA is required'));
  const prResult = data.prResult;
  try {
    validateGateResult(prResult);
    if (!prResult || prResult.kind !== 'pass' || !validateMergeReady(prResult.value, currentHeadSha)
      || prResult.value.planId !== planId || prResult.value.taskId !== taskId) {
      violations.push(violation('iteration.pr-result.invalid', 'A current-head-bound merge-ready PR result is required'));
    }
  } catch {
    violations.push(violation('iteration.pr-result.invalid', 'A current-head-bound merge-ready PR result is required'));
  }
  if (violations.length > 0) return failure(failureKind(violations), violations);
  const result = prResult as Extract<GateResult<MergeReady>, { kind: 'pass' }>;
  return { kind: 'pass', value: { phase, planId, taskId, nextStatus: 'Done' }, evidence: [...(data.evidence as readonly EvidenceRef[]), ...result.evidence] };
}
