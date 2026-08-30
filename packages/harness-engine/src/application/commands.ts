import type { DispatchInput } from '../gates/dispatch.ts';
import type { ExecutionLeaseClaim, StaleProof } from '../domain/lease.ts';
import type { CompletionEvidence, PlanRow, PlanStatus } from '../domain/workflow.ts';

export interface RevisionedCommand {
  readonly expectedRevision: number;
}

export interface CreateWorkflowCommand extends RevisionedCommand {
  readonly workflowId?: string;
  readonly plan: Omit<PlanRow, 'status'> & { readonly status?: PlanStatus };
}

export interface RegisterPlanCommand extends RevisionedCommand {
  readonly plan: PlanRow;
}

export interface RegisterAssignmentCommand extends RevisionedCommand {
  readonly planId: string;
  readonly assignmentDigest: string;
  readonly executeAs: string;
  readonly branch: string;
  readonly worktreePath: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TransitionPlanCommand extends RevisionedCommand {
  readonly planId: string;
  readonly nextStatus: PlanStatus;
  readonly completionEvidence?: CompletionEvidence;
}

export interface ClaimExecutionLeaseCommand extends RevisionedCommand {
  readonly planId: string;
  readonly holderId: string;
  readonly worktreePath: string;
  readonly claimedAt: string;
  readonly staleProof?: StaleProof;
}

export interface ReleaseExecutionLeaseCommand extends RevisionedCommand {
  readonly planId: string;
  readonly holderId: string;
  readonly fencingToken: number;
}

export interface AppendCompletionEvidenceCommand extends RevisionedCommand {
  readonly planId: string;
  readonly evidence: CompletionEvidence;
}

export type ValidateCommand = DispatchInput;
