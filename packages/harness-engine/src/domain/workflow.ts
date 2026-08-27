export type PlanStatus = 'Todo' | 'InProgress' | 'InReview' | 'Blocked' | 'Done';

/** 执行租约只描述协调所需的稳定字段；运行时任务数据不得进入快照。 */
export interface ExecutionLease {
  readonly holder?: string;
  readonly acquiredAt?: string;
  readonly expiresAt?: string;
  readonly [key: string]: unknown;
}

/** 合并租约只描述协调所需的稳定字段；运行时任务数据不得进入快照。 */
export interface IntegrationMergeLease {
  readonly holder?: string;
  readonly acquiredAt?: string;
  readonly expiresAt?: string;
  readonly [key: string]: unknown;
}

export interface PlanRow {
  readonly id: string;
  readonly title: string;
  readonly status: PlanStatus;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly executionLease?: ExecutionLease;
}

export interface WorkflowSnapshot {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly workflowId: string;
  readonly plans: readonly PlanRow[];
  readonly integrationMergeLease?: IntegrationMergeLease;
  /** 存储层返回的写入时间；调用方创建快照时可以省略。 */
  readonly updatedAt?: string;
}

export interface CompletionEvidence {
  readonly leaseRemaining?: boolean;
  readonly executionLeaseRemaining?: boolean;
  readonly integrationMergeLeaseRemaining?: boolean;
  readonly reviewRequired?: boolean;
  readonly reviewComplete?: boolean;
  readonly qaRequired?: boolean;
  readonly qaComplete?: boolean;
  readonly requiredReviewMissing?: boolean;
  readonly requiredQaMissing?: boolean;
}

const PLAN_STATUSES: readonly PlanStatus[] = ['Todo', 'InProgress', 'InReview', 'Blocked', 'Done'];

export function isPlanStatus(value: unknown): value is PlanStatus {
  return typeof value === 'string' && PLAN_STATUSES.includes(value as PlanStatus);
}

function assertCompletionEvidence(
  plan: PlanRow,
  evidence: CompletionEvidence | undefined,
): asserts evidence is CompletionEvidence {
  if (evidence === undefined) {
    throw new Error('Completion evidence is required before marking a plan Done');
  }

  const leaseRemains = plan.executionLease !== undefined
    || evidence.leaseRemaining === true
    || evidence.executionLeaseRemaining === true
    || evidence.integrationMergeLeaseRemaining === true;
  if (leaseRemains) {
    throw new Error('Cannot mark a plan Done while a lease remains');
  }

  const reviewMissing = evidence.requiredReviewMissing === true
    || (evidence.reviewRequired === true && evidence.reviewComplete !== true)
    || evidence.reviewComplete === false;
  if (reviewMissing) {
    throw new Error('Cannot mark a plan Done while required review evidence is missing');
  }

  const qaMissing = evidence.requiredQaMissing === true
    || (evidence.qaRequired === true && evidence.qaComplete !== true)
    || evidence.qaComplete === false;
  if (qaMissing) {
    throw new Error('Cannot mark a plan Done while required QA evidence is missing');
  }
}

export function transitionPlanStatus(
  plan: PlanRow,
  nextStatus: PlanStatus,
  evidence?: CompletionEvidence,
): PlanRow {
  if (!isPlanStatus(nextStatus)) {
    throw new TypeError(`Unknown plan status: ${String(nextStatus)}`);
  }
  if (nextStatus === 'Done') {
    assertCompletionEvidence(plan, evidence);
  }
  return { ...plan, status: nextStatus };
}
