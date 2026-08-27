import type { EvidenceRef, GateResult, RecoveryAction, Violation } from '../core/result.ts';
import { validateEvidenceRef } from '../core/result.ts';
import type { ReviewPackage, ResidualClosure } from '../domain/review.ts';
import { isConcreteRevision, validateResidualClosure, validateReviewPackage } from '../domain/review.ts';

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
  readonly evidence?: readonly EvidenceRef[];
}

export interface RequiredCheck {
  readonly name: string;
  readonly status: string;
  readonly headSha: string;
}

export interface RequiredReview {
  readonly reviewerId: string;
  readonly status: string;
  readonly headSha: string;
}

export type ReviewVerdict = 'approve' | 'block';

export interface ReviewTally {
  readonly total: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly pending: number;
  readonly unresolved: number;
  readonly score: number;
  readonly verdict: ReviewVerdict;
}

export interface MergeReady {
  readonly planId: string;
  readonly taskId: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly mergeReady: true;
  readonly tally: ReviewTally;
  readonly score: number;
  readonly verdict: ReviewVerdict;
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
  /** 保留字段仅用于兼容输入；结构化 residualClosure 才能通过。 */
  readonly residualsClosed?: boolean;
  readonly residualClosure?: ResidualClosure;
  readonly residuals?: ResidualClosure;
  readonly mergeable?: boolean;
  readonly priorResult?: MergeReady;
  readonly evidence?: readonly EvidenceRef[];
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
function validEvidence(value: unknown): value is EvidenceRef {
  try {
    validateEvidenceRef(value as EvidenceRef);
    return true;
  } catch {
    return false;
  }
}

function evidenceViolations(evidence: readonly EvidenceRef[] | undefined): Violation[] {
  if (evidence === undefined || evidence.length === 0) {
    return [violation('pr.evidence.missing', 'At least one evidence reference is required')];
  }
  return evidence.every(validEvidence)
    ? []
    : [violation('pr.evidence.invalid', 'Evidence references must contain source and RFC 3339 observedAt')];
}

export function evaluatePushCadence(input: PushCadenceInput): GateResult<PushDecision> {
  const revision = input.currentHeadSha ?? input.headSha;
  const headSha = typeof revision === 'string' ? revision.trim() : '';
  const violations: Violation[] = [...evidenceViolations(input.evidence)];
  if (!isConcreteRevision(headSha)) violations.push(violation('push.head-sha.missing', 'A concrete current HEAD SHA is required'));
  if (runningOnCurrentHead(input)) violations.push(violation('push.current-head.busy', 'CI or AI review is still running on the current HEAD'));
  if (violations.length > 0) {
    return failure(violations.some(({ code }) => code === 'push.current-head.busy') ? 'blocked' : 'unknown', violations);
  }
  return {
    kind: 'pass',
    value: { headSha, push: input.changesPending !== false },
    evidence: input.evidence as readonly EvidenceRef[],
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

export function calculateReviewTally(reviews: readonly RequiredReview[], unresolved: number): ReviewTally {
  let approved = 0;
  let changesRequested = 0;
  let pending = 0;
  for (const review of reviews) {
    const status = typeof review.status === 'string' ? review.status.trim().toLowerCase() : '';
    if (status === 'approved' || status === 'approve') approved += 1;
    else if (status === 'changes_requested' || status === 'request_changes' || status === 'changes-requested') changesRequested += 1;
    else pending += 1;
  }
  const total = reviews.length;
  const score = total === 0 ? 0 : Math.round((approved / total) * 10000) / 100;
  const verdict: ReviewVerdict = total > 0 && approved === total && unresolved === 0 ? 'approve' : 'block';
  return { total, approved, changesRequested, pending, unresolved, score, verdict };
}

function prFailureKind(violations: readonly Violation[]): 'fail' | 'blocked' | 'unknown' {
  if (violations.some(({ code }) => code === 'pr.head-sha.stale' || code === 'pr.prior-result.invalidated' || code === 'pr.review.unresolved')) return 'blocked';
  if (violations.some(({ code }) => code.startsWith('pr.evidence.') || code.startsWith('pr.residuals.evidence.'))) return 'unknown';
  return 'fail';
}

export function evaluatePrReview(input: PrReviewInput): GateResult<MergeReady> {
  const violations: Violation[] = [...evidenceViolations(input.evidence)];
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
      if (!checkPassed(check.status)) violations.push(violation('pr.check.failed', `Required check ${String(check.name)} has not passed`));
      if (!isConcreteRevision(check.headSha)) {
        violations.push(violation('pr.check.head-sha.missing', `Required check ${String(check.name)} is not bound to a concrete HEAD`));
      } else if (check.headSha !== currentHeadSha) {
        violations.push(violation('pr.check.stale', `Required check ${String(check.name)} is not for the current HEAD`));
      }
    }
  }
  if (input.requiredReviews === undefined || input.requiredReviews.length === 0) {
    violations.push(violation('pr.reviews.missing', 'Required review evidence is missing'));
  } else {
    for (const review of input.requiredReviews) {
      if (typeof review.reviewerId !== 'string' || review.reviewerId.trim().length === 0 || !reviewApproved(review.status)) {
        violations.push(violation('pr.review.unapproved', `Required review by ${String(review.reviewerId)} is not approved`));
      }
      if (!isConcreteRevision(review.headSha)) {
        violations.push(violation('pr.review.head-sha.missing', `Review by ${String(review.reviewerId)} is not bound to a concrete HEAD`));
      } else if (review.headSha !== currentHeadSha) {
        violations.push(violation('pr.review.stale', `Review by ${String(review.reviewerId)} is not for the current HEAD`));
      }
    }
  }
  if (input.unresolvedReviews !== undefined
    && input.unresolvedReviewCount !== undefined
    && input.unresolvedReviews !== input.unresolvedReviewCount) {
    violations.push(violation('pr.review.unresolved.conflict', 'Unresolved review aliases disagree'));
  }
  const unresolved = input.unresolvedReviews ?? input.unresolvedReviewCount;
  if (unresolved === undefined) {
    violations.push(violation('pr.review.unresolved.unknown', 'Unresolved review count is unknown'));
  } else if (!Number.isSafeInteger(unresolved) || unresolved < 0 || unresolved > 0) {
    violations.push(violation('pr.review.unresolved', 'Unresolved review threads remain'));
  }
  const residualClosure = input.residualClosure ?? input.residuals;
  if (residualClosure === undefined) {
    violations.push(violation('pr.residuals.evidence.missing', 'Structured residual closure evidence is required'));
  } else if (!validateResidualClosure(residualClosure)) {
    violations.push(violation('pr.residuals.invalid', 'Residual closure requires owner, decision, target, and closure evidence'));
  }
  if (input.mergeable !== true) {
    violations.push(violation(input.mergeable === false ? 'pr.mergeable.false' : 'pr.mergeable.unknown', 'PR mergeability is not proven'));
  }

  if (violations.length > 0) return failure(prFailureKind(violations), violations);
  const reviews = input.requiredReviews as readonly RequiredReview[];
  const tally = calculateReviewTally(reviews, unresolved as number);
  return {
    kind: 'pass',
    value: { planId, taskId, baseSha, headSha, mergeReady: true, tally, score: tally.score, verdict: tally.verdict },
    evidence: input.evidence as readonly EvidenceRef[],
  };
}
