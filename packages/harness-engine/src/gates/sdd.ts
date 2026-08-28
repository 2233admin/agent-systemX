import type { GateResult, RecoveryAction, Violation } from '../core/result.ts';
import { isRfc3339Timestamp } from '../core/result.ts';
import type { ReviewPackage } from '../domain/review.ts';
import { isConcreteRevision, validateReviewPackage } from '../domain/review.ts';

export interface QcIdentity {
  readonly planId: string;
  readonly taskId: string;
  readonly reviewerId: string;
  readonly reviewRange: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly seats: number;
}

export interface ReviewReady {
  readonly planId: string;
  readonly taskId: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly reviewRange: string;
  readonly qcSeats: 1 | 3;
}

export interface SddGateInput {
  readonly planId?: string;
  readonly taskId?: string;
  readonly baseSha?: string;
  readonly headSha?: string;
  readonly currentHeadSha?: string;
  readonly reviewRange?: string;
  readonly range?: string;
  readonly reviewPackage?: ReviewPackage;
  readonly qc?: QcIdentity;
  readonly qcIdentity?: QcIdentity;
  readonly reviewerId?: string;
  readonly executionMode?: 'sdd' | 'inline';
  readonly qcSeats?: number;
  readonly observedAt?: string;
}

function violation(code: string, message: string): Violation {
  return { code, message };
}

function recovery(code: string, description: string): RecoveryAction {
  return { code, description };
}

function failure(kind: 'fail' | 'blocked' | 'unknown', violations: readonly Violation[]): GateResult<ReviewReady> {
  return {
    kind,
    violations,
    recovery: violations.map(({ code, message }) => recovery(`recover.${code}`, message ?? '重新提供可验证证据')),
  };
}

function requiredRevision(value: unknown): boolean {
  return isConcreteRevision(value);
}

function reviewRange(baseSha: string, headSha: string): string {
  return `${baseSha}..${headSha}`;
}

