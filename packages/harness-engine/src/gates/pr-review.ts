import type { EvidenceRef, GateResult, RecoveryAction, Violation } from '../core/result.ts';
import { validateEvidenceRef, validateGateResult } from '../core/result.ts';
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
  readonly residualClosure: ResidualClosure;
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
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.source !== 'string' || candidate.source.trim().length === 0) return false;
  try {
    validateEvidenceRef(candidate);
    return true;
  } catch {
    return false;
  }
}

function evidenceViolations(evidence: unknown): Violation[] {
  if (evidence === undefined) return [violation('pr.evidence.missing', 'At least one evidence reference is required')];
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return [violation('pr.evidence.invalid', 'Evidence references must contain source and RFC 3339 observedAt')];
  }
  for (let index = 0; index < evidence.length; index += 1) {
    if (!(index in evidence) || !validEvidence(evidence[index])) {
      return [violation('pr.evidence.invalid', 'Evidence references must contain source and RFC 3339 observedAt')];
    }
  }
  return [];
}

export function evaluatePushCadence(input: unknown): GateResult<PushDecision> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return failure('unknown', [violation('push.input.invalid', 'Push cadence input must be an object')]);
  }
  const data = input as PushCadenceInput;
  const revision = data.currentHeadSha !== undefined ? data.currentHeadSha : data.headSha;
  const headSha = typeof revision === 'string' ? revision.trim() : '';
  const violations: Violation[] = [...evidenceViolations(data.evidence)];
  if (!isConcreteRevision(headSha)) violations.push(violation('push.head-sha.missing', 'A concrete current HEAD SHA is required'));
  if (runningOnCurrentHead(data)) violations.push(violation('push.current-head.busy', 'CI or AI review is still running on the current HEAD'));
  if (violations.length > 0) {
    return failure(violations.some(({ code }) => code === 'push.current-head.busy') ? 'blocked' : 'unknown', violations);
  }
  return {
    kind: 'pass',
    value: { headSha, push: data.changesPending !== false },
    evidence: data.evidence as readonly EvidenceRef[],
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

export function validateMergeReady(value: unknown, currentHeadSha?: string): value is MergeReady {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const allowed = ['planId', 'taskId', 'baseSha', 'headSha', 'mergeReady', 'tally', 'score', 'verdict', 'residualClosure'];
  if (Object.keys(candidate).length !== allowed.length || Object.keys(candidate).some((key) => !allowed.includes(key))) return false;
  if (typeof candidate.planId !== 'string' || candidate.planId.trim().length === 0
    || typeof candidate.taskId !== 'string' || candidate.taskId.trim().length === 0
    || !isConcreteRevision(candidate.baseSha) || !isConcreteRevision(candidate.headSha)
    || candidate.mergeReady !== true || (currentHeadSha !== undefined && candidate.headSha !== currentHeadSha)
    || !validateResidualClosure(candidate.residualClosure)) return false;
  if (candidate.verdict !== 'approve'
    || typeof candidate.score !== 'number' || !Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 100) return false;
  if (typeof candidate.tally !== 'object' || candidate.tally === null || Array.isArray(candidate.tally)) return false;
  const tally = candidate.tally as Record<string, unknown>;
  const tallyKeys = ['total', 'approved', 'changesRequested', 'pending', 'unresolved', 'score', 'verdict'];
  if (Object.keys(tally).length !== tallyKeys.length || Object.keys(tally).some((key) => !tallyKeys.includes(key))) return false;
  if (tally.verdict !== 'approve' || tally.score !== candidate.score) return false;
  if (!['total', 'approved', 'changesRequested', 'pending', 'unresolved'].every((key) => typeof tally[key] === 'number'
    && Number.isSafeInteger(tally[key]) && (tally[key] as number) >= 0)) return false;
  return (tally.total as number) > 0
    && tally.total === tally.approved
    && tally.changesRequested === 0 && tally.pending === 0 && tally.unresolved === 0
    && tally.total === (tally.approved as number);
}
function validRequiredCheck(value: unknown): value is RequiredCheck {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).every((key) => ['name', 'status', 'headSha'].includes(key))
    && Object.keys(candidate).length === 3
    && typeof candidate.name === 'string' && candidate.name.trim().length > 0
    && typeof candidate.status === 'string' && candidate.status.trim().length > 0
    && isConcreteRevision(candidate.headSha);
}

function validRequiredReview(value: unknown): value is RequiredReview {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).every((key) => ['reviewerId', 'status', 'headSha'].includes(key))
    && Object.keys(candidate).length === 3
    && typeof candidate.reviewerId === 'string' && candidate.reviewerId.trim().length > 0
    && typeof candidate.status === 'string' && candidate.status.trim().length > 0
    && isConcreteRevision(candidate.headSha);
}
function denseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) return false;
  }
  return true;
}


function prFailureKind(violations: readonly Violation[]): 'fail' | 'blocked' | 'unknown' {
  if (violations.some(({ code }) => code === 'pr.head-sha.stale' || code === 'pr.prior-result.invalidated' || code === 'pr.review.unresolved')) return 'blocked';
  if (violations.some(({ code }) => code.startsWith('pr.evidence.') || code.startsWith('pr.residuals.evidence.'))) return 'unknown';
  return 'fail';
}

