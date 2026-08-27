import type { GateResult, RecoveryAction, Violation } from '../core/result.ts';
import type { ReviewPackage } from '../domain/review.ts';
import { isConcreteRevision, validateReviewPackage } from '../domain/review.ts';

export interface PushDecision {
  readonly headSha: string;
  readonly push: boolean;
}

export interface PushCadenceInput {
  readonly currentHeadSha?: string;
  readonly headSha?: string;
  readonly ciRunning?: boolean;
  readonly aiReviewRunning?: boolean;
  readonly ciRunningOnHead?: boolean;
  readonly aiReviewRunningOnHead?: boolean;
  readonly changesPending?: boolean;
}

export interface RequiredCheck {
  readonly name: string;
  readonly status: string;
  readonly headSha?: string;
}

export interface RequiredReview {
  readonly reviewerId: string;
  readonly status: string;
  readonly headSha?: string;
}

export interface MergeReady {
  readonly planId: string;
  readonly taskId: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly mergeReady: true;
}

export interface PrReviewInput {
  readonly planId?: string;
  readonly taskId?: string;
  readonly baseSha?: string;
  readonly headSha?: string;
  readonly currentHeadSha?: string;
  readonly reviewPackage?: ReviewPackage;
  readonly requiredChecks?: readonly RequiredCheck[];
  readonly requiredReviews?: readonly RequiredReview[];
  readonly unresolvedReviews?: number;
  readonly unresolvedReviewCount?: number;
  readonly residualsClosed?: boolean;
  readonly mergeable?: boolean;
  readonly priorResult?: MergeReady;
}

function violation(code: string, message: string): Violation {
  return { code, message };
}

function failure<T>(kind: 'fail' | 'blocked' | 'unknown', violations: readonly Violation[]): GateResult<T> {
  const recovery: readonly RecoveryAction[] = violations.map(({ code, message }) => ({
    code: `recover.${code}`,
    description: message ?? '重新读取当前 head、check 和 review 状态',
  }));
  return { kind, violations, recovery };
}

function runningOnCurrentHead(input: PushCadenceInput): boolean {
  return input.ciRunning === true
    || input.aiReviewRunning === true
    || input.ciRunningOnHead === true
    || input.aiReviewRunningOnHead === true;
}

export function evaluatePushCadence(input: PushCadenceInput): GateResult<PushDecision> {
  const headSha = typeof (input.currentHeadSha ?? input.headSha) === 'string'
    ? (input.currentHeadSha ?? input.headSha as string).trim()
    : '';
  const violations: Violation[] = [];
  if (!isConcreteRevision(headSha)) violations.push(violation('push.head-sha.missing', 'A concrete current HEAD SHA is required'));
  if (runningOnCurrentHead(input)) violations.push(violation('push.current-head.busy', 'CI or AI review is still running on the current HEAD'));
  if (violations.length > 0) return failure('blocked', violations);
  return {
    kind: 'pass',
    value: { headSha, push: input.changesPending !== false },
    evidence: [],
  };
}

function checkPassed(status: unknown): boolean {
  if (typeof status !== 'string') return false;
  const normalized = status.trim().toLowerCase();
  return normalized === 'passed' || normalized === 'pass' || normalized === 'success' || normalized === 'successful' || normalized === 'completed';
}

function reviewApproved(status: unknown): boolean {
  if (typeof status !== 'string') return false;
  const normalized = status.trim().toLowerCase();
  return normalized === 'approved' || normalized === 'approve';
}