export function validateSddGate(input: SddGateInput): GateResult<ReviewReady> {
  const violations: Violation[] = [];
  const planId = typeof input.planId === 'string' ? input.planId.trim() : '';
  const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
  const baseSha = typeof input.baseSha === 'string' ? input.baseSha.trim() : '';
  const headSha = typeof input.headSha === 'string' ? input.headSha.trim() : '';
  const currentHeadSha = typeof input.currentHeadSha === 'string' ? input.currentHeadSha.trim() : '';
  const suppliedRange = input.reviewRange ?? input.range;
  const range = typeof suppliedRange === 'string' ? suppliedRange.trim() : '';
  const expectedRange = requiredRevision(baseSha) && requiredRevision(headSha) ? reviewRange(baseSha, headSha) : '';
  const pkg = input.reviewPackage;
  const qc = input.qc ?? input.qcIdentity;

  if (!requiredRevision(baseSha)) violations.push(violation('sdd.base-sha.missing', 'A concrete BASE SHA is required'));
  if (!requiredRevision(headSha)) violations.push(violation('sdd.head-sha.missing', 'A concrete HEAD SHA is required'));
  if (currentHeadSha.length === 0) violations.push(violation('sdd.current-head.missing', 'Current HEAD SHA is required'));
  if (currentHeadSha.length > 0 && headSha.length > 0 && currentHeadSha !== headSha) {
    violations.push(violation('sdd.head-sha.stale', 'Review evidence is bound to a stale HEAD SHA'));
  }
  if (planId.length === 0) violations.push(violation('sdd.plan-id.missing', 'planId is required'));
  if (taskId.length === 0) violations.push(violation('sdd.task-id.missing', 'taskId is required'));
  if (pkg === undefined) {
    violations.push(violation('sdd.review-package.missing', 'A review package is required'));
  } else if (!validateReviewPackage(pkg)) {
    violations.push(violation('sdd.review-package.invalid', 'Review package is malformed'));
  } else {
    if (pkg.planId !== planId) violations.push(violation('sdd.review-package.plan-id.mismatch', 'Review package planId does not match'));
    if (pkg.taskId !== taskId) violations.push(violation('sdd.review-package.task-id.mismatch', 'Review package taskId does not match'));
    if (pkg.baseSha !== baseSha) violations.push(violation('sdd.review-package.base-sha.mismatch', 'Review package BASE SHA does not match'));
    if (pkg.headSha !== headSha) violations.push(violation('sdd.review-package.head-sha.mismatch', 'Review package HEAD SHA does not match'));
  }
  if (range.length === 0) {
    violations.push(violation('sdd.review-range.missing', 'An explicit BASE..HEAD review range is required'));
  } else if (!expectedRange || range !== expectedRange || /HEAD(?:~|\^|$)/i.test(range)) {
    violations.push(violation('sdd.review-range.invalid', 'Review range must be the concrete BASE..HEAD range'));
    if (expectedRange && range !== expectedRange) violations.push(violation('sdd.review-range.mismatch', 'Review range does not match BASE and HEAD'));
  }

  const expectedSeats = input.executionMode === 'sdd' ? 3 : input.executionMode === 'inline' ? 1 : undefined;
  if (expectedSeats === undefined) {
    violations.push(violation('sdd.execution-mode.missing', 'Execution mode must be sdd or inline'));
  }
  if (qc === undefined) {
    violations.push(violation('sdd.qc.identity.missing', 'QC identity is required'));
  } else {
    if (!requiredRevision(qc.baseSha) || qc.baseSha !== baseSha) violations.push(violation('sdd.qc.base-sha.mismatch', 'QC BASE SHA does not match'));
    if (!requiredRevision(qc.headSha) || qc.headSha !== headSha) violations.push(violation('sdd.qc.head-sha.mismatch', 'QC HEAD SHA does not match'));
    if (qc.planId !== planId) violations.push(violation('sdd.qc.plan-id.mismatch', 'QC planId does not match'));
    if (qc.taskId !== taskId) violations.push(violation('sdd.qc.task-id.mismatch', 'QC taskId does not match'));
    if (typeof qc.reviewerId !== 'string' || qc.reviewerId.trim().length === 0 || qc.reviewerId === taskId) {
      violations.push(violation('sdd.qc.identity.mismatch', 'QC reviewer identity is required and must be distinct'));
    }
    if (qc.reviewRange !== expectedRange) violations.push(violation('sdd.qc.review-range.mismatch', 'QC review range does not match'));
    if (expectedSeats !== undefined && qc.seats !== expectedSeats) {
      violations.push(violation('sdd.qc.seats.mismatch', `QC requires exactly ${expectedSeats} seat(s)`));
    }
  }
  if (input.qcSeats !== undefined && expectedSeats !== undefined && input.qcSeats !== expectedSeats) {
    violations.push(violation('sdd.qc.seats.mismatch', `QC requires exactly ${expectedSeats} seat(s)`));
  }
  if (input.reviewerId !== undefined && qc !== undefined && input.reviewerId !== qc.reviewerId) {
    violations.push(violation('sdd.qc.identity.mismatch', 'QC reviewer identity does not match'));
  }
  if (input.observedAt !== undefined && !isRfc3339Timestamp(input.observedAt)) {
    violations.push(violation('sdd.evidence.observed-at.invalid', 'SDD evidence observedAt must be RFC 3339'));
  }

  if (violations.length > 0) {
    const onlyStale = violations.every(({ code }) => code === 'sdd.head-sha.stale');
    return failure(onlyStale ? 'blocked' : 'fail', violations);
  }
  return {
    kind: 'pass',
    value: {
      planId,
      taskId,
      baseSha,
      headSha,
      reviewRange: expectedRange,
      qcSeats: (expectedSeats as 1 | 3),
    },
    evidence: [
      { source: 'harness-engine.sdd.review-package', observedAt: pkg?.createdAt as string },
      ...(input.observedAt === undefined ? [] : [{ source: 'harness-engine.sdd', observedAt: input.observedAt }]),
    ],
  };
}
