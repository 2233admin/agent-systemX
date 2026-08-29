import type { WorkflowCommandEnvelope, WorkflowCommandResult } from './commands.ts';
import type { DispatchInput } from '../gates/dispatch.ts';
import type { WorkflowSnapshot } from '../domain/workflow.ts';

export interface ReadWorkflowQuery extends WorkflowCommandEnvelope {}

export interface StatusQuery extends WorkflowCommandEnvelope {
  readonly consistency?: 'latest' | 'exact';
}

export interface ValidateQuery {
  readonly operationId: string;
  readonly actorId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly inputDigest: string;
  readonly assignment: DispatchInput;
}

export type StatusView = WorkflowCommandResult<WorkflowSnapshot>;
export type ValidationView = WorkflowCommandResult<unknown>;
