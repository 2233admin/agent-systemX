import type { Known, Unknown } from '../core/result.ts';

export interface OrcaWorkerRequest {
  readonly runId: string;
  readonly taskId: string;
  readonly objective: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly baseSha: string;
  readonly revisionId: string;
  readonly client: 'omp';
}

export interface OrcaWorkerResult {
  readonly runId: string;
  readonly taskId: string;
  readonly branch?: string;
  readonly dispatchId: string;
  readonly workerId?: string;
  readonly deliveryId?: string;
  readonly status: string;
  readonly worktreePath?: string;
  readonly command: readonly string[];
}

export type OrcaExecutionResult = Known<OrcaWorkerResult> | Unknown;

/**
 * The run slice depends on this port rather than the read-only ControlledOrcaAdapter.
 * A production implementation must start and read a real Orca worker.
 */
export interface OrcaExecutionPort {
  runWorker(request: OrcaWorkerRequest): Promise<OrcaExecutionResult>;
}
