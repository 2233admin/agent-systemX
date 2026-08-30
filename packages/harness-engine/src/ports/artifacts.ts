import type { WorkflowSnapshot } from '../domain/workflow';

export interface ApplicationWriteAuthorization {
  readonly kind: 'harness-application-write';
  readonly applicationId: string;
  readonly nonce: string;
}

export interface GuardedArtifactStore {
  readWorkflow(workflowId: string): Promise<WorkflowSnapshot | null>;
  writeWorkflow(
    expectedRevision: number,
    next: WorkflowSnapshot,
    authorization: ApplicationWriteAuthorization,
  ): Promise<void>;
}

export type ArtifactStore = GuardedArtifactStore;