export function evaluatePrReview(input: PrReviewInput): GateResult<MergeReady> {
  const violations: Violation[] = [];
  const planId = typeof input.planId === 'string' ? input.planId.trim() : '';
  const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
  const baseSha = typeof input.baseSha === 'string' ? input.baseSha.trim() : '';
  const headSha = typeof input.headSha === 'string' ? input.headSha.trim() : '';
  const currentHeadSha = typeof input.currentHeadSha === 'string' ? input.currentHeadSha.trim() : '';
  if (planId.length === 0) violations.push(violation('pr.plan-id.missing', 'planId is required'));
  if (taskId.length === 0) violations.push(violation('pr.task-id.missing', 'taskId is required'));
  if (!isConcreteRevision(baseSha)) violations.push(violation('pr.base-sha.missing', 'A concrete BASE SHA is required'));
  if (!isConcreteRevision(headSha)) violations.push(violation('pr.head-sha.missing', 'A concrete review HEAD SHA is required'));
  if (!isConcreteRevision(currentHeadSha)) {
    violations.push(violation('pr.current-head.missing', 'A concrete current HEAD SHA is required'));
  } else if (currentHeadSha !== headSha) {
    violations.push(violation('pr.head-sha.stale', 'PR review evidence is bound to a stale HEAD SHA'));
  }
  if (input.priorResult !== undefined && input.priorResult.headSha !== currentHeadSha) {
    violations.push(violation('pr.prior-result.invalidated', 'Prior review result is invalid after a HEAD change'));
  }

  const pkg = input.reviewPackage;
  if (pkg === undefined) {
    violations.push(violation('pr.review-package.missing', 'A review package is required'));
  } else if (!validateReviewPackage(pkg)) {
    violations.push(violation('pr.review-package.invalid', 'Review package is malformed'));
  } else {
    if (pkg.planId !== planId || pkg.taskId !== taskId) violations.push(violation('pr.review-package.identity.mismatch', 'Review package identity does not match'));
    if (pkg.baseSha !== baseSha || pkg.headSha !== headSha) violations.push(violation('pr.review-package.range.mismatch', 'Review package range does not match'));
  }

  if (input.requiredChecks === undefined || input.requiredChecks.length === 0) {
    violations.push(violation('pr.checks.missing', 'Required check evidence is missing'));
  } else {
    for (const check of input.requiredChecks) {
      if (!checkPassed(check.status)) violations.push(violation('pr.check.failed', `Required check ${check.name} has not passed`));
      if (check.headSha !== undefined && check.headSha !== currentHeadSha) violations.push(violation('pr.check.stale', `Required check ${check.name} is not for the current HEAD`));
    }
  }
  if (input.requiredReviews === undefined || input.requiredReviews.length === 0) {
    violations.push(violation('pr.reviews.missing', 'Required review evidence is missing'));
  } else {
    for (const review of input.requiredReviews) {
      if (typeof review.reviewerId !== 'string' || review.reviewerId.trim().length === 0 || !reviewApproved(review.status)) {
        violations.push(violation('pr.review.unapproved', `Required review by ${String(review.reviewerId)} is not approved`));
      }
      if (typeof review.headSha === 'string' && review.headSha !== currentHeadSha) {
        violations.push(violation('pr.review.stale', `Review by ${String(review.reviewerId)} is not for the current HEAD`));
      }
    }
  }
  const unresolved = input.unresolvedReviews ?? input.unresolvedReviewCount;
  if (unresolved === undefined) {
    violations.push(violation('pr.review.unresolved.unknown', 'Unresolved review count is unknown'));
  } else if (!Number.isSafeInteger(unresolved) || unresolved < 0 || unresolved > 0) {
    violations.push(violation('pr.review.unresolved', 'Unresolved review threads remain'));
  }
  if (input.residualsClosed !== true) violations.push(violation('pr.residuals.incomplete', 'Residuals are not closed or explicitly accepted'));
  if (input.mergeable !== true) {
    violations.push(violation(input.mergeable === false ? 'pr.mergeable.false' : 'pr.mergeable.unknown', 'PR mergeability is not proven'));
  }

  if (violations.length > 0) {
    const stale = violations.some(({ code }) => code === 'pr.head-sha.stale' || code === 'pr.prior-result.invalidated');
    const blocked = violations.some(({ code }) => code === 'pr.review.unresolved');
    return failure(stale || blocked ? 'blocked' : 'fail', violations);
  }
  return {
    kind: 'pass',
    value: { planId, taskId, baseSha, headSha, mergeReady: true },
    evidence: [],
  };
}
