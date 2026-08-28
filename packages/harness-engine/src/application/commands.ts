import type { CompletionEvidence, WorkflowSnapshot } from '../domain/workflow.ts';
import type { EvidenceRef, RecoveryAction, Unknown, Violation } from '../core/result.ts';
import type { DispatchInput } from '../gates/dispatch.ts';

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

export interface RegisterAssignmentCommand extends WorkflowCommandEnvelope {
  readonly taskId: string;
  readonly assignment: DispatchInput;
}

export interface PrepareExecutionCommand extends WorkflowCommandEnvelope {
  readonly taskId: string;
}

export interface ClaimExecutionLeaseCommand extends WorkflowCommandEnvelope {
  readonly worktreePath: string;
}

export interface TransitionPlanCommand extends WorkflowCommandEnvelope {
  readonly nextStatus: 'Todo' | 'InProgress' | 'InReview' | 'Blocked' | 'Done';
  readonly completionEvidence?: CompletionEvidence;
}

export interface AppendEvidenceCommand extends WorkflowCommandEnvelope {
  readonly evidence: readonly EvidenceRef[];
}

export interface ReleaseExecutionLeaseCommand extends WorkflowCommandEnvelope {
  readonly fencingToken: number;
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