export function evaluatePrReview(input: unknown): GateResult<MergeReady> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return failure('unknown', [violation('pr.input.invalid', 'PR review input must be an object')]);
  }
  const data = input as PrReviewInput;
  const violations: Violation[] = [...evidenceViolations(data.evidence)];
  const planId = typeof data.planId === 'string' ? data.planId.trim() : '';
  const taskId = typeof data.taskId === 'string' ? data.taskId.trim() : '';
  const baseSha = typeof data.baseSha === 'string' ? data.baseSha.trim() : '';
  const headSha = typeof data.headSha === 'string' ? data.headSha.trim() : '';
  const currentHeadSha = typeof data.currentHeadSha === 'string' ? data.currentHeadSha.trim() : '';
  if (planId.length === 0) violations.push(violation('pr.plan-id.missing', 'planId is required'));
  if (taskId.length === 0) violations.push(violation('pr.task-id.missing', 'taskId is required'));
  if (!isConcreteRevision(baseSha)) violations.push(violation('pr.base-sha.missing', 'A concrete BASE SHA is required'));
  if (!isConcreteRevision(headSha)) violations.push(violation('pr.head-sha.missing', 'A concrete review HEAD SHA is required'));
  if (!isConcreteRevision(currentHeadSha)) {
    violations.push(violation('pr.current-head.missing', 'A concrete current HEAD SHA is required'));
  } else if (currentHeadSha !== headSha) {
    violations.push(violation('pr.head-sha.stale', 'PR review evidence is bound to a stale HEAD SHA'));
  }
  if (data.priorResult !== undefined && (!validateMergeReady(data.priorResult, currentHeadSha)
    || data.priorResult.headSha !== currentHeadSha)) {
    violations.push(violation('pr.prior-result.invalidated', 'Prior review result is invalid after a HEAD change'));
  }

  const pkg = data.reviewPackage;
  if (pkg === undefined) {
    violations.push(violation('pr.review-package.missing', 'A review package is required'));
  } else if (!validateReviewPackage(pkg)) {
    violations.push(violation('pr.review-package.invalid', 'Review package is malformed'));
  } else {
    if (pkg.planId !== planId || pkg.taskId !== taskId) violations.push(violation('pr.review-package.identity.mismatch', 'Review package identity does not match'));
    if (pkg.baseSha !== baseSha || pkg.headSha !== headSha) violations.push(violation('pr.review-package.range.mismatch', 'Review package range does not match'));
  }

  const checks = data.requiredChecks;
  if (!denseArray(checks) || checks.length === 0) {
    violations.push(violation('pr.checks.missing', 'Required check evidence is missing'));
  } else if (!checks.every((item) => validRequiredCheck(item))) {
    violations.push(violation('pr.checks.invalid', 'Required check elements are malformed'));
  } else {
    for (const check of checks) {
      if (!checkPassed(check.status)) violations.push(violation('pr.check.failed', `Required check ${check.name} has not passed`));
      if (check.headSha !== currentHeadSha) violations.push(violation('pr.check.stale', `Required check ${check.name} is not for the current HEAD`));
    }
  }
  const reviews = data.requiredReviews;
  if (!denseArray(reviews) || reviews.length === 0) {
    violations.push(violation('pr.reviews.missing', 'Required review evidence is missing'));
  } else if (!reviews.every((item) => validRequiredReview(item))) {
    violations.push(violation('pr.reviews.invalid', 'Required review elements are malformed'));
  } else {
    for (const review of reviews) {
      if (!reviewApproved(review.status)) violations.push(violation('pr.review.unapproved', `Required review by ${review.reviewerId} is not approved`));
      if (review.headSha !== currentHeadSha) violations.push(violation('pr.review.stale', `Review by ${review.reviewerId} is not for the current HEAD`));
    }
  }
  if (data.unresolvedReviews !== undefined && data.unresolvedReviewCount !== undefined
    && data.unresolvedReviews !== data.unresolvedReviewCount) {
    violations.push(violation('pr.review.unresolved.conflict', 'Unresolved review aliases disagree'));
  }
  const unresolved = data.unresolvedReviews !== undefined ? data.unresolvedReviews : data.unresolvedReviewCount;
  if (unresolved === undefined) {
    violations.push(violation('pr.review.unresolved.unknown', 'Unresolved review count is unknown'));
  } else if (!Number.isSafeInteger(unresolved) || unresolved < 0 || unresolved > 0) {
    violations.push(violation('pr.review.unresolved', 'Unresolved review threads remain'));
  }
  const residualClosure = data.residualClosure !== undefined ? data.residualClosure : data.residuals;
  if (residualClosure === undefined) {
    violations.push(violation('pr.residuals.evidence.missing', 'Structured residual closure evidence is required'));
  } else if (!validateResidualClosure(residualClosure)) {
    violations.push(violation('pr.residuals.invalid', 'Residual closure requires owner, decision, target, and closure evidence'));
  }
  if (data.mergeable !== true) {
    violations.push(violation(data.mergeable === false ? 'pr.mergeable.false' : 'pr.mergeable.unknown', 'PR mergeability is not proven'));
  }

  if (violations.length > 0) return failure(prFailureKind(violations), violations);
  const validReviews = reviews as readonly RequiredReview[];
  const validResidualClosure = residualClosure as ResidualClosure;
  const tally = calculateReviewTally(validReviews, unresolved as number);
  return {
    kind: 'pass',
    value: { planId, taskId, baseSha, headSha, mergeReady: true, tally, score: tally.score, verdict: tally.verdict, residualClosure: validResidualClosure },
    evidence: data.evidence as readonly EvidenceRef[],
  };
}
