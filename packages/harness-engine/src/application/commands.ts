import type { WorkflowSnapshot } from '../domain/workflow.ts';
import type { EvidenceRef, RecoveryAction, Unknown, Violation } from '../core/result.ts';


export interface WorkflowCommandEnvelope {
  readonly workflowId: string;
  readonly planId?: string;
  readonly taskId?: string;
  readonly operationId: string;
  readonly actorId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly inputDigest: string;
}

export interface CreateWorkflowCommand extends WorkflowCommandEnvelope {}

export interface RegisterPlanCommand extends WorkflowCommandEnvelope {
  readonly planId: string;
  readonly title: string;
  readonly baseSha: string;
}


export interface WorkflowCommandResult<T> {
  readonly kind: 'applied' | 'rejected' | 'blocked' | 'unknown' | 'not-available';
  readonly value?: T;
  readonly revision: number;
  readonly operationId: string;
  readonly stage: string;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly failureRefs: readonly EvidenceRef[];
  readonly unknownFacts: readonly Unknown[];
  readonly violations: readonly Violation[];
  readonly recoveryActions: readonly RecoveryAction[];
}

export type WorkflowSnapshotResult = WorkflowCommandResult<WorkflowSnapshot>;
