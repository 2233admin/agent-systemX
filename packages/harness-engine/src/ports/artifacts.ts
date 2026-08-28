import type { WorkflowSnapshot } from '../domain/workflow';
import type { RecoveryAction, Violation } from '../core/result';

export interface WorkflowWriteRequest {
  readonly expectedRevision: number;
  readonly next: WorkflowSnapshot;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly inputDigest: string;
}

export type WorkflowWriteResult =
  | {
      readonly kind: 'applied';
      readonly operationId: string;
      readonly revision: number;
      readonly value: WorkflowSnapshot;
    }
  | {
      readonly kind: 'conflict' | 'rejected';
      readonly operationId: string;
      readonly revision: number;
      readonly violations: readonly Violation[];
      readonly recoveryActions: readonly RecoveryAction[];
    };

export interface ArtifactStore {
  readWorkflow(workflowId: string): Promise<WorkflowSnapshot | null>;
  writeWorkflow(expectedRevision: number, next: WorkflowSnapshot): Promise<void>;
  writeWorkflowConditional(request: WorkflowWriteRequest): Promise<WorkflowWriteResult>;
}
